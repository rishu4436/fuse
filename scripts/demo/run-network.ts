// Starts 4 independent solver processes (3 honest + 1 adversarial fixture) against FUSE_API. LOCAL only.
// Pass --with-api to also start the API in-process tree.
import { spawn, type ChildProcess } from 'node:child_process';
const procs: ChildProcess[] = [];
const withApi = process.argv.includes('--with-api');
if (withApi) procs.push(spawn('npx', ['tsx', 'services/api/src/server.ts'], { stdio: 'inherit' }));
setTimeout(() => { for (const k of ['direct', 'routing', 'flash', 'rogue']) procs.push(spawn('npx', ['tsx', 'services/solver-reference/src/worker.ts', k], { stdio: 'inherit' })); }, withApi ? 2500 : 0);
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
