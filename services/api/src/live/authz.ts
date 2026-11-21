// Execution authorizations (security review issue A). A preflight that passes Guardian issues a short-lived, single-use
// authorization bound to the exact transaction structure the user reviewed. /api/broadcast relays ONLY a signed
// transaction whose structure (scriptSigs stripped) is byte-identical to the authorized template, after re-running the
// financial constraints against fresh chain state.
//
// Stateless and publicly verifiable: the authorization is signed (BIP-340-style Schnorr over secp256k1, libauth) with a
// server ATTESTATION key taken from the FUSE_AUTH_KEY env var (never committed). The key controls no funds; it only
// attests "this exact template passed FUSE preflight". Its public key is published at /api/live/status, so anyone can
// verify an authorization (and a certificate's INTENT_BOUND level) without trusting FUSE. Single use: a per-instance
// used-set, plus the binding to exact input outpoints, which consensus lets be spent only once (inputs are re-checked
// unspent before relaying).
import { randomBytes } from 'node:crypto';
import { binToHex, hexToBin, sha256, utf8ToBin, secp256k1, hash160, encodeTransaction, type TransactionCommon } from '@bitauth/libauth';
import { toUnsignedTransaction, type TxTemplate } from '@fuse/transaction-composer';
import { toJson, fromJson } from '@fuse/solver-sdk';

export const AUTH_TTL_SECONDS = 300;
export interface Constraints {
  userLockingBytecode: string; maxMinerFee: bigint; expectedUserCost: bigint; capital: bigint; maxUserCost: bigint; allowedRecipients: string[];
  vault: { id: string; lockingBytecode: string; category: string; feeBps: bigint; minFee: bigint; maxExposure: bigint; ownerPkh: string; requiredReturn: bigint | null } | null;
  route: { units: unknown; buyOutpoint: unknown; sellOutpoint: unknown; satsIn: unknown; minSatsOut: unknown; slippageBps: number } | null;
}
export interface AuthPayload {
  v: 1; kind: 'fuse.execution-authorization/v1'; intentId: string; network: 'mainnet'; action: string; address: string;
  issuedAt: number; expiresAt: number; templateHash: string; structureHash: string; template: TxTemplate; constraints: Constraints;
  guardian: { level: string; ok: boolean; checks: string[] }; auction: { auctionId: string; transcriptHash: string; winner: string } | null;
}
export interface Authorization { payload: string; authHash: string; serverPubkey: string; serverSig: string }

const fail = (msg: string, code = 403): never => { throw Object.assign(new Error(msg), { statusCode: code, code: 'AUTHORIZATION' }); };
const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export function serverKey(env = process.env) {
  const k = env.FUSE_AUTH_KEY;
  if (!k || !/^[0-9a-f]{64}$/.test(k)) return null;
  const priv = hexToBin(k); const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') return null;
  return { priv, pub: binToHex(pub) };
}

/** Bytes of a transaction with every unlocking bytecode removed: the exact structure a signer commits to. */
export function strippedStructure(tx: TransactionCommon) {
  return encodeTransaction({ ...tx, inputs: tx.inputs.map((i) => ({ ...i, unlockingBytecode: new Uint8Array() })) });
}
export const structureHashOfTemplate = (t: TxTemplate) => binToHex(sha256.hash(strippedStructure(toUnsignedTransaction(t))));
export const authHashOf = (payloadB64: string) => binToHex(sha256.hash(utf8ToBin(`fuse-authz/v1:${payloadB64}`)));

export function issueAuthorization(p: Omit<AuthPayload, 'v' | 'kind' | 'intentId' | 'issuedAt' | 'expiresAt' | 'structureHash' | 'network'>, opts: { now?: number; ttl?: number; env?: NodeJS.ProcessEnv } = {}): Authorization {
  const key = serverKey(opts.env) ?? fail('execution authorizations are disabled on this deployment (FUSE_AUTH_KEY not set)', 503);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const payload: AuthPayload = { v: 1, kind: 'fuse.execution-authorization/v1', intentId: 'int_' + randomBytes(12).toString('hex'), network: 'mainnet', issuedAt: now, expiresAt: now + (opts.ttl ?? AUTH_TTL_SECONDS), structureHash: structureHashOfTemplate(p.template), ...p };
  const enc = b64u(toJson(payload)); const h = authHashOf(enc);
  const sig = secp256k1.signMessageHashSchnorr(key.priv, hexToBin(h));
  if (typeof sig === 'string') fail(sig, 500);
  return { payload: enc, authHash: h, serverPubkey: key.pub, serverSig: binToHex(sig as Uint8Array) };
}

/** Signature + expiry check. `trustedPubkey` is the deployment's published attestation key. */
export function openAuthorization(a: Authorization | undefined | null, trustedPubkey: string, opts: { now?: number; ignoreExpiry?: boolean } = {}): AuthPayload {
  if (!a || typeof a.payload !== 'string' || typeof a.serverSig !== 'string') fail('missing execution authorization: run preflight (POST /api/live/prepare) and send its authorization with the signed transaction');
  if (a!.serverPubkey !== trustedPubkey) fail('authorization was not issued by this deployment (unknown attestation key)');
  const h = authHashOf(a!.payload);
  if (h !== a!.authHash) fail('authorization hash does not match its payload');
  if (!/^[0-9a-f]{128}$/.test(a!.serverSig) || !secp256k1.verifySignatureSchnorr(hexToBin(a!.serverSig), hexToBin(trustedPubkey), hexToBin(h))) fail('authorization signature is invalid (forged or tampered)');
  let p: AuthPayload; try { p = fromJson<AuthPayload>(unb64u(a!.payload)); } catch { return fail('authorization payload is not valid JSON'); }
  if (p.network !== 'mainnet' || p.kind !== 'fuse.execution-authorization/v1' || p.v !== 1) fail('unsupported authorization version');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!opts.ignoreExpiry && now >= p.expiresAt) fail(`authorization expired at ${new Date(p.expiresAt * 1000).toISOString()}: run preflight again`);
  return p;
}

/** Optional: the user's wallet key signs the auth hash too (Schnorr). Binds the authorization to the user, publicly. */
export function verifyUserSignature(authHash: string, us: { pubkey: string; sig: string } | undefined, userLockingBytecode: string) {
  if (!us) return { present: false, ok: false, detail: 'no user signature over the authorization hash' };
  try {
    const pkh = binToHex(hash160(hexToBin(us.pubkey)));
    if (userLockingBytecode !== `76a914${pkh}88ac`) return { present: true, ok: false, detail: 'user signature key does not own the authorized wallet' };
    const ok = secp256k1.verifySignatureSchnorr(hexToBin(us.sig), hexToBin(us.pubkey), hexToBin(authHash));
    return { present: true, ok, detail: ok ? `wallet key ${pkh} signed the authorization hash` : 'user signature invalid' };
  } catch { return { present: true, ok: false, detail: 'malformed user signature' }; }
}
export function signAuthAsUser(authHash: string, priv: Uint8Array) {
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array; const sig = secp256k1.signMessageHashSchnorr(priv, hexToBin(authHash)) as Uint8Array;
  return { pubkey: binToHex(pub), sig: binToHex(sig) };
}

/** First structural difference between an authorized template and a signed transaction, or null if identical. */
export function structureDiff(t: TxTemplate, signed: TransactionCommon): string | null {
  const want = toUnsignedTransaction(t);
  if (signed.version !== want.version) return `version ${signed.version} ≠ authorized ${want.version}`;
  if (signed.locktime !== want.locktime) return `locktime ${signed.locktime} ≠ authorized ${want.locktime}`;
  if (signed.inputs.length !== want.inputs.length) return `${signed.inputs.length} inputs ≠ authorized ${want.inputs.length}`;
  if (signed.outputs.length !== want.outputs.length) return `${signed.outputs.length} outputs ≠ authorized ${want.outputs.length}`;
  for (let i = 0; i < want.inputs.length; i++) {
    const a = signed.inputs[i], b = want.inputs[i];
    if (binToHex(a.outpointTransactionHash) !== binToHex(b.outpointTransactionHash) || a.outpointIndex !== b.outpointIndex) return `input ${i} spends a different outpoint`;
    if (a.sequenceNumber !== b.sequenceNumber) return `input ${i} sequence differs`;
  }
  for (let i = 0; i < want.outputs.length; i++) {
    const a = signed.outputs[i], b = want.outputs[i];
    if (binToHex(a.lockingBytecode) !== binToHex(b.lockingBytecode)) return `output ${i} pays a different recipient/script`;
    if (a.valueSatoshis !== b.valueSatoshis) return `output ${i} amount ${a.valueSatoshis} ≠ authorized ${b.valueSatoshis}`;
    const ta = a.token, tb = b.token;
    if (!!ta !== !!tb || (ta && tb && (binToHex(ta.category) !== binToHex(tb.category) || ta.amount !== tb.amount || !!ta.nft !== !!tb.nft || (ta.nft && tb.nft && (ta.nft.capability !== tb.nft.capability || binToHex(ta.nft.commitment) !== binToHex(tb.nft.commitment)))))) return `output ${i} token data differs`;
  }
  // belt and braces: byte equality of the stripped encodings
  if (binToHex(strippedStructure(signed)) !== binToHex(strippedStructure(want))) return 'stripped transaction bytes differ';
  return null;
}
