import { describe, it, expect } from 'vitest';
import { secp256k1, hash160, binToHex, sha256, utf8ToBin, encodeCashAddress } from '@bitauth/libauth';
import { signInputs, finalize } from '@fuse/transaction-composer';
import { toJson, fromJson } from '@fuse/solver-sdk';
import { buildApp } from '../src/app.js';
import { FuseState } from '../src/state.js';

const priv = sha256.hash(utf8ToBin('fuse-api-wallet-test-only'));
const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
const address = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: hash160(pub) }).address;
const coin = (n: number, sats: string) => ({ txid: binToHex(sha256.hash(utf8ToBin(`c${n}`))), vout: 0, satoshis: sats, path: 'receive', addressIndex: 0 });

describe('wallet preflight API (no broadcast)', () => {
  it('preflight → wallet signs → independent verification; tampered response rejected; no broadcast route exists', async () => {
    const app = await buildApp(new FuseState(process.cwd(), { auctionWindowSeconds: 4 }));
    const r = await app.inject({ method: 'POST', url: '/api/wallet/preflight', headers: { 'content-type': 'application/json' }, payload: toJson({ network: 'mainnet', address, coins: [coin(1, '50000'), coin(2, '20000')] }) });
    expect(r.statusCode).toBe(200);
    const body = fromJson<{ preflight: { ok: boolean; broadcast: string; templateHash: string }; template: never; wcRequest: { broadcast: boolean; sourceOutputs: unknown[] } }>(r.body);
    expect(body.preflight.ok).toBe(true); expect(body.preflight.broadcast).toBe('DISABLED'); expect(body.wcRequest.broadcast).toBe(false);
    expect(body.wcRequest.sourceOutputs).toHaveLength(2);
    const signed = finalize(body.template, signInputs(body.template, 'user', priv));
    const ok = fromJson<{ ok: boolean; broadcast: string }>((await app.inject({ method: 'POST', url: '/api/wallet/verify-signed', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ templateHash: body.preflight.templateHash, signedTransaction: signed }) })).body);
    expect(ok.ok).toBe(true); expect(ok.broadcast).toBe('DISABLED');
    const tampered = signed.slice(0, -10) + 'ffffffffff';
    const bad = fromJson<{ ok: boolean }>((await app.inject({ method: 'POST', url: '/api/wallet/verify-signed', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ templateHash: body.preflight.templateHash, signedTransaction: tampered }) })).body);
    expect(bad.ok).toBe(false);
    const routes = app.printRoutes();
    expect(routes).not.toMatch(/broadcast/i);
  });
});
