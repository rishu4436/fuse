/* global console */
// Bundles the FUSE API (services/api/src/embedded.ts + all workspace packages) into one ESM file the hosted
// Next.js route handler loads at runtime, and copies the read-only mainnet evidence snapshots next to it.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'apps/web/embedded');
rmSync(out, { recursive: true, force: true }); mkdirSync(resolve(out, 'evidence'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'services/api/src/embedded.ts')], outfile: resolve(out, 'fuse-api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, logLevel: 'warning', legalComments: 'none',
});
for (const f of ['cauldron-pool-verification.json', 'paryon-deployment-verification.json', 'moria-historical-replay.json']) cpSync(resolve(root, 'evidence', f), resolve(out, 'evidence', f));
mkdirSync(resolve(out, 'evidence/mainnet'), { recursive: true });
cpSync(resolve(root, 'evidence/mainnet/live-vaults.json'), resolve(out, 'evidence/mainnet/live-vaults.json'));
cpSync(resolve(root, 'evidence/mainnet/live-solvers.json'), resolve(out, 'evidence/mainnet/live-solvers.json'));
console.log('embedded API bundle →', out);
// smoke-load the bundle so a broken module graph fails the build instead of 500-ing production
const m = await import(pathToFileURL(resolve(out, 'fuse-api.mjs')).href);
if (typeof m.handle !== 'function') throw new Error('embedded bundle does not export handle()');
console.log('embedded bundle smoke-load ok');
