// Re-reads every broadcast mainnet tx of the test plan from bchexplorer.cash, re-hashes the raw bytes locally and
// records confirmation status. Writes evidence/mainnet/run.json (public data only; no keys).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { txidOfRaw } from '@fuse/transaction-composer';
const f = new URL('../../evidence/mainnet/run.json', import.meta.url).pathname;
const run = JSON.parse(readFileSync(f, 'utf8')) as { txs: Array<Record<string, unknown> & { txid: string }> } & Record<string, unknown>;
const get = (p: string) => { for (let i = 0; ; i++) { try { return execFileSync('curl', ['-sS', '--fail-with-body', '-m', '30', 'https://bchexplorer.cash/api' + p], { encoding: 'utf8' }).trim(); } catch (e) { if (i > 4) throw e; } } };
const tip = Number(get('/blocks/tip/height'));
for (const t of run.txs) {
  const raw = get(`/tx/${t.txid}/hex`);
  const s = JSON.parse(get(`/tx/${t.txid}/status`)) as { confirmed: boolean; block_height?: number; block_hash?: string };
  Object.assign(t, { rehashedTxidMatches: txidOfRaw(raw) === t.txid, sizeBytes: raw.length / 2, confirmed: s.confirmed, blockHeight: s.block_height ?? null, blockHash: s.block_hash ?? null, confirmations: s.block_height ? tip - s.block_height + 1 : 0, link: `https://bchexplorer.cash/tx/${t.txid}` });
  console.log(`${t.step}\n  ${t.txid} fee ${t.fee} ${s.confirmed ? `block ${s.block_height}` : 'unconfirmed'} rehash ${t.rehashedTxidMatches ? 'ok' : 'MISMATCH'}`);
}
Object.assign(run, { checkedAt: new Date().toISOString(), tipHeight: tip, totalMinerFeesSats: String(run.txs.reduce((a, t) => a + BigInt(t.fee as string), 0n)) });
writeFileSync(f, JSON.stringify(run, null, 1));
