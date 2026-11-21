import { createHash } from 'node:crypto';
import { readSource, rpc, fulcrumUrl, unavailable } from './source.js';

export const electrum = <T>(method: string, params: unknown[]) =>
  readSource(fulcrumUrl, () => rpc<T>(fulcrumUrl, method, params));
const sha = (buf: Buffer) => createHash('sha256').update(buf).digest();
const doubleHash = (buf: Buffer) => sha(sha(buf));
type Proof = {block_height: number; pos: number; merkle: string[]};
export async function inclusion(txid: string) {
  const proof = await electrum<Proof>('blockchain.transaction.get_merkle', [txid]);
  if (!Number.isSafeInteger(proof.block_height) || proof.block_height < 1 || !Number.isSafeInteger(proof.pos) || proof.pos < 0 || proof.merkle.length > 32) throw unavailable('Invalid Merkle proof');
  const header = await electrum<string>('blockchain.block.header', [proof.block_height]);
  if (!/^[0-9a-f]{160}$/i.test(header)) throw unavailable('Invalid BCH header');
  let node = Buffer.from(txid, 'hex').reverse();
  let pos = proof.pos;
  for (const sibling of proof.merkle) {
    if (!/^[0-9a-f]{64}$/i.test(sibling)) throw unavailable('Invalid Merkle branch');
    const other = Buffer.from(sibling, 'hex').reverse();
    node = doubleHash(Buffer.concat(pos % 2 ? [other,node] : [node,other]));
    pos = Math.floor(pos / 2);
  }
  if (pos !== 0 || node.toString('hex') !== header.slice(72,136)) throw unavailable('Transaction is absent from the reported Merkle root');
  return { blockHeight: proof.block_height, blockHash: doubleHash(Buffer.from(header,'hex')).reverse().toString('hex'), header, proof };
}

type Coin = {tx_hash: string; tx_pos: number; height: number; value: number};
export async function unspentAtScript(script: string) {
  const hash = sha(Buffer.from(script,'hex')).reverse().toString('hex');
  return electrum<Coin[]>('blockchain.scripthash.listunspent', [hash, 'include_tokens']);
}
