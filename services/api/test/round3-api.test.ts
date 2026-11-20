import { describe, it, expect, beforeAll } from 'vitest';
import { toJson, fromJson } from '@fuse/solver-sdk';
import { signRecipe, PRESETS } from '@fuse/recipes';
import { fixtureKey } from '@fuse/simulation';
import { binToHex } from '@bitauth/libauth';
import { buildApp } from '../src/app.js';
import { FuseState } from '../src/state.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const get = async <T>(url: string) => { const r = await app.inject({ method: 'GET', url }); expect(r.statusCode, r.body).toBe(200); return fromJson<T>(r.body); };
const post = async <T>(url: string, body: unknown, code = 200) => { const r = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: toJson(body) }); expect(r.statusCode, r.body).toBe(code); return fromJson<T>(r.body); };
beforeAll(async () => { app = await buildApp(new FuseState(process.cwd(), { auctionWindowSeconds: 4 })); });

describe('round 3 API', () => {
  it('typed compile: arbitrage + LP deposit compile, Paryon repayment is BLOCKED with the reason', async () => {
    const arb = await post<{ plan: { ok: boolean; selected: { strategy: string } } }>('/api/compile/typed', { type: 'ATOMIC_ARBITRAGE' });
    expect(arb.plan.ok).toBe(true); expect(arb.plan.selected.strategy).toBe('FLASH_LIQUIDITY');
    const dep = await post<{ plan: { ok: boolean; explanation: { headline: string } } }>('/api/compile/typed', { type: 'LIQUIDITY_DEPOSIT', amount: 3_000_000n });
    expect(dep.plan.ok).toBe(true); expect(dep.plan.explanation.headline).toMatch(/Deposit 3000000/);
    const rep = await post<{ plan: { ok: boolean; error: { stage: string; reason: string } } }>('/api/compile/typed', { type: 'LOAN_REPAYMENT' });
    expect(rep.plan.ok).toBe(false); expect(rep.plan.error.stage).toBe('RESOLVE'); expect(rep.plan.error.reason).toMatch(/^BLOCKED/);
  });
  it('staged run: competitor between stages → rebuild → completed; impossible minOut → RECOVERABLE with owner output', async () => {
    const ok = await post<{ status: string; stages: Array<{ attempts: Array<{ kind: string }> }> }>('/api/staged/run', { competitor: true });
    expect(ok.status).toBe('COMPLETED'); expect(ok.stages[1].attempts.map((a) => a.kind)).toContain('REBUILD');
    const bad = await post<{ status: string; recovery: { position: Array<{ unspent: boolean }> } }>('/api/staged/run', { minOut: 50_000_000n });
    expect(bad.status).toBe('RECOVERABLE'); expect(bad.recovery.position[0].unspent).toBe(true);
  });
  it('rate advice and redemption search are READ-ONLY and never executable', async () => {
    const r = await get<{ status: string; executable: boolean; candidates: unknown[] }>('/api/guardian/rates?multiple=2&demandCents=1000000');
    expect(r.status).toBe('READ-ONLY'); expect(r.executable).toBe(false); expect(r.candidates.length).toBeGreaterThan(1);
    const x = await get<{ status: string; best: { executable: boolean; redemptionPriceCents: bigint }; oraclePriceCents: bigint }>('/api/opportunities/redemption');
    expect(x.best.executable).toBe(false); expect(x.best.redemptionPriceCents).toBe((x.oraclePriceCents * 1005n) / 1000n);
  });
  it('marketplace: seeded recipes are verified (the unrepaid-borrow recipe is rejected), tampering is caught, nothing executes', async () => {
    const m = await get<{ autoExecute: boolean; recipes: Array<{ body: { name: string }; verdict: { listed: boolean; checks: Array<{ name: string; ok: boolean }> } }> }>('/api/marketplace/recipes');
    expect(m.autoExecute).toBe(false);
    const by = (n: string) => m.recipes.find((r) => r.body.name === n)!;
    expect(by('Flash back-run rebate').verdict.listed).toBe(true);
    expect(by('Plain best-pool route').verdict.listed).toBe(true);
    expect(by('Free money (unrepaid borrow)').verdict.listed).toBe(false);
    expect(by('Free money (unrepaid borrow)').verdict.checks.find((c) => c.name === 'structure')!.ok).toBe(false);
    const k = fixtureKey('test-author');
    const signed = signRecipe({ schema: 'fuse.recipe/v1', name: 'Tampered route', description: '', legs: PRESETS.ROUTING, bounds: { minOutTokens: '30000', maxInSats: '40000000' }, author: { pubkey: binToHex(k.pub), label: 't' }, createdAt: 1_795_000_001, tags: [] }, k.priv);
    const tampered = { ...signed, recipe: { ...signed.recipe, bounds: { ...signed.recipe.bounds, maxInSats: '99999999' } } };
    const v = await post<{ listed: boolean; checks: Array<{ name: string; ok: boolean }>; autoExecute: boolean }>('/api/marketplace/recipes', tampered);
    expect(v.listed).toBe(false); expect(v.checks.find((c) => c.name === 'content hash')!.ok).toBe(false); expect(v.autoExecute).toBe(false);
    const pub = await post<{ listed: boolean; signedWith: string }>('/api/marketplace/publish-local', { name: 'My routing recipe', legs: PRESETS.ROUTING });
    expect(pub.listed).toBe(true); expect(pub.signedWith).toMatch(/fixture/);
    expect((await get<{ counts: { recipes: number } }>('/api/store')).counts.recipes).toBe(6);
  });
});
