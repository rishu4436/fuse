// F50 — READ-ONLY mainnet transaction explorer. Raw hex is fetched from a public indexer (bchexplorer.cash, an
// esplora-compatible API) and re-hashed locally: if hash256(raw) != txid the result is rejected, so the indexer
// cannot forge contents. Outputs are labelled only by exact matches against locally reconstructed Paryon V1
// contract scripts and known token categories. Nothing is built, signed or broadcast.
import { ESPLORA, rawTx, status, tip } from './live/chain.js';
import { inspectRaw } from '@fuse/transaction-composer';
import { PARYON_MAINNET_V1, paryonContracts, decodeLoanCommitment, decodePriceCommitment } from '@fuse/protocol-adapters';

export interface MainnetTxStatus { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number }
export type Fetcher = (path: string) => Promise<string>;

let known: Map<string, string> | undefined;
function knownScripts() {
  if (known) return known;
  const c = paryonContracts();
  known = new Map<string, string>();
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'string') known.set(v, `Paryon ${k}`);
    else for (const [f, lb] of Object.entries(v as Record<string, string>)) known.set(lb, `Paryon loan function ${f}`);
  }
  return known;
}
const CATEGORIES: Record<string, string> = Object.fromEntries(Object.entries(PARYON_MAINNET_V1.tokenIds).map(([k, v]) => [v, k === 'paryonTokenId' ? 'PUSD / Paryon' : `Paryon ${k}`]));

export function decodeMainnet(txid: string, rawHex: string, status: MainnetTxStatus | null, tipHeight: number | null) {
  const i = inspectRaw(rawHex);
  if (i.txid !== txid) throw Object.assign(new Error(`indexer raw hashes to ${i.txid}, not ${txid}`), { code: 'HASH_MISMATCH' });
  const outputs = i.outputs.map((o) => {
    const contract = knownScripts().get(o.lockingBytecode) ?? null;
    const asset = o.token ? CATEGORIES[o.token.category] ?? 'unknown token' : null;
    let state: unknown = null;
    if (o.token?.nft && o.token.category === PARYON_MAINNET_V1.tokenIds.paryonTokenId && contract) {
      try { state = /price/i.test(contract) ? { kind: 'price', ...decodePriceCommitment(o.token.nft.commitment) } : /loan$/i.test(contract) ? { kind: 'loan', ...decodeLoanCommitment(o.token.nft.commitment) } : null; } catch { state = null; }
    }
    return { ...o, label: contract ?? (o.lockingBytecode.startsWith('6a') ? 'OP_RETURN' : null), asset, state };
  });
  const confirmations = status?.confirmed && status.block_height && tipHeight ? Math.max(0, tipHeight - status.block_height + 1) : 0;
  return { network: 'mainnet' as const, status: 'READ-ONLY' as const, txidVerifiedLocally: true, source: ESPLORA, confirmationKnown: status !== null, confirmed: !!status?.confirmed, blockHeight: status?.block_height ?? null, blockHash: status?.block_hash ?? null, confirmations, ...i, outputs, protocols: [...new Set(outputs.map((o) => o.label).filter((x): x is string => !!x && x.startsWith('Paryon')))] };
}

export async function fetchMainnetTx(txid: string, fetcher?: Fetcher) {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw Object.assign(new Error('txid must be 64 lowercase hex chars'), { code: 'BAD_TXID' });
  const [raw, block, height] = await Promise.all([
    fetcher ? fetcher(`/tx/${txid}/hex`) : rawTx(txid),
    (fetcher ? fetcher(`/tx/${txid}/status`).then((text) => JSON.parse(text) as MainnetTxStatus) : status(txid)).catch(() => null),
    (fetcher ? fetcher('/blocks/tip/height').then(Number) : tip()).catch(() => null),
  ]);
  return decodeMainnet(txid, raw, block, height);
}
