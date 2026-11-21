// LIVE mainnet chain access for the FUSE backend (serverless-safe). Primary source: bchexplorer.cash (esplora REST
// backed by Fulcrum). The API serves plain HTTP clients and challenges browser-like fetches, so requests go through
// the system curl binary (present on Vercel's Node runtime and on the build box), with Node fetch as fallback.
// Nothing returned by the indexer is trusted: raw transactions are re-hashed locally and decoded with libauth;
// UTXO values / tokens are taken from the decoded raw output, never from the JSON summary.
import { execFile } from 'node:child_process';
import { binToHex, hexToBin, hash256, decodeTransaction } from '@bitauth/libauth';
import type { TokenSpec } from '@fuse/transaction-composer';

export const ESPLORA = process.env.FUSE_ESPLORA ?? 'https://bchexplorer.cash/api';
export const EXPLORER_TX = 'https://bchexplorer.cash/tx/';
type Decoded = Exclude<ReturnType<typeof decodeTransaction>, string>;
export interface LiveUtxo { txid: string; vout: number; satoshis: bigint; lockingBytecode: string; token?: TokenSpec; confirmed: boolean }

function curl(args: string[], input?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, timeout: 25_000 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return reject(err);
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: String(stdout ?? '') });
    });
    if (input !== undefined) { p.stdin?.write(input); p.stdin?.end(); }
  });
}
// The API answers plain HTTP clients (curl-style user agent) and challenges browser-like ones. Primary: Node fetch
// (pooled keep-alive connections) with a curl user agent; fallback: the curl binary.
const UA = { 'user-agent': 'curl/8.5.0 (fuse-live)', accept: '*/*' };
async function request(path: string, body?: string): Promise<{ ok: boolean; status: number; text: string }> {
  const t0 = Date.now(); const r = await request0(path, body); if (process.env.FUSE_DEBUG_CHAIN) console.error(`[chain] ${r.status} ${Date.now() - t0}ms ${path}`); return r;
}
async function request0(path: string, body?: string): Promise<{ ok: boolean; status: number; text: string }> {
  const url = ESPLORA + path;
  try {
    const res = await fetch(url, { ...(body !== undefined ? { method: 'POST', body, headers: { ...UA, 'content-type': 'text/plain' } } : { headers: UA }), signal: AbortSignal.timeout(8_000), cache: 'no-store' } as RequestInit);
    const text = await res.text();
    if (res.status !== 403 || !/challenge|captcha|<html/i.test(text)) return { ok: res.ok, status: res.status, text };
  } catch { /* transient TLS reset: fall back to curl */ }
  try {
    const args = ['-sS', '-m', '20', '-w', '\n%{http_code}', ...(body !== undefined ? ['-X', 'POST', '-H', 'content-type: text/plain', '--data-binary', '@-'] : []), url];
    const r = await curl(args, body);
    const i = r.out.lastIndexOf('\n'); const status = Number(r.out.slice(i + 1)) || 0; const text = r.out.slice(0, i);
    return { ok: status >= 200 && status < 300, status, text };
  } catch (e) { return { ok: false, status: 0, text: (e as Error).message }; }
}
/** GET with retries (the endpoint has frequent transient TLS resets). */
export async function get(path: string, tries = 6): Promise<string> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const r = await request(path).catch((e) => ({ ok: false, status: 0, text: String((e as Error).message) }));
    if (r.ok) return r.text.trim();
    last = `${r.status} ${r.text.slice(0, 200)}`;
    if (r.status === 400 || r.status === 404) break;
    await new Promise((s) => setTimeout(s, 150 * (i + 1)));
  }
  throw Object.assign(new Error(`indexer ${path}: ${last}`), { statusCode: 502 });
}
export const getJson = async <T>(path: string) => JSON.parse(await get(path)) as T;

/** Relay an already-signed transaction. Returns the txid reported by the node (or throws with the node error). */
// Second broadcast path: a Fulcrum/BCHN node over WSS on port 443 (the only Electrum transport reachable from
// every host we run on). Round 6 found bchexplorer.cash accepting a valid tx into its own mempool without
// propagating it (its node lagged ~8 blocks); the same hex re-sent to this node reached the network at once.
const FULCRUM_WSS = process.env.FUSE_FULCRUM_WSS ?? 'wss://cashnode.bch.ninja';
export async function fulcrumBroadcast(rawHex: string, url = FULCRUM_WSS, timeoutMs = 6000): Promise<string> {
  const WS = (globalThis as { WebSocket?: new (u: string) => WebSocket }).WebSocket;
  if (!WS || process.env.FUSE_NO_FANOUT === '1') throw new Error('fan-out disabled');
  return new Promise((resolve, reject) => {
    const ws = new WS(url); const t = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new Error('fulcrum timeout')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'blockchain.transaction.broadcast', params: [rawHex] }));
    ws.onmessage = (m) => { clearTimeout(t); try { ws.close(); } catch { /* closed */ } const d = JSON.parse(String(m.data)) as { result?: string; error?: { message?: string } }; if (typeof d.result === 'string') resolve(d.result); else reject(new Error(d.error?.message ?? 'fulcrum rejected')); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('fulcrum connection failed')); };
  });
}
/** txid → which broadcast paths accepted it (for the broadcast receipt). */
export const relayPaths = new Map<string, string[]>();
export async function relay(rawHex: string): Promise<string> {
  let last = ''; let txid: string | null = null; const paths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await request('/tx', rawHex).catch((e) => ({ ok: false, status: 0, text: String((e as Error).message) }));
    if (r.ok) { txid = r.text.trim(); paths.push('bchexplorer.cash POST /api/tx'); break; }
    last = r.text.slice(0, 300);
    if (r.status >= 400 && r.status < 500) break; // node rejected it: do not retry
    await new Promise((s) => setTimeout(s, 700));
  }
  // fan out to a second node; it can also rescue a relay failure, but never overrides a node rejection
  const f = await fulcrumBroadcast(rawHex).then((id) => ({ ok: true as const, id }), (e: Error) => ({ ok: false as const, e: e.message }));
  if (f.ok) { paths.push(`Fulcrum ${FULCRUM_WSS} blockchain.transaction.broadcast`); txid ??= f.id; }
  if (!txid) throw Object.assign(new Error(`node rejected or relay failed: ${last}${f.ok ? '' : ` · fulcrum: ${f.e}`}`), { statusCode: 422 });
  relayPaths.set(txid, paths); if (relayPaths.size > 200) relayPaths.delete(relayPaths.keys().next().value!);
  return txid;
}

const rawCache = new Map<string, string>();
export async function rawTx(txid: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw Object.assign(new Error('bad txid'), { statusCode: 400 });
  const hit = rawCache.get(txid); if (hit) return hit;
  const hex = await get(`/tx/${txid}/hex`);
  if (binToHex(hash256(hexToBin(hex)).reverse()) !== txid) throw new Error(`raw tx re-hash mismatch for ${txid}`);
  rawCache.set(txid, hex);
  return hex;
}
export async function decoded(txid: string): Promise<Decoded> {
  const d = decodeTransaction(hexToBin(await rawTx(txid)));
  if (typeof d === 'string') throw new Error(d);
  return d;
}
export const tokenOf = (o: Decoded['outputs'][number]): TokenSpec | undefined => o.token ? { category: binToHex(o.token.category), amount: o.token.amount, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } : undefined;
export async function outputAt(txid: string, vout: number) {
  const o = (await decoded(txid)).outputs[vout];
  if (!o) throw new Error(`no output ${txid}:${vout}`);
  return { txid, vout, satoshis: o.valueSatoshis, lockingBytecode: binToHex(o.lockingBytecode), token: tokenOf(o) };
}
export async function status(txid: string) { return getJson<{ confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number }>(`/tx/${txid}/status`); }
export async function tip() { return Number(await get('/blocks/tip/height')); }
export async function outspend(txid: string, vout: number) { return getJson<{ spent: boolean; txid?: string; vin?: number; status?: { confirmed: boolean } }>(`/tx/${txid}/outspend/${vout}`); }
export async function confirmations(txid: string) { const [s, t] = await Promise.all([status(txid), tip()]); return { ...s, confirmations: s.block_height ? t - s.block_height + 1 : 0, tip: t }; }

export async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (k < xs.length) { const i = k++; out[i] = await f(xs[i]); } }));
  return out;
}

/** Spendable coins of an address, verified from raw txs; coins already spent in the mempool are dropped. */
export async function addressUtxos(address: string, opts: { max?: number } = {}): Promise<LiveUtxo[]> {
  const list = await getJson<Array<{ txid: string; vout: number; value: number; status?: { confirmed: boolean } }>>(`/address/${encodeURIComponent(address)}/utxo`);
  // the address index can lag the mempool: drop outpoints spent by any mempool tx touching this address
  const mem = await getJson<Array<{ vin: Array<{ txid: string; vout: number }> }>>(`/address/${encodeURIComponent(address)}/txs/mempool`).catch(() => []);
  const spentInMempool = new Set(mem.flatMap((t) => t.vin.map((i) => `${i.txid}:${i.vout}`)));
  const pick = list.filter((u) => !spentInMempool.has(`${u.txid}:${u.vout}`)).slice(0, opts.max ?? 25);
  const res = await pool<typeof pick[number], LiveUtxo | null>(pick, 5, async (u) => {
    const [o, sp] = await Promise.all([outputAt(u.txid, u.vout), outspend(u.txid, u.vout).catch(() => ({ spent: false }))]);
    return sp.spent ? null : ({ ...o, confirmed: Boolean(u.status?.confirmed) } as LiveUtxo);
  });
  return res.filter((x): x is LiveUtxo => x !== null).sort((a, b) => (a.satoshis > b.satoshis ? -1 : 1));
}
