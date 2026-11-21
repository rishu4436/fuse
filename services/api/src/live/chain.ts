// LIVE mainnet chain access for the FUSE backend (serverless-safe). Primary source: bchexplorer.cash (esplora REST
// backed by Fulcrum). The API serves plain HTTP clients and challenges browser-like fetches, so requests go through
// the system curl binary (present on Vercel's Node runtime and on the build box), with Node fetch as fallback.
// Nothing returned by the indexer is trusted: raw transactions are re-hashed locally and decoded with libauth;
// UTXO values / tokens are taken from the decoded raw output, never from the JSON summary.
import { execFile } from 'node:child_process';
import { binToHex, hexToBin, sha256, hash256, decodeTransaction } from '@bitauth/libauth';
import { setTimeout as delay } from 'node:timers/promises';
import { electrum, inclusion, unspentAtScript } from './fulcrum.js';
import { readSource, unavailable, fulcrumUrl, rpc } from './source.js';
import type { TokenSpec } from '@fuse/transaction-composer';

export const ESPLORA = process.env.FUSE_ESPLORA ?? 'https://bchexplorer.cash/api';
export const EXPLORER_TX = 'https://bchexplorer.cash/tx/';
type Decoded = Exclude<ReturnType<typeof decodeTransaction>, string>;
export interface LiveUtxo { txid: string; vout: number; satoshis: bigint; lockingBytecode: string; token?: TokenSpec; confirmed: boolean }

function curl(args: string[], input?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const p = execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, timeout: 3500 }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return reject(err);
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: String(stdout ?? '') });
    });
    if (input !== undefined) { p.stdin?.write(input); p.stdin?.end(); }
  });
}
// The API answers plain HTTP clients (curl-style user agent) and challenges browser-like ones. Primary: Node fetch
// (pooled keep-alive connections) with a curl user agent; fallback: the curl binary.
const UA = { 'user-agent': 'curl/8.5.0 (fuse-live)', accept: '*/*' };
async function request(path: string, body?: string, base = ESPLORA): Promise<{ ok: boolean; status: number; text: string }> {
  const t0 = Date.now(); const r = await request0(path, body, base); if (process.env.FUSE_DEBUG_CHAIN) console.error(`[chain] ${r.status} ${Date.now() - t0}ms ${path}`); return r;
}
async function request0(path: string, body: string | undefined, base: string): Promise<{ ok: boolean; status: number; text: string }> {
  const url = base + path;
  try {
    const res = await fetch(url, { ...(body !== undefined ? { method: 'POST', body, headers: { ...UA, 'content-type': 'text/plain' } } : { headers: UA }), signal: AbortSignal.timeout(3500), cache: 'no-store' } as RequestInit);
    const text = await res.text();
    if (res.status !== 403 || !/challenge|captcha|<html/i.test(text)) return { ok: res.ok, status: res.status, text };
  } catch { /* transient TLS reset: fall back to curl */ }
  try {
    const args = ['-sS', '-m', '3', '-w', '\n%{http_code}', ...(body !== undefined ? ['-X', 'POST', '-H', 'content-type: text/plain', '--data-binary', '@-'] : []), url];
    const r = await curl(args, body);
    const i = r.out.lastIndexOf('\n'); const status = Number(r.out.slice(i + 1)) || 0; const text = r.out.slice(0, i);
    return { ok: status >= 200 && status < 300, status, text };
  } catch (e) { return { ok: false, status: 0, text: (e as Error).message }; }
}
/** Retry transient errors once. Unknown spend state is always fatal to financial requests. */
export async function get(path: string): Promise<string> {
  const bases = [...new Set([ESPLORA, process.env.FUSE_ESPLORA_FALLBACK].filter((x): x is string => !!x))];
  const errors: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (const base of bases) {
      try {
        return await readSource(base, async () => {
          const r = await request(path, undefined, base);
          if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), {status: r.status});
          return r.text.trim();
        });
      } catch (e) {
        errors.push(`${new URL(base).hostname}: ${(e as Error).message}`);
      }
    }
    if (!process.env.FUSE_ESPLORA || process.env.FUSE_FULCRUM_WSS) {
      const rawId = new RegExp('^/tx/([0-9a-f]{64})/hex$').exec(path)?.[1];
      try {
        const addr = /^[/]address[/]([^/]+)[/]utxo$/.exec(path)?.[1];
        if (addr) {
          const coins = await electrum<Array<{tx_hash:string;tx_pos:number;height:number;value:number}>>('blockchain.address.listunspent', [decodeURIComponent(addr), 'include_tokens']);
          return JSON.stringify(coins.map(c => ({txid:c.tx_hash, vout:c.tx_pos, value:c.value, status:{confirmed:c.height > 0}})));
        }
        const spend = /^[/]tx[/]([0-9a-f]{64})[/]outspend[/](\d+)$/.exec(path);
        if (spend) return JSON.stringify(await fulcrumSpend(spend[1], Number(spend[2])));
        if (rawId) return await readSource(fulcrumUrl, () => rpc<string>(fulcrumUrl, 'blockchain.transaction.get', [rawId, false]));
        if (path === '/blocks/tip/height') return String((await readSource(fulcrumUrl, () => rpc<{height:number}>(fulcrumUrl, 'blockchain.headers.subscribe', []))).height);
      } catch (e) { errors.push(`Fulcrum: ${(e as Error).message}`); }
    }
    if (round === 0) await delay(150 * 2 ** round);
  }
  throw unavailable(`BCH data unavailable (${errors.join(', ')}). Retry shortly.`);
}
export const getJson = async <T>(path: string) => JSON.parse(await get(path)) as T;

/** Relay an already-signed transaction. Returns the txid reported by the node (or throws with the node error). */
// Second broadcast path: a Fulcrum/BCHN node over WSS on port 443 (the only Electrum transport reachable from
// every host we run on). Round 6 found bchexplorer.cash accepting a valid tx into its own mempool without
// propagating it (its node lagged ~8 blocks); the same hex re-sent to this node reached the network at once.
const FULCRUM_WSS = fulcrumUrl;
export async function fulcrumBroadcast(rawHex: string, url = FULCRUM_WSS, timeoutMs = 6000): Promise<string> {
  if (process.env.FUSE_NO_FANOUT === '1') throw new Error('fan-out disabled');
  return rpc<string>(url, 'blockchain.transaction.broadcast', [rawHex], timeoutMs);
}
/** txid → which broadcast paths accepted it (for the broadcast receipt). */
export const relayPaths = new Map<string, string[]>();
export async function relay(rawHex: string): Promise<string> {
  let last = ''; let txid: string | null = null; const paths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await request('/tx', rawHex).catch((e) => ({ ok: false, status: 0, text: String((e as Error).message) }));
    if (r.ok) { txid = r.text.trim(); paths.push('bchexplorer.cash POST /api/tx'); break; }
    last = r.text.slice(0, 300);
    if (r.status >= 400 && r.status < 500 && r.status !== 429) throw Object.assign(new Error('Primary node rejected transaction: ' + last), { statusCode: 422 }); // node rejected it: do not retry
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
  if (rawCache.size >= 512) rawCache.delete(rawCache.keys().next().value!);
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
export async function status(txid: string) {
  try {
    const state = await getJson<{ confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number }>('/tx/' + txid + '/status');
    if (state?.confirmed === false) return state;
    if (state?.confirmed !== true || !/^[0-9a-f]{64}$/.test(state.block_hash ?? '')) throw unavailable('Invalid transaction status');
    // Explorer status can pair the right block hash with a height calculated from a lagging tip.
    const block = await getJson<{id: string; height:number; stale?:boolean}>('/block/' + state.block_hash);
    if (block.stale || !Number.isSafeInteger(block.height) || block.height < 1 || block.id !== state.block_hash ||
        await get('/block-height/' + block.height) !== block.id) throw unavailable('Block is outside the active chain');
    return { ...state, block_height: block.height };
  } catch (error) {
    if (process.env.FUSE_ESPLORA && !process.env.FUSE_FULCRUM_WSS) throw error;
    const proof = await inclusion(txid);
    return { confirmed: true, block_height: proof.blockHeight, block_hash: proof.blockHash, block_time: Buffer.from(proof.header,'hex').readUInt32LE(68) };
  }
}
export async function tip() {
  const value = Number(await get('/blocks/tip/height'));
  if (!Number.isSafeInteger(value) || value <= 0) throw unavailable('Invalid BCH tip height');
  return value;
}
export async function freshTip() {
  const height = await tip();
  let hash: string;
  let header: string;
  try {
    hash = await get('/block-height/' + height);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw unavailable('Invalid tip hash');
    header = await get('/block/' + hash + '/header');
  } catch (error) {
    if (process.env.FUSE_ESPLORA && !process.env.FUSE_FULCRUM_WSS) throw error;
    header = await electrum<string>('blockchain.block.header', [height]);
    hash = binToHex(hash256(hexToBin(header)).reverse());
  }
  if (!/^[0-9a-f]{160}$/.test(header) || binToHex(hash256(hexToBin(header)).reverse()) !== hash) throw unavailable('Invalid tip header');
  const ageSeconds = Date.now() / 1000 - Buffer.from(header, 'hex').readUInt32LE(68);
  if (ageSeconds > 7200 || ageSeconds < -7200) throw unavailable('Chain tip is stale or has an invalid timestamp. Retry with a current reader.');
  return { height, hash, checkedAt: new Date().toISOString() };
}
export async function outspend(txid: string, vout: number) {
  const s = await getJson<{ spent: boolean; txid?: string; vin?: number; status?: { confirmed: boolean } }>(`/tx/${txid}/outspend/${vout}`);
  if (typeof s?.spent !== 'boolean' || (s.spent && !/^[0-9a-f]{64}$/.test(s.txid ?? ''))) throw unavailable('Invalid BCH outpoint status');
  return s;
}
async function fulcrumSpend(id: string, vout: number) {
  const output = await outputAt(id, vout);
  const coins = await unspentAtScript(output.lockingBytecode);
  if (coins.some(c => c.tx_hash === id && c.tx_pos === vout)) return { spent: false };
  const scriptHash = binToHex(sha256.hash(hexToBin(output.lockingBytecode)).reverse());
  const history = await electrum<Array<{tx_hash:string; height:number}>>('blockchain.scripthash.get_history', [scriptHash]);
  // Only a decoded spending input establishes the next vault hop. Bound the search on busy scripts.
  for (const item of history.slice(-32).reverse()) {
    const tx = await decoded(item.tx_hash);
    const vin = tx.inputs.findIndex(i => binToHex(i.outpointTransactionHash) === id && i.outpointIndex === vout);
    if (vin >= 0) return {spent:true, txid:item.tx_hash, vin, status:{confirmed:item.height > 0}};
  }
  throw unavailable('Independent node could not identify the spender within the history window');
}
export async function independentlyUnspent(inputs: Array<{ txid:string; vout:number; lockingBytecode:string }>) {
  const scripts = [...new Set(inputs.map(i => i.lockingBytecode))];
  await pool(scripts, 4, async script => {
    const coins = await unspentAtScript(script);
    if (!inputs.filter(i => i.lockingBytecode === script).every(i => coins.some(c => c.tx_hash === i.txid && c.tx_pos === i.vout))) {
      throw Object.assign(new Error('Independent BCH node cannot confirm all selected inputs are unspent. Run preflight again.'), { statusCode: 409 });
    }
  });
}
export async function confirmations(txid: string) { const [s, t] = await Promise.all([status(txid), tip()]); return { ...s, confirmations: s.block_height ? t - s.block_height + 1 : 0, tip: t }; }

export async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (k < xs.length) { const i = k++; out[i] = await f(xs[i]); } }));
  return out;
}

/** Spendable coins of an address, verified from raw txs; coins already spent in the mempool are dropped. */
export async function addressUtxos(address: string, opts: { max?: number } = {}): Promise<LiveUtxo[]> {
  const list = await getJson<Array<{ txid: string; vout: number; value: number; status?: { confirmed: boolean } }>>(`/address/${encodeURIComponent(address)}/utxo`);
  const pick = list.slice(0, opts.max ?? 25);
  const res = await pool<typeof pick[number], LiveUtxo | null>(pick, 5, async (u) => {
    const [o, sp] = await Promise.all([outputAt(u.txid, u.vout), outspend(u.txid, u.vout)]);
    return sp.spent ? null : ({ ...o, confirmed: Boolean(u.status?.confirmed) } as LiveUtxo);
  });
  return res.filter((x): x is LiveUtxo => x !== null).sort((a, b) => (a.satoshis > b.satoshis ? -1 : 1));
}
