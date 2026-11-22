import { binToHex, decodeCashAddress, decodeTransaction, encodeTransaction, hash160, hexToBin, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { cauldronSwapIsValid, decodeVaultState } from '@fuse/contracts';
import { canonicalize } from '@fuse/core';
import type { ChainReader, IntentBinder } from '@fuse/proof-verifier';
import { contractLockingBytecode, contractUnlocks, sourceOutputsOf, templateHash, toUnsignedTransaction, txidOfRaw, verifyTemplateAndRaw, type TxTemplate } from '@fuse/transaction-composer';
import { FuseApiError } from './errors.js';
import { fromJson, toJson } from './wire.js';
import type { ExecutionAuthorization, LiveConstraints, LiveExecutionPolicy, LiveIntentEvidence, LivePreflight, LivePrepareInput, LiveVault, LiveVaultIdentity } from './live.js';

export const MAINNET_PUSD_CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const same = (a: unknown, b: unknown) => canonicalize(JSON.parse(toJson(a))) === canonicalize(JSON.parse(toJson(b)));

export function requireLive(ok: unknown, message: string, code = 'INVALID_LIVE_RESPONSE', status = 422): asserts ok {
  if (!ok) throw new FuseApiError(status, code, message);
}

export function mainnetWallet(address: string) {
  const d = decodeCashAddress(address);
  requireLive(typeof d !== 'string' && d.prefix === 'bitcoincash' && d.payload.length === 20 &&
    (d.type === 'p2pkh' || d.type === 'p2pkhWithTokens'), 'Use a Bitcoin Cash mainnet P2PKH address.', 'INVALID_MAINNET_ADDRESS', 400);
  return binToHex(d.payload);
}

export function vaultScript(vault: LiveVaultIdentity) {
  return contractLockingBytecode({ kind: 'flashvault-bch', fn: 'flash', params: { ...vault.params, vaultCategory: vault.category } })!;
}

export function checkVault(vault: LiveVault) {
  const parsed = decodeCashAddress(vault.address);
  const script = vaultScript(vault);
  const pkh = mainnetWallet(vault.owner);
  requireLive(typeof parsed !== 'string' && parsed.prefix === 'bitcoincash' &&
    (parsed.type === 'p2sh' || parsed.type === 'p2shWithTokens') && script === vault.lockingBytecode &&
    binToHex(parsed.payload) === script.slice(4, -2) && pkh === vault.params.ownerPkh,
  'Vault address or owner does not match the FlashVaultBCH contract.');
}

export function verifyHashSignature(sig: string, publicKey: string, digest: string) {
  return /^[0-9a-f]{128}$/.test(sig) && /^0[23][0-9a-f]{64}$/.test(publicKey) &&
    /^[0-9a-f]{64}$/.test(digest) && secp256k1.verifySignatureSchnorr(hexToBin(sig), hexToBin(publicKey), hexToBin(digest));
}

interface AuthorizationPayload {
  v: 1;
  kind: 'fuse.execution-authorization/v1';
  network: 'mainnet';
  intentId: string;
  action: string;
  address: string;
  issuedAt: number;
  expiresAt: number;
  templateHash: string;
  structureHash: string;
  template: TxTemplate;
  constraints: LiveConstraints;
  guardian: { level: string; ok: boolean; checks: string[] };
  auction: { auctionId: string; transcriptHash: string; winner: string } | null;
}

export function authorizationDigest(payload: string) {
  return binToHex(sha256.hash(utf8ToBin(`fuse-authz/v1:${payload}`)));
}

function readAuthorization(auth: ExecutionAuthorization, pinnedKey: string, now: number | null) {
  requireLive(auth?.serverPubkey === pinnedKey && typeof auth.payload === 'string' &&
    auth.payload.length <= 200_000 && /^[a-zA-Z0-9_-]+$/.test(auth.payload),
  'Authorization does not match the pinned deployment key or is malformed.', 'AUTHORIZATION_SIGNATURE', 403);
  const hash = authorizationDigest(auth.payload);
  requireLive(hash === auth.authHash && verifyHashSignature(auth.serverSig, pinnedKey, hash),
    'Authorization signature or payload hash is invalid.', 'AUTHORIZATION_SIGNATURE', 403);
  let p: AuthorizationPayload;
  try {
    const bytes = Uint8Array.from(atob(auth.payload.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
    p = fromJson<AuthorizationPayload>(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new FuseApiError(422, 'INVALID_AUTHORIZATION', 'Could not decode the signed authorization payload.');
  }
  requireLive(p?.network === 'mainnet' && p.v === 1 && p.kind === 'fuse.execution-authorization/v1' &&
    typeof p.intentId === 'string' && Number.isSafeInteger(p.issuedAt) && Number.isSafeInteger(p.expiresAt) &&
    p.expiresAt > p.issuedAt && p.expiresAt - p.issuedAt <= 300,
  'Unsupported or malformed mainnet authorization.', 'INVALID_AUTHORIZATION');
  if (now !== null) {
    requireLive(p.issuedAt <= now + 10, 'Authorization was issued in the future. Check the system clock.', 'INVALID_AUTHORIZATION');
    requireLive(now < p.expiresAt, 'Authorization expired. Run preflight again.', 'AUTHORIZATION_EXPIRED', 409);
  }
  requireLive(p.templateHash === templateHash(p.template) &&
    p.structureHash === binToHex(sha256.hash(encodeTransaction(toUnsignedTransaction(p.template)))),
  'The authorization does not commit to its transaction template.', 'TEMPLATE_MISMATCH');
  return p;
}

/** Match the complete unsigned transaction and wallet source outputs against the displayed template. */
export function checkUnsigned(prepared: LivePreflight, input: LivePrepareInput) {
  requireLive(prepared?.network === 'mainnet' && prepared.action === input.action && prepared.address === input.address,
    'Prepared execution has a different network, operation, or wallet.');
  const { template, sign } = prepared;
  const unsigned = toUnsignedTransaction(template);
  const covenantUnlocks = contractUnlocks(template);
  const walletInputs: number[] = [];
  const sources = template.inputs.map((i, index) => {
    const unlock = covenantUnlocks.get(index) ?? '';
    unsigned.inputs[index].unlockingBytecode = hexToBin(unlock);
    if (!covenantUnlocks.has(index)) walletInputs.push(index);
    return {
      outpointIndex: i.vout, outpointTransactionHash: i.txid, sequenceNumber: unsigned.inputs[index].sequenceNumber,
      unlockingBytecode: unlock, lockingBytecode: i.lockingBytecode, valueSatoshis: String(i.satoshis),
      ...(i.token ? { token: { ...i.token, amount: String(i.token.amount) } } : {}),
    };
  });
  requireLive(sign.broadcast === false && walletInputs.length > 0 && same(sign.userInputs, walletInputs) &&
    same(sign.inputPaths, walletInputs.map(i => [i, 'receive', 0])) && same(sign.sourceOutputs, sources) &&
    sign.transactionHex === binToHex(encodeTransaction(unsigned)) && prepared.templateHash === templateHash(template),
  'Unsigned transaction or wallet source outputs differ from the template. Discard this preflight.', 'TEMPLATE_MISMATCH');
}

function checkVaultConstraint(template: TxTemplate, c: LiveConstraints, input: LivePrepareInput, owner: string, pin?: LiveVaultIdentity) {
  const vault = c.vault;
  const vaultInputs = template.inputs.map((i, index) => ({ i, index })).filter(({ i }) => i.role === 'vault');
  const action = input.action;
  if (action === 'consolidate') {
    requireLive(!vault && !vaultInputs.length && c.capital === 0n, 'Consolidation cannot move vault capital.');
    return;
  }
  requireLive(vault && vault.lockingBytecode === vaultScript({ ...vault, params: vault }), 'FlashVault script does not match its parameters.');
  if (action === 'deploy-vault') {
    const genesis = template.inputs[0];
    const output = template.outputs[0];
    requireLive(!vaultInputs.length && genesis.vout === 0 && vault.category === genesis.txid && vault.ownerPkh === owner &&
      vault.id === 'new' && output.lockingBytecode === vault.lockingBytecode && output.satoshis === (input.principal ?? 20_000n) &&
      c.capital === output.satoshis && output.token?.category === vault.category && output.token.amount === 0n &&
      output.token.nft?.capability === 'mutable' && output.token.nft.commitment === '00'.repeat(17),
    'Vault deployment does not match the requested owner, principal, or NFT genesis.');
    return;
  }
  requireLive(vaultInputs.length === 1 && pin && vault.id === pin.id && (!input.vaultId || input.vaultId === pin.id) &&
    vault.category === pin.category && vault.lockingBytecode === vaultScript(pin), 'Vault does not match the pinned mainnet identity.', 'VAULT_MISMATCH');
  const { i, index } = vaultInputs[0];
  const output = template.outputs[index];
  requireLive(i.lockingBytecode === vault.lockingBytecode && output?.lockingBytecode === vault.lockingBytecode &&
    i.token?.category === vault.category && output.token?.category === vault.category &&
    i.token.amount === 0n && output.token.amount === 0n && i.token.nft?.capability === 'mutable' && output.token.nft?.capability === 'mutable',
  'FlashVault continuation has a different script or identity NFT.');
  const delta = output.satoshis - i.satoshis;
  if (action === 'deposit' || action === 'withdraw') {
    const amount = input.amount ?? 10_000n;
    requireLive(i.unlock.kind === 'flashvault-bch-owner' && vault.ownerPkh === owner &&
      delta === (action === 'deposit' ? amount : -amount) && output.token.nft.commitment === i.token.nft.commitment &&
      c.capital === (action === 'deposit' ? amount : 0n), 'Vault owner operation differs from the requested amount or wallet.');
  } else {
    const proportional = (i.satoshis * vault.feeBps + 9_999n) / 10_000n;
    const fee = proportional > vault.minFee ? proportional : vault.minFee;
    const before = decodeVaultState(i.token.nft.commitment);
    const after = decodeVaultState(output.token.nft.commitment);
    requireLive(i.unlock.kind === 'flashvault-bch' && i.satoshis <= vault.maxExposure && c.capital === 0n && delta === fee &&
      !before.paused && !after.paused && after.flashCount === before.flashCount + 1n &&
      after.cumulativeFees === before.cumulativeFees + fee, 'FlashVault repayment or committed state transition is invalid.');
  }
  requireLive(vault.requiredReturn === output.satoshis, 'Vault return differs from the authorized amount.');
}

function checkPoolConstraints(template: TxTemplate, route: LiveConstraints['route'], input: LivePrepareInput) {
  const legs = template.inputs.map((i, index) => ({ i, index })).filter(({ i }) => i.role === 'pool');
  if (input.action !== 'flash-cauldron') {
    requireLive(!route && !legs.length, 'Unexpected Cauldron route.');
    return;
  }
  requireLive(route && legs.length === 2 && route.slippageBps === 0 && route.buyOutpoint !== route.sellOutpoint &&
    route.units === String(input.units ?? 1n), 'Cauldron route differs from the requested trade.');
  for (const { i, index } of legs) {
    const out = template.outputs[index];
    const outpoint = `${i.txid}:${i.vout}`;
    requireLive(i.unlock.kind === 'cauldron-pool' && out?.lockingBytecode === i.lockingBytecode &&
      i.token?.category === MAINNET_PUSD_CATEGORY && out.token?.category === MAINNET_PUSD_CATEGORY &&
      !i.token.nft && !out.token.nft && cauldronSwapIsValid(i.satoshis, i.token.amount, out.satoshis, out.token.amount),
    'Cauldron PUSD pool identity or price invariant failed.');
    const buy = outpoint === route.buyOutpoint;
    requireLive(buy || outpoint === route.sellOutpoint, 'Transaction uses a pool outside the authorized route.');
    const units = i.token.amount - out.token.amount;
    requireLive(buy ? units === BigInt(route.units) && out.satoshis - i.satoshis === route.satsIn
      : units === -BigInt(route.units) && i.satoshis - out.satoshis === route.minSatsOut,
    'Cauldron trade values differ from the authorized route.');
  }
}

export function verifyPreflight(prepared: LivePreflight, request: LivePrepareInput, policy: LiveExecutionPolicy, now = Math.floor(Date.now() / 1000)) {
  const owner = mainnetWallet(request.address);
  checkUnsigned(prepared, request);
  requireLive(prepared.authorization, prepared.authorizationNote ?? 'Run preflight on a deployment with execution authorization.', 'AUTHORIZATION_REQUIRED', 403);
  const p = readAuthorization(prepared.authorization, policy.attestationPubkey, now);
  const c = p.constraints;
  requireLive(p.guardian?.ok === true && prepared.risk?.ok === true && p.guardian.level === prepared.risk.level &&
    same(p.guardian.checks, prepared.risk.checks.map(c => `${c.ok ? 'ok' : 'FAIL'}:${c.name}`)) &&
    p.action === request.action && p.address === request.address && p.templateHash === prepared.templateHash &&
    same(p.template, prepared.template) && same(c, prepared.constraints),
  'Displayed preflight differs from its signed authorization or was blocked.', 'AUTHORIZATION_MISMATCH');
  checkVaultConstraint(p.template, c, request, owner, policy.vault);
  checkPoolConstraints(p.template, c.route, request);
  const route = prepared.route;
  requireLive(c.route ? route && route.units === c.route.units && route.buyOutpoint === c.route.buyOutpoint &&
    route.sellOutpoint === c.route.sellOutpoint && route.satsIn === c.route.satsIn && route.satsOut === c.route.minSatsOut &&
    route.roundTripLoss === route.satsIn - route.satsOut : !route, 'Displayed route differs from authorized pool amounts.');
  const wallet = `76a914${owner}88ac`;
  const allowed = new Set([wallet, ...(c.vault ? [c.vault.lockingBytecode] : [])]);
  for (const i of p.template.inputs) {
    if (i.unlock.kind === 'cauldron-pool' && i.role === 'pool') allowed.add(i.lockingBytecode);
    if (i.role === 'wallet') requireLive(i.unlock.kind === 'p2pkh' && !i.token && i.lockingBytecode === wallet, 'Unexpected wallet source output.');
    else requireLive((i.role === 'vault' || i.role === 'pool') && contractLockingBytecode(i.unlock) === i.lockingBytecode, 'Covenant does not match its locking script.');
  }
  requireLive(p.template.outputs.length === 1 + (c.vault ? 1 : 0) + (c.route ? 2 : 0) &&
    p.template.outputs.filter(o => o.lockingBytecode === wallet && !o.token).length === 1 &&
    c.userLockingBytecode === wallet && c.allowedRecipients.every(s => allowed.has(s)) &&
    p.template.outputs.every(o => c.allowedRecipients.includes(o.lockingBytecode)), 'Transaction contains an unexpected recipient or output.');
  const spend = p.template.inputs.filter(i => i.lockingBytecode === wallet).reduce((sum, i) => sum + i.satoshis, 0n)
    - p.template.outputs.find(o => o.lockingBytecode === wallet)!.satoshis - c.capital;
  const ceiling = request.maxUserCost ?? policy.maxUserCost;
  const report = verifyTemplateAndRaw(p.template, prepared.sign.transactionHex, {
    vm: false, maxMinerFee: policy.maxMinerFee, allowedOutputScripts: [...allowed],
  });
  requireLive(report.ok && report.minerFee === prepared.minerFee && report.minerFee <= c.maxMinerFee &&
    spend === c.expectedUserCost && spend === prepared.expectedUserCost && spend <= c.maxUserCost &&
    spend <= ceiling && spend <= policy.maxUserCost && prepared.risk.netUserCost === spend &&
    prepared.risk.capitalToOwnVault === c.capital, 'Transaction fee or wallet cost differs from the approved constraints.', 'COST_LIMIT');
  return p;
}

export async function readMainnetOutput(reader: ChainReader, txid: string, vout: number) {
  requireLive(reader.network === 'mainnet', 'Use an independent BCH mainnet reader.', 'NETWORK_MISMATCH', 400);
  const parent = await reader.getRawTransaction(txid).catch(() => null);
  requireLive(parent, `Cannot read mainnet parent ${txid}. Check the indexer and retry.`, 'CHAIN_UNAVAILABLE', 503);
  requireLive(txidOfRaw(parent.rawHex) === txid, 'Parent bytes do not match the input transaction ID.', 'SOURCE_MISMATCH');
  const tx = decodeTransaction(hexToBin(parent.rawHex));
  requireLive(typeof tx !== 'string' && tx.outputs[vout], 'Parent transaction has no such source output.', 'SOURCE_MISMATCH');
  return tx.outputs[vout];
}

export async function checkMainnetSources(template: TxTemplate, reader: ChainReader) {
  const expected = sourceOutputsOf(template);
  await Promise.all(template.inputs.map(async (input, index) => {
    const output = await readMainnetOutput(reader, input.txid, input.vout);
    const normalized = { ...output, token: output.token };
    requireLive(same(normalized, expected[index]), 'Mainnet source amount, script, or token differs from preflight.', 'SOURCE_MISMATCH');
  }));
}

/** Bind a historical receipt to an independently pinned operator key and verify any separate wallet signature. */
export function liveIntentBinder(evidence: LiveIntentEvidence, trustedKey: string): IntentBinder {
  return async (cert, txs) => {
    const auth = evidence.authorization;
    if (!auth) return { present: false, ok: false, detail: 'No execution authorization was supplied.' };
    const p = readAuthorization(auth, trustedKey, null);
    const tx = txs.get(cert.transactions[0].txid);
    const hash = tx && binToHex(sha256.hash(encodeTransaction({ ...tx, inputs: tx.inputs.map(input => ({ ...input, unlockingBytecode: new Uint8Array() })) })));
    requireLive(cert.network === 'mainnet' && cert.transactions.length === 1 && hash === p.structureHash && p.guardian.ok &&
      (!p.auction || p.auction.transcriptHash === cert.quoteCommitment), 'Receipt does not match the authorized transaction or auction commitment.', 'AUTHORIZATION_MISMATCH');
    const sig = evidence.userSignature;
    if (sig) requireLive(`76a914${binToHex(hash160(hexToBin(sig.pubkey)))}88ac` === p.constraints.userLockingBytecode &&
      verifyHashSignature(sig.sig, sig.pubkey, auth.authHash), 'Wallet authorization signature is invalid.', 'AUTHORIZATION_SIGNATURE');
    return { present: true, ok: true, detail: sig
      ? 'Deployment authorization and separate wallet signature verified.'
      : 'Deployment authorization verified. Separate wallet authorization signature absent.' };
  };
}
