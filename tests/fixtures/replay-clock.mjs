// Only the isolated Next child receives this preload. Keep the block header and authorization clock in the same historical window.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
if (process.env.FUSE_BROADCAST !== '0' || process.env.FUSE_ESPLORA !== 'http://127.0.0.1:18788') throw Error('Invalid fixture environment');
const start = performance.now();
const date = Date;
const epoch = date.parse('2026-11-21T08:22:26.669Z');
Date.now = () => Math.floor(epoch + performance.now() - start);


const bytes = readFileSync(new globalThis.URL('./fulcrum-coins.json', import.meta.url));
if (createHash('sha256').update(bytes).digest('hex') !== 'af08edea670df087021e0a4ee901b20a5fd17ba16ec4912418dbbec9d8f776de') throw Error('Independent UTXO fixture integrity check failed');
const {responses} = JSON.parse(bytes);
globalThis.WebSocket = class FixtureSocket {
  constructor() { globalThis.queueMicrotask(() => this.onopen?.()); }
  send(message) {
    const {id, method, params} = JSON.parse(message);
    const coins = responses[params[0]];
    const reply = method === 'blockchain.scripthash.listunspent' && coins ? {result: coins} : {error:{message:'Unrecorded fixture RPC'}};
    globalThis.queueMicrotask(() => this.onmessage?.({data:JSON.stringify({id,...reply})}));
  }
  close() {}
};
