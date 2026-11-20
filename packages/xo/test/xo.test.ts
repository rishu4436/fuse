import { describe, it, expect } from 'vitest';
import { binToHex, encodeLockingBytecodeP2pkh, hash160, secp256k1 } from '@bitauth/libauth';
import { p2pkhTemplate } from '@xo-cash/templates';
import { inspectTemplate, officialTemplates, xoP2pkhPayout, XO_ENGINE_STATUS } from '../src/index.js';

describe('F48 XO Stack (real @xo-cash packages)', () => {
  it('validates the official templates and pins their content identifiers', () => {
    const t = officialTemplates();
    expect(t.map((x) => x.key)).toEqual(['p2pkh', 'multisig', 'wrapBCH', 'wrapBCHChipnet', 'faucetCash']);
    for (const x of t) expect(x.templateIdentifier).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(t.map((x) => x.templateIdentifier)).size).toBe(5);
    expect(t[0].actions).toContain('sendSatoshis');
    // identifier is content-addressed: any change → different identifier
    expect(inspectTemplate({ ...p2pkhTemplate, description: 'changed' }).templateIdentifier).not.toBe(t[0].templateIdentifier);
  });
  it('rejects malformed templates with the XO validator', () => {
    expect(() => inspectTemplate({ ...p2pkhTemplate, scripts: { ...p2pkhTemplate.scripts, lockP2PKH: 42 } })).toThrow(/Template invalid/);
    expect(() => inspectTemplate('{not json')).toThrow();
  });
  it('compiles the XO P2PKH receiving script from a public key; matches an independent libauth encoding', () => {
    const pub = secp256k1.derivePublicKeyCompressed(new Uint8Array(32).fill(3)) as Uint8Array;
    const p = xoP2pkhPayout(binToHex(pub));
    expect(p.lockingBytecode).toBe(binToHex(encodeLockingBytecodeP2pkh(hash160(pub))));
    expect(p.address).toMatch(/^bchtest:q/);
    expect(() => xoP2pkhPayout('00'.repeat(32))).toThrow(/public key/);
    expect(XO_ENGINE_STATUS.status).toBe('BLOCKED');
  });
});
