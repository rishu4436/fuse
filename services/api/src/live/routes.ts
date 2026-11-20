// LIVE mainnet routes (default mode of the app). Reads come from public indexers; the execute path builds unsigned
// transactions; /api/broadcast relays already-signed hex after a full VM check. The server holds no keys.
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { confirmations, tip, addressUtxos, ESPLORA, EXPLORER_TX } from './chain.js';
import { loadVaultConfigs, trackVault } from './vault.js';
import { livePools, bestRoundTrip } from './cauldron.js';
import { liveParyon } from './paryon.js';
import { prepare, LIVE_CAPS } from './execute.js';
import { broadcast, verifySigned, rateLimit } from './relay.js';
import { liveCertificate } from './certificate.js';
import { radar, sentinel } from '@fuse/risk-engine';
import { parseLoan } from '@fuse/risk-engine';

export const broadcastEnabled = () => process.env.FUSE_BROADCAST === '1';
const Txid = z.string().regex(/^[0-9a-f]{64}$/);

export function registerLive(app: FastifyInstance, ctx: { root: string; paryonSnapshot: () => unknown }) {
  const configs = () => loadVaultConfigs(ctx.root);
  app.get('/api/live/status', async () => {
    const t0 = Date.now(); let tipHeight: number | null = null; let err: string | null = null;
    try { tipHeight = await tip(); } catch (e) { err = (e as Error).message; }
    return { mode: 'LIVE', network: 'mainnet', tipHeight, chainSource: ESPLORA, latencyMs: Date.now() - t0, error: err, broadcast: broadcastEnabled() ? 'ENABLED (relays already-signed hex after a full VM check; server holds no keys)' : 'DISABLED', vaults: configs().map((c) => ({ id: c.id, status: c.status, category: c.category })), caps: LIVE_CAPS, sandbox: 'opt-in local BCH VM (toggle in the app)' };
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
    return { checkedAt: live.readAt, tipHeight: live.tipHeight, mode: 'LIVE', coverage: live.coverage, live: { latestPrice: live.latestPrice, priceStates: live.priceStates, loans: live.loans, activeLoans: active.length, staleLoans: live.loans.length - active.length, currentPeriod: live.currentPeriod } };
  };
  app.get('/api/live/paryon-view', async () => liveView());
  app.get('/api/live/guardian/sentinel', async () => { const v = await liveView(); return { checkedAt: v.checkedAt, ...sentinel({ priceStates: v.live.priceStates as never, latestPrice: v.live.latestPrice as never, activeLoans: v.live.activeLoans, staleLoans: v.live.staleLoans, checkedAt: v.checkedAt }) }; });
  app.get('/api/live/wallet/:address', async (req) => { const a = (req.params as { address: string }).address; const coins = await addressUtxos(a); return { address: a, balance: coins.reduce((s, c) => s + c.satoshis, 0n), coins }; });
  const PrepareZ = z.object({ action: z.enum(['flash', 'flash-cauldron', 'deposit', 'withdraw', 'deploy-vault', 'consolidate']), address: z.string().min(20).max(120), vaultId: z.string().max(40).optional(), amount: z.coerce.bigint().positive().optional(), principal: z.coerce.bigint().positive().optional(), units: z.coerce.bigint().min(1n).max(5n).optional(), maxUserCost: z.coerce.bigint().positive().optional() });
  app.post('/api/live/prepare', async (req) => prepare(configs(), PrepareZ.parse(req.body)));
  app.post('/api/live/verify-signed', async (req) => verifySigned(z.object({ rawHex: z.string() }).parse(req.body).rawHex));
  app.post('/api/broadcast', async (req) => { rateLimit(String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0]); return broadcast(z.object({ rawHex: z.string() }).parse(req.body).rawHex, { enabled: broadcastEnabled() }); });
  app.get('/api/live/tx/:txid', async (req) => { const t = Txid.parse((req.params as { txid: string }).txid); return { txid: t, explorer: EXPLORER_TX + t, ...(await confirmations(t)) }; });
  app.post('/api/live/certificate', async (req) => liveCertificate(configs(), Txid.parse(z.object({ txid: z.string() }).parse(req.body).txid)));
}
