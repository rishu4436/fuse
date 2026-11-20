// Explanation engine: turns a transaction template + its fee accounting into plain-language steps,
// guarantees and risks. Every number is read from the template; nothing is taken from solver claims.
import type { TxTemplate } from '@fuse/transaction-composer';
import type { FeeAccounting } from './fees.js';

export interface Explanation { headline: string; steps: string[]; fees: Array<{ label: string; sats: bigint; note: string }>; guarantees: string[]; risks: string[] }
const fmt = (n: bigint) => n.toLocaleString('en-US');

export function explain(t: TxTemplate, acc: FeeAccounting, ctx: { tokenLabel: string; token: string; simulated: boolean; executionClass: string }): Explanation {
  const steps: string[] = [];
  const owner = acc.parties.find((p) => p.kind === 'owner');
  const vaultIn = t.inputs.find((i) => i.role === 'vault');
  const poolIns = t.inputs.filter((i) => i.role === 'pool');
  if (vaultIn) steps.push(`Borrow ${fmt(vaultIn.satoshis)} sats from a FlashVault shard; the same transaction must return ${fmt(vaultIn.satoshis + acc.vaultFee)} sats (fee ${fmt(acc.vaultFee)}) or it is invalid.`);
  for (const p of acc.parties.filter((x) => x.kind === 'pool')) {
    const tok = p.tokens[ctx.token] ?? 0n;
    steps.push(tok < 0n ? `Buy ${fmt(-tok)} ${ctx.tokenLabel} from ${p.party} for ${fmt(p.sats)} sats.` : tok > 0n ? `Sell ${fmt(tok)} ${ctx.tokenLabel} into ${p.party} for ${fmt(-p.sats)} sats.` : `Touch ${p.party} without changing its token balance.`);
  }
  if (poolIns.length === 0 && t.inputs.some((i) => i.role === 'solver')) steps.push('Solver delivers tokens from its own inventory.');
  const got = owner?.tokens[ctx.token] ?? 0n;
  if (owner) steps.push(`You receive ${fmt(got)} ${ctx.tokenLabel} and spend ${fmt(-owner.sats)} sats net (change returns to your address).`);
  for (const s of acc.parties.filter((x) => x.kind === 'solver')) steps.push(`${s.party} nets ${fmt(s.sats)} sats.`);
  const fees = [
    { label: 'Miner fee', sats: acc.minerFee, note: 'inputs − outputs' },
    ...(acc.vaultFee ? [{ label: 'FlashVault fee', sats: acc.vaultFee, note: 'accrues to LPs in the continuation output' }] : []),
    { label: 'Paid to pools', sats: acc.poolNetSats, note: 'net sats into AMM pools (price, incl. 0.3% Cauldron fee)' },
    { label: 'Solver net', sats: acc.solverNetSats, note: 'solver fee or arbitrage share' },
  ];
  const guarantees = [
    'Single transaction: every leg succeeds or none does (no partial state).',
    `Signed with SIGHASH_ALL|FORKID|UTXOS: your signature commits to every input and output.`,
    acc.conservation.sats && acc.conservation.tokens ? 'Value conservation verified: no sats or tokens unaccounted for.' : 'VALUE CONSERVATION FAILED',
    ...(vaultIn ? ['FlashVault covenant enforces repayment + fee and state continuation.'] : []),
  ];
  const risks = [
    ...(ctx.simulated ? ['Simulated LOCAL network: no real funds move.'] : []),
    'Pool UTXOs may be spent by someone else first; the transaction then fails safely and must be re-quoted.',
    ...(ctx.executionClass !== 'ATOMIC_SINGLE_TX' ? ['Not single-transaction atomic: staged recovery applies.'] : []),
  ];
  return { headline: `Receive ${fmt(got)} ${ctx.tokenLabel} for ${fmt(owner ? -owner.sats : 0n)} sats net in one atomic transaction`, steps, fees, guarantees, risks };
}
