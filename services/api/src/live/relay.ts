// /api/broadcast: relays ALREADY-SIGNED transactions. Before relaying, the server re-derives every spent output from
// chain data (raw parents re-hashed) and runs the full BCH 2026 VM over every input; an invalid transaction is
// refused without touching the network. No keys exist on the server; nothing here can sign.
import { binToHex, hexToBin, decodeTransaction, createVirtualMachineBch2026, type Output } from '@bitauth/libauth';
import { txidOfRaw } from '@fuse/transaction-composer';
import { outputAt, pool, relay, EXPLORER_TX } from './chain.js';

const hits = new Map<string, number[]>();
export function rateLimit(ip: string, max = 12, windowMs = 60_000) {
  const now = Date.now(); const h = (hits.get(ip) ?? []).filter((t) => now - t < windowMs); h.push(now); hits.set(ip, h);
  if (h.length > max) throw Object.assign(new Error('rate limited: too many broadcasts from this client'), { statusCode: 429 });
}

export async function verifySigned(rawHex: string) {
  if (!/^[0-9a-f]+$/.test(rawHex) || rawHex.length % 2 || rawHex.length > 200_000) throw Object.assign(new Error('rawHex must be hex, ≤ 100 kB'), { statusCode: 400 });
  const tx = decodeTransaction(hexToBin(rawHex));
  if (typeof tx === 'string') throw Object.assign(new Error(`not a transaction: ${tx}`), { statusCode: 400 });
  const src = await pool(tx.inputs, 4, async (i) => outputAt(binToHex(i.outpointTransactionHash), i.outpointIndex));
  const sourceOutputs = src.map((o) => ({ lockingBytecode: hexToBin(o.lockingBytecode), valueSatoshis: o.satoshis, ...(o.token ? { token: { category: hexToBin(o.token.category), amount: o.token.amount, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: hexToBin(o.token.nft.commitment) } } : {}) } } : {}) }) as Output);
  const vm = createVirtualMachineBch2026();
  const r = vm.verify({ transaction: tx, sourceOutputs });
  const inSum = src.reduce((a, o) => a + o.satoshis, 0n); const outSum = tx.outputs.reduce((a, o) => a + o.valueSatoshis, 0n);
  return { txid: txidOfRaw(rawHex), vmValid: r === true, vmDetail: r === true ? 'all inputs valid in the BCH 2026 VM against chain-derived source outputs' : String(r), minerFee: inSum - outSum, sizeBytes: rawHex.length / 2, inputs: tx.inputs.length, outputs: tx.outputs.length };
}

export async function broadcast(rawHex: string, opts: { enabled: boolean; maxFee?: bigint }) {
  if (!opts.enabled) throw Object.assign(new Error('broadcasting is disabled on this deployment (FUSE_BROADCAST=1 not set)'), { statusCode: 503 });
  const v = await verifySigned(rawHex);
  if (!v.vmValid) throw Object.assign(new Error(`refused: ${v.vmDetail}. Nothing was sent.`), { statusCode: 422, details: v });
  if (v.minerFee > (opts.maxFee ?? 50_000n)) throw Object.assign(new Error(`refused: miner fee ${v.minerFee} sats looks wrong (guard 50,000). Nothing was sent.`), { statusCode: 422 });
  const nodeTxid = await relay(rawHex);
  if (nodeTxid !== v.txid) throw Object.assign(new Error(`node returned ${nodeTxid}, expected ${v.txid}`), { statusCode: 502 });
  return { ...v, broadcast: true, relayedVia: 'bchexplorer.cash (POST /api/tx → Fulcrum/BCHN)', explorer: EXPLORER_TX + v.txid };
}
