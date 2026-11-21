// Mainnet solver auction (security review issue D). Independent solver processes answer a signed RFQ with signed quotes
// for a flash-financed Cauldron round trip. The hosted API verifies each quote (registered solver key, RFQ binding,
// expiry), RECOMPUTES every quoted route against fresh live pool state (a solver that over-promises is rejected), scores
// the survivors by the user's total cost, composes the winner's exact route, and issues an execution authorization (A)
// that commits to the auction transcript hash. Stateless: the RFQ is signed by the attestation key, so any instance can
// settle it.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { binToHex, hexToBin, sha256, utf8ToBin, secp256k1 } from '@bitauth/libauth';
import { toJson } from '@fuse/solver-sdk';
import { serverKey } from './authz.js';
import { prepare, type PrepareInput } from './execute.js';
import type { VaultConfig } from './vault.js';

export const RFQ_TTL = 180; export const QUOTE_TTL = 120;
export interface Rfq { v: 1; kind: 'fuse.rfq/v1'; auctionId: string; network: 'mainnet'; action: 'flash-cauldron'; address: string; vaultId: string | null; units: string; issuedAt: number; expiresAt: number }
export interface QuoteRoute { units: string; buyOutpoint: string; sellOutpoint: string; satsIn: string; satsOut: string; loss: string }
export interface Quote { v: 1; kind: 'fuse.solver-quote/v1'; auctionId: string; rfqHash: string; solverPubkey: string; strategy: string; route: QuoteRoute; quotedAt: number; expiresAt: number }
export interface SignedQuote { quote: Quote; sig: string }
export interface RegisteredSolver { solverId: string; pubkey: string; strategy: string; operator: string }

const fail = (msg: string, code = 422): never => { throw Object.assign(new Error(msg), { statusCode: code }); };
const h = (tag: string, o: unknown) => sha256.hash(utf8ToBin(`${tag}:${toJson(o)}`));
export const rfqHash = (r: Rfq) => binToHex(h('fuse-rfq/v1', r));
export const quoteHash = (q: Quote) => binToHex(h('fuse-quote/v1', q));
export const transcriptHashOf = (t: unknown) => binToHex(h('fuse-transcript/v1', t));
export const solverIdOfPub = (pub: string) => 'lsol_' + binToHex(sha256.hash(hexToBin(pub))).slice(0, 16);
function schnorr(hashHex: string, priv: Uint8Array) { const s = secp256k1.signMessageHashSchnorr(priv, hexToBin(hashHex)); if (typeof s === 'string') throw new Error(s); return binToHex(s); }
const verifySchnorr = (sig: string, pub: string, hashHex: string) => { try { return secp256k1.verifySignatureSchnorr(hexToBin(sig), hexToBin(pub), hexToBin(hashHex)); } catch { return false; } };

export function loadSolverRegistry(root: string): RegisteredSolver[] {
  const f = resolve(root, 'evidence/mainnet/live-solvers.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).solvers as RegisteredSolver[]) : [];
}

export function openRfq(x: { address: string; units: bigint; vaultId?: string }, now = Math.floor(Date.now() / 1000)) {
  const key = serverKey() ?? fail('auctions need the attestation key (FUSE_AUTH_KEY)', 503);
  const base = { v: 1 as const, kind: 'fuse.rfq/v1' as const, network: 'mainnet' as const, action: 'flash-cauldron' as const, address: x.address, vaultId: x.vaultId ?? null, units: x.units.toString(), issuedAt: now, expiresAt: now + RFQ_TTL };
  const rfq: Rfq = { ...base, auctionId: 'lauc_' + binToHex(h('lauc', { ...base, n: binToHex(secp256k1.derivePublicKeyCompressed(key.priv) as Uint8Array), r: Math.random() })).slice(0, 20) };
  const hash = rfqHash(rfq);
  return { rfq, rfqHash: hash, rfqSig: schnorr(hash, key.priv), attestationPubkey: key.pub };
}

/** Solver side: sign a quote for an RFQ. */
export function signQuote(q: Omit<Quote, 'v' | 'kind'>, priv: Uint8Array): SignedQuote { const quote: Quote = { v: 1, kind: 'fuse.solver-quote/v1', ...q }; return { quote, sig: schnorr(quoteHash(quote), priv) }; }

export interface QuoteVerdict { solverId: string; strategy: string; quoteHash: string; valid: boolean; reasons: string[]; recomputed?: { satsIn: string; satsOut: string; loss: string; expectedUserCost: string; minerFee: string; guardian: string }; score?: string; rank?: number }

export async function settleAuction(configs: VaultConfig[], registry: RegisteredSolver[], body: { rfq: Rfq; rfqSig: string; quotes: SignedQuote[] }, now = Math.floor(Date.now() / 1000)) {
  const key = serverKey() ?? fail('auctions need the attestation key (FUSE_AUTH_KEY)', 503);
  const rh = rfqHash(body.rfq);
  if (!verifySchnorr(body.rfqSig, key.pub, rh)) fail('RFQ signature invalid (not issued by this deployment)', 403);
  if (body.rfq.expiresAt < now) fail('RFQ expired', 410);
  if (body.quotes.length > 8) fail('too many quotes', 413);
  const verdicts: QuoteVerdict[] = []; const prepared = new Map<string, Awaited<ReturnType<typeof prepare>>>();
  for (const sq of body.quotes) {
    const q = sq.quote; const reasons: string[] = []; const qh = quoteHash(q);
    const reg = registry.find((r) => r.pubkey === q.solverPubkey);
    const v: QuoteVerdict = { solverId: reg?.solverId ?? solverIdOfPub(q.solverPubkey), strategy: q.strategy, quoteHash: qh, valid: false, reasons };
    if (!reg) reasons.push('solver key not in the registry');
    if (!verifySchnorr(sq.sig, q.solverPubkey, qh)) reasons.push('quote signature invalid');
    if (q.rfqHash !== rh || q.auctionId !== body.rfq.auctionId) reasons.push('quote is for a different RFQ');
    if (q.expiresAt < now) reasons.push('quote expired');
    if (q.route.units !== body.rfq.units) reasons.push('quote changes the requested size');
    if (verdicts.some((x) => x.solverId === v.solverId)) reasons.push('duplicate quote from the same solver');
    if (!reasons.length) {
      try {
        const p = await prepare(configs, { action: 'flash-cauldron', address: body.rfq.address, vaultId: body.rfq.vaultId ?? undefined, units: BigInt(q.route.units), route: { buyOutpoint: q.route.buyOutpoint, sellOutpoint: q.route.sellOutpoint } } as PrepareInput);
        const r = p.route as { satsIn: bigint; satsOut: bigint; roundTripLoss: bigint };
        v.recomputed = { satsIn: String(r.satsIn), satsOut: String(r.satsOut), loss: String(r.roundTripLoss), expectedUserCost: String(p.expectedUserCost), minerFee: String(p.minerFee), guardian: p.risk.level };
        if (r.roundTripLoss > BigInt(q.route.loss)) reasons.push(`misquoted: recomputed loss ${r.roundTripLoss} > quoted ${q.route.loss}`);
        if (!p.risk.ok) reasons.push('Guardian BLOCK on the composed route');
        if (!reasons.length) prepared.set(v.solverId, p);
      } catch (e) { reasons.push(`route does not compose on live state: ${(e as Error).message}`); }
    }
    v.valid = reasons.length === 0; verdicts.push(v);
  }
  const ranked = verdicts.filter((v) => v.valid).sort((a, b) => { const d = BigInt(a.recomputed!.expectedUserCost) - BigInt(b.recomputed!.expectedUserCost); return d !== 0n ? (d < 0n ? -1 : 1) : a.quoteHash < b.quoteHash ? -1 : 1; });
  ranked.forEach((v, i) => { v.rank = i + 1; v.score = v.recomputed!.expectedUserCost; });
  const winner = ranked[0] ?? fail(`no valid quote: ${verdicts.map((v) => `${v.strategy}: ${v.reasons.join('; ')}`).join(' | ') || 'none submitted'}`, 409);
  const transcript = { v: 1, kind: 'fuse.auction-transcript/v1', rfq: body.rfq, rfqHash: rh, rfqSig: body.rfqSig, quotes: body.quotes, verdicts, scoring: 'lowest recomputed total user cost (flash fee + round-trip pool loss + miner fee); ties by quote hash', winner: winner.solverId, settledAt: now };
  const transcriptHash = transcriptHashOf(transcript);
  return { prepared: prepared.get(winner.solverId)!, transcript, transcriptHash, winner };
}
