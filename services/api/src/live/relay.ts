// /api/broadcast: relays an ALREADY-SIGNED transaction, and only one that matches a FUSE execution authorization
// (security review issue A). Order of checks, each fatal:
//   1. authorization: attestation signature, expiry, single use (per-instance set + exact outpoints, re-checked unspent)
//   2. structure: the signed tx with every scriptSig stripped must be byte-identical to the authorized template;
//      key-less covenant unlocks must equal the ones FUSE composed
//   3. VM: every input valid in the BCH 2026 VM against source outputs re-derived from chain (raw parents re-hashed)
//   4. fresh chain state: each spent output still matches the template (value, script, token) and is unspent
//   5. financial constraints + Guardian re-run: recipients, fee cap, user net cost, vault repayment, pool invariants
//      and minimum sats out on the route. Guardian BLOCK → refused.
// No keys that control funds exist on the server; nothing here can sign a spend.
import { binToHex, hexToBin, decodeTransaction, createVirtualMachineBch2026, type Output } from '@bitauth/libauth';
import { REQUIRED_SIGHASH_BYTE, contractUnlocks, txidOfRaw, type TxTemplate } from '@fuse/transaction-composer';
import { cauldronSwapIsValid } from '@fuse/contracts';
import { independentlyUnspent, freshTip, outputAt, outspend, pool, relay, relayPaths, EXPLORER_TX, type LiveUtxo } from './chain.js';
import { openAuthorization, structureDiff, verifyUserSignature, type Authorization, type AuthPayload } from './authz.js';
import { guardianPreflight, simulate } from './execute.js';

type Src = { txid: string; vout: number; satoshis: bigint; lockingBytecode: string; token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } } };
export interface ChainDeps { independentlyUnspent?: typeof independentlyUnspent; freshTip?: typeof freshTip; outputAt: (txid: string, vout: number) => Promise<Src>; outspend: (txid: string, vout: number) => Promise<{ spent: boolean; txid?: string }>; relay: (rawHex: string) => Promise<string> }
export const liveChain: ChainDeps = { independentlyUnspent, freshTip, outputAt: outputAt as never, outspend, relay };

const hits = new Map<string, number[]>();
let instanceHits: number[] = [];
export function rateLimit(ip: string, max = 12, windowMs = 60_000) {
  const now = Date.now();
  instanceHits = instanceHits.filter(t => now - t < windowMs);
  for (const [key, times] of hits) if (now - times[times.length - 1] >= windowMs) hits.delete(key);
  const recent = (hits.get(ip) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= max || instanceHits.length >= 120) {
    throw Object.assign(new Error('Broadcast rate limited. Retry in one minute.'), { statusCode: 429 });
  }
  recent.push(now);
  hits.set(ip, recent);
  instanceHits.push(now);
}
const refuse = (msg: string, code = 422, details?: unknown): never => { throw Object.assign(new Error(`refused: ${msg}. Nothing was sent.`), { statusCode: code, details }); };

function decodeRaw(rawHex: string) {
  if (!/^[0-9a-f]+$/.test(rawHex) || rawHex.length % 2 || rawHex.length > 200_000) throw Object.assign(new Error('rawHex must be hex, ≤ 100 kB'), { statusCode: 400 });
  const tx = decodeTransaction(hexToBin(rawHex));
  if (typeof tx === 'string') throw Object.assign(new Error(`not a transaction: ${tx}`), { statusCode: 400 });
  return tx;
}

export async function verifySigned(rawHex: string, deps: ChainDeps = liveChain) {
  const tx = decodeRaw(rawHex);
  const src = await pool(tx.inputs, 4, async (i) => deps.outputAt(binToHex(i.outpointTransactionHash), i.outpointIndex));
  const sourceOutputs = src.map((o) => ({ lockingBytecode: hexToBin(o.lockingBytecode), valueSatoshis: o.satoshis, ...(o.token ? { token: { category: hexToBin(o.token.category), amount: o.token.amount, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: hexToBin(o.token.nft.commitment) } } : {}) } } : {}) }) as Output);
  const r = createVirtualMachineBch2026().verify({ transaction: tx, sourceOutputs });
  const inSum = src.reduce((a, o) => a + o.satoshis, 0n); const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  return { tx, src, txid: txidOfRaw(rawHex), vmValid: r === true, vmDetail: r === true ? 'all inputs valid in the BCH 2026 VM against chain-derived source outputs' : String(r), minerFee: inSum - outSum, sizeBytes: rawHex.length / 2, inputs: tx.inputs.length, outputs: tx.outputs.length };
}

const used = new Map<string, number>();
const tokEq = (a: Src['token'], b: TxTemplate['inputs'][number]['token']) => (!a && !b) || (!!a && !!b && a.category === b.category && a.amount === b.amount && (!!a.nft === !!b.nft) && (!a.nft || (a.nft.capability === b.nft!.capability && a.nft.commitment === b.nft!.commitment)));

/** Re-runs the authorized financial constraints on the template against fresh source outputs. */
export function enforceConstraints(p: AuthPayload, src: Src[], minerFee: bigint) {
  const t = p.template; const c = p.constraints; const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  add('fresh source outputs match the template', t.inputs.every((x, i) => src[i] && src[i].satoshis === x.satoshis && src[i].lockingBytecode === x.lockingBytecode && tokEq(src[i].token, x.token)), 'value, script and token of every spent output re-read from chain');
  add('recipients authorized', t.outputs.every((o) => c.allowedRecipients.includes(o.lockingBytecode)), `${c.allowedRecipients.length} authorized scripts`);
  add('miner fee within the authorized cap', minerFee <= c.maxMinerFee, `${minerFee} ≤ ${c.maxMinerFee}`);
  const userIn = t.inputs.filter((i) => i.lockingBytecode === c.userLockingBytecode).reduce((a, i) => a + i.satoshis, 0n);
  const userOut = t.outputs.filter((o) => o.lockingBytecode === c.userLockingBytecode).reduce((a, o) => a + o.satoshis, 0n);
  const cost = userIn - userOut - c.capital;
  add('user net cost within the authorized limit', cost <= c.maxUserCost, `${cost} ≤ ${c.maxUserCost}`);
  if (c.vault && c.vault.requiredReturn !== null) {
    const back = t.outputs.find((o) => o.lockingBytecode === c.vault!.lockingBytecode)?.satoshis ?? 0n;
    add('vault repaid as authorized', back >= c.vault.requiredReturn, `${back} ≥ ${c.vault.requiredReturn}`);
  }
  if (c.route) {
    const legs = t.inputs.map((x, i) => ({ x, i })).filter(({ x }) => x.role === 'pool');
    for (const { x, i } of legs) { const o = t.outputs[i]; add(`pool ${x.txid.slice(0, 8)}:${x.vout} invariant on fresh state`, !!o && !!x.token && !!o.token && o.lockingBytecode === x.lockingBytecode && cauldronSwapIsValid(src[i].satoshis, src[i].token!.amount, o.satoshis, o.token.amount), 'k-invariant with 0.3% fee recomputed'); }
    const sell = legs.find(({ x }) => `${x.txid}:${x.vout}` === c.route!.sellOutpoint);
    if (sell) { const out = src[sell.i].satoshis - t.outputs[sell.i].satoshis; add('route returns at least the authorized sats out', out >= BigInt(String(c.route.minSatsOut)), `${out} ≥ ${c.route.minSatsOut}`); }
  }
  const coins: LiveUtxo[] = t.inputs.filter((i) => i.lockingBytecode === c.userLockingBytecode).map((i) => ({ txid: i.txid, vout: i.vout, satoshis: i.satoshis, lockingBytecode: i.lockingBytecode, confirmed: true }) as LiveUtxo);
  const g = guardianPreflight(t, { userLb: c.userLockingBytecode, vaultLb: c.vault?.lockingBytecode ?? null, fee: minerFee, expectedUserCost: c.expectedUserCost, capital: c.capital, maxUserCost: c.maxUserCost, sim: simulate(t), requiredReturn: c.vault?.requiredReturn ?? null, coins });
  add('Guardian re-run at broadcast', g.ok, `level ${g.level}${g.ok ? '' : ': ' + g.checks.filter((x) => !x.ok && x.level === 'block').map((x) => x.name).join(', ')}`);
  return { ok: checks.every((x) => x.ok), checks, guardian: g.level };
}

export interface BroadcastRequest { rawHex: string; authorization?: Authorization; userSignature?: { pubkey: string; sig: string } }
export async function broadcast(req: BroadcastRequest, opts: { enabled: boolean; trustedPubkey: string | null; maxFee?: bigint; deps?: ChainDeps; now?: number }) {
  if (!opts.enabled) throw Object.assign(new Error('broadcasting is disabled on this deployment (FUSE_BROADCAST=1 not set)'), { statusCode: 503 });
  if (!opts.trustedPubkey) throw Object.assign(new Error('broadcasting needs execution authorizations, which are not configured (FUSE_AUTH_KEY)'), { statusCode: 503 });
  const deps = opts.deps ?? liveChain;
  // 1. authorization
  const p = openAuthorization(req.authorization, opts.trustedPubkey, { now: opts.now });
  if (used.has(p.intentId)) refuse('this authorization was already used (single use)', 409);
  if (!p.guardian.ok) refuse(`the authorized preflight had a Guardian ${p.guardian.level}`, 403);
  // 2. structure
  const tx = decodeRaw(req.rawHex);
  const diff = structureDiff(p.template, tx);
  if (diff) refuse(`signed transaction differs from the authorized template: ${diff}`, 403);
  for (const [i, input] of p.template.inputs.entries()) {
    if (input.unlock.kind !== 'p2pkh') continue;
    const unlock = tx.inputs[i].unlockingBytecode;
    const length = unlock[0];
    if (length < 9 || length > 73 || unlock[length] !== REQUIRED_SIGHASH_BYTE ||
        unlock[length + 1] !== 33 || unlock.length !== length + 35) refuse('wallet input must sign ALL | FORKID | UTXOS', 403);
  }
  const cu = contractUnlocks(p.template);
  for (const [i, u] of cu) if (binToHex(tx.inputs[i].unlockingBytecode) !== u) refuse(`input ${i} covenant unlock differs from the composed one`, 403);
  const us = verifyUserSignature(req.authorization!.authHash, req.userSignature, p.constraints.userLockingBytecode);
  if (us.present && !us.ok) refuse(us.detail, 403);
  // 3. VM against chain
  const v = await verifySigned(req.rawHex, deps);
  if (!v.vmValid) refuse(v.vmDetail, 422);
  if (v.minerFee > (opts.maxFee ?? 50_000n)) refuse(`miner fee ${v.minerFee} sats looks wrong (guard 50,000)`);
  // 4. fresh chain state: inputs unspent (also enforces single use across instances)
  await deps.freshTip?.();
  await deps.independentlyUnspent?.(p.template.inputs);
  const spent = await pool(p.template.inputs, 4, async (x) => (await deps.outspend(x.txid, x.vout)).spent !== false);
  if (spent.some(Boolean)) refuse('an authorized input is already spent (authorization used, or state moved): run preflight again', 409);
  // 5. constraints + Guardian on fresh state
  const c = enforceConstraints(p, v.src, v.minerFee);
  if (!c.ok) refuse(`financial constraints failed on fresh chain state: ${c.checks.filter((x) => !x.ok).map((x) => `${x.name} (${x.detail})`).join('; ')}`, 422, c.checks);
  if (used.has(p.intentId)) refuse('this authorization was already used', 409);
  if ((opts.now ?? Math.floor(Date.now() / 1000)) >= p.expiresAt) refuse('authorization expired during verification', 403);
  used.set(p.intentId, p.expiresAt);
  for (const [k, e] of used) if (e < Math.floor(Date.now() / 1000) - 3600) used.delete(k);
  const nodeTxid = await deps.relay(req.rawHex);
  if (nodeTxid !== v.txid) throw Object.assign(new Error(`node returned ${nodeTxid}, expected ${v.txid}`), { statusCode: 502 });
  const { tx: _t, src: _s, ...pub } = v;
  return { ...pub, broadcast: true, intentId: p.intentId, authHash: req.authorization!.authHash, intentBound: true, userSignature: us, constraintChecks: c.checks, guardianAtBroadcast: c.guardian, relayedVia: relayPaths.get(v.txid)?.join(' + ') ?? 'relay', explorer: EXPLORER_TX + v.txid };
}
export const _resetUsedForTests = () => used.clear();
