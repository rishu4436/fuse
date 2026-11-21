import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const bytes = readFileSync('tests/fixtures/browser-chain.json');
if (createHash('sha256').update(bytes).digest('hex') !== '2e29eb7114166f131dc7d6bfe10c94730ce8c780eee4d8fa1d00ba5c61521802') throw Error('Fixture integrity check failed');
const {responses} = JSON.parse(bytes);
const fixture = createServer((req, res) => {
  if (req.method !== 'GET' || !Object.hasOwn(responses, req.url)) {
    console.error('Unrecorded fixture request', req.method, req.url);
    res.writeHead(404).end('No recorded response');
    return;
  }
  res.writeHead(200).end(responses[req.url]);
});
const base = 'http://127.0.0.1:18788';
fixture.listen(18788, '127.0.0.1', () => {
  const child = spawn(process.execPath, ['--import', new URL('../../tests/fixtures/replay-clock.mjs', import.meta.url).href, resolve('apps/web/node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '3000'], {
    cwd: resolve('apps/web'), stdio: 'inherit',
    env: {...process.env, FUSE_HOSTED:'1', FUSE_ESPLORA:base, FUSE_ESPLORA_FALLBACK:'', FUSE_FULCRUM_WSS:'', FUSE_CAULDRON_INDEXER:base,
      FUSE_AUTH_KEY:randomBytes(32).toString('hex'), FUSE_BROADCAST:'0', FUSE_NO_FANOUT:'1'},
  });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill());
  child.on('exit', code => { fixture.close(); process.exitCode = code ?? 1; });
});
