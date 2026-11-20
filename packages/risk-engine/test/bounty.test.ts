import { describe, it, expect } from 'vitest';
import { secp256k1, sha256, utf8ToBin, binToHex } from '@bitauth/libauth';
import { signOffer, evaluateRescueClaim, type RescueOffer } from '../src/index.js';

const priv = sha256.hash(utf8ToBin('rescue-test-owner'));
const pub = binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
const loan = { outpoint: 'aa:0', collateralSats: 100_000_000n, debtCents: 16_000n, beingRedeemed: 0n, status: 'mature', currentRateRaw: 1n, periodsBehind: 0n };
const offer: RescueOffer = { standard: 'FUSE-RESCUE-1', loan: 'aa:0', ownerPubkey: pub, maxBountySats: 200_000n, minImprovementBps: 1_000n, bountyBpsOfAddedCollateral: 100n, expiresAt: 2_000, nonce: '01' };

describe('X03 rescue bounties', () => {
  it('valid rescue earns at most the cap; never executable', () => {
    const s = signOffer(offer, priv);
    const after = { ...loan, collateralSats: 115_000_000n }; // +15% collateral
    const r = evaluateRescueClaim(s, loan, after, 20_000n, 150_000n, 1_000);
    expect(r.valid).toBe(true); expect(r.capSats).toBe(150_000n); expect(r.executable).toBe(false);
    expect(evaluateRescueClaim(s, loan, after, 20_000n, 150_001n, 1_000).reasons.join()).toMatch(/exceeds cap/);
  });
  it('rejects tampered offers, insufficient improvement, expiry and debt increase', () => {
    const s = signOffer(offer, priv);
    expect(evaluateRescueClaim({ ...s, offer: { ...offer, maxBountySats: 10n ** 9n } }, loan, { ...loan, collateralSats: 120_000_000n }, 20_000n, 1n, 1_000).reasons.join()).toMatch(/hash mismatch/);
    expect(evaluateRescueClaim(s, loan, { ...loan, collateralSats: 101_000_000n }, 20_000n, 1n, 1_000).reasons.join()).toMatch(/improved/);
    expect(evaluateRescueClaim(s, loan, { ...loan, collateralSats: 120_000_000n }, 20_000n, 1n, 3_000).reasons.join()).toMatch(/expired/);
    expect(evaluateRescueClaim(s, loan, { ...loan, collateralSats: 140_000_000n, debtCents: 17_000n }, 20_000n, 1n, 1_000).reasons.join()).toMatch(/debt increased/);
  });
});
