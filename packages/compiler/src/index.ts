// F03 Intent execution compiler. Stages: PARSE → AUTHORIZE → POLICY → RESOLVE → PLAN → COMPOSE →
// SIMULATE → CONSTRAIN → RANK → EXPLAIN. Each stage records timing and a verdict; the first hard failure
// stops the pipeline with a precise reason. Supports TOKEN_SWAP today; other intent types stop at RESOLVE
// with UNSUPPORTED (truthful), never with a fabricated plan.
import { parseIntent, intentCommitment, type Intent } from '@fuse/intent';
import { STRATEGIES, flashArbitrageTemplate, type MarketView, type SolverIdentity, type SwapIntentView, type UtxoView, type Bid } from '@fuse/solver-sdk';
import { dryRunCovenants, recomputeOutcome } from '@fuse/auction';
import { evaluatePolicy, type Policy, type SpendRecord } from '@fuse/policy-engine';
import { templateHash, type TxTemplate } from '@fuse/transaction-composer';
import { accountFees, type FeeAccounting } from './fees.js';
import { buildDeposit, buildWithdraw, type ShardRef, type Coin } from '@fuse/flash-liquidity';
import { explain, type Explanation } from './explain.js';
export * from './fees.js';
export * from './explain.js';

export const STAGES = ['PARSE', 'AUTHORIZE', 'POLICY', 'RESOLVE', 'PLAN', 'COMPOSE', 'SIMULATE', 'CONSTRAIN', 'RANK', 'EXPLAIN'] as const;
export type Stage = (typeof STAGES)[number];
export interface StageResult { stage: Stage; ok: boolean; ms: number; detail: string }
export interface Candidate { strategy: Bid['strategy']; solverId: string; ok: boolean; reasons: string[]; templateHash?: string; template?: TxTemplate; outcome?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint }; fees?: FeeAccounting }
export interface CompiledPlan { executionClass?: string; staged?: Array<{ id: string; description: string }>; ok: boolean; intentCommitment?: string; stages: StageResult[]; candidates: Candidate[]; selected?: Candidate; explanation?: Explanation; error?: { stage: Stage; reason: string } }

export interface CompileContext {
  market: MarketView;
  ownerCoins: UtxoView[];
  solvers: Array<{ strategy: Exclude<Bid['strategy'], 'ADVERSARIAL_FIXTURE'> | 'ADVERSARIAL_FIXTURE'; identity: SolverIdentity }>;
  policy?: { policy: Policy; history?: SpendRecord[] };
  tokenLabel?: string;
  now?: number;
  /** LP context for LIQUIDITY_DEPOSIT / LIQUIDITY_WITHDRAWAL (owner path of the FlashVault). */
  liquidity?: { lpLockingBytecode: string; lpCoins: Coin[]; shards: ShardRef[] };
}

/** Intent types whose execution needs Paryon V1 transaction builders that are not published. */
export const PARYON_BLOCKED = ['LOAN_REPAYMENT', 'COLLATERAL_TOP_UP', 'INTEREST_RATE_ADJUSTMENT', 'LOAN_REFINANCE', 'POSITION_DELEVERAGE', 'POSITION_EXIT', 'LIQUIDATION', 'REDEMPTION_ARBITRAGE'] as const;
export const COMPILED_TYPES = ['TOKEN_SWAP', 'ATOMIC_ARBITRAGE', 'LIQUIDITY_DEPOSIT', 'LIQUIDITY_WITHDRAWAL'] as const;
const POLICY_ACTION: Record<string, string> = { TOKEN_SWAP: 'TOKEN_SWAP', ATOMIC_ARBITRAGE: 'FLASH_LIQUIDITY', LIQUIDITY_DEPOSIT: 'LIQUIDITY_DEPOSIT', LIQUIDITY_WITHDRAWAL: 'LIQUIDITY_WITHDRAWAL' };

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
    if (i.atomicity === 'STAGED_RECOVERABLE' && i.type !== 'TOKEN_SWAP') throw new Error(`STAGED_RECOVERABLE is compiled for TOKEN_SWAP only (got ${i.type})`);
    if (i.atomicity === 'MONITOR_ONLY') throw new Error('MONITOR_ONLY atomicity has no execution plan');
    commit = intentCommitment(i);
    return { value: null, detail: `${i.authorizationMode} via ${i.owner.authorization}; commitment ${commit.slice(0, 16)}…` };
  });
  run('POLICY', () => {
    if (!ctx.policy) return { value: null, detail: 'no delegated policy: every transaction needs the owner signature' };
    const i = intent!;
    const d = evaluatePolicy(ctx.policy.policy, { action: (POLICY_ACTION[i.type] ?? i.type) as never, protocol: i.type.startsWith('LIQUIDITY') ? 'fuse-flashvault' : 'cauldron', asset: 'BCH', amount: i.maxInput?.amount ?? 0n, feeSats: i.maxFee.amount, outputs: [], recipient: i.owner.lockingBytecode, now, signer: 'delegate' }, ctx.policy.history ?? []);
    if (!d.allowed) throw new Error(`policy denies: ${d.reasons.join('; ')}`);
    return { value: null, detail: d.requiresApproval ? 'allowed, owner approval required' : 'allowed within policy limits' };
  });
  if (!failed && intent && intent.type !== 'TOKEN_SWAP') return compileSpecial(intent, ctx, run, stages, candidates, commit, () => failed);
  const view = run('RESOLVE', () => {
    const i = intent!;
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
      // A solver may get back its own inventory change, but must never end up with MORE of the bought token than it put in.
      const tok = (xs: Array<{ role?: string; token?: { category: string; amount: bigint } }>) => xs.filter((x) => x.role === 'solver' && x.token?.category === view!.buyToken).reduce((a, x) => a + x.token!.amount, 0n);
      const solverGain = tok(c.template!.outputs) - tok(c.template!.inputs as Array<{ role?: string; token?: { category: string; amount: bigint } }>);
      if (solverGain > 0n) c.reasons.push(`solver gains ${solverGain} of the bought token`);
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
  const staged = intent?.atomicity === 'STAGED_RECOVERABLE' ? [{ id: 'prepare', description: 'owner → owner: consolidate into one exact funding output' }, { id: 'swap', description: `${selected?.strategy ?? 'best route'} from the funding output; rebuilt from fresh state on conflict; stops RECOVERABLE with owner outputs listed` }] : undefined;
  return { ok: !failed, executionClass: intent?.atomicity, staged, intentCommitment: commit, stages, candidates, selected, explanation, error: failed };
}

type Run = <T>(stage: Stage, f: () => { value: T; detail: string }) => T | undefined;
/** ATOMIC_ARBITRAGE (owner flash arbitrage), LIQUIDITY_DEPOSIT / LIQUIDITY_WITHDRAWAL (FlashVault owner path),
 *  precise BLOCKED stops for Paryon write intents and UNSUPPORTED for the rest. */
function compileSpecial(i: Intent, ctx: CompileContext, run: Run, stages: StageResult[], candidates: Candidate[], commit: string | undefined, failedNow: () => CompiledPlan['error']): CompiledPlan {
  const done = (extra: Partial<CompiledPlan> = {}): CompiledPlan => ({ ok: !failedNow(), executionClass: i.atomicity, intentCommitment: commit, stages, candidates, error: failedNow(), ...extra });
  const resolved = run('RESOLVE', () => {
    if ((PARYON_BLOCKED as readonly string[]).includes(i.type)) throw new Error(`BLOCKED: ${i.type} needs Paryon V1 transaction builders (@paryonusd/library) that are not published; FUSE only reads Paryon state (see docs/INTEGRATION-FEASIBILITY.md)`);
    if (!(COMPILED_TYPES as readonly string[]).includes(i.type)) throw new Error(`UNSUPPORTED: ${i.type} is not compiled (compiled types: ${COMPILED_TYPES.join(', ')})`);
    if (i.protocols.includes('moria-v1-historical')) throw new Error('Moria V1 is disabled (Apr 2026) and is historical-only; it cannot be an execution venue');
    if (i.network !== ctx.market.network) throw new Error(`intent network ${i.network} ≠ market ${ctx.market.network}`);
    if (i.type === 'ATOMIC_ARBITRAGE') {
      if (!ctx.ownerCoins.some((c) => !c.token)) throw new Error('owner needs one plain BCH coin for the miner fee');
      return { value: i.type, detail: `${ctx.market.pools.length} pools, ${ctx.market.vault.shards.length} vault shards; profit asset BCH` };
    }
    if (!ctx.liquidity) throw new Error('no LP context: liquidity intents need the vault owner (LP) key context');
    if (ctx.liquidity.lpLockingBytecode !== i.owner.lockingBytecode) throw new Error('intent owner is not the vault LP: only the LP key can use the owner path');
    return { value: i.type, detail: `${ctx.liquidity.shards.length} shards, ${ctx.liquidity.lpCoins.length} LP coins` };
  });
  if (!resolved) return done();
  let template: TxTemplate | undefined; let strategy: Candidate['strategy'] = 'ROUTING';
  run('PLAN', () => {
    if (i.type === 'ATOMIC_ARBITRAGE') return { value: null, detail: 'flash arbitrage across the two most mispriced pools, owner keeps the profit' };
    return { value: null, detail: i.type === 'LIQUIDITY_DEPOSIT' ? 'owner-path deposit into the smallest shard with headroom' : 'owner-path withdrawal from the named (or largest) shard' };
  });
  run('COMPOSE', () => {
    if (i.type === 'ATOMIC_ARBITRAGE') {
      const fee = [...ctx.ownerCoins].filter((c) => !c.token).sort((a, b) => (a.satoshis < b.satoshis ? -1 : 1)).find((c) => c.satoshis >= 10_000n);
      if (!fee) throw new Error('no owner coin ≥ 10,000 sats for the miner fee');
      const minProfit = i.minOutput?.asset === 'BCH' ? i.minOutput.amount : 0n;
      const p = flashArbitrageTemplate(ctx.market, { lockingBytecode: i.owner.lockingBytecode, feeCoin: fee }, { minProfit });
      template = p.template; strategy = 'FLASH_LIQUIDITY';
      return { value: null, detail: `${p.tokens} tokens round-trip, expected profit ${p.profit} sats` };
    }
    const L = ctx.liquidity!;
    const amount = i.inputs.find((x) => x.asset === 'BCH')?.amount ?? 0n;
    if (amount <= 0n) throw new Error('inputs must contain a positive BCH amount');
    const named = typeof i.operation.params.shard === 'string' ? L.shards.find((s) => `${s.txid}:${s.vout}` === i.operation.params.shard) : undefined;
    if (i.operation.params.shard && !named) throw new Error(`shard ${String(i.operation.params.shard).slice(0, 12)}… not found`);
    const lp = { params: ctx.market.vault.params, vaultLockingBytecode: ctx.market.vault.lockingBytecode, lpLockingBytecode: L.lpLockingBytecode };
    if (i.type === 'LIQUIDITY_DEPOSIT') {
      const shard = named ?? [...L.shards].filter((s) => s.satoshis + amount <= ctx.market.vault.params.maxExposure).sort((a, b) => (a.satoshis < b.satoshis ? -1 : 1))[0];
      if (!shard) throw new Error(`no shard has headroom for ${amount} sats under maxExposure ${ctx.market.vault.params.maxExposure}`);
      const fund = [...L.lpCoins].filter((c) => !c.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
      if (!fund) throw new Error('LP has no plain BCH coin');
      template = buildDeposit(lp, shard, fund, amount);
    } else {
      const shard = named ?? [...L.shards].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
      if (!shard) throw new Error('vault has no shards');
      template = buildWithdraw(lp, shard, amount);
    }
    return { value: null, detail: `${template.inputs.length} inputs → ${template.outputs.length} outputs (LP owner path, 0x61 signature required)` };
  });
  const c: Candidate = { strategy, solverId: 'owner', ok: !!template, reasons: [], template, templateHash: template ? templateHash(template) : undefined };
  if (template) candidates.push(c);
  run('SIMULATE', () => {
    const d = dryRunCovenants(template!);
    if (!d.ok) throw new Error(`BCH VM: ${d.detail}`);
    const pools = Object.fromEntries(ctx.market.pools.map((p) => [p.id, p.lockingBytecode]));
    c.fees = accountFees(template!, { owner: i.owner.lockingBytecode, vault: ctx.market.vault.lockingBytecode, pools, solvers: {} });
    if (!c.fees.conservation.sats || !c.fees.conservation.tokens) throw new Error('value conservation failed');
    const ownerPath = template!.inputs.some((x) => x.unlock.kind === 'flashvault-bch-owner');
    return { value: null, detail: ownerPath ? 'owner-path inputs are signature-dependent: verified in the VM after the LP signs (0x61); value conservation checked' : `${d.detail}; value conservation checked` };
  });
  run('CONSTRAIN', () => {
    const t = template!;
    const inSats = t.inputs.reduce((s, x) => s + x.satoshis, 0n), outSats = t.outputs.reduce((s, x) => s + x.satoshis, 0n);
    const miner = inSats - outSats;
    if (miner > i.maxFee.amount) throw new Error(`miner fee ${miner} > maxFee ${i.maxFee.amount}`);
    if (i.type === 'ATOMIC_ARBITRAGE') {
      const ownerIn = t.inputs.filter((x) => x.lockingBytecode === i.owner.lockingBytecode).reduce((s, x) => s + x.satoshis, 0n);
      const ownerOut = t.outputs.filter((x) => x.lockingBytecode === i.owner.lockingBytecode).reduce((s, x) => s + x.satoshis, 0n);
      const min = i.minOutput?.asset === 'BCH' ? i.minOutput.amount : 1n;
      if (ownerOut - ownerIn < min) throw new Error(`owner profit ${ownerOut - ownerIn} < required ${min}`);
      c.outcome = { userReceivesTokens: 0n, userNetSpendSats: ownerIn - ownerOut, minerFeeSats: miner };
      return { value: null, detail: `owner nets ${ownerOut - ownerIn} sats; miner fee ${miner}` };
    }
    c.outcome = { userReceivesTokens: 0n, userNetSpendSats: 0n, minerFeeSats: miner };
    return { value: null, detail: `miner fee ${miner} ≤ ${i.maxFee.amount}; exposure cap enforced by the builder` };
  });
  const selected = run('RANK', () => ({ value: c, detail: 'single owner-built candidate (no solver competition for owner-only actions)' }));
  const explanation = run('EXPLAIN', () => {
    const e = explain(template!, c.fees!, { token: ctx.market.token, tokenLabel: ctx.tokenLabel ?? 'tokens', simulated: ctx.market.simulated, executionClass: i.atomicity });
    if (i.type !== 'ATOMIC_ARBITRAGE') e.headline = i.type === 'LIQUIDITY_DEPOSIT' ? `Deposit ${i.inputs[0]?.amount ?? 0n} sats into a FlashVault shard (LP owner path)` : `Withdraw ${i.inputs[0]?.amount ?? 0n} sats from a FlashVault shard (LP owner path)`;
    return { value: e, detail: e.headline };
  });
  return done({ selected, explanation });
}
export * from './netting.js';
export * from './worlds.js';
export * from './staged.js';
