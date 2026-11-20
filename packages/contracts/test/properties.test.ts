import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { setupBchVault, setupTokenVault, builder } from './helpers.js';
import { encodeVaultState, decodeVaultState, flashFee, nextVaultState } from '../src/index.js';

describe('FlashVault property tests (fast-check, BCH VM in the loop)', () => {
  it('BCH vault: tx valid  ⇔  returned >= principal + fee  (conservation property)', async () => {
    await fc.assert(fc.asyncProperty(
      fc.bigInt({ min: 10_000n, max: 5_000_000n }),   // shard value
      fc.bigInt({ min: 0n, max: 500n }),             // fee bps
      fc.bigInt({ min: 0n, max: 3_000n }),           // min fee
      fc.bigInt({ min: -2_000n, max: 2_000n }),      // delta vs required
      async (shardValue, feeBps, minFee, delta) => {
        const f = setupBchVault({ feeBps, minFee }, shardValue);
        const required = shardValue + f.fee;
        const returned = required + delta;
        const surplus = returned - shardValue;
        if (returned < 1_000n || surplus < 0n || f.fee + delta > 150_000n) return; // outside funding / dust domain
        const tx = builder(f.provider)
          .addInput(f.shard, f.vault.unlock.flash())
          .addInput(f.funding, f.borrower.sig.unlockP2PKH())
          .addOutput({ to: f.vault.tokenAddress, amount: returned, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: surplus, paused: false }) } } })
          .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - surplus - 3_000n });
        const ok = await tx.send().then(() => true, () => false);
        expect(ok).toBe(delta >= 0n);
      }), { numRuns: 30 });
  });

  it('token vault: tx valid  ⇔  tokens returned >= principal + fee', async () => {
    await fc.assert(fc.asyncProperty(
      fc.bigInt({ min: 1n, max: 10_000_000n }),
      fc.bigInt({ min: 0n, max: 1_000n }),
      fc.bigInt({ min: 0n, max: 100n }),
      fc.bigInt({ min: -500n, max: 500n }),
      async (shardTokens, feeBps, minFee, delta) => {
        const f = setupTokenVault({ feeBps, minFee }, shardTokens);
        const returned = shardTokens + f.fee + delta;
        const extraNeeded = returned - shardTokens;
        if (returned <= 0n || extraNeeded > f.borrowerTokens.token!.amount) return;
        const change = shardTokens + f.borrowerTokens.token!.amount - returned;
        const b = builder(f.provider)
          .addInput(f.shard, f.vault.unlock.flash())
          .addInput(f.borrowerTokens, f.borrower.sig.unlockP2PKH())
          .addInput(f.funding, f.borrower.sig.unlockP2PKH())
          .addOutput({ to: f.vault.tokenAddress, amount: f.shard.satoshis, token: { category: f.params.assetCategory, amount: returned } });
        if (change > 0n) b.addOutput({ to: f.borrower.address, amount: 1_000n, token: { category: f.params.assetCategory, amount: change } });
        b.addOutput({ to: f.borrower.address, amount: f.funding.satoshis - 3_000n - (change > 0n ? 0n : -1_000n) });
        const ok = await b.send().then(() => true, () => false);
        expect(ok).toBe(delta >= 0n);
      }), { numRuns: 30 });
  });

  it('fee formula: monotone, >= minFee, ceil-correct, never negative', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 2n ** 62n }), fc.bigInt({ min: 0n, max: 10_000n }), fc.bigInt({ min: 0n, max: 10n ** 9n }), (p, bps, min) => {
      const fee = flashFee(p, bps, min);
      expect(fee >= min).toBe(true);
      expect(fee * 10_000n >= p * bps).toBe(true);
      expect(flashFee(p + 1n, bps, min) >= fee).toBe(true);
    }));
  });

  it('state codec roundtrip and transition invariants', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 2n ** 62n }), fc.bigInt({ min: 0n, max: 2n ** 62n }), fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 12n }), (c, fees, paused, surplus) => {
      const s = { flashCount: c, cumulativeFees: fees, paused };
      expect(decodeVaultState(encodeVaultState(s))).toEqual(s);
      if (paused) expect(() => nextVaultState(s, surplus)).toThrow();
      else expect(nextVaultState(s, surplus)).toEqual({ flashCount: c + 1n, cumulativeFees: fees + surplus, paused: false });
    }));
    expect(() => decodeVaultState('00')).toThrow();
    expect(() => flashFee(-1n, 1n, 1n)).toThrow();
  });
});
