// Starts the API and 4 independent solver processes (3 honest + 1 adversarial fixture). LOCAL only.
import { spawn } from 'node:child_process';
const procs = [spawn('npx', ['tsx', 'services/api/src/server.ts'], { stdio: 'inherit' })];
setTimeout(() => { for (const k of ['direct', 'routing', 'flash', 'rogue']) procs.push(spawn('npx', ['tsx', 'services/solver-reference/src/worker.ts', k], { stdio: 'inherit' })); }, 2500);
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
