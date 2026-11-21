// End-to-end mainnet test of the HOSTED app's execute path:
//   hosted /api/live/prepare (compose + simulate + Guardian) → box-only test signer → hosted /api/broadcast →
//   hosted /api/live/tx (confirmation) → hosted /api/live/certificate (verified against mainnet).
// Nothing is broadcast without --broadcast. Round caps: ≤ 150,000 sats total fees + losses, ≤ 5,000 sats fee per tx.
//   npx tsx scripts/mainnet/hosted-e2e.ts <action> [--units 1] [--amount 10000] [--principal 30000] [--broadcast] [--base URL]
//   npx tsx scripts/mainnet/hosted-e2e.ts certificate <txid> | status <txid>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { toJson, fromJson } from '@fuse/solver-sdk';
import { loadTestWallet, signPrepared, type Prepared } from './test-signer.js';
import { signAuthAsUser, structureHashOfTemplate, type Authorization } from '../../services/api/src/live/authz.js';

const args = process.argv.slice(2); const [action] = args;
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = flag('base') ?? process.env.FUSE_WEB ?? 'https://fuse-rust-eight.vercel.app';
const BROADCAST = args.includes('--broadcast');
const LEDGER = '/home/box/secrets/fuse-live-ledger.json';
const EVIDENCE = new URL('../../evidence/mainnet/live-run.json', import.meta.url).pathname;
const ROUND_CAP = BigInt(process.env.FUSE_ROUND_CAP ?? '150000'); const MAX_FEE = 5_000n; // round 5: FUSE_ROUND_CAP=56697 (6,697 already spent before round 5 + 50,000)
interface Ledger { spent: string; txs: Array<{ action: string; txid: string; minerFee: string; cost: string; at: string }> }
const ledger: Ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { spent: '0', txs: [] };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: toJson(body) } : {}), signal: AbortSignal.timeout(90_000) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
    const text = await r.text();
    if (r.ok) return fromJson<T>(text);
    if (r.status >= 500 && r.status !== 503 && i < 2) { await new Promise((s) => setTimeout(s, 2000)); continue; }
    throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 400)}`);
  }
}
function record(entry: Record<string, unknown>) {
  mkdirSync(new URL('.', `file://${EVIDENCE}`).pathname, { recursive: true });
  const ev = existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) : { network: 'mainnet', app: BASE, note: 'Hosted execute path: prepare (hosted) → box-only test signer → /api/broadcast (hosted) → certificate (hosted). Public data only.', txs: [] };
  ev.txs.push(entry); writeFileSync(EVIDENCE, JSON.stringify(ev, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
}

async function main() {
  if (action === 'certificate' || action === 'status') {
    const txid = args[1];
    if (action === 'status') { console.log(await call('GET', `/api/live/tx/${txid}`)); return; }
    const authFile = new URL(`../../evidence/mainnet/authorizations/${txid}.json`, import.meta.url);
    const bound = existsSync(authFile) ? JSON.parse(readFileSync(authFile, 'utf8')) : {};
    const c = await call<{ kind: string; verification: { status: string; level: string; checks: Array<{ name: string; ok: boolean; detail?: string }> }; routing: unknown[]; certificate: { certificateId: string } }>('POST', '/api/live/certificate', { txid, authorization: bound.authorization ?? null, userSignature: bound.userSignature ?? null, auction: bound.auction });
    console.log(`${c.kind} ${c.certificate.certificateId}: ${c.verification.status} · level ${c.verification.level}`); for (const k of c.verification.checks) console.log(`  ${k.ok ? '✓' : '✕'} ${k.name} ${k.detail ?? ''}`);
    if (c.routing.length) console.log('routing (recomputed from chain):', JSON.stringify(c.routing));
    mkdirSync(new URL('../../evidence/mainnet/certificates/', import.meta.url).pathname, { recursive: true });
    writeFileSync(new URL(`../../evidence/mainnet/certificates/${txid}.json`, import.meta.url), JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
    return;
  }
  const w = loadTestWallet();
  const body: Record<string, unknown> = { action, address: w.address };
  for (const k of ['units', 'amount', 'principal', 'vaultId']) if (flag(k)) body[k] = flag(k);
  const p = await call<Prepared & { simulation: Array<{ inputIndex: number; kind: string; ok: boolean; detail: string }>; risk: { ok: boolean; level: string; checks: Array<{ name: string; ok: boolean; detail: string }>; netUserCost: bigint }; route: unknown; template: Prepared['template'] }>('POST', '/api/live/prepare', body);
  console.log(`── hosted preflight: ${action} @ ${BASE} ──`);
  console.log(`miner fee ${p.minerFee} sats · expected user cost ${p.expectedUserCost} sats · Guardian ${p.risk.level}`);
  for (const s of p.simulation) console.log(`  sim input ${s.inputIndex} ${s.kind}: ${s.ok ? 'ok' : 'FAIL'} — ${s.detail}`);
  for (const c of p.risk.checks) console.log(`  ${c.ok ? '✓' : '✕'} ${c.name}: ${c.detail}`);
  if (p.route) console.log('  route', JSON.stringify(p.route, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  p.template.outputs.forEach((o, i) => console.log(`  out ${i} ${o.satoshis} ${o.label ?? o.role}`));
  const remaining = ROUND_CAP - BigInt(ledger.spent);
  const s = signPrepared(p, w, { maxFee: MAX_FEE, maxUserCost: remaining < 20_000n ? remaining : 20_000n });
  console.log(`signed locally (box-only test signer): txid ${s.txid}, net cost ${s.cost} sats; round budget left ${remaining}`);
  if (!BROADCAST) { console.log('DRY RUN: not broadcast. Re-run with --broadcast.'); return; }
  const authz = (p as unknown as { authorization: Authorization | null }).authorization;
  if (!authz) throw new Error('preflight issued no execution authorization: refusing');
  const ap = JSON.parse(Buffer.from(authz.payload, 'base64url').toString('utf8')) as { structureHash: string; intentId: string; expiresAt: number };
  if (ap.structureHash !== structureHashOfTemplate(p.template)) throw new Error('authorization is not for the template the signer reviewed');
  const userSignature = signAuthAsUser(authz.authHash, w.priv); // the wallet key also signs the authorization hash
  const b = await call<{ txid: string; explorer: string; vmDetail: string; minerFee: bigint; intentId: string; intentBound: boolean; constraintChecks: unknown; userSignature: unknown }>('POST', '/api/broadcast', { rawHex: s.raw, authorization: authz, userSignature });
  writeFileSync(new URL(`../../evidence/mainnet/authorizations/${b.txid}.json`, import.meta.url), JSON.stringify({ txid: b.txid, authorization: authz, userSignature, broadcastResult: { intentId: b.intentId, intentBound: b.intentBound, constraintChecks: b.constraintChecks, userSignature: b.userSignature } }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
  if (b.txid !== s.txid) throw new Error('broadcast txid mismatch');
  ledger.spent = String(BigInt(ledger.spent) + s.cost); ledger.txs.push({ action, txid: b.txid, minerFee: String(b.minerFee), cost: String(s.cost), at: new Date().toISOString() });
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), { mode: 0o600 });
  record({ action, txid: b.txid, intentId: b.intentId, intentBound: b.intentBound, explorer: b.explorer, minerFee: b.minerFee, netCost: s.cost, relayedBy: `${BASE}/api/broadcast`, serverVmCheck: b.vmDetail, guardian: p.risk.level, route: p.route, at: new Date().toISOString() });
  console.log(`BROADCAST via hosted /api/broadcast OK ${b.txid}\n  ${b.explorer}`);
}
main().catch((e) => { console.error('ERROR:', (e as Error).message); process.exit(1); });
