import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { secp256k1, binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { PolicySchema, signPolicy, verifySignedPolicy, evaluatePolicy, POLICY_TEMPLATES, type ProposedAction } from '../src/index.js';

const priv = sha256.hash(utf8ToBin('policy-test-owner'));
const pub = binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
const now = 1_800_000_000;
const policy = PolicySchema.parse(POLICY_TEMPLATES.conservativeRescue(pub, 'local', now));
const action = (o: Partial<ProposedAction> = {}): ProposedAction => ({ action: 'COLLATERAL_TOP_UP', protocol: 'fuse-native', asset: 'BCH', amount: 1_000_000n, feeSats: 1_000n, outputs: [], healthBeforeBps: 11_500n, healthAfterBps: 13_000n, now: now + 10, signer: 'owner', ...o });

describe('FEP-1 portable policies', () => {
  it('signs and independently verifies; detects tampering, wrong network and wrong domain', () => {
    const sp = signPolicy(policy, priv);
    expect(verifySignedPolicy(JSON.parse(JSON.stringify(sp, (_k, v) => typeof v === 'bigint' ? v.toString() : v)), { network: 'local', domain: 'fuse.guardian' }).ok).toBe(true);
    const tampered = { ...sp, policy: { ...sp.policy, maxFeeSats: 999_999_999n } };
    expect(verifySignedPolicy(JSON.parse(JSON.stringify(tampered, (_k, v) => typeof v === 'bigint' ? v.toString() : v)), { network: 'local', domain: 'fuse.guardian' }).reasons).toContain('hash mismatch: policy content differs from signed commitment');
    const r = verifySignedPolicy(JSON.parse(JSON.stringify(sp, (_k, v) => typeof v === 'bigint' ? v.toString() : v)), { network: 'mainnet', domain: 'other' });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/network mismatch/);
  });

  it('allows a compliant action but still requires approval in APPROVAL_REQUIRED mode', () => {
    const d = evaluatePolicy(policy, action());
    expect(d).toEqual({ allowed: true, requiresApproval: true, reasons: [] });
  });

  it('enforces per-action, per-period, fee, action, protocol, expiry and health rules', () => {
    expect(evaluatePolicy(policy, action({ amount: 6_000_000n })).reasons.join()).toMatch(/per-action/);
    expect(evaluatePolicy(policy, action(), [{ asset: 'BCH', amount: 19_500_000n, at: now }]).reasons.join()).toMatch(/period spend/);
    expect(evaluatePolicy(policy, action({ feeSats: 30_000n })).reasons.join()).toMatch(/fee/);
    expect(evaluatePolicy(policy, action({ action: 'TOKEN_SWAP' })).reasons.join()).toMatch(/not allowed/);
    expect(evaluatePolicy(policy, action({ protocol: 'cauldron' })).reasons.join()).toMatch(/protocol/);
    expect(evaluatePolicy(policy, action({ now: now + 31 * 86_400 })).reasons.join()).toMatch(/expired/);
    expect(evaluatePolicy(policy, action({ healthAfterBps: 11_600n })).reasons.join()).toMatch(/health improvement/);
    expect(evaluatePolicy({ ...policy, mode: 'REVOKED' }, action()).allowed).toBe(false);
    expect(evaluatePolicy(policy, action(), [], [0]).reasons).toContain('policy revoked');
  });

  it('property: never allows amount above per-action limit or cumulative spend above period cap', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 50_000_000n }), fc.array(fc.bigInt({ min: 0n, max: 10_000_000n }), { maxLength: 6 }), (amt, past) => {
      const hist = past.map((amount) => ({ asset: 'BCH', amount, at: now }));
      const d = evaluatePolicy(policy, action({ amount: amt }), hist);
      const total = past.reduce((s, x) => s + x, 0n) + amt;
      if (amt > 5_000_000n || total > 20_000_000n) expect(d.allowed).toBe(false);
    }));
  });
});
