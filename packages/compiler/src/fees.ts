// F08 Accurate fee accounting: exact per-party BigInt deltas read from the template itself.
// Invariant (tested): Σ party sat deltas + miner fee = 0, and Σ token deltas per category = 0.
import type { TxTemplate } from '@fuse/transaction-composer';

export type PartyKind = 'owner' | 'vault' | 'pool' | 'solver' | 'other';
export interface PartyMap { owner: string; vault?: string; pools?: Record<string, string>; solvers?: Record<string, string> }
export interface PartyDelta { party: string; kind: PartyKind; lockingBytecode: string; sats: bigint; tokens: Record<string, bigint> }
export interface FeeAccounting {
  parties: PartyDelta[];
  minerFee: bigint;
  vaultFee: bigint;
  poolNetSats: bigint;
  solverNetSats: bigint;
  ownerNetSats: bigint;
  conservation: { sats: boolean; tokens: boolean };
}

export function accountFees(t: TxTemplate, map: PartyMap): FeeAccounting {
  const nameOf = (lb: string): [string, PartyKind] => {
    if (lb === map.owner) return ['owner', 'owner'];
    if (lb === map.vault) return ['FlashVault', 'vault'];
    for (const [id, p] of Object.entries(map.pools ?? {})) if (p === lb) return [id, 'pool'];
    for (const [id, p] of Object.entries(map.solvers ?? {})) if (p === lb) return [id, 'solver'];
    return [`script ${lb.slice(0, 10)}…`, 'other'];
  };
  const by = new Map<string, PartyDelta>();
  const touch = (lb: string) => { let d = by.get(lb); if (!d) { const [party, kind] = nameOf(lb); d = { party, kind, lockingBytecode: lb, sats: 0n, tokens: {} }; by.set(lb, d); } return d; };
  for (const i of t.inputs) { const d = touch(i.lockingBytecode); d.sats -= i.satoshis; if (i.token && i.token.amount > 0n) d.tokens[i.token.category] = (d.tokens[i.token.category] ?? 0n) - i.token.amount; }
  for (const o of t.outputs) { const d = touch(o.lockingBytecode); d.sats += o.satoshis; if (o.token && o.token.amount > 0n) d.tokens[o.token.category] = (d.tokens[o.token.category] ?? 0n) + o.token.amount; }
  const parties = [...by.values()];
  const minerFee = t.inputs.reduce((s, i) => s + i.satoshis, 0n) - t.outputs.reduce((s, o) => s + o.satoshis, 0n);
  const sum = (k: PartyKind) => parties.filter((p) => p.kind === k).reduce((s, p) => s + p.sats, 0n);
  const cats = new Set(parties.flatMap((p) => Object.keys(p.tokens)));
  const tokensOk = [...cats].every((c) => parties.reduce((s, p) => s + (p.tokens[c] ?? 0n), 0n) === 0n);
  return {
    parties, minerFee, vaultFee: sum('vault'), poolNetSats: sum('pool'), solverNetSats: sum('solver'), ownerNetSats: sum('owner'),
    conservation: { sats: parties.reduce((s, p) => s + p.sats, 0n) + minerFee === 0n, tokens: tokensOk },
  };
}
