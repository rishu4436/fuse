// More compiled intent types: ATOMIC_ARBITRAGE, LIQUIDITY_DEPOSIT / LIQUIDITY_WITHDRAWAL, STAGED_RECOVERABLE
// planning, and precise BLOCKED stops for Paryon write intents. Every composed template is signed and then
// accepted (or not) by the LOCAL BCH VM chain, not just checked structurally.
import { describe, it, expect } from 'vitest';
import { createLocalMarket, liveMarketView, utxosOf } from '@fuse/simulation';
import { contractUnlocks, finalize, signInputs, verifyTemplateAndRaw } from '@fuse/transaction-composer';
import { compileIntent, STAGES, type CompileContext } from '../src/index.js';

const now = Math.floor(Date.now() / 1000);
const base = (m: ReturnType<typeof createLocalMarket>, over: Record<string, unknown>) => ({
  version: 1, id: 'intent_types_00001', network: 'local', owner: { lockingBytecode: m.user.lockingBytecode, authorization: 'WALLET_SIGNATURE' },
  inputs: [], allowedAssets: ['BCH', m.token], maxFee: { asset: 'BCH', amount: '20000' }, maxSlippageBps: 100, deadline: now + 600,
  protocols: ['cauldron', 'fuse-flashvault'], authorizationMode: 'PER_TX_SIGNATURE', nonce: '00112233445566778899', replayDomain: 'fuse-local',
  atomicity: 'ATOMIC_SINGLE_TX', requiredEvidence: ['TX_CONFIRMED', 'CERTIFICATE'], ...over,
});
const shardRefs = async (m: ReturnType<typeof createLocalMarket>) => (await m.provider.getUtxos(m.vault.tokenAddress)).filter((u) => u.token?.nft && u.token.category === m.vaultParams.vaultCategory).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));
async function ctxOf(m: ReturnType<typeof createLocalMarket>): Promise<CompileContext> {
  return {
    market: await liveMarketView(m), ownerCoins: (await utxosOf(m, m.user.address)).filter((c) => !c.token), solvers: [], tokenLabel: 'FUSD', now,
    liquidity: { lpLockingBytecode: m.lp.lockingBytecode, lpCoins: (await utxosOf(m, m.lp.address)) as never, shards: await shardRefs(m) },
  };
}

describe('compiler: additional intent types', () => {
  it('ATOMIC_ARBITRAGE: owner flash arbitrage compiles through all stages and the signed tx is accepted by the BCH VM chain', async () => {
    const m = createLocalMarket();
    const p = compileIntent(base(m, { type: 'ATOMIC_ARBITRAGE', operation: { kind: 'ATOMIC_ARBITRAGE', params: {} }, minOutput: { asset: 'BCH', amount: '1000' } }), await ctxOf(m));
    expect(p.error).toBeUndefined();
    expect(p.stages.map((s) => s.stage)).toEqual([...STAGES]);
    const t = p.selected!.template!;
    expect(t.inputs.some((i) => i.unlock.kind === 'flashvault-bch')).toBe(true);
    const profit = -p.selected!.outcome!.userNetSpendSats;
    expect(profit).toBeGreaterThan(1_000n);
    const raw = finalize(t, contractUnlocks(t), signInputs(t, 'user', m.user.priv));
    expect(verifyTemplateAndRaw(t, raw, { requireStrongSighash: true }).ok).toBe(true);
    const before = (await utxosOf(m, m.user.address)).reduce((s, u) => s + u.satoshis, 0n);
    await m.provider.sendRawTransaction(raw);
    const after = (await utxosOf(m, m.user.address)).reduce((s, u) => s + u.satoshis, 0n);
    expect(after - before).toBe(profit);
    // the gap is now closed: compiling again stops precisely instead of inventing a profit
    const again = compileIntent(base(m, { type: 'ATOMIC_ARBITRAGE', operation: { kind: 'ATOMIC_ARBITRAGE', params: {} }, minOutput: { asset: 'BCH', amount: '1000' } }), await ctxOf(m));
    expect(again.error?.stage).toBe('COMPOSE');
    expect(again.error?.reason).toMatch(/nets -?\d+ sats/);
  });

  it('LIQUIDITY_DEPOSIT and LIQUIDITY_WITHDRAWAL compile to LP owner-path templates that the LP signs and the VM accepts', async () => {
    const m = createLocalMarket();
    const lpOwner = { owner: { lockingBytecode: m.lp.lockingBytecode, authorization: 'WALLET_SIGNATURE' } };
    const dep = compileIntent(base(m, { ...lpOwner, type: 'LIQUIDITY_DEPOSIT', operation: { kind: 'LIQUIDITY_DEPOSIT', params: {} }, inputs: [{ asset: 'BCH', amount: '5000000' }] }), await ctxOf(m));
    expect(dep.error).toBeUndefined();
    expect(dep.explanation!.headline).toMatch(/Deposit 5000000 sats/);
    const t = dep.selected!.template!;
    const raw = finalize(t, contractUnlocks(t), signInputs(t, 'lp', m.lp.priv));
    expect(verifyTemplateAndRaw(t, raw, { requireStrongSighash: true }).ok).toBe(true);
    await m.provider.sendRawTransaction(raw);
    const wd = compileIntent(base(m, { ...lpOwner, type: 'LIQUIDITY_WITHDRAWAL', operation: { kind: 'LIQUIDITY_WITHDRAWAL', params: {} }, inputs: [{ asset: 'BCH', amount: '2000000' }] }), await ctxOf(m));
    expect(wd.error).toBeUndefined();
    const t2 = wd.selected!.template!;
    await m.provider.sendRawTransaction(finalize(t2, contractUnlocks(t2), signInputs(t2, 'lp', m.lp.priv)));
    // the user key is not the LP: the owner path is refused at RESOLVE
    const notLp = compileIntent(base(m, { type: 'LIQUIDITY_WITHDRAWAL', operation: { kind: 'LIQUIDITY_WITHDRAWAL', params: {} }, inputs: [{ asset: 'BCH', amount: '1000' }] }), await ctxOf(m));
    expect(notLp.error).toMatchObject({ stage: 'RESOLVE' }); expect(notLp.error!.reason).toMatch(/not the vault LP/);
  });

  it('Paryon write intents stop at RESOLVE as BLOCKED; STAGED_RECOVERABLE swaps carry a staged plan', async () => {
    const m = createLocalMarket();
    for (const type of ['LOAN_REPAYMENT', 'COLLATERAL_TOP_UP', 'LIQUIDATION']) {
      const p = compileIntent(base(m, { type, operation: { kind: type, params: {} }, protocols: ['paryon-v1'] }), await ctxOf(m));
      expect(p.error).toMatchObject({ stage: 'RESOLVE' }); expect(p.error!.reason).toMatch(/^BLOCKED: .*@paryonusd\/library/);
    }
    const hedge = compileIntent(base(m, { type: 'HEDGE_ADJUSTMENT', operation: { kind: 'HEDGE_ADJUSTMENT', params: {} } }), await ctxOf(m));
    expect(hedge.error!.reason).toMatch(/^UNSUPPORTED/);
    const ctx = { ...(await ctxOf(m)), solvers: [{ strategy: 'ROUTING' as const, identity: (await import('@fuse/simulation')).solverIdentity(m, 'routing') }] };
    const staged = compileIntent(base(m, { type: 'TOKEN_SWAP', operation: { kind: 'TOKEN_SWAP', params: {} }, atomicity: 'STAGED_RECOVERABLE', inputs: [{ asset: 'BCH', amount: '40000000' }], minOutput: { asset: m.token, amount: '30000' }, maxInput: { asset: 'BCH', amount: '40000000' } }), ctx);
    expect(staged.ok).toBe(true);
    expect(staged.executionClass).toBe('STAGED_RECOVERABLE');
    expect(staged.staged!.map((s) => s.id)).toEqual(['prepare', 'swap']);
  });
});
