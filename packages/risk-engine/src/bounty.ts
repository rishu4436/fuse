// X03 Rescue bounties: a borrower signs an offer that pays whoever restores a loan's health, up to a cap.
// A claim is valid only if the post-rescue state improves the collateral ratio by the promised amount.
// The on-chain payout must be in the SAME transaction as the rescue; for Paryon V1 that path is BLOCKED
// (manage() builder not verified), so FUSE validates offers/claims but executes none.
import { secp256k1, hexToBin, binToHex } from '@bitauth/libauth';
import { commitment } from '@fuse/core';
import { assessLoan, type LoanSnapshot } from './index.js';

export interface RescueOffer { standard: 'FUSE-RESCUE-1'; loan: string; ownerPubkey: string; maxBountySats: bigint; minImprovementBps: bigint; bountyBpsOfAddedCollateral: bigint; expiresAt: number; nonce: string }
export interface SignedOffer { offer: RescueOffer; hash: string; signature: string }
export const offerHash = (o: RescueOffer) => commitment('rescue-offer/v1', o);

export function signOffer(o: RescueOffer, priv: Uint8Array): SignedOffer {
  const hash = offerHash(o);
  const sig = secp256k1.signMessageHashSchnorr(priv, hexToBin(hash));
  if (typeof sig === 'string') throw new Error(sig);
  return { offer: o, hash, signature: binToHex(sig) };
}

export function evaluateRescueClaim(s: SignedOffer, before: LoanSnapshot, after: LoanSnapshot, priceCents: bigint, claimedBountySats: bigint, now: number) {
  const reasons: string[] = [];
  if (offerHash(s.offer) !== s.hash) reasons.push('offer hash mismatch');
  if (!secp256k1.verifySignatureSchnorr(hexToBin(s.signature), hexToBin(s.offer.ownerPubkey), hexToBin(s.hash))) reasons.push('owner signature invalid');
  if (now >= s.offer.expiresAt) reasons.push('offer expired');
  if (before.outpoint !== s.offer.loan) reasons.push('claim is for a different loan');
  const b = assessLoan(before, priceCents), a = assessLoan(after, priceCents);
  const improvement = (a.crBps ?? 0n) - (b.crBps ?? 0n);
  if (improvement < s.offer.minImprovementBps) reasons.push(`CR improved ${improvement} bps < required ${s.offer.minImprovementBps}`);
  if (after.debtCents > before.debtCents) reasons.push('debt increased');
  const added = after.collateralSats - before.collateralSats;
  const cap = (() => { const byShare = added > 0n ? (added * s.offer.bountyBpsOfAddedCollateral) / 10_000n : 0n; return byShare < s.offer.maxBountySats ? byShare : s.offer.maxBountySats; })();
  if (claimedBountySats > cap) reasons.push(`bounty ${claimedBountySats} exceeds cap ${cap}`);
  return { valid: reasons.length === 0, reasons, improvementBps: improvement, capSats: cap, executable: false as const, blockedBy: 'Paryon V1 manage() transaction builder not verified in FUSE' };
}
