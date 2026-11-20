import { binToHex } from '@bitauth/libauth';
import { ChaingraphClient, decodeRawTx } from '../../packages/indexer-client/src/index.js';
import { PARYON_MAINNET_V1 } from '../../packages/protocol-adapters/src/paryon.js';
const cg = new ChaingraphClient();
for (const [k, txid] of Object.entries(PARYON_MAINNET_V1.genesisTxIds)) {
  const tx = await cg.getTransaction(txid);
  const d = decodeRawTx(tx!.rawHex);
  console.log(k, tx!.blockHeight, d.outputs.map((o) => binToHex(o.lockingBytecode).slice(0, 70) + (o.token ? ` [${o.token.nft?.capability ?? 'ft'}]` : '')).join('\n   '));
}
