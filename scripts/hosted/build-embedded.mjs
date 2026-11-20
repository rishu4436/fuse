/* global console */
// Bundles the FUSE API (services/api/src/embedded.ts + all workspace packages) into one ESM file the hosted
// Next.js route handler loads at runtime, and copies the read-only mainnet evidence snapshots next to it.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'apps/web/embedded');
rmSync(out, { recursive: true, force: true }); mkdirSync(resolve(out, 'evidence'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'services/api/src/embedded.ts')], outfile: resolve(out, 'fuse-api.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, logLevel: 'warning', legalComments: 'none',
});
for (const f of ['cauldron-pool-verification.json', 'paryon-deployment-verification.json', 'moria-historical-replay.json']) cpSync(resolve(root, 'evidence', f), resolve(out, 'evidence', f));
console.log('embedded API bundle →', out);
