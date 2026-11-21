import { describe, it, expect } from 'vitest';
import { wizSignPayload, wireBig } from '../apps/web/lib/wiz-wire';

// Shape of a real /api/live/prepare `sign` block (flash on fuse-live-1, round 6, public chain data)
const req = {
  transactionHex: '02000000' + '00'.repeat(8),
  userPrompt: 'FUSE flash',
  sourceOutputs: [
    { outpointIndex: 0, outpointTransactionHash: 'cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c', sequenceNumber: 4294967295, unlockingBytecode: '0051', lockingBytecode: 'aa2014fa3605d51dd8c9cf29878038a46c72eab1862c65ad42966d17042d59a723db87', valueSatoshis: '30400', token: { category: 'fa0c5163b8490a12d995f09ebc6c5cc32ebe3b3fc104951819b7cfee5d74549b', amount: '0', nft: { capability: 'mutable' as const, commitment: '0400000000000000900100000000000000' } } },
    { outpointIndex: 0, outpointTransactionHash: '5584a8b0aabba5c7d250c70a6f72a5323cba6cf2d55cf283073aa93cb87af5e0', sequenceNumber: 4294967295, unlockingBytecode: '', lockingBytecode: '76a9147501a419ad434b19fbf62b63d467b4f32a619f7188ac', valueSatoshis: 20000n },
  ],
};

describe('WizardConnect wire encoding', () => {
  it('is JSON-serializable (the relay JSON.stringifies every message)', () => {
    expect(() => JSON.stringify(wizSignPayload(req))).not.toThrow();
  });
  it('uses the reference encoding Cashonize validates: hex bytes, "<bigint: Xn>" values, hex tx', () => {
    const p = wizSignPayload(req);
    expect(p.transaction).toBe(req.transactionHex);
    expect(p.broadcast).toBe(false);
    expect(p.sourceOutputs[0].valueSatoshis).toBe('<bigint: 30400n>');
    expect(p.sourceOutputs[1].valueSatoshis).toBe('<bigint: 20000n>');
    expect(p.sourceOutputs[0].token).toEqual({ category: req.sourceOutputs[0].token!.category, amount: '<bigint: 0n>', nft: { capability: 'mutable', commitment: '0400000000000000900100000000000000' } });
    expect(p.sourceOutputs[1]).not.toHaveProperty('token');
    for (const s of p.sourceOutputs) { expect(s.outpointTransactionHash).toMatch(/^[0-9a-f]{64}$/); expect(s.valueSatoshis).toMatch(/^<bigint: \d+n>$/); }
  });
  it('rejects non-hex byte fields instead of sending garbage', () => {
    expect(() => wizSignPayload({ ...req, transactionHex: 'zz' })).toThrow(/not hex/);
    expect(wireBig('5n')).toBe('<bigint: 5n>');
  });
});
