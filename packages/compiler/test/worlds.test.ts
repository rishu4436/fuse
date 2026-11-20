import { describe, it, expect } from 'vitest';
import { createLocalMarket, marketViewOf, solverIdentity } from '@fuse/simulation';
import { parallelWorlds } from '../src/index.js';

describe('F42 parallel worlds', () => {
  it('same intent, six worlds: flash wins only while a gap exists; paused vault falls back to routing', () => {
    const m = createLocalMarket(); const now = Math.floor(Date.now() / 1000);
    const intent = { version: 1, id: 'intent_worlds_0001', network: 'local', type: 'TOKEN_SWAP', owner: { lockingBytecode: m.user.lockingBytecode, authorization: 'WALLET_SIGNATURE' }, inputs: [], allowedAssets: ['BCH', m.token], operation: { kind: 'TOKEN_SWAP', params: {} }, minOutput: { asset: m.token, amount: '30000' }, maxInput: { asset: 'BCH', amount: '40000000' }, maxFee: { asset: 'BCH', amount: '20000' }, maxSlippageBps: 100, deadline: now + 600, protocols: ['cauldron'], authorizationMode: 'PER_TX_SIGNATURE', nonce: '00112233445566778899', replayDomain: 'fuse-local', atomicity: 'ATOMIC_SINGLE_TX', requiredEvidence: ['CERTIFICATE'] };
    const ctx = { market: marketViewOf(m), ownerCoins: [{ txid: m.userCoin.txid, vout: 0, satoshis: m.userCoin.satoshis }], solvers: (['direct', 'routing', 'flash'] as const).map((k) => ({ strategy: ({ direct: 'DIRECT_LIQUIDITY', routing: 'ROUTING', flash: 'FLASH_LIQUIDITY' } as const)[k], identity: solverIdentity(m, k) })), now };
    const w = Object.fromEntries(parallelWorlds(intent, ctx).map((r) => [r.scenario.id, r]));
    expect(w.base.strategy).toBe('FLASH_LIQUIDITY');
    expect(w['gap-closed'].strategy).not.toBe('FLASH_LIQUIDITY');
    expect(w['gap-wider'].userNetSpendSats!).toBeLessThan(w.base.userNetSpendSats!);
    expect(w['vault-paused'].strategy).not.toBe('FLASH_LIQUIDITY');
    expect(w['routing-only'].strategy).toBe('ROUTING');
    expect(w.thin.userNetSpendSats! > w.base.userNetSpendSats! || !w.thin.ok).toBe(true);
  });
});
