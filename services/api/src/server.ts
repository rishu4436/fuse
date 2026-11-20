import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { FuseState } from './state.js';
import { FuseStore } from '@fuse/store';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const store = new FuseStore(process.env.FUSE_DB ?? resolve(root, '.data/fuse.db'));
const state = new FuseState(root, { auctionWindowSeconds: Number(process.env.FUSE_AUCTION_WINDOW ?? 4), store });
const app = await buildApp(state);
setInterval(() => { state.tick().catch((e) => state.emit('TICK_ERROR', (e as Error).message)); }, 400);
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`SQLite store ${store.path} (schema v${store.migrations().at(-1)?.version}, session ${store.session})`);
console.log(`FUSE API (LOCAL simulation + mainnet READ-ONLY evidence) on http://127.0.0.1:${port}`);
