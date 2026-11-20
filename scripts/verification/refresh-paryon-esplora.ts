// Paryon V1 live-state refresh through an alternative indexer when Chaingraph's category query fails
// ("database query error": the unspent anti-join on the Loan script times out server side).
// Source: bchexplorer.cash (mempool/esplora-style REST API backed by Fulcrum). Nothing from the API is trusted:
// every UTXO is resolved to its raw transaction, re-hashed locally (txid must match), decoded with libauth, and
// its output must sit at the reconstructed Loan / Price script, carry the Paryon category as a mutable NFT and
// decode as a loan / price commitment. READ-ONLY: no transaction is built or broadcast.
//
// Coverage: the address UTXO endpoint returns at most 200 entries, so loans are discovered as the UNION of
// (a) the endpoint's UTXO list and (b) every loan from the previous snapshot traced forward through its
// spending transactions to its current unspent continuation. Loans opened since the previous snapshot that
// fall outside the 200-entry window can be missed; the report states the coverage explicitly.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { binToHex, hexToBin, hash256, decodeTransaction, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { PARYON_MAINNET_V1, paryonContracts, decodeLoanCommitment, decodePriceCommitment, collateralRatioBps, liquidationPriceCents } from '../../packages/protocol-adapters/src/paryon.js';

const API = process.env.FUSE_ESPLORA ?? 'https://bchexplorer.cash/api';
const file = new URL('../../evidence/paryon-deployment-verification.json', import.meta.url);
const prev = JSON.parse(readFileSync(file, 'utf8'));
const dep = PARYON_MAINNET_V1;
const c = paryonContracts(dep);
const cat = dep.tokenIds.paryonTokenId;
const addr = (lb: string) => { const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(lb), prefix: 'bitcoincash', tokenSupport: true } as never); return typeof r === 'string' ? r : (r as { address: string }).address; };

// Fetched with the system curl client (the API serves plain HTTP clients; browsers get a JS challenge).
const run = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted JSON, every field is re-derived from raw txs
async function get(path: string, text = false, tries = 4): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const { stdout } = await run('curl', ['-sS', '--fail', '-m', '30', API + path], { maxBuffer: 64 * 1024 * 1024 });
      return text ? stdout : JSON.parse(stdout);
    } catch (e) { if (i >= tries) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
type Decoded = Exclude<ReturnType<typeof decodeTransaction>, string>;
const rawCache = new Map<string, Decoded>();
async function tx(txid: string): Promise<Decoded> {
  const hit = rawCache.get(txid); if (hit) return hit;
  const hex: string = (await get(`/tx/${txid}/hex`, true)).trim();
  const local = binToHex(hash256(hexToBin(hex)).reverse());
  if (local !== txid) throw new Error(`raw tx re-hash mismatch for ${txid}`);
  const d = decodeTransaction(hexToBin(hex));
  if (typeof d === 'string') throw new Error(d);
  rawCache.set(txid, d);
  return d;
}
async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let k = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (k < xs.length) { const i = k++; out[i] = await f(xs[i]); } }));
  return out;
}
const outAt = async (outpoint: string) => {
  const [txid, v] = outpoint.split(':'); const d = await tx(txid); const o = d.outputs[Number(v)];
  return { outpoint, lockingBytecode: binToHex(o.lockingBytecode), valueSatoshis: o.valueSatoshis, category: o.token ? binToHex(o.token.category) : null, capability: o.token?.nft?.capability ?? null, commitment: o.token?.nft ? binToHex(o.token.nft.commitment) : null };
};

const tip = Number(await get('/blocks/tip/height', true));
// (a) endpoint UTXO lists
const listed = async (lb: string) => (await get(`/address/${addr(lb)}/utxo`)) as Array<{ txid: string; vout: number }>;
const [loanListed, priceListed, guardedListed] = await Promise.all([listed(c.loan), listed(c.price), listed(c.priceGuarded)]);
// (b) trace previous snapshot loans forward
const traced = new Set<string>(); let spentSincePrev = 0; let closed = 0; const dropped: string[] = []; const untraceable: string[] = [];
await pool(prev.live.loans.map((l: { outpoint: string }) => l.outpoint) as string[], 6, async (op) => {
  let cur = op;
  for (let depth = 0; depth < 12; depth++) {
    const [txid, v] = cur.split(':');
    let s: { spent: boolean; txid: string };
    try { s = await get(`/tx/${txid}/outspend/${v}`, false, 2); }
    catch {
      // Distinguish "this tx no longer exists" (an unconfirmed tx captured by the previous snapshot that was later
      // dropped / double-spent) from an indexer failure. Never guessed: both are counted and reported.
      const { stdout } = await run('curl', ['-sS', '-m', '30', `${API}/tx/${txid}`]).catch(() => ({ stdout: '' }));
      (/No such mempool or blockchain transaction/.test(stdout) ? dropped : untraceable).push(cur); return;
    }
    if (!s.spent) { traced.add(cur); return; }
    if (depth === 0) spentSincePrev++;
    const d = await tx(s.txid);
    const next = d.outputs.findIndex((o) => binToHex(o.lockingBytecode) === c.loan && o.token && binToHex(o.token.category) === cat && o.token.nft?.capability === 'mutable');
    if (next < 0) { closed++; return; }
    cur = `${s.txid}:${next}`;
  }
});
const candidates = [...new Set([...loanListed.map((u) => `${u.txid}:${u.vout}`), ...traced])];
const outs = await pool(candidates, 6, outAt);
const loanUtxos = outs.filter((o) => o.lockingBytecode === c.loan);
const priceOuts = await pool([...priceListed, ...guardedListed].map((u) => `${u.txid}:${u.vout}`), 6, outAt);
const priceStates = priceOuts.filter((u) => (u.lockingBytecode === c.price || u.lockingBytecode === c.priceGuarded) && u.category === cat && u.commitment?.startsWith('00'))
  .map((u) => ({ outpoint: u.outpoint, contract: u.lockingBytecode === c.priceGuarded ? 'PriceContractGuarded' : 'PriceContract', ...decodePriceCommitment(u.commitment!) }))
  .sort((a, b) => (b.sequence > a.sequence ? 1 : b.sequence < a.sequence ? -1 : 0));
const price = priceStates[0]?.priceRaw ?? null;
const currentPeriod = (BigInt(tip) - dep.contractParams.startBlockHeight) / dep.contractParams.periodLengthBlocks;
const loans = loanUtxos.filter((u) => u.category === cat && u.capability === 'mutable' && u.commitment?.length === 54).map((u) => {
  const s = decodeLoanCommitment(u.commitment!);
  const ratio = price ? collateralRatioBps(u.valueSatoshis, price, s.borrowedTokenAmount) : null;
  return {
    outpoint: u.outpoint, collateralSats: u.valueSatoshis.toString(), debtCents: s.borrowedTokenAmount.toString(), beingRedeemed: s.amountBeingRedeemed.toString(),
    status: s.status, currentRateRaw: s.currentInterestRateRaw.toString(), nextRateRaw: s.nextInterestRateRaw.toString(), lastPeriodInterestPaid: s.lastPeriodInterestPaid.toString(),
    collateralRatioBps: ratio?.toString() ?? null, periodsBehind: (currentPeriod - s.lastPeriodInterestPaid).toString(),
    liquidationPriceCents: s.borrowedTokenAmount > 0n ? liquidationPriceCents(u.valueSatoshis, s.borrowedTokenAmount).toString() : null,
  };
});
const activeLoans = loans.filter((l) => BigInt(l.periodsBehind) <= 1n && l.debtCents !== '0');
const ratios = activeLoans.map((l) => Number(l.collateralRatioBps ?? 0)).filter((x) => x > 0).sort((a, b) => a - b);
const report = {
  ...prev,
  checkedAt: new Date().toISOString(), tipHeight: tip,
  liveSource: { indexer: API, method: 'address UTXO endpoint ∪ previous-snapshot loans traced through outspends; every raw tx re-hashed locally and decoded with libauth', chaingraphStatus: 'category / locking-bytecode unspent queries failed: "database query error" (~60 s server-side timeout)', previousCheckedAt: prev.checkedAt },
  live: {
    priceContractUtxosAtReconstructedScripts: priceOuts.length, latestPrice: priceStates[0] ?? null, priceStates: priceStates.slice(0, 5),
    unspentMutableParyonNfts: null, otherMutableScripts: null,
    loanUtxosAtLoanContract: loanUtxos.length, decodedLoans: loans.length,
    coverage: { endpointLoanUtxos: loanListed.length, endpointCap: 200, tracedFromPreviousSnapshot: traced.size, previousLoans: prev.live.loans.length, previousLoansSpentSince: spentSincePrev, previousLoansClosed: closed, previousOutpointsDroppedUnconfirmed: dropped.length, previousOutpointsUntraceable: untraceable.length, droppedExamples: dropped.slice(0, 5), note: 'Loans opened since the previous snapshot beyond the 200-entry endpoint window may be missing.' },
    collateralRatioBps: ratios.length ? { min: ratios[0], median: ratios[Math.floor(ratios.length / 2)], max: ratios[ratios.length - 1] } : null,
    currentPeriod: currentPeriod.toString(), activeLoans: activeLoans.length, staleLoans: loans.length - activeLoans.length,
    activeLoanRatioNote: 'collateralRatioBps stats are over active loans (interest paid within 1 period, debt > 0)',
    loans,
  },
};
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
console.log(j({ checkedAt: report.checkedAt, tipHeight: tip, latestPrice: report.live.latestPrice, decodedLoans: loans.length, activeLoans: activeLoans.length, coverage: report.live.coverage, collateralRatioBps: report.live.collateralRatioBps }));
writeFileSync(file, j(report) + '\n');
