// F50 — READ-ONLY mainnet transaction explorer. Raw hex is fetched from a public indexer (bchexplorer.cash, an
// esplora-compatible API) and re-hashed locally: if hash256(raw) != txid the result is rejected, so the indexer
// cannot forge contents. Outputs are labelled only by exact matches against locally reconstructed Paryon V1
// contract scripts and known token categories. Nothing is built, signed or broadcast.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectRaw } from '@fuse/transaction-composer';
import { PARYON_MAINNET_V1, paryonContracts, decodeLoanCommitment, decodePriceCommitment } from '@fuse/protocol-adapters';

const run = promisify(execFile);
const ESPLORA = process.env.FUSE_ESPLORA ?? 'https://bchexplorer.cash/api';
export interface MainnetTxStatus { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number }
export type Fetcher = (path: string) => Promise<string>;
export const curlFetcher: Fetcher = async (path) => (await run('curl', ['-sS', '--fail', '-m', '25', ESPLORA + path], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

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
  const confirmations = status?.confirmed && status.block_height && tipHeight ? tipHeight - status.block_height + 1 : 0;
  return { network: 'mainnet' as const, status: 'READ-ONLY' as const, txidVerifiedLocally: true, source: ESPLORA, confirmed: !!status?.confirmed, blockHeight: status?.block_height ?? null, blockHash: status?.block_hash ?? null, confirmations, ...i, outputs, protocols: [...new Set(outputs.map((o) => o.label).filter((x): x is string => !!x && x.startsWith('Paryon')))] };
}

const cache = new Map<string, ReturnType<typeof decodeMainnet>>();
export async function fetchMainnetTx(txid: string, f: Fetcher = curlFetcher) {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw Object.assign(new Error('txid must be 64 lowercase hex chars'), { code: 'BAD_TXID' });
  const c = cache.get(txid); if (c?.confirmed) return c;
  const raw = await f(`/tx/${txid}/hex`).catch((e) => { throw Object.assign(new Error(`indexer: ${String(e.stderr ?? e.message).trim().slice(0, 160)}`), { code: 'NOT_FOUND' }); });
  const [status, tip] = await Promise.all([f(`/tx/${txid}/status`).then((s) => JSON.parse(s) as MainnetTxStatus).catch(() => null), f('/blocks/tip/height').then(Number).catch(() => null)]);
  const r = decodeMainnet(txid, raw, status, tip);
  cache.set(txid, r);
  return r;
}
