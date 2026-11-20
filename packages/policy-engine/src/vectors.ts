// X04 FEP-1 conformance vectors: deterministic policy, canonical form, commitment preimage, hash and
// owner Schnorr signature from a public TEST-ONLY key, plus negative vectors an implementation must reject.
import { secp256k1, sha256, utf8ToBin, binToHex } from '@bitauth/libauth';
import { canonicalize } from '@fuse/core';
import { PolicySchema, signPolicy, policyHash } from './index.js';

export function fep1Vectors() {
  const priv = sha256.hash(utf8ToBin('FEP-1 test vector owner key: PUBLIC, NEVER FUND'));
  const pub = binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
  const input = {
    standard: 'FEP-1', version: 1, policyId: 'vector-001', network: 'mainnet', domain: 'fuse.guardian', owner: { pubkey: pub },
    assets: [{ asset: 'BCH', maxPerAction: '5000000', maxPerPeriod: '20000000', periodSeconds: 86400 }],
    allowedActions: ['COLLATERAL_TOP_UP', 'LOAN_REPAYMENT'], allowedProtocols: ['paryon-v1'], approvedRecipients: [], approvedSourceVaults: [],
    minHealthImprovementBps: 500, maxFeeSats: '20000', minOutputs: [], validFrom: 1790000000, expiresAt: 1792592000, revocationNonce: 0, mode: 'APPROVAL_REQUIRED',
  };
  const policy = PolicySchema.parse(input);
  const canonical = canonicalize(policy);
  const signed = signPolicy(policy, priv);
  return {
    standard: 'FEP-1', ownerPrivateKeyDerivation: "sha256(utf8('FEP-1 test vector owner key: PUBLIC, NEVER FUND'))", ownerPubkey: pub,
    policyJson: input, canonical, preimage: `FUSE:policy/FEP-1\n${canonical}`, hash: policyHash(policy), signature: signed.signature,
    negative: [
      { name: 'amount changed after signing', mutate: { path: 'assets.0.maxPerAction', value: '5000001' }, expect: 'hash mismatch' },
      { name: 'network swapped', mutate: { path: 'network', value: 'chipnet' }, expect: 'hash mismatch + network mismatch' },
      { name: 'signature bit flip', signature: signed.signature.slice(0, -2) + (signed.signature.endsWith('00') ? '01' : '00'), expect: 'owner signature invalid' },
    ],
  };
}
