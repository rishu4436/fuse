import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { secp256k1, hexToBin } from '@bitauth/libauth';
import { fep1Vectors, verifySignedPolicy } from '../src/index.js';

const file = JSON.parse(readFileSync(new URL('../../../docs/standards/fep-1-vectors.json', import.meta.url), 'utf8'));
// Independent canonicalizer (does not import @fuse/core): sorted keys, no whitespace.
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);

describe('X04 FEP-1 portable policy standard: conformance vectors', () => {
  it('published vectors are reproducible byte-for-byte', () => { expect(fep1Vectors()).toEqual(file); });
  it('an independent implementation (node:crypto + own canonicalizer) reaches the same hash and accepts the signature', () => {
    expect(canon(file.policyJson)).toBe(file.canonical);
    const h = createHash('sha256').update(`FUSE:policy/FEP-1\n${file.canonical}`).digest('hex');
    expect(h).toBe(file.hash);
    expect(secp256k1.verifySignatureSchnorr(hexToBin(file.signature), hexToBin(file.ownerPubkey), hexToBin(h))).toBe(true);
  });
  it('negative vectors are rejected by the reference verifier', () => {
    const ok = verifySignedPolicy({ policy: file.policyJson, signature: file.signature, hash: file.hash }, { network: 'mainnet', domain: 'fuse.guardian' });
    expect(ok.ok).toBe(true);
    const p1 = structuredClone(file.policyJson); p1.assets[0].maxPerAction = '5000001';
    expect(verifySignedPolicy({ policy: p1, signature: file.signature, hash: file.hash }, { network: 'mainnet', domain: 'fuse.guardian' }).reasons.join()).toMatch(/hash mismatch/);
    const p2 = { ...structuredClone(file.policyJson), network: 'chipnet' };
    expect(verifySignedPolicy({ policy: p2, signature: file.signature, hash: file.hash }, { network: 'mainnet', domain: 'fuse.guardian' }).reasons.join()).toMatch(/network mismatch/);
    expect(verifySignedPolicy({ policy: file.policyJson, signature: file.negative[2].signature, hash: file.hash }, { network: 'mainnet', domain: 'fuse.guardian' }).reasons.join()).toMatch(/signature invalid/);
  });
});
