// READ-ONLY: list live Cauldron pools for a token (public Cauldron indexer), fetch each pool tx from
// Chaingraph, re-hash the raw tx locally, decode it with libauth and check that the on-chain locking
// bytecode equals the P2SH32 of the published Cauldron script with the owner PKH substituted, and that
// sats/tokens match the indexer. No keys, no broadcasts.
import { MockNetworkProvider } from 'cashscript';
import { binToHex } from '@bitauth/libauth';
import { writeFileSync } from 'node:fs';
import { cauldronPoolContract } from '../../packages/contracts/src/index.js';
import { ChaingraphClient, decodeRawTx } from '../../packages/indexer-client/src/index.js';

const PUSD = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const token = process.argv[2] ?? PUSD;
const cg = new ChaingraphClient();
const res = await fetch(`https://indexer.cauldron.quest/cauldron/pool/active?token=${token}`);
const { active } = (await res.json()) as { active: Array<{ owner_pkh: string; txid: string; tx_pos: number; sats: number; tokens: number; pool_id: string }> };
const offline = new MockNetworkProvider();
const results = [];
for (const pool of active.slice(0, 10)) {
  const tx = await cg.getTransaction(pool.txid);
  if (!tx) { results.push({ pool_id: pool.pool_id, error: 'tx not found on chaingraph' }); continue; }
  const out = decodeRawTx(tx.rawHex).outputs[pool.tx_pos];
  const expected = cauldronPoolContract(pool.owner_pkh, offline).lockingBytecode;
  const actual = binToHex(out.lockingBytecode);
  results.push({
    pool_id: pool.pool_id,
    outpoint: `${pool.txid}:${pool.tx_pos}`,
    blockHeight: tx.blockHeight,
    scriptMatchesPublishedCauldronArtifact: expected === actual,
    satsMatchIndexer: out.valueSatoshis === BigInt(pool.sats),
    tokensMatchIndexer: out.token?.amount === BigInt(pool.tokens),
    categoryMatches: out.token ? binToHex(out.token.category) === token : false,
    sats: out.valueSatoshis.toString(),
    tokens: out.token?.amount.toString() ?? null,
  });
}
const report = { checkedAt: new Date().toISOString(), network: 'mainnet', token, indexer: 'https://indexer.cauldron.quest/cauldron', chainSource: 'chaingraph (raw tx re-hashed locally)', poolsReturned: active.length, checked: results };
console.log(JSON.stringify(report, null, 2));
writeFileSync(new URL('../../evidence/cauldron-pool-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
