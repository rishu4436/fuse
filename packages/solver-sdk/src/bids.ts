import { secp256k1, hexToBin, binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { commitment } from '@fuse/core';
import { templateHash } from '@fuse/transaction-composer';
import type { Bid } from './types.js';

export type UnsignedBid = Omit<Bid, 'signature' | 'templateHash'>;
export const bidCommitment = (b: Omit<Bid, 'signature'>) => commitment('solver-bid/v1', b);

export function signBid(b: UnsignedBid, priv: Uint8Array): Bid {
  const withHash = { ...b, templateHash: templateHash(b.template) };
  const sig = secp256k1.signMessageHashSchnorr(priv, hexToBin(bidCommitment(withHash)));
  if (typeof sig === 'string') throw new Error(sig);
  return { ...withHash, signature: binToHex(sig) };
}

export function verifyBidSignature(b: Bid): { ok: boolean; reason?: string } {
  if (templateHash(b.template) !== b.templateHash) return { ok: false, reason: 'template hash mismatch' };
  const { signature, ...rest } = b;
  if (!/^[0-9a-f]{128}$/.test(signature) || !/^[0-9a-f]{66}$/.test(b.solverPubkey)) return { ok: false, reason: 'malformed signature or pubkey' };
  const ok = secp256k1.verifySignatureSchnorr(hexToBin(signature), hexToBin(b.solverPubkey), hexToBin(bidCommitment(rest)));
  return ok ? { ok } : { ok, reason: 'bad solver signature' };
}

export const solverIdOf = (pubkey: string) => 'solver_' + binToHex(sha256.hash(utf8ToBin(pubkey))).slice(0, 16);
