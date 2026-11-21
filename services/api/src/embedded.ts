// Hosted mode: the whole FUSE API (LOCAL simulation world, auction engine, compiler, verifier) runs IN-PROCESS
// inside a serverless function. There is no background loop: each request lazily advances the world (tick) and
// runs one pass of the four reference solvers (each with its own LOCAL fixture key — never funded).
//
// Deterministic sandbox across serverless instances: every browser session carries a signed, compressed JOURNAL
// of its state-changing sandbox requests (server-stamped time, method, url, body) in the `x-fuse-sandbox` header.
// The sandbox world is a pure function of (genesis fixture, journal): every source of nondeterminism is pinned —
// the clock is frozen to each op's recorded time while it runs, solver nonces are derived from (auction, solver),
// fixture keys are fixed. An instance that has never seen the session (or a cold start) rebuilds the identical
// world by replaying the journal, so auction ids, txids and certificate ids are the same on every instance.
// Mainnet (/api/live, /api/broadcast) never goes through the journal.
import { createHmac, createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
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
type World = { app: App; state: FuseState; solvers: Solver[]; pumping: Promise<void> | null; lastPump: number };
export const HOSTED_INFO = { hosted: true, mode: 'HOSTED SIMULATION', persistence: 'deterministic per browser session: signed client-carried journal of sandbox ops, replayed on any instance (x-fuse-sandbox)', solvers: 'in-process reference solvers, one pass per request', mainnetBroadcast: process.env.FUSE_BROADCAST === '1' ? 'relay of already-signed hex only (no server keys)' : false };

// ---- frozen clock (only while a journaled op runs or is replayed; all sandbox work is serialized per process) ----
const realNow = Date.now.bind(Date);
let frozen: number | null = null;
Date.now = () => frozen ?? realNow();
let lock: Promise<unknown> = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> { const r = lock.then(f, f); lock = r.catch(() => undefined); return r; }
async function at<T>(t: number, f: () => Promise<T>): Promise<T> { const prev = frozen; frozen = t; try { return await f(); } finally { frozen = prev; } }

// ---- journal token ----
interface Op { t: number; m: string; u: string; b?: string }
interface Journal { v: 1; sid: string; g: number; ops: Op[] }
const MAX_OPS = 60;
const macKey = () => createHash('sha256').update('fuse-sandbox-journal/v1:' + (process.env.FUSE_AUTH_KEY ?? 'local-dev-only')).digest();
function seal(j: Journal) { const body = deflateRawSync(Buffer.from(JSON.stringify(j))).toString('base64url'); return `${body}.${createHmac('sha256', macKey()).update(body).digest('base64url').slice(0, 22)}`; }
function open(tok: string | undefined): Journal | null {
  if (!tok) return null; const [body, mac] = tok.split('.');
  if (!body || !mac || createHmac('sha256', macKey()).update(body).digest('base64url').slice(0, 22) !== mac) return null;
  try { const j = JSON.parse(inflateRawSync(Buffer.from(body, 'base64url')).toString()) as Journal; return j.v === 1 && Array.isArray(j.ops) ? j : null; } catch { return null; }
}
const headOf = (j: Journal) => createHash('sha256').update(`${j.sid}:${j.g}:${JSON.stringify(j.ops)}`).digest('hex');
/** requests that change nothing in the sandbox world are not journaled */
const PURE = new Set(['/api/certificates/verify', '/api/compile', '/api/compile/typed', '/api/parallel-worlds', '/api/netting/simulate', '/api/xo/templates/inspect', '/api/wallet/preflight', '/api/wallet/verify-signed', '/api/notifications/read']);

// ---- worlds: genesis (shared, read-only use) + an LRU of session worlds keyed by journal head ----
let genesis: Promise<World> | null = null;
const worlds = new Map<string, World>();
function remember(head: string, w: World) { worlds.delete(head); worlds.set(head, w); while (worlds.size > 6) worlds.delete(worlds.keys().next().value!); }

async function boot(root: string, g?: number): Promise<World> {
  const state = new FuseState(root, { auctionWindowSeconds: Number(process.env.FUSE_AUCTION_WINDOW ?? 4), store: new FuseStore(':memory:', g ? `s_${g.toString(36)}` : undefined) });
  const app = await buildApp(state);
  const solvers: Solver[] = (Object.keys(KINDS) as Array<keyof typeof KINDS>).map((kind) => { const key = fixtureKey(`solver-${kind}`); const pubkey = binToHex(key.pub); return { kind, strategy: KINDS[kind], key, pubkey, solverId: solverIdOf(pubkey), seen: new Set() }; });
  for (const s of solvers) await app.inject({ method: 'POST', url: '/api/solvers/register', headers: { 'content-type': 'application/json' }, payload: toJson({ pubkey: s.pubkey, strategy: s.strategy, name: `${s.kind}-solver` }) });
  return { app, state, solvers, pumping: null, lastPump: 0 };
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
        // deterministic nonce: one bid per (auction, solver) — replay must reproduce the same bid
        const nonce = createHash('sha256').update(`bid-nonce:${a.auctionId}:${s.solverId}`).digest('hex').slice(0, 16);
        const bid: Bid = signBid({ auctionId: a.auctionId, solverId: s.solverId, solverPubkey: s.pubkey, strategy: s.strategy, executionClass: 'ATOMIC_SINGLE_TX', template: p.template, claims: p.claims, explanation: p.explanation, expiresAt: Math.floor(Date.now() / 1000) + 60, nonce }, s.key.priv);
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

/** Advance the world: settle/close due auctions and let solvers bid/sign. `force` skips the 250 ms coalescing (used
 *  around journaled ops so live handling and replay pump at exactly the same points). */
async function pump(b: World, force = false) {
  if (b.pumping) { await b.pumping; if (!force) return; }
  if (!force && Date.now() - b.lastPump < 250) return;
  b.pumping = (async () => { try { await b.state.tick(); await solverPass(b.app, b.solvers); await b.state.tick(); } catch (e) { b.state.emit('TICK_ERROR', (e as Error).message); } finally { b.lastPump = Date.now(); b.pumping = null; } })();
  return b.pumping;
}

/** Apply one journaled op exactly as both the live path and replay do: frozen clock, pump, request, pump. */
async function applyOp(b: World, op: Op) {
  return at(op.t, async () => {
    await pump(b, true);
    const r = await b.app.inject({ method: op.m as 'POST', url: op.u, headers: { 'content-type': 'application/json' }, ...(op.b ? { payload: op.b } : {}) });
    await pump(b, true);
    return r;
  });
}

async function worldFor(root: string, j: Journal): Promise<{ w: World; replayed: number }> {
  const head = headOf(j); const hit = worlds.get(head);
  if (hit) { remember(head, hit); return { w: hit, replayed: 0 }; }
  const w = await at(j.g, () => boot(root, j.g));
  for (const op of j.ops) await applyOp(w, op);
  remember(head, w);
  return { w, replayed: j.ops.length };
}

export interface EmbeddedRequest { method: string; url: string; headers: Record<string, string>; body?: string }
export interface EmbeddedResponse { status: number; headers: Record<string, string>; body: string }
export async function handle(root: string, req: EmbeddedRequest): Promise<EmbeddedResponse> {
  const path = req.url.split('?')[0];
  const live = path.startsWith('/api/live') || path === '/api/broadcast';
  if (live) { genesis ??= boot(root); return forward(await genesis, req, path, true); }
  return serial(async () => {
    const q = new URL(req.url, 'http://x').searchParams.get('sbx') ?? undefined;
    const tok = req.headers['x-fuse-sandbox'] ?? q;
    let j = open(tok);
    const mutating = req.method !== 'GET' && req.method !== 'HEAD' && !PURE.has(path);
    const extra: Record<string, string> = {};
    if (tok && !j) extra['x-fuse-sandbox-note'] = 'journal rejected (bad signature) — sandbox restarted from genesis';
    if (!j && !mutating) { genesis ??= boot(root); const g = await genesis; await pump(g); return forward(g, req, path, false, extra); }
    if (path === '/api/world/reset') j = null; // reset = new journal from genesis
    if (j && j.ops.length >= MAX_OPS) { j = null; extra['x-fuse-sandbox-note'] = `journal reached ${MAX_OPS} ops — sandbox restarted from genesis`; }
    j ??= { v: 1, sid: createHash('sha256').update(`${realNow()}:${Math.random()}`).digest('hex').slice(0, 12), g: realNow(), ops: [] };
    const { w, replayed } = await worldFor(root, j);
    if (replayed) extra['x-fuse-sandbox-replayed'] = String(replayed);
    if (!mutating) { await pump(w); return forward(w, req, path, false, { ...extra, 'x-fuse-sandbox': seal(j) }); }
    const op: Op = { t: realNow(), m: req.method, u: req.url.replace(/([?&])sbx=[^&]*&?/, '$1').replace(/[?&]$/, ''), ...(req.body ? { b: req.body } : {}) };
    worlds.delete(headOf(j));
    const r = await applyOp(w, op);
    const next: Journal = { ...j, ops: [...j.ops, op] };
    remember(headOf(next), w);
    return respond(r, path, { ...extra, 'x-fuse-sandbox': seal(next), 'x-fuse-sandbox-ops': String(next.ops.length) });
  });
}

type Injected = Awaited<ReturnType<App['inject']>>;
function respond(r: Injected, path: string, extra: Record<string, string> = {}): EmbeddedResponse {
  let body = r.payload;
  if (r.statusCode === 200 && (path === '/api/health' || path === '/api/network/status')) body = toJson({ ...fromJson<object>(body), hostedMode: HOSTED_INFO });
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !['content-length', 'connection', 'transfer-encoding'].includes(k)) headers[k] = String(v);
  return { status: r.statusCode, headers: { ...headers, ...extra, 'access-control-expose-headers': 'x-fuse-sandbox, x-fuse-sandbox-replayed, x-fuse-sandbox-note, x-fuse-sandbox-ops' }, body };
}

async function forward(b: World, req: EmbeddedRequest, path: string, live: boolean, extra: Record<string, string> = {}): Promise<EmbeddedResponse> {
  if (path === '/api/events') {
    // serverless functions cannot hold a stream open: send recent events, then close (the client falls back to polling)
    const after = Number(req.headers['last-event-id'] ?? 0);
    const body = 'retry: 3000\n\n' + b.state.events.slice(-50).filter((e) => Number(e.id) > after || Number.isNaN(Number(e.id))).map((e) => `id: ${e.id}\ndata: ${toJson(e)}\n\n`).join('');
    return { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...extra }, body };
  }
  const r = await b.app.inject({ method: req.method as 'GET', url: req.url, headers: req.headers, ...(req.body ? { payload: req.body } : {}) });
  if (req.method === 'POST' && !live) await pump(b);
  return respond(r, path, extra);
}

/** tests: simulate a different serverless instance (no cached session worlds) */
export function _dropWorldsForTests() { worlds.clear(); }
