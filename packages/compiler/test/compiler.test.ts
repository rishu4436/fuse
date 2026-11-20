import { describe, it, expect } from 'vitest';
import { createLocalMarket, marketViewOf, solverIdentity } from '@fuse/simulation';
import { compileIntent, accountFees, STAGES } from '../src/index.js';

const m = createLocalMarket();
const now = Math.floor(Date.now() / 1000);
const intent = (over: Record<string, unknown> = {}) => ({
  version: 1, id: 'intent_compile_0001', network: 'local', type: 'TOKEN_SWAP',
  owner: { lockingBytecode: m.user.lockingBytecode, authorization: 'WALLET_SIGNATURE' },
  inputs: [{ asset: 'BCH', amount: '40000000' }], allowedAssets: ['BCH', m.token],
  operation: { kind: 'TOKEN_SWAP', params: {} },
  minOutput: { asset: m.token, amount: '30000' }, maxInput: { asset: 'BCH', amount: '40000000' }, maxFee: { asset: 'BCH', amount: '20000' },
  maxSlippageBps: 100, deadline: now + 600, protocols: ['cauldron', 'fuse-flashvault'], authorizationMode: 'PER_TX_SIGNATURE',
  nonce: '00112233445566778899', replayDomain: 'fuse-local', atomicity: 'ATOMIC_SINGLE_TX', requiredEvidence: ['TX_CONFIRMED', 'CERTIFICATE'],
  ...over,
});
const ctx = () => ({
  market: marketViewOf(m),
  ownerCoins: [{ txid: m.userCoin.txid, vout: m.userCoin.vout, satoshis: m.userCoin.satoshis }],
  solvers: (['direct', 'routing', 'flash', 'rogue'] as const).map((k) => ({ strategy: ({ direct: 'DIRECT_LIQUIDITY', routing: 'ROUTING', flash: 'FLASH_LIQUIDITY', rogue: 'ADVERSARIAL_FIXTURE' } as const)[k], identity: solverIdentity(m, k) })),
  tokenLabel: 'FUSD', now,
});

describe('intent compiler (F03) + fee accounting (F08) + explanation', () => {
  it('runs all stages, rejects the adversarial template, selects the cheapest verified route', () => {
    const p = compileIntent(intent(), ctx());
    expect(p.ok).toBe(true);
    expect(p.stages.map((s) => s.stage)).toEqual([...STAGES]);
    const rogue = p.candidates.find((c) => c.strategy === 'ADVERSARIAL_FIXTURE')!;
    expect(rogue.ok).toBe(false);
    expect(rogue.reasons.join(' ')).toMatch(/minOut|solver output/);
    expect(p.selected!.strategy).toBe('FLASH_LIQUIDITY');
    const valid = p.candidates.filter((c) => c.ok);
    expect(valid.every((c) => c.outcome!.userNetSpendSats >= p.selected!.outcome!.userNetSpendSats)).toBe(true);
    expect(p.explanation!.headline).toMatch(/Receive 30,000 FUSD/);
    expect(p.explanation!.steps.some((s) => /FlashVault/.test(s))).toBe(true);
  });
  it('fee accounting conserves value exactly for every composed candidate', () => {
    const p = compileIntent(intent(), ctx());
    for (const c of p.candidates.filter((x) => x.fees)) {
      expect(c.fees!.conservation).toEqual({ sats: true, tokens: true });
      const sum = c.fees!.parties.reduce((s, x) => s + x.sats, 0n);
      expect(sum + c.fees!.minerFee).toBe(0n);
    }
    const f = p.selected!.fees!;
    expect(f.vaultFee).toBeGreaterThan(0n);
    expect(-f.ownerNetSats).toBe(p.selected!.outcome!.userNetSpendSats);
  });
  it('detects value leaks in tampered templates', () => {
    const p = compileIntent(intent(), ctx());
    const t = structuredClone(p.selected!.template!);
    t.outputs[0].token = { ...t.outputs[0].token!, amount: 0n };
    const pools = Object.fromEntries(marketViewOf(m).pools.map((x) => [x.id, x.lockingBytecode]));
    const tokOut = t.outputs.find((o) => o.role === 'user')!; tokOut.token!.amount += 1n;
    expect(accountFees(t, { owner: m.user.lockingBytecode, pools }).conservation.tokens).toBe(false);
  });
  it('stops precisely: unsupported types, Moria V1, monitor-only, impossible bounds', () => {
    const fail = (o: Record<string, unknown>) => compileIntent(intent(o), ctx()).error!;
    expect(fail({ type: 'LOAN_REPAYMENT', operation: { kind: 'LOAN_REPAYMENT', params: {} } })).toMatchObject({ stage: 'RESOLVE' });
    expect(fail({ protocols: ['moria-v1-historical'] }).reason).toMatch(/Moria V1 is disabled/);
    expect(fail({ owner: { lockingBytecode: m.user.lockingBytecode, authorization: 'READ_ONLY_ADDRESS' }, authorizationMode: 'MONITOR_ONLY', atomicity: 'MONITOR_ONLY' })).toMatchObject({ stage: 'AUTHORIZE' });
    expect(fail({ maxInput: { asset: 'BCH', amount: '1000' } })).toMatchObject({ stage: 'CONSTRAIN' });
    expect(fail({ deadline: now - 1 })).toMatchObject({ stage: 'PARSE' });
  });
});
