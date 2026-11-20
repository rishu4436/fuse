// Hosted mode: the whole FUSE API (LOCAL simulation world, auction engine, compiler, verifier) runs IN-PROCESS
// inside a serverless function. There is no background loop: each request lazily advances the world (tick) and
// runs one pass of the four reference solvers (each with its own LOCAL fixture key — never funded). State is
// ephemeral, held in memory per function instance; a cold start resets it. Mainnet stays READ-ONLY; no
// broadcasting exists in this mode.
import { randomBytes } from 'node:crypto';
import { binToHex } from '@bitauth/libauth';
import { STRATEGIES, signBid, solverIdOf, toJson, fromJson, type Bid } from '@fuse/solver-sdk';
import { signInputs } from '@fuse/transaction-composer';
import { fixtureKey } from '@fuse/simulation';
import { FuseStore } from '@fuse/store';
import { buildApp } from './app.js';
import { FuseState } from './state.js';

type App = Awaited<ReturnType<typeof buildApp>>;
const KINDS = { direct: 'DIRECT_LIQUIDITY', routing: 'ROUTING', flash: 'FLASH_LIQUIDITY', rogue: 'ADVERSARIAL_FIXTURE' } as const;
interface Solver { kind: keyof typeof KINDS; strategy: (typeof KINDS)[keyof typeof KINDS]; key: ReturnType<typeof fixtureKey>; pubkey: string; solverId: string; seen: Set<string> }
let booted: Promise<{ app: App; state: FuseState; solvers: Solver[] }> | null = null;
let pumping: Promise<void> | null = null; let lastPump = 0;
export const HOSTED_INFO = { hosted: true, mode: 'HOSTED SIMULATION', persistence: 'in-memory, per serverless instance (ephemeral)', solvers: 'in-process reference solvers, one pass per request', mainnetBroadcast: process.env.FUSE_BROADCAST === '1' ? 'relay of already-signed hex only (no server keys)' : false };

async function boot(root: string) {
  const state = new FuseState(root, { auctionWindowSeconds: Number(process.env.FUSE_AUCTION_WINDOW ?? 4), store: new FuseStore(':memory:') });
  const app = await buildApp(state);
  const solvers: Solver[] = (Object.keys(KINDS) as Array<keyof typeof KINDS>).map((kind) => { const key = fixtureKey(`solver-${kind}`); const pubkey = binToHex(key.pub); return { kind, strategy: KINDS[kind], key, pubkey, solverId: solverIdOf(pubkey), seen: new Set() }; });
  for (const s of solvers) await app.inject({ method: 'POST', url: '/api/solvers/register', headers: { 'content-type': 'application/json' }, payload: toJson({ pubkey: s.pubkey, strategy: s.strategy, name: `${s.kind}-solver` }) });
  return { app, state, solvers };
}

async function call<T>(app: App, method: 'GET' | 'POST', url: string, body?: unknown, solverId?: string): Promise<T> {
  const r = await app.inject({ method, url, headers: { 'content-type': 'application/json', ...(solverId ? { 'x-fuse-solver': solverId } : {}) }, ...(body !== undefined ? { payload: toJson(body) } : {}) });
  return fromJson<T>(r.payload);
}

async function solverPass(app: App, solvers: Solver[]) {
  const open = await call<Array<{ auctionId: string; intent: never; market: never }>>(app, 'GET', '/api/auctions/open');
  for (const s of solvers) {
    for (const a of open) {
      if (s.seen.has(a.auctionId)) continue; s.seen.add(a.auctionId);
      try {
        const utxos = await call<Array<{ txid: string; vout: number; satoshis: bigint; token?: unknown }>>(app, 'GET', `/api/chain/utxos?address=${encodeURIComponent(s.key.address)}`);
        const identity = { id: s.solverId, pubkey: s.pubkey, lockingBytecode: s.key.lockingBytecode, coins: utxos.filter((u) => !u.token), inventory: utxos.filter((u) => u.token) } as never;
        const p = STRATEGIES[s.strategy](a.market, a.intent, identity);
        const bid: Bid = signBid({ auctionId: a.auctionId, solverId: s.solverId, solverPubkey: s.pubkey, strategy: s.strategy, executionClass: 'ATOMIC_SINGLE_TX', template: p.template, claims: p.claims, explanation: p.explanation, expiresAt: Math.floor(Date.now() / 1000) + 60, nonce: randomBytes(8).toString('hex') }, s.key.priv);
        await call(app, 'POST', '/api/solver/bids', bid, s.solverId);
      } catch { /* strategy declined (e.g. no route) — same as a worker logging "no bid" */ }
    }
    const reqs = await call<Array<{ auctionId: string; bid: Bid }>>(app, 'GET', `/api/solver/sign-requests?solverId=${s.solverId}`);
    for (const r of reqs) {
      const unlocks = signInputs(r.bid.template, 'solver', s.key.priv);
      await call(app, 'POST', '/api/solver/signatures', { auctionId: r.auctionId, solverId: s.solverId, unlocks: Object.fromEntries(unlocks) }, s.solverId);
    }
  }
}

/** Advance the world: settle/close due auctions and let solvers bid/sign. Coalesced, at most every 250 ms. */
async function pump(b: Awaited<NonNullable<typeof booted>>) {
  if (pumping) return pumping;
  if (Date.now() - lastPump < 250) return;
  pumping = (async () => { try { await b.state.tick(); await solverPass(b.app, b.solvers); await b.state.tick(); } catch (e) { b.state.emit('TICK_ERROR', (e as Error).message); } finally { lastPump = Date.now(); pumping = null; } })();
  return pumping;
}

export interface EmbeddedRequest { method: string; url: string; headers: Record<string, string>; body?: string }
export interface EmbeddedResponse { status: number; headers: Record<string, string>; body: string }
export async function handle(root: string, req: EmbeddedRequest): Promise<EmbeddedResponse> {
  booted ??= boot(root);
  const b = await booted;
  const path = req.url.split('?')[0];
  const live = path.startsWith('/api/live') || path === '/api/broadcast';
  if (!live) await pump(b);
  if (path === '/api/events') {
    // serverless functions cannot hold a stream open: send recent events, then close (the client falls back to polling)
    const after = Number(req.headers['last-event-id'] ?? 0);
    const body = 'retry: 3000\n\n' + b.state.events.slice(-50).filter((e) => Number(e.id) > after || Number.isNaN(Number(e.id))).map((e) => `id: ${e.id}\ndata: ${toJson(e)}\n\n`).join('');
    return { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body };
  }
  const r = await b.app.inject({ method: req.method as 'GET', url: req.url, headers: req.headers, ...(req.body ? { payload: req.body } : {}) });
  let body = r.payload;
  if (r.statusCode === 200 && (path === '/api/health' || path === '/api/network/status')) body = toJson({ ...fromJson<object>(body), hostedMode: HOSTED_INFO });
  if (req.method === 'POST' && !live) await pump(b);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !['content-length', 'connection', 'transfer-encoding'].includes(k)) headers[k] = String(v);
  return { status: r.statusCode, headers, body };
}
