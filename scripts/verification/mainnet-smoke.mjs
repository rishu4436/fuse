import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { rpc, fulcrumUrl } from '../../services/api/src/live/source.ts';

const base = process.env.FUSE_WEB ?? 'https://fusebch.vercel.app';
const txid = '994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f';
const sha = data => createHash('sha256').update(data).digest();
async function get(url, json = true) {
  const r = await globalThis.fetch(url, {signal: globalThis.AbortSignal.timeout(40000), headers: {'user-agent':'curl/8.5.0 (fuse-live)'}});
  if (!r.ok) throw Error('HTTP ' + r.status);
  return json ? r.json() : r.text();
}
async function independentTransaction() {
  let raw;
  let source = 'bchexplorer.cash';
  try {
    raw = await get('https://bchexplorer.cash/api/tx/' + txid + '/hex', false);
  } catch (error) {
    source = new URL(fulcrumUrl).hostname;
    console.log('Public explorer unavailable:', error.message, 'Trying', source);
    raw = await rpc(fulcrumUrl, 'blockchain.transaction.get', [txid, false], 8_000);
  }
  const hex = raw.trim();
  assert.match(hex, /^(?:[0-9a-f]{2})+$/i);
  assert.equal(sha(sha(Buffer.from(hex, 'hex'))).reverse().toString('hex'), txid);
  return source;
}
const probes = {
  'deployed chain tip': async () => { const r = await get(base + '/api/live/status'); assert.ok(r.tipHeight > 0 && !r.error); return r.tipHeight; },
  'deployed active vault': async () => { const v = await get(base + '/api/live/vaults'); assert.ok(v.some(x => x.id === 'fuse-live-1' && x.open && x.current && !x.error)); },
  'deployed Cauldron pools': async () => { const r = await get(base + '/api/live/cauldron'); assert.ok(r.pools.length >= 2); },
  'deployed transaction inclusion': async () => { const r = await get(base + '/api/live/tx/' + txid); assert.ok(r.confirmed && r.confirmations > 0 && r.block_height === 978214); return r.block_height; },
  'runner to independent BCH source': independentTransaction,
};
await Promise.all(Object.entries(probes).map(async ([name, probe]) => {
  const start = Date.now();
  try { const value = await probe(); console.log(name, 'OK', Date.now()-start, 'ms', value ?? ''); }
  catch (e) { console.error(name, 'FAILED', e.message, Date.now()-start, 'ms'); process.exitCode = 1; }
}));
