// Security review issue A: /api/broadcast must relay ONLY the exact transaction a preflight authorized.
import { describe, it, expect, beforeEach } from 'vitest';
import { secp256k1, hash160, binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { signInputs, finalize, txidOfRaw, templateHash, type TxTemplate } from '@fuse/transaction-composer';
import { issueAuthorization, signAuthAsUser, type Authorization } from '../src/live/authz.js';
import { broadcast, _resetUsedForTests, type ChainDeps } from '../src/live/relay.js';

const key = (s: string) => { const priv = sha256.hash(utf8ToBin(s)); const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array; return { priv, pub, lb: `76a914${binToHex(hash160(pub))}88ac` }; };
const user = key('authz-test-user'); const vault = key('authz-test-vault'); const attacker = key('authz-test-attacker');
const SERVER = binToHex(sha256.hash(utf8ToBin('authz-test-server-key'))); const OTHER = binToHex(sha256.hash(utf8ToBin('some-other-server')));
const env = (k: string) => ({ FUSE_AUTH_KEY: k }) as unknown as NodeJS.ProcessEnv;
const trusted = binToHex(secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin('authz-test-server-key'))) as Uint8Array);
const coin = (n: number, sats: bigint) => ({ txid: binToHex(sha256.hash(utf8ToBin(`coin${n}`))), vout: 0, satoshis: sats, lockingBytecode: user.lb });
const C = [coin(1, 50_000n), coin(2, 20_000n), coin(3, 9_000n)];
const userIn = (c: (typeof C)[number]) => ({ txid: c.txid, vout: c.vout, satoshis: c.satoshis, lockingBytecode: user.lb, role: 'wallet' as const, unlock: { kind: 'p2pkh' as const, signer: 'user' } });
// a deposit-like intent: 30,000 sats to the vault script, change back to the user, 600 sats miner fee
const T = (o: Partial<{ inputs: TxTemplate['inputs']; outputs: TxTemplate['outputs'] }> = {}): TxTemplate => ({ version: 2, locktime: 0, inputs: o.inputs ?? [userIn(C[0]), userIn(C[1])], outputs: o.outputs ?? [{ lockingBytecode: vault.lb, satoshis: 30_000n, role: 'vault-continuation' as never }, { lockingBytecode: user.lb, satoshis: 39_400n, role: 'change' as never }] });
const constraints = { userLockingBytecode: user.lb, maxMinerFee: 5_000n, expectedUserCost: 600n, capital: 30_000n, maxUserCost: 600n, allowedRecipients: [vault.lb, user.lb], vault: { id: 'v', lockingBytecode: vault.lb, category: '00'.repeat(32), feeBps: 9n, minFee: 100n, maxExposure: 100_000n, ownerPkh: '', requiredReturn: 30_000n }, route: null };
const auth = (t = T(), o: { key?: string; now?: number; guardianOk?: boolean } = {}) => issueAuthorization({ action: 'deposit', address: 'bitcoincash:test', templateHash: templateHash(t), template: t, constraints, guardian: { level: o.guardianOk === false ? 'BLOCK' : 'PASS', ok: o.guardianOk !== false, checks: [] }, auction: null }, { env: env(o.key ?? SERVER), now: o.now });
const sign = (t: TxTemplate) => finalize(t, signInputs(t, 'user', user.priv));

let spent: Set<string>; let relayed: string[];
const chain = (): ChainDeps => ({
  outputAt: async (txid, vout) => { const c = C.find((x) => x.txid === txid && x.vout === vout); if (!c) throw new Error('unknown outpoint'); return { ...c }; },
  outspend: async (txid, vout) => ({ spent: spent.has(`${txid}:${vout}`) }),
  relay: async (raw) => { relayed.push(raw); return txidOfRaw(raw); },
});
const send = (rawHex: string, authorization?: Authorization, extra: Record<string, unknown> = {}, now?: number) => broadcast({ rawHex, authorization, ...extra }, { enabled: true, trustedPubkey: trusted, deps: chain(), now });

describe('broadcast is bound to a reviewed execution authorization', () => {
  beforeEach(() => { spent = new Set(); relayed = []; _resetUsedForTests(); });

  it('relays the exact authorized transaction (and records the user signature over the auth hash)', async () => {
    const a = auth(); const r = await send(sign(T()), a, { userSignature: signAuthAsUser(a.authHash, user.priv) });
    expect(r.broadcast).toBe(true); expect(r.intentBound).toBe(true); expect(r.userSignature.ok).toBe(true); expect(relayed).toHaveLength(1);
  });
  it('rejects a valid signed tx with no authorization', async () => {
    await expect(send(sign(T()))).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/missing execution authorization/) });
  });
  it('rejects a forged signature, a tampered payload and a key that is not the deployment key', async () => {
    const a = auth(); const flip = (h: string) => (h[0] === '0' ? '1' : '0') + h.slice(1);
    await expect(send(sign(T()), { ...a, serverSig: flip(a.serverSig) })).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/signature is invalid/) });
    await expect(send(sign(T()), { ...a, payload: a.payload.slice(0, -2) + 'AA' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(send(sign(T()), auth(T(), { key: OTHER }))).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/not issued by this deployment/) });
  });
  it('rejects an expired authorization', async () => {
    const a = auth(T(), { now: 1_000 });
    await expect(send(sign(T()), a, {}, 1_000 + 301)).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/expired/) });
  });
  it('rejects a replayed authorization (same instance) and a replay after the inputs were spent (any instance)', async () => {
    const a = auth(); await send(sign(T()), a);
    await expect(send(sign(T()), a)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already used/) });
    _resetUsedForTests(); spent.add(`${C[0].txid}:0`);
    await expect(send(sign(T()), a)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already spent/) });
    expect(relayed).toHaveLength(1);
  });
  it('fails closed when the chain reader is unavailable', async () => {
    const deps = chain();
    deps.outspend = async () => { throw new Error('source unavailable'); };
    await expect(broadcast({ rawHex: sign(T()), authorization: auth() }, { enabled: true, trustedPubkey: trusted, deps })).rejects.toThrow('source unavailable');
    expect(relayed).toHaveLength(0);
  });
  it('relays a concurrently submitted authorization only once', async () => {
    const a = auth();
    const results = await Promise.allSettled([send(sign(T()), a), send(sign(T()), a)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(relayed).toHaveLength(1);
  });
  const variants: Array<[string, TxTemplate, RegExp]> = [
    ['a different output script', T({ outputs: [{ lockingBytecode: attacker.lb, satoshis: 30_000n, role: 'change' as never }, { lockingBytecode: user.lb, satoshis: 39_400n, role: 'change' as never }] }), /output 0 pays a different recipient/],
    ['a changed amount', T({ outputs: [{ lockingBytecode: vault.lb, satoshis: 29_000n, role: 'vault-continuation' as never }, { lockingBytecode: user.lb, satoshis: 40_400n, role: 'change' as never }] }), /output 0 amount/],
    ['an extra output', T({ outputs: [{ lockingBytecode: vault.lb, satoshis: 30_000n, role: 'vault-continuation' as never }, { lockingBytecode: user.lb, satoshis: 38_400n, role: 'change' as never }, { lockingBytecode: attacker.lb, satoshis: 1_000n, role: 'change' as never }] }), /3 outputs/],
    ['an extra input', T({ inputs: [userIn(C[0]), userIn(C[1]), userIn(C[2])], outputs: [{ lockingBytecode: vault.lb, satoshis: 30_000n, role: 'vault-continuation' as never }, { lockingBytecode: user.lb, satoshis: 48_400n, role: 'change' as never }] }), /3 inputs/],
    ['swapped recipients', T({ outputs: [{ lockingBytecode: user.lb, satoshis: 39_400n, role: 'change' as never }, { lockingBytecode: vault.lb, satoshis: 30_000n, role: 'vault-continuation' as never }] }), /output 0/],
    ['a different input', T({ inputs: [userIn(C[0]), userIn(C[2])], outputs: [{ lockingBytecode: vault.lb, satoshis: 30_000n, role: 'vault-continuation' as never }, { lockingBytecode: user.lb, satoshis: 28_400n, role: 'change' as never }] }), /input 1 spends a different outpoint/],
  ];
  for (const [name, variant, why] of variants) {
    it(`rejects a VM-valid signed tx with ${name}`, async () => {
      await expect(send(sign(variant), auth())).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(why) });
      expect(relayed).toHaveLength(0);
    });
  }
  it('rejects an authorization whose preflight Guardian verdict was BLOCK', async () => {
    await expect(send(sign(T()), auth(T(), { guardianOk: false }))).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/Guardian BLOCK/) });
  });
  it('re-runs the financial constraints on fresh chain state (state moved since preflight → refused)', async () => {
    const moved = { ...C[1], satoshis: 25_000n }; const deps = chain(); const orig = deps.outputAt;
    deps.outputAt = async (t, v) => (t === moved.txid ? moved : orig(t, v));
    await expect(broadcast({ rawHex: sign(T()), authorization: auth() }, { enabled: true, trustedPubkey: trusted, deps })).rejects.toMatchObject({ statusCode: 422 });
  });
  it('rejects a user signature by a key that does not own the wallet', async () => {
    const a = auth();
    await expect(send(sign(T()), a, { userSignature: signAuthAsUser(a.authHash, attacker.priv) })).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/does not own/) });
  });
  it('refuses everything when broadcasting or authorizations are not configured', async () => {
    await expect(broadcast({ rawHex: sign(T()), authorization: auth() }, { enabled: false, trustedPubkey: trusted, deps: chain() })).rejects.toMatchObject({ statusCode: 503 });
    await expect(broadcast({ rawHex: sign(T()), authorization: auth() }, { enabled: true, trustedPubkey: null, deps: chain() })).rejects.toMatchObject({ statusCode: 503 });
  });
});
