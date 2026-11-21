// LIVE Cauldron V0 pools (PUSD). Discovery via the public Cauldron indexer; every pool used is re-verified from
// the raw transaction: re-hashed, script == P2SH32 of the published Cauldron artifact with the owner PKH,
// value/tokens taken from the decoded output, and the outpoint must still be unspent.
import { cauldronBuyQuote, cauldronSellQuote } from '@fuse/contracts';
import { contractLockingBytecode, type TokenSpec } from '@fuse/transaction-composer';
import { readSource } from './source.js';
import { outputAt, outspend, pool } from './chain.js';

export const PUSD = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
export interface LivePool { poolId: string; ownerPkh: string; txid: string; vout: number; satoshis: bigint; tokens: bigint; lockingBytecode: string; token: TokenSpec; satsPerUnit: number }
let cache: { at: number; pools: LivePool[]; indexerCount: number } | null = null;

export async function livePools(maxVerify = 5): Promise<{ pools: LivePool[]; indexerCount: number; checkedAt: string; source: string }> {
  if (cache && Date.now() - cache.at < 20_000) return { pools: cache.pools, indexerCount: cache.indexerCount, checkedAt: new Date(cache.at).toISOString(), source: 'indexer.cauldron.quest + bchexplorer.cash raw txs' };
  const base = process.env.FUSE_CAULDRON_INDEXER ?? 'https://indexer.cauldron.quest';
  const active = await readSource(base, async () => {
    const res = await fetch(base + '/cauldron/pool/active?token=' + PUSD, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) throw Object.assign(new Error('Cauldron indexer HTTP ' + res.status), { statusCode: 503 });
    const { active } = (await res.json()) as { active: Array<{ owner_pkh: string; txid: string; tx_pos: number; sats: number; tokens: number; pool_id: string }> };
    return active;
  });
  const cand = active.filter((a) => a.sats >= 200_000 && a.tokens >= 10).sort((a, b) => b.sats - a.sats).slice(0, maxVerify);
  const verified = await pool(cand, 4, async (a) => {
      const [o, sp] = await Promise.all([outputAt(a.txid, a.tx_pos), outspend(a.txid, a.tx_pos)]);
      const expected = contractLockingBytecode({ kind: 'cauldron-pool', ownerPkh: a.owner_pkh });
      if (sp.spent || o.lockingBytecode !== expected || o.token?.category !== PUSD || o.token.nft) return null;
      return { poolId: a.pool_id, ownerPkh: a.owner_pkh, txid: a.txid, vout: a.tx_pos, satoshis: o.satoshis, tokens: o.token.amount, lockingBytecode: o.lockingBytecode, token: o.token, satsPerUnit: Number(o.satoshis) / Number(o.token.amount) } as LivePool;
  });
  const pools = verified.filter((x): x is LivePool => x !== null);
  cache = { at: Date.now(), pools, indexerCount: active.length };
  return { pools, indexerCount: active.length, checkedAt: new Date().toISOString(), source: 'indexer.cauldron.quest + bchexplorer.cash raw txs' };
}

/** Round trip through a GIVEN pool pair (buy `units` on A, sell them on B); null when out of range. */
export function roundTripVia(a: LivePool, b: LivePool, units: bigint) {
  if (a === b || a.txid + a.vout === b.txid + b.vout || units >= a.tokens) return null;
  try { const buy = cauldronBuyQuote(a.satoshis, a.tokens, units); const sell = cauldronSellQuote(b.satoshis, b.tokens, units); return { a, b, satsIn: buy.satsIn, satsOut: sell.satsOut, loss: buy.satsIn - sell.satsOut, buy, sell }; } catch { return null; }
}
/** Best round trip (buy `units` on A, sell the same units on B) — the cheapest atomic route through two pools. */
export function bestRoundTrip(pools: LivePool[], units: bigint) {
  let best: { a: LivePool; b: LivePool; satsIn: bigint; satsOut: bigint; loss: bigint; buy: ReturnType<typeof cauldronBuyQuote>; sell: ReturnType<typeof cauldronSellQuote> } | null = null;
  for (const a of pools) for (const b of pools) {
    if (a === b || units >= a.tokens) continue;
    try {
      const buy = cauldronBuyQuote(a.satoshis, a.tokens, units); const sell = cauldronSellQuote(b.satoshis, b.tokens, units);
      const loss = buy.satsIn - sell.satsOut;
      if (!best || loss < best.loss) best = { a, b, satsIn: buy.satsIn, satsOut: sell.satsOut, loss, buy, sell };
    } catch { /* out of range */ }
  }
  return best;
}

export async function assertPoolsUnspent(ps: LivePool[]) {
  const sp = await Promise.all(ps.map((p) => outspend(p.txid, p.vout)));
  if (sp.some((x) => x.spent)) { cache = null; throw Object.assign(new Error('a Cauldron pool UTXO was just spent by another trader; prepare again to use the new pool state'), { statusCode: 409 }); }
}
