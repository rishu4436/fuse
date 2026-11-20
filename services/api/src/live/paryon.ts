// LIVE Paryon V1 state for the Guardian. Oracle price: read now from the PriceContract(Guarded) UTXOs (raw txs
// re-hashed + decoded). Loans: the Loan-contract UTXO list is read now; loans whose outpoint is unchanged since the
// last snapshot reuse the decoded snapshot state, loans that moved or are new are decoded from their raw txs now
// (bounded per request, cached). Coverage is reported, never assumed.
import { PARYON_MAINNET_V1, paryonContracts, decodeLoanCommitment, decodePriceCommitment, collateralRatioBps, liquidationPriceCents } from '@fuse/protocol-adapters';
import { addressUtxosRaw, outputAt, pool, tip } from './paryon-io.js';
import { cashaddr } from './vault.js';

const dep = PARYON_MAINNET_V1; const cat = dep.tokenIds.paryonTokenId;
let contracts: ReturnType<typeof paryonContracts> | null = null;
const C = () => (contracts ??= paryonContracts(dep));
const decodedLoans = new Map<string, Record<string, string> | null>();
let cache: { at: number; value: unknown } | null = null;

export async function liveParyon(snapshot: { live?: { loans?: Array<Record<string, string>> }; checkedAt?: string } | null, budget = 160) {
  if (cache && Date.now() - cache.at < 45_000) return cache.value as Awaited<ReturnType<typeof compute>>;
  const value = await compute(snapshot, budget);
  cache = { at: Date.now(), value };
  return value;
}

async function compute(snapshot: { live?: { loans?: Array<Record<string, string>> }; checkedAt?: string } | null, budget: number) {
  const c = C();
  const [t, priceList, guardedList, loanList] = await Promise.all([tip(), addressUtxosRaw(cashaddr(c.price, true)), addressUtxosRaw(cashaddr(c.priceGuarded, true)), addressUtxosRaw(cashaddr(c.loan, true))]);
  const priceOuts = await pool([...priceList, ...guardedList].slice(0, 12), 4, (u) => outputAt(u.txid, u.vout).catch(() => null));
  const prices = priceOuts.filter((o): o is NonNullable<typeof o> => !!o && o.token?.category === cat && !!o.token.nft?.commitment.startsWith('00'))
    .map((o) => ({ outpoint: `${o.txid}:${o.vout}`, contract: o.lockingBytecode === c.priceGuarded ? 'PriceContractGuarded' : 'PriceContract', ...decodePriceCommitment(o.token!.nft!.commitment) }))
    .sort((a, b) => (b.sequence > a.sequence ? 1 : -1));
  const latest = prices[0] ?? null;
  const currentPeriod = (BigInt(t) - dep.contractParams.startBlockHeight) / dep.contractParams.periodLengthBlocks;
  const snapByOutpoint = new Map((snapshot?.live?.loans ?? []).map((l) => [l.outpoint, l]));
  const listed = loanList.map((u) => `${u.txid}:${u.vout}`);
  const unchanged = listed.filter((o) => snapByOutpoint.has(o));
  const moved = listed.filter((o) => !snapByOutpoint.has(o));
  const todo = moved.filter((o) => !decodedLoans.has(o)).slice(0, budget);
  await pool(todo, 10, async (op) => {
    const [txid, v] = op.split(':');
    try {
      const o = await outputAt(txid, Number(v));
      if (o.lockingBytecode !== c.loan || o.token?.category !== cat || o.token.nft?.capability !== 'mutable' || o.token.nft.commitment.length !== 54) { decodedLoans.set(op, null); return; }
      const s = decodeLoanCommitment(o.token.nft.commitment);
      decodedLoans.set(op, { outpoint: op, collateralSats: o.satoshis.toString(), debtCents: s.borrowedTokenAmount.toString(), beingRedeemed: s.amountBeingRedeemed.toString(), status: s.status, currentRateRaw: s.currentInterestRateRaw.toString(), nextRateRaw: s.nextInterestRateRaw.toString(), lastPeriodInterestPaid: s.lastPeriodInterestPaid.toString(), periodsBehind: '0', liquidationPriceCents: s.borrowedTokenAmount > 0n ? liquidationPriceCents(o.satoshis, s.borrowedTokenAmount).toString() : '', collateralRatioBps: '' });
    } catch { /* retried next request */ }
  });
  const loans = [...unchanged.map((o) => snapByOutpoint.get(o)!), ...moved.map((o) => decodedLoans.get(o)).filter((x): x is Record<string, string> => !!x)]
    .map((l): Record<string, string> => ({ ...l, periodsBehind: (currentPeriod - BigInt(l.lastPeriodInterestPaid)).toString(), collateralRatioBps: latest && BigInt(l.debtCents) > 0n ? String(collateralRatioBps(BigInt(l.collateralSats), latest.priceRaw, BigInt(l.debtCents))) : (null as unknown as string) }));
  return {
    mode: 'LIVE' as const, readAt: new Date().toISOString(), tipHeight: t, currentPeriod: currentPeriod.toString(),
    latestPrice: latest ? { ...latest, sequence: latest.sequence.toString(), priceRaw: latest.priceRaw.toString() } : null,
    priceStates: prices.map((p) => ({ ...p, sequence: p.sequence.toString(), priceRaw: p.priceRaw.toString() })),
    loans,
    coverage: { loanUtxosListed: listed.length, endpointCap: 200, reusedFromSnapshotUnchanged: unchanged.length, decodedLiveNow: moved.filter((o) => decodedLoans.get(o)).length, pendingDecode: moved.filter((o) => !decodedLoans.has(o)).length, snapshotCheckedAt: snapshot?.checkedAt ?? null, note: 'Loan list from the Loan-contract address UTXO endpoint (max 200 entries). Unchanged outpoints reuse the decoded snapshot state (an unchanged outpoint means an unchanged commitment); moved/new loans are decoded from raw txs now.' },
  };
}
