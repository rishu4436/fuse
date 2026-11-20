// F03 Intent execution compiler. Stages: PARSE → AUTHORIZE → POLICY → RESOLVE → PLAN → COMPOSE →
// SIMULATE → CONSTRAIN → RANK → EXPLAIN. Each stage records timing and a verdict; the first hard failure
// stops the pipeline with a precise reason. Supports TOKEN_SWAP today; other intent types stop at RESOLVE
// with UNSUPPORTED (truthful), never with a fabricated plan.
import { parseIntent, intentCommitment, type Intent } from '@fuse/intent';
import { STRATEGIES, type MarketView, type SolverIdentity, type SwapIntentView, type UtxoView, type Bid } from '@fuse/solver-sdk';
import { dryRunCovenants, recomputeOutcome } from '@fuse/auction';
import { evaluatePolicy, type Policy, type SpendRecord } from '@fuse/policy-engine';
import { templateHash, type TxTemplate } from '@fuse/transaction-composer';
import { accountFees, type FeeAccounting } from './fees.js';
import { explain, type Explanation } from './explain.js';
export * from './fees.js';
export * from './explain.js';

export const STAGES = ['PARSE', 'AUTHORIZE', 'POLICY', 'RESOLVE', 'PLAN', 'COMPOSE', 'SIMULATE', 'CONSTRAIN', 'RANK', 'EXPLAIN'] as const;
export type Stage = (typeof STAGES)[number];
export interface StageResult { stage: Stage; ok: boolean; ms: number; detail: string }
export interface Candidate { strategy: Bid['strategy']; solverId: string; ok: boolean; reasons: string[]; templateHash?: string; template?: TxTemplate; outcome?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint }; fees?: FeeAccounting }
export interface CompiledPlan { ok: boolean; intentCommitment?: string; stages: StageResult[]; candidates: Candidate[]; selected?: Candidate; explanation?: Explanation; error?: { stage: Stage; reason: string } }

export interface CompileContext {
  market: MarketView;
  ownerCoins: UtxoView[];
  solvers: Array<{ strategy: Exclude<Bid['strategy'], 'ADVERSARIAL_FIXTURE'> | 'ADVERSARIAL_FIXTURE'; identity: SolverIdentity }>;
  policy?: { policy: Policy; history?: SpendRecord[] };
  tokenLabel?: string;
  now?: number;
}

export function compileIntent(input: unknown, ctx: CompileContext): CompiledPlan {
  const stages: StageResult[] = [];
  const candidates: Candidate[] = [];
  let failed: CompiledPlan['error'];
  const run = <T>(stage: Stage, f: () => { value: T; detail: string }): T | undefined => {
    if (failed) return undefined;
    const t0 = performance.now();
    try { const r = f(); stages.push({ stage, ok: true, ms: performance.now() - t0, detail: r.detail }); return r.value; }
    catch (e) { const reason = (e as Error).message.split('\n')[0]; stages.push({ stage, ok: false, ms: performance.now() - t0, detail: reason }); failed = { stage, reason }; return undefined; }
  };
  const now = ctx.now ?? Math.floor(Date.now() / 1000);
  const intent = run('PARSE', () => { const i = parseIntent(input, now); return { value: i, detail: `${i.type} intent ${i.id} (schema FEP intent v1)` }; });
  let commit: string | undefined;
  run('AUTHORIZE', () => {
    const i = intent!;
    if (i.authorizationMode === 'MONITOR_ONLY') throw new Error('MONITOR_ONLY intent: FUSE can watch and alert but has no execution authority');
    if (i.atomicity !== 'ATOMIC_SINGLE_TX') throw new Error(`atomicity ${i.atomicity} not compiled yet (only ATOMIC_SINGLE_TX)`);
    commit = intentCommitment(i);
    return { value: null, detail: `${i.authorizationMode} via ${i.owner.authorization}; commitment ${commit.slice(0, 16)}…` };
  });
  run('POLICY', () => {
    if (!ctx.policy) return { value: null, detail: 'no delegated policy: every transaction needs the owner signature' };
    const i = intent!;
    const d = evaluatePolicy(ctx.policy.policy, { action: 'TOKEN_SWAP', protocol: 'cauldron', asset: 'BCH', amount: i.maxInput?.amount ?? 0n, feeSats: i.maxFee.amount, outputs: [], recipient: i.owner.lockingBytecode, now, signer: 'delegate' }, ctx.policy.history ?? []);
    if (!d.allowed) throw new Error(`policy denies: ${d.reasons.join('; ')}`);
    return { value: null, detail: d.requiresApproval ? 'allowed, owner approval required' : 'allowed within policy limits' };
  });
  const view = run('RESOLVE', () => {
    const i = intent!;
    if (i.type !== 'TOKEN_SWAP') throw new Error(`UNSUPPORTED: compiler handles TOKEN_SWAP today; ${i.type} is not compiled`);
    if (i.protocols.includes('moria-v1-historical')) throw new Error('Moria V1 is disabled (Apr 2026) and is historical-only; it cannot be an execution venue');
    if (i.network !== ctx.market.network) throw new Error(`intent network ${i.network} ≠ market ${ctx.market.network}`);
    if (!i.minOutput || i.minOutput.asset === 'BCH') throw new Error('TOKEN_SWAP needs minOutput in a CashToken category');
    if (i.minOutput.asset !== ctx.market.token) throw new Error(`no known pools for category ${i.minOutput.asset.slice(0, 12)}…`);
    if (!i.maxInput || i.maxInput.asset !== 'BCH') throw new Error('TOKEN_SWAP needs maxInput in BCH');
    if (!ctx.ownerCoins.some((c) => !c.token)) throw new Error('owner has no spendable BCH coins');
    const v: SwapIntentView = { auctionId: 'compile', intentId: i.id, intentCommitment: commit!, type: 'TOKEN_SWAP', owner: { lockingBytecode: i.owner.lockingBytecode, coins: ctx.ownerCoins }, buyToken: i.minOutput.asset, minOut: i.minOutput.amount, maxIn: i.maxInput.amount, maxFee: i.maxFee.amount, deadline: i.deadline };
    return { value: v, detail: `${ctx.market.pools.length} pools, ${ctx.market.vault.shards.length} vault shards, ${ctx.ownerCoins.length} owner coins` };
  });
  run('PLAN', () => {
    for (const s of ctx.solvers) candidates.push({ strategy: s.strategy, solverId: s.identity.id, ok: true, reasons: [] });
    if (!candidates.length) throw new Error('no strategies available');
    return { value: null, detail: candidates.map((c) => c.strategy).join(', ') };
  });
  run('COMPOSE', () => {
    ctx.solvers.forEach((s, k) => {
      const c = candidates[k];
      try { const p = STRATEGIES[s.strategy](ctx.market, view!, s.identity); c.template = p.template; c.templateHash = templateHash(p.template); }
      catch (e) { c.ok = false; c.reasons.push(`compose: ${(e as Error).message}`); }
    });
    const n = candidates.filter((c) => c.template).length;
    if (!n) throw new Error(`no strategy could compose a transaction: ${candidates.map((c) => c.reasons[0]).join('; ')}`);
    return { value: null, detail: `${n}/${candidates.length} templates composed` };
  });
  run('SIMULATE', () => {
    for (const c of candidates.filter((x) => x.template)) {
      const d = dryRunCovenants(c.template!);
      if (!d.ok) { c.ok = false; c.reasons.push(`BCH VM: ${d.detail}`); }
      const pools = Object.fromEntries(ctx.market.pools.map((p) => [p.id, p.lockingBytecode]));
      const solverLb = ctx.solvers.find((s) => s.identity.id === c.solverId)!.identity.lockingBytecode;
      c.fees = accountFees(c.template!, { owner: view!.owner.lockingBytecode, vault: ctx.market.vault.lockingBytecode, pools, solvers: { [`solver ${c.strategy.toLowerCase()}`]: solverLb } });
      if (!c.fees.conservation.sats || !c.fees.conservation.tokens) { c.ok = false; c.reasons.push('value conservation failed'); }
    }
    const n = candidates.filter((c) => c.ok && c.template).length;
    if (!n) throw new Error('every template failed BCH VM simulation');
    return { value: null, detail: `${n} template(s) valid in BCH 2026 VM (covenant inputs)` };
  });
  run('CONSTRAIN', () => {
    for (const c of candidates.filter((x) => x.ok && x.template)) {
      const o = recomputeOutcome(c.template!, view!.owner.lockingBytecode, view!.buyToken);
      c.outcome = o;
      if (o.userReceivesTokens < view!.minOut) c.reasons.push(`delivers ${o.userReceivesTokens} < minOut ${view!.minOut}`);
      if (o.userNetSpendSats > view!.maxIn) c.reasons.push(`net spend ${o.userNetSpendSats} > maxIn ${view!.maxIn}`);
      if (o.minerFeeSats > view!.maxFee) c.reasons.push(`miner fee ${o.minerFeeSats} > maxFee ${view!.maxFee}`);
      if (c.template!.outputs.some((x) => x.token?.category === view!.buyToken && x.role === 'solver')) c.reasons.push('solver output receives the bought token');
      if (c.reasons.length) c.ok = false;
    }
    const n = candidates.filter((c) => c.ok).length;
    if (!n) throw new Error(`no candidate satisfies the intent bounds: ${candidates.flatMap((c) => c.reasons).join('; ')}`);
    return { value: null, detail: `${n} candidate(s) within minOut/maxIn/maxFee` };
  });
  const selected = run('RANK', () => {
    const ok = candidates.filter((c) => c.ok).sort((a, b) => (a.outcome!.userNetSpendSats < b.outcome!.userNetSpendSats ? -1 : 1));
    return { value: ok[0], detail: `best: ${ok[0].strategy} at ${ok[0].outcome!.userNetSpendSats} sats net` };
  });
  const explanation = run('EXPLAIN', () => {
    const e = explain(selected!.template!, selected!.fees!, { token: view!.buyToken, tokenLabel: ctx.tokenLabel ?? 'tokens', simulated: ctx.market.simulated, executionClass: (intent as Intent).atomicity });
    return { value: e, detail: e.headline };
  });
  return { ok: !failed, intentCommitment: commit, stages, candidates, selected, explanation, error: failed };
}
