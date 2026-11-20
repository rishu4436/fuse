// Live (mainnet) module guards that can be tested without touching the network.
import { describe, it, expect } from 'vitest';
import type { TxTemplate } from '@fuse/transaction-composer';
import { broadcast, verifySigned, rateLimit } from '../src/live/relay.js';
import { simulate, guardianPreflight, LIVE_CAPS } from '../src/live/execute.js';

const USER = '76a914' + '16ce0ac40f684f525f7d2fd58ae797d30f914dd3' + '88ac';
const OTHER = '76a914' + '11'.repeat(20) + '88ac';
const tpl = (outs: TxTemplate['outputs']): TxTemplate => ({ version: 2, locktime: 0, inputs: [{ txid: 'ab'.repeat(32), vout: 0, satoshis: 10_000n, lockingBytecode: USER, role: 'user' as never, unlock: { kind: 'p2pkh', signer: 'user' } }], outputs: outs });
const run = (t: TxTemplate, fee: bigint, expected: bigint) => guardianPreflight(t, { userLb: USER, vaultLb: null, fee, expectedUserCost: expected, capital: 0n, sim: simulate(t), requiredReturn: null, coins: [{ txid: 'ab'.repeat(32), vout: 0, satoshis: 10_000n, confirmed: true } as never] });

describe('live broadcast relay', () => {
  it('refuses when broadcasting is disabled, before any network call', async () => {
    await expect(broadcast('00', { enabled: false })).rejects.toMatchObject({ statusCode: 503 });
  });
  it('rejects non-hex and non-transactions with 400', async () => {
    await expect(verifySigned('zz')).rejects.toMatchObject({ statusCode: 400 });
    await expect(verifySigned('0000')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('rate-limits a client after 12 broadcasts per minute', () => {
    const ip = `test-${Math.random()}`;
    for (let i = 0; i < 12; i++) rateLimit(ip);
    expect(() => rateLimit(ip)).toThrow(/rate limited/);
  });
});

describe('live Guardian preflight', () => {
  it('passes a self-payment within the fee cap', () => {
    const r = run(tpl([{ lockingBytecode: USER, satoshis: 9_500n, role: 'change' as never }]), 500n, 500n);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'no hidden transfers')?.ok).toBe(true);
  });
  it('blocks an output paying an unexpected script', () => {
    const r = run(tpl([{ lockingBytecode: OTHER, satoshis: 9_000n, role: 'change' as never }, { lockingBytecode: USER, satoshis: 500n, role: 'change' as never }]), 500n, 500n);
    expect(r.ok).toBe(false); expect(r.level).toBe('BLOCK');
    expect(r.checks.find((c) => c.name === 'no hidden transfers')?.ok).toBe(false);
  });
  it('blocks a fee above the live cap and a cost above expectation', () => {
    const r = run(tpl([{ lockingBytecode: USER, satoshis: 1_000n, role: 'change' as never }]), LIVE_CAPS.maxMinerFee + 1n, 500n);
    expect(r.checks.find((c) => c.name === 'miner fee within cap')?.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'your net cost')?.ok).toBe(false);
  });
});
