// Re-verifies every mainnet vault certificate under the four verification levels (review issue B).
// Pure chain reads; no keys. The attestation pubkey is the one published at /api/live/status.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { liveCertificate } from '../../services/api/src/live/certificate.js';
import { loadVaultConfigs } from '../../services/api/src/live/vault.js';

const root = process.cwd();
const ATTESTATION = process.env.FUSE_ATTESTATION_PUBKEY ?? '037e044ab06145cc82956a836cb712f0f422a5bc05371e49eabd4936592419401f';
const authDir = join(root, 'evidence/mainnet/authorizations'), certDir = join(root, 'evidence/mainnet/certificates');
const txids = [...new Set([...readdirSync(certDir), ...readdirSync(authDir)].filter((f) => /^[0-9a-f]{64}\.json$/.test(f)).map((f) => f.replace('.json', '')))];
const big = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
const summary: unknown[] = [];
for (const txid of txids) {
  const a = existsSync(join(authDir, `${txid}.json`)) ? JSON.parse(readFileSync(join(authDir, `${txid}.json`), 'utf8')) : null;
  const r = await liveCertificate(loadVaultConfigs(root), txid, { authorization: a?.authorization ?? null, userSignature: a?.userSignature ?? null, trustedPubkey: ATTESTATION, auction: a?.auction });
  writeFileSync(join(certDir, `${txid}.json`), JSON.stringify(r, big, 2) + '\n');
  const v = r.verification;
  summary.push({ txid, kind: r.kind, status: v.status, level: v.level, levels: v.levels });
  console.log(txid.slice(0, 12), r.kind, v.status, v.level, Object.entries(v.levels).map(([k, x]) => `${k}=${(x as { ok: boolean }).ok}`).join(' '));
  for (const c of v.checks.filter((c) => !c.ok || c.name.startsWith('claim-not'))) console.log('   ', c.name, c.detail);
}
writeFileSync(join(root, 'evidence/mainnet/reverification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), attestationPubkey: ATTESTATION, verifier: 'packages/proof-verifier levels + services/api/src/live/verify.ts rederivers', results: summary }, big, 2) + '\n');
