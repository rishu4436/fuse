import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { toJson, fromJson, type Bid } from '@fuse/solver-sdk';
import { FuseState, serializeAuction } from './state.js';
import { PARYON_OPERATION_STATUS } from '@fuse/protocol-adapters';
import { buildSelfConsolidation, preflight, wcSignRequest, verifyWalletSigned, lockingBytecodeOf } from '@fuse/wallet';
import { binToHex, encodeTransaction } from '@bitauth/libauth';
import type { TxTemplate } from '@fuse/transaction-composer';

export async function buildApp(state: FuseState) {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
  await app.register(cors, { origin: true });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => { try { done(null, body ? fromJson(body as string) : {}); } catch (e) { done(e as Error); } });
  app.setReplySerializer((p) => toJson(p));
  app.setErrorHandler((err, _req, reply) => { const e = err as { statusCode?: number; code?: string; message: string }; reply.status(e.statusCode && e.statusCode < 500 ? e.statusCode : 400).send({ error: e.code ?? 'ERROR', message: e.message }); });

  app.get('/api/health', async () => ({ ok: true, uptimeMs: Date.now() - state.startedAt, network: 'local', simulated: true, mainnetBroadcast: false }));
  app.get('/api/network/status', async () => {
    const c = state.evidence('cauldron'), p = state.evidence('paryon');
    return {
      local: { mode: 'SIMULATION', engine: 'cashscript MockNetworkProvider + BCH 2026 VM', addresses: state.demoAddresses },
      mainnet: { mode: 'READ-ONLY', broadcast: 'disabled (no owner authorization)', source: 'chaingraph (gql.chaingraph.pat.mn)', cauldronSnapshotAt: c?.checkedAt ?? null, paryonSnapshotAt: p?.checkedAt ?? null, tipHeightAtSnapshot: p?.tipHeight ?? null },
      chipnet: { mode: 'NOT CONNECTED', reason: 'electrum ports blocked from build environment; no chipnet tx performed' },
    };
  });

  // ---- LOCAL execution world ----
  app.get('/api/vault', async () => state.vault());
  app.post('/api/world/reset', async () => { state.reset(); return { ok: true }; });
  app.get('/api/chain/utxos', async (req) => state.chainUtxos(z.object({ address: z.string().min(10) }).parse(req.query).address));
  const SwapBody = z.object({ minOut: z.coerce.bigint().positive(), maxIn: z.coerce.bigint().positive(), maxFee: z.coerce.bigint().positive().default(20_000n) });
  app.post('/api/intents/swap', async (req) => { const b = SwapBody.parse(req.body); return serializeAuction(await state.openSwap(b.minOut, b.maxIn, b.maxFee)); });
  app.get('/api/auctions', async () => [...state.engine.auctions.values()].reverse().map(serializeAuction));
  app.get('/api/auctions/:id', async (req, reply) => { const a = state.engine.auctions.get((req.params as { id: string }).id); return a ? serializeAuction(a) : reply.status(404).send({ error: 'NOT_FOUND' }); });

  // ---- solver network ----
  app.post('/api/solvers/register', async (req) => { const b = z.object({ pubkey: z.string(), strategy: z.string(), name: z.string().max(40) }).parse(req.body); const r = state.engine.registerSolver(b.pubkey, b.strategy, b.name); state.emit('SOLVER_REGISTERED', `${b.name} (${b.strategy})`); return r; });
  app.get('/api/solvers', async () => [...state.engine.solvers.values()]);
  app.get('/api/auctions/open', async () => state.engine.openAuctions().map((a) => ({ auctionId: a.auctionId, intent: a.intent, market: a.market, closesAt: a.closesAt })));
  app.post('/api/solver/bids', async (req) => { const r = state.engine.submitBid(req.body as Bid); const b = req.body as Bid; state.emit(r.accepted ? 'BID_RECEIVED' : 'BID_REFUSED', `${b.strategy ?? '?'}${r.reason ? ': ' + r.reason : ''}`, b.auctionId); return r; });
  app.get('/api/solver/sign-requests', async (req) => {
    const { solverId } = z.object({ solverId: z.string() }).parse(req.query);
    return [...state.engine.auctions.values()].filter((a) => a.status === 'AWAITING_SIGNATURES' && a.winner?.bid.solverId === solverId && !a.signatures.has('solver') && state.engine.requiredSigners(a.auctionId).includes('solver')).map((a) => ({ auctionId: a.auctionId, bid: a.winner!.bid }));
  });
  app.post('/api/solver/signatures', async (req) => {
    const b = z.object({ auctionId: z.string(), solverId: z.string(), unlocks: z.record(z.string(), z.string().regex(/^[0-9a-f]+$/)) }).parse(req.body);
    const a = state.engine.auctions.get(b.auctionId);
    if (!a || a.winner?.bid.solverId !== b.solverId) throw Object.assign(new Error('not the selected solver'), { statusCode: 403 });
    state.engine.addSignatures(b.auctionId, 'solver', new Map(Object.entries(b.unlocks).map(([k, v]) => [Number(k), v])));
    state.emit('SOLVER_SIGNED', b.solverId, b.auctionId);
    return { ok: true };
  });
  app.get('/api/solver/results', async (req) => { const { solverId } = z.object({ solverId: z.string() }).parse(req.query); return [...state.engine.auctions.values()].filter((a) => a.bids.some((x) => x.solverId === solverId)).map((a) => ({ auctionId: a.auctionId, status: a.status, winner: a.winner?.bid.solverId, txid: a.txid })); });

  // ---- certificates ----
  app.get('/api/certificates', async () => [...state.certificates.values()].reverse());
  app.get('/api/certificates/:id', async (req, reply) => { const c = state.certificates.get((req.params as { id: string }).id); return c ?? reply.status(404).send({ error: 'NOT_FOUND' }); });
  app.get('/api/certificates/:id/html', async (req, reply) => { const c = state.certificates.get((req.params as { id: string }).id); if (!c) return reply.status(404).send({ error: 'NOT_FOUND' }); const v = await state.verify(c); return reply.type('text/html').send(state.html(c, v)); });
  app.post('/api/certificates/verify', async (req) => state.verify(req.body));

  // ---- mainnet READ-ONLY ----
  app.get('/api/mainnet/cauldron', async () => ({ status: 'READ-ONLY', ...state.evidence('cauldron') }));
  app.get('/api/mainnet/paryon', async () => { const p = state.evidence('paryon'); return { status: 'READ-ONLY', operations: PARYON_OPERATION_STATUS, checkedAt: p?.checkedAt, tipHeight: p?.tipHeight, deployment: p?.deployment, live: p?.live }; });

  // ---- wallet: mainnet preflight + independent verification of wallet signatures. NO broadcast endpoint exists. ----
  const preflights = new Map<string, { template: TxTemplate; owner: string; maxFee: bigint }>();
  const CoinZ = z.object({ txid: z.string().regex(/^[0-9a-f]{64}$/), vout: z.coerce.number().int().nonnegative(), satoshis: z.coerce.bigint().positive(), hasToken: z.boolean().default(false), path: z.enum(['receive', 'change', 'defi']), addressIndex: z.coerce.number().int().nonnegative() });
  app.post('/api/wallet/preflight', async (req) => {
    const b = z.object({ network: z.enum(['mainnet', 'chipnet']), address: z.string().min(20), coins: z.array(CoinZ).min(1).max(50), maxMinerFee: z.coerce.bigint().positive().default(5_000n) }).parse(req.body);
    const owner = lockingBytecodeOf(b.address);
    const { template, inputPaths } = buildSelfConsolidation(b.coins.map((c) => ({ ...c, token: c.hasToken ? {} : undefined })), owner);
    const p = preflight(template, { network: b.network, ownerLockingBytecode: owner, maxMinerFee: b.maxMinerFee, authorization: 'WizardConnect hdwalletv1: wallet-confirmed signature, broadcast:false', contractVerification: 'no contract inputs (P2PKH self-consolidation)' });
    preflights.set(p.templateHash, { template, owner, maxFee: b.maxMinerFee });
    const r = wcSignRequest(template, 'FUSE mainnet preflight: consolidate your own coins (FUSE will NOT broadcast)');
    return {
      preflight: p, template, inputPaths,
      wcRequest: { transactionHex: binToHex(encodeTransaction(r.transaction)), broadcast: false, userPrompt: r.userPrompt,
        sourceOutputs: r.sourceOutputs.map((s) => ({ outpointIndex: s.outpointIndex, outpointTransactionHash: binToHex(s.outpointTransactionHash), sequenceNumber: s.sequenceNumber, unlockingBytecode: binToHex(s.unlockingBytecode), lockingBytecode: binToHex(s.lockingBytecode), valueSatoshis: s.valueSatoshis })) },
    };
  });
  app.post('/api/wallet/verify-signed', async (req, reply) => {
    const b = z.object({ templateHash: z.string(), signedTransaction: z.string().regex(/^([0-9a-f]{2})+$/) }).parse(req.body);
    const pf = preflights.get(b.templateHash);
    if (!pf) return reply.status(404).send({ error: 'UNKNOWN_PREFLIGHT', message: 'run preflight first' });
    const v = verifyWalletSigned(pf.template, b.signedTransaction, { ownerLockingBytecode: pf.owner, maxMinerFee: pf.maxFee });
    return { ...v, broadcast: 'DISABLED', note: v.ok ? 'Signed transaction is valid and matches the reviewed preflight. FUSE did not broadcast it.' : 'Wallet response rejected.' };
  });

  // ---- events (SSE) ----
  app.get('/api/events', async (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    for (const e of state.events.slice(-50)) reply.raw.write(`id: ${e.id}\ndata: ${toJson(e)}\n\n`);
    const l = (e: Parameters<Parameters<typeof state.listeners.add>[0]>[0]) => reply.raw.write(`id: ${e.id}\ndata: ${toJson(e)}\n\n`);
    state.listeners.add(l);
    const ka = setInterval(() => reply.raw.write(': ka\n\n'), 15_000);
    req.raw.on('close', () => { clearInterval(ka); state.listeners.delete(l); });
    return reply;
  });
  app.get('/api/events/recent', async () => state.events.slice(-100));
  return app;
}
