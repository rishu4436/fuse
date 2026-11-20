// F42 Parallel Worlds: compile the SAME intent against perturbed copies of the market (price moves,
// liquidity drain, paused vault, missing solvers) and compare outcomes. Pure and deterministic.
import { cauldronBuyQuote } from '@fuse/contracts';
import { encodeVaultState, decodeVaultState } from '@fuse/contracts';
import type { MarketView } from '@fuse/solver-sdk';
import { compileIntent, type CompileContext, type CompiledPlan } from './index.js';

export interface WorldScenario { id: string; label: string; poolPriceBps?: Record<string, number>; poolDepthBps?: Record<string, number>; pauseVault?: boolean; dropStrategies?: string[] }
export const DEFAULT_WORLDS: WorldScenario[] = [
  { id: 'base', label: 'Current market' },
  { id: 'gap-closed', label: 'Arbitrage gap closed (pool B = pool A price)', poolPriceBps: { 'pool-B': -1304 } },
  { id: 'gap-wider', label: 'Pool B 10% richer', poolPriceBps: { 'pool-B': 1000 } },
  { id: 'thin', label: 'Both pools lose 70% depth', poolDepthBps: { 'pool-A': -7000, 'pool-B': -7000 } },
  { id: 'vault-paused', label: 'FlashVault paused by LP', pauseVault: true },
  { id: 'routing-only', label: 'Only the routing solver is online', dropStrategies: ['DIRECT_LIQUIDITY', 'FLASH_LIQUIDITY'] },
];

/** Price move keeps token depth and scales sats (spot price ×(1+bps)); depth move scales both sides. */
export function perturb(m: MarketView, s: WorldScenario): MarketView {
  const v = structuredClone(m);
  for (const p of v.pools) {
    const pb = BigInt(s.poolPriceBps?.[p.id] ?? 0), db = BigInt(s.poolDepthBps?.[p.id] ?? 0);
    p.utxo.satoshis = (p.utxo.satoshis * (10_000n + pb)) / 10_000n;
    if (db) { p.utxo.satoshis = (p.utxo.satoshis * (10_000n + db)) / 10_000n; p.utxo.token = { ...p.utxo.token!, amount: (p.utxo.token!.amount * (10_000n + db)) / 10_000n }; }
  }
  if (s.pauseVault) for (const sh of v.vault.shards) sh.token = { ...sh.token!, nft: { ...sh.token!.nft!, commitment: encodeVaultState({ ...decodeVaultState(sh.token!.nft!.commitment), paused: true }) } };
  return v;
}

export interface WorldResult { scenario: WorldScenario; ok: boolean; strategy?: string; userNetSpendSats?: bigint; deltaVsBaseSats?: bigint; failedAt?: string; reason?: string; poolOnlyCostSats: bigint; plan: CompiledPlan }
export function parallelWorlds(intent: unknown, ctx: CompileContext, worlds = DEFAULT_WORLDS, minOut?: bigint): WorldResult[] {
  const res = worlds.map((w) => {
    const market = perturb(ctx.market, w);
    const plan = compileIntent(intent, { ...ctx, market, solvers: ctx.solvers.filter((s) => !(w.dropStrategies ?? []).includes(s.strategy)) });
    const x = minOut ?? plan.candidates[0]?.outcome?.userReceivesTokens ?? 0n;
    const best = market.pools.map((p) => { try { return cauldronBuyQuote(p.utxo.satoshis, p.utxo.token!.amount, x).satsIn; } catch { return 1n << 62n; } }).reduce((a, b) => (b < a ? b : a));
    return { scenario: w, ok: plan.ok, strategy: plan.selected?.strategy, userNetSpendSats: plan.selected?.outcome?.userNetSpendSats, failedAt: plan.error?.stage, reason: plan.error?.reason, poolOnlyCostSats: best, plan };
  });
  const base = res[0]?.userNetSpendSats;
  return res.map((r) => ({ ...r, deltaVsBaseSats: base !== undefined && r.userNetSpendSats !== undefined ? r.userNetSpendSats - base : undefined }));
}
