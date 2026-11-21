// LIVE mainnet routes (default mode of the app). Reads come from public indexers; the execute path builds unsigned
// transactions; /api/broadcast relays already-signed hex after a full VM check. The server holds no keys.
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { sourceHealth } from './source.js';
import { freshTip, confirmations, tip, addressUtxos, ESPLORA, EXPLORER_TX } from './chain.js';
import { loadVaultConfigs, trackVault } from './vault.js';
import { livePools, bestRoundTrip } from './cauldron.js';
import { liveParyon } from './paryon.js';
import { assertInputsUnspent, prepare, LIVE_CAPS } from './execute.js';
import { broadcast, verifySigned, rateLimit } from './relay.js';
import { openAuthorization, issueAuthorization, serverKey } from './authz.js';
import { liveCertificate, esploraReader } from './certificate.js';
import { liveRederiver, intentBinder } from './verify.js';
import { verifyCertificate } from '@fuse/proof-verifier';
import { openRfq, settleAuction, loadSolverRegistry } from './auction.js';
import { radar, sentinel } from '@fuse/risk-engine';
import { parseLoan } from '@fuse/risk-engine';

export const broadcastEnabled = () => process.env.FUSE_BROADCAST === '1';
/** Preflight result + an execution authorization when Guardian passed (none on BLOCK, so a blocked tx can never be relayed). */
export function withAuthorization<T extends Awaited<ReturnType<typeof prepare>>>(p: T, auction: { auctionId: string; transcriptHash: string; winner: string } | null = null) {
  if (!p.risk.ok || !serverKey()) return { ...p, authorization: null, authorizationNote: !p.risk.ok ? 'Guardian BLOCK: no execution authorization issued' : 'authorizations not configured on this deployment' };
  const authorization = issueAuthorization({ action: p.action, address: p.address, templateHash: p.templateHash, template: p.template, constraints: p.constraints as never, guardian: { level: p.risk.level, ok: p.risk.ok, checks: p.risk.checks.map((c) => `${c.ok ? 'ok' : 'FAIL'}:${c.name}`) }, auction });
  return { ...p, authorization };
}
const Txid = z.string().regex(/^[0-9a-f]{64}$/);

export function registerLive(app: FastifyInstance, ctx: { root: string; paryonSnapshot: () => unknown }) {
  const configs = () => loadVaultConfigs(ctx.root);
  app.get('/api/live/status', async () => {
    const t0 = Date.now(); let tipHeight: number | null = null; let err: string | null = null;
    try { tipHeight = await tip(); } catch (e) { err = (e as Error).message; }
    return { mode: 'LIVE', network: 'mainnet', releaseSha: process.env.FUSE_RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null, tipHeight, sources: sourceHealth(), checkedAt: new Date().toISOString(), chainSource: new URL(ESPLORA).hostname, latencyMs: Date.now() - t0, error: err, broadcast: broadcastEnabled() && serverKey() ? 'ENABLED (relays only signed txs that match an unexpired, single-use execution authorization from preflight; full VM + constraint re-check; server holds no fund keys)' : 'DISABLED', authorization: serverKey() ? { scheme: 'Schnorr secp256k1 over sha256("fuse-authz/v1:" + payload)', attestationPubkey: serverKey()!.pub, ttlSeconds: 300, singleUse: 'per-instance used-set + exact input outpoints re-checked unspent' } : null, vaults: configs().map((c) => ({ id: c.id, status: c.status, category: c.category })), caps: LIVE_CAPS, sandbox: 'opt-in local BCH VM (toggle in the app)' };
  });
  app.get('/api/live/vaults', async () => Promise.all(configs().map((c) => trackVault(c).catch((e: Error) => ({ id: c.id, error: e.message })))));
  app.get('/api/live/vault/:id', async (req, reply) => { const c = configs().find((x) => x.id === (req.params as { id: string }).id); return c ? trackVault(c) : reply.status(404).send({ error: 'NOT_FOUND' }); });
  app.get('/api/live/cauldron', async () => { const r = await livePools(); const rt = bestRoundTrip(r.pools, 1n); return { ...r, bestRoundTrip1Unit: rt ? { buyPool: rt.a.poolId, sellPool: rt.b.poolId, satsIn: rt.satsIn, satsOut: rt.satsOut, loss: rt.loss } : null }; });
  app.get('/api/live/paryon', async () => liveParyon(ctx.paryonSnapshot() as never));
  app.get('/api/live/guardian/radar', async (req) => {
    const { shockBps, limit } = z.object({ shockBps: z.coerce.bigint().min(0n).max(9_000n).default(0n), limit: z.coerce.number().int().min(1).max(400).default(60) }).parse(req.query);
    const live = await liveParyon(ctx.paryonSnapshot() as never);
    const price = BigInt(live.latestPrice?.priceRaw ?? 0);
    const r = radar(live.loans.map((l) => parseLoan(l as Record<string, string>)), price, shockBps);
    return { status: 'LIVE (READ-ONLY)', readAt: live.readAt, tipHeight: live.tipHeight, latestPrice: live.latestPrice, coverage: live.coverage, ...r, risks: r.risks.slice(0, limit), total: r.risks.length };
  });
  const liveView = async () => {
    const live = await liveParyon(ctx.paryonSnapshot() as never);
    const active = live.loans.filter((l) => BigInt(l.periodsBehind) <= 1n && l.debtCents !== '0');
    const crs = active.map((l) => Number(l.collateralRatioBps)).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    const collateralRatioBps = { min: crs[0] ?? 0, median: crs.length ? crs[Math.floor(crs.length / 2)] : 0, max: crs[crs.length - 1] ?? 0 };
    const snap = ctx.paryonSnapshot() as { operations?: Record<string, string> } | null;
    return { checkedAt: live.readAt, tipHeight: live.tipHeight, mode: 'LIVE', coverage: live.coverage, operations: snap?.operations ?? {}, live: { latestPrice: live.latestPrice, priceStates: live.priceStates, loans: live.loans, activeLoans: active.length, staleLoans: live.loans.length - active.length, currentPeriod: live.currentPeriod, collateralRatioBps, unspentMutableParyonNfts: live.loans.length } };
  };
  app.get('/api/live/paryon-view', async () => liveView());
  app.get('/api/live/guardian/sentinel', async () => { const v = await liveView(); return { checkedAt: v.checkedAt, ...sentinel({ priceStates: v.live.priceStates as never, latestPrice: v.live.latestPrice as never, activeLoans: v.live.activeLoans, staleLoans: v.live.staleLoans, checkedAt: v.checkedAt }) }; });
  app.get('/api/live/wallet/:address', async (req) => { const a = (req.params as { address: string }).address; const coins = await addressUtxos(a); return { address: a, balance: coins.reduce((s, c) => s + c.satoshis, 0n), coins }; });
  const PrepareZ = z.object({ action: z.enum(['flash', 'flash-cauldron', 'deposit', 'withdraw', 'deploy-vault', 'consolidate']), address: z.string().min(20).max(120), vaultId: z.string().max(40).optional(), amount: z.coerce.bigint().positive().optional(), principal: z.coerce.bigint().positive().optional(), units: z.coerce.bigint().min(1n).max(5n).optional(), maxUserCost: z.coerce.bigint().positive().optional() });
  app.post('/api/live/prepare', async (req) => withAuthorization(await prepare(configs(), PrepareZ.parse(req.body))));
  app.post('/api/live/verify-signed', async (req) => { const { tx: _t, src: _s, ...v } = await verifySigned(z.object({ rawHex: z.string() }).parse(req.body).rawHex); return v; });
  // D: mainnet solver auction — signed RFQ → signed solver quotes → verify + recompute + score → authorized winner
  app.post('/api/live/auction/rfq', async (req) => { const b = z.object({ address: z.string().min(20).max(120), units: z.coerce.bigint().min(1n).max(5n).default(1n), vaultId: z.string().max(40).optional() }).parse(req.body); return { ...openRfq(b), solvers: loadSolverRegistry(ctx.root) }; });
  app.post('/api/live/auction/settle', async (req) => {
    const b = req.body as Parameters<typeof settleAuction>[2];
    if (!b?.rfq || !b.rfqSig || !Array.isArray(b.quotes)) throw Object.assign(new Error('rfq, rfqSig and quotes are required'), { statusCode: 400 });
    const r = await settleAuction(configs(), loadSolverRegistry(ctx.root), b);
    return { ...withAuthorization(r.prepared, { auctionId: r.transcript.rfq.auctionId, transcriptHash: r.transcriptHash, winner: r.winner.solverId }), auction: { transcript: r.transcript, transcriptHash: r.transcriptHash, winner: r.winner } };
  });
  app.get('/api/live/auction/solvers', async () => loadSolverRegistry(ctx.root));
  const AuthZ = z.object({ payload: z.string().max(200_000), authHash: z.string(), serverPubkey: z.string(), serverSig: z.string() });
  app.post('/api/live/check-authorization', async (req) => {
    const p = openAuthorization(AuthZ.parse(req.body), serverKey()?.pub ?? '');
    const chainTip = await freshTip();
    await assertInputsUnspent(p.template.inputs);
    if (Date.now() >= p.expiresAt * 1000) throw Object.assign(new Error('Authorization expired. Run preflight again.'), {statusCode: 409});
    return { chainTip, intentId: p.intentId };
  });
  app.post('/api/broadcast', async (req) => {
    rateLimit(String((process.env.VERCEL && req.headers['x-vercel-forwarded-for']) || req.ip).split(',')[0].trim());
    const b = z.object({ rawHex: z.string(), authorization: AuthZ.optional(), userSignature: z.object({ pubkey: z.string(), sig: z.string() }).optional() }).parse(req.body);
    return broadcast(b, { enabled: broadcastEnabled(), trustedPubkey: serverKey()?.pub ?? null });
  });
  app.get('/api/live/tx/:txid', async (req) => { const t = Txid.parse((req.params as { txid: string }).txid); return { txid: t, explorer: EXPLORER_TX + t, ...(await confirmations(t)) }; });
  const CertReq = z.object({ txid: Txid, authorization: z.object({ payload: z.string(), authHash: z.string(), serverPubkey: z.string(), serverSig: z.string() }).nullish(), userSignature: z.object({ pubkey: z.string(), sig: z.string() }).nullish(), auction: z.unknown().optional() });
  app.post('/api/live/certificate', async (req) => { const b = CertReq.parse(req.body); return liveCertificate(configs(), b.txid, { authorization: b.authorization, userSignature: b.userSignature, trustedPubkey: serverKey()?.pub ?? null, auction: b.auction }); });
  // third-party re-verification of a submitted certificate (+ optional authorization) under the four levels
  app.post('/api/live/verify-certificate', async (req) => {
    const b = z.object({ certificate: z.unknown(), authorization: CertReq.shape.authorization, userSignature: CertReq.shape.userSignature, attestationPubkey: z.string().regex(/^0[23][0-9a-f]{64}$/).optional() }).parse(req.body);
    return verifyCertificate(b.certificate, esploraReader, { rederive: liveRederiver(configs()), intent: intentBinder({ authorization: b.authorization, userSignature: b.userSignature, trustedPubkey: serverKey()?.pub ?? null }) });
  });
}
