// READ-ONLY: replay historical Moria V1-era MUSD transactions from BCH mainnet in a fresh BCH 2026 VM.
// Moria V1 was disabled in April 2026; this is history only and is never used as an execution venue.
import { writeFileSync } from 'node:fs';
import { ChaingraphClient } from '@fuse/indexer-client';
import { replayRaw } from '@fuse/proof-verifier';

const MUSD = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366'; // docs.moria.money/technical/deployment
const cg = new ChaingraphClient(undefined, fetch, 90_000);
const txs = await cg.getTransactionsByCategory(MUSD, Number(process.env.LIMIT ?? 40));
console.log(`found ${txs.length} MUSD transactions`);
const results = [];
for (const t of txs.slice(0, 12)) {
  try {
    const tx = await cg.getTransaction(t.txid);
    if (!tx) { results.push({ txid: t.txid, error: 'not found' }); continue; }
    const r = await replayRaw(tx.rawHex, async (id) => { const p = await cg.getTransaction(id); if (!p) throw new Error(`parent ${id} missing`); return p.rawHex; });
    results.push({ ...r, blockHeight: tx.blockHeight });
    console.log(t.txid, r.allValid ? 'VALID' : 'INVALID', `${r.inputs} in / ${r.outputs} out`);
  } catch (e) { results.push({ txid: t.txid, error: (e as Error).message }); console.log(t.txid, 'ERROR', (e as Error).message); }
}
writeFileSync('evidence/moria-historical-replay.json', JSON.stringify({ checkedAt: new Date().toISOString(), network: 'mainnet', mode: 'READ-ONLY', protocol: 'Moria V1 (disabled April 2026, historical only)', category: MUSD, source: 'chaingraph (every raw tx re-hashed locally)', vm: 'libauth createVirtualMachineBch2026', note: 'Replays MUSD-carrying transactions input by input. FUSE does not decode Moria contract semantics.', results }, null, 2));
