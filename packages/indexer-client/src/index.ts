// Read-only BCH chain access. Primary backend: Chaingraph GraphQL (public, HTTPS).
// Every value returned here is fetched live; nothing is cached or fabricated. Callers must treat
// indexer data as untrusted and re-verify anything security relevant (e.g. decode raw tx hex).
import { decodeTransaction, hexToBin, binToHex, hash256 } from '@bitauth/libauth';

export const DEFAULT_CHAINGRAPH = 'https://gql.chaingraph.pat.mn/v1/graphql';

export interface ChainOutput {
  outpoint: string;
  valueSatoshis: bigint;
  lockingBytecode: string;
  tokenCategory: string | null;
  fungibleAmount: bigint | null;
  nftCapability: string | null;
  nftCommitment: string | null;
  spentBy: string[];
}

export interface ChainTx {
  txid: string;
  rawHex: string;
  blockHeight: number | null;
  blockHash: string | null;
}

const strip = (h: string | null | undefined) => (h == null ? null : h.replace(/^\\x/, ''));

export class ChaingraphClient {
  constructor(private readonly url = DEFAULT_CHAINGRAPH, private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 20_000) {}

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: ctrl.signal });
      if (!res.ok) throw new IndexerError(`chaingraph HTTP ${res.status}`, true);
      const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (body.errors?.length) throw new IndexerError(`chaingraph: ${body.errors[0].message}`, false);
      return body.data as T;
    } finally {
      clearTimeout(t);
    }
  }

  async tipHeight(): Promise<number> {
    const d = await this.query<{ block: Array<{ height: string }> }>('{ block(limit:1, order_by:{height:desc}){ height } }');
    return Number(d.block[0].height);
  }

  /** Fetch a transaction; the raw hex is re-hashed locally so a lying indexer cannot substitute it. */
  async getTransaction(txid: string): Promise<ChainTx | null> {
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('invalid txid');
    const d = await this.query<{ transaction: Array<{ encoded_hex: string; block_inclusions: Array<{ block: { height: string; hash: string } }> }> }>(
      `query($h: bytea!){ transaction(where:{hash:{_eq:$h}}){ encoded_hex block_inclusions{ block{ height hash } } } }`, { h: `\\x${txid}` });
    const t = d.transaction[0];
    if (!t) return null;
    const computed = binToHex(hash256(hexToBin(t.encoded_hex)).reverse());
    if (computed !== txid) throw new IndexerError(`indexer returned tx whose hash ${computed} != ${txid}`, false);
    const inc = t.block_inclusions[0]?.block;
    return { txid, rawHex: t.encoded_hex, blockHeight: inc ? Number(inc.height) : null, blockHash: inc ? strip(inc.hash) : null };
  }

  async getOutput(txid: string, index: number): Promise<ChainOutput | null> {
    const d = await this.query<{ output: Array<{ value_satoshis: string; locking_bytecode: string; token_category: string | null; fungible_token_amount: string | null; nonfungible_token_capability: string | null; nonfungible_token_commitment: string | null; spent_by: Array<{ transaction: { hash: string } }> }> }>(
      `query($h: bytea!, $i: bigint!){ output(where:{transaction_hash:{_eq:$h}, output_index:{_eq:$i}}){ value_satoshis locking_bytecode token_category fungible_token_amount nonfungible_token_capability nonfungible_token_commitment spent_by{ transaction{ hash } } } }`,
      { h: `\\x${txid}`, i: String(index) });
    const o = d.output[0];
    if (!o) return null;
    return {
      outpoint: `${txid}:${index}`,
      valueSatoshis: BigInt(o.value_satoshis),
      lockingBytecode: strip(o.locking_bytecode)!,
      tokenCategory: strip(o.token_category),
      fungibleAmount: o.fungible_token_amount == null ? null : BigInt(o.fungible_token_amount),
      nftCapability: o.nonfungible_token_capability,
      nftCommitment: strip(o.nonfungible_token_commitment),
      spentBy: o.spent_by.map((s) => strip(s.transaction.hash)!),
    };
  }

  /** Unspent outputs for a locking bytecode (hex). */
  async getUnspentByLockingBytecode(lockingBytecodeHex: string, limit = 200): Promise<ChainOutput[]> {
    if (!/^([0-9a-f]{2})+$/.test(lockingBytecodeHex)) throw new Error('invalid locking bytecode hex');
    const d = await this.query<{ output: Array<{ transaction_hash: string; output_index: string; value_satoshis: string; locking_bytecode: string; token_category: string | null; fungible_token_amount: string | null; nonfungible_token_capability: string | null; nonfungible_token_commitment: string | null }> }>(
      `query($lb: bytea!, $limit: Int!){ output(where:{locking_bytecode:{_eq:$lb}, _not:{spent_by:{}}}, limit:$limit){ transaction_hash output_index value_satoshis locking_bytecode token_category fungible_token_amount nonfungible_token_capability nonfungible_token_commitment } }`,
      { lb: `\\x${lockingBytecodeHex}`, limit });
    return d.output
      .filter((o) => strip(o.locking_bytecode) === lockingBytecodeHex)
      .map((o) => ({
        outpoint: `${strip(o.transaction_hash)}:${o.output_index}`,
        valueSatoshis: BigInt(o.value_satoshis),
        lockingBytecode: strip(o.locking_bytecode)!,
        tokenCategory: strip(o.token_category),
        fungibleAmount: o.fungible_token_amount == null ? null : BigInt(o.fungible_token_amount),
        nftCapability: o.nonfungible_token_capability,
        nftCommitment: strip(o.nonfungible_token_commitment),
        spentBy: [],
      }));
  }

  /** Historical (spent or unspent) transactions that created outputs of a category, with block heights. */
  async getTransactionsByCategory(categoryHex: string, limit = 25, offset = 0): Promise<Array<{ txid: string; blockHeight: number | null }>> {
    if (!/^[0-9a-f]{64}$/.test(categoryHex)) throw new Error('invalid category');
    const d = await this.query<{ output: Array<{ transaction_hash: string; transaction: { block_inclusions: Array<{ block: { height: string } }> } }> }>(
      `query($c: bytea!, $limit: Int!, $offset: Int!){ output(where:{token_category:{_eq:$c}}, limit:$limit, offset:$offset){ transaction_hash transaction { block_inclusions { block { height } } } } }`,
      { c: `\\x${categoryHex}`, limit, offset });
    const seen = new Map<string, number | null>();
    for (const o of d.output) { const h = strip(o.transaction_hash)!; if (!seen.has(h)) seen.set(h, o.transaction.block_inclusions[0] ? Number(o.transaction.block_inclusions[0].block.height) : null); }
    return [...seen].map(([txid, blockHeight]) => ({ txid, blockHeight }));
  }

  /** Unspent token outputs of a category (display-order hex), excluding OP_RETURN burns. Optionally filter NFT capability. */
  async getUnspentByCategory(categoryHex: string, opts: { capability?: 'none' | 'mutable' | 'minting'; limit?: number } = {}): Promise<ChainOutput[]> {
    if (!/^[0-9a-f]{64}$/.test(categoryHex)) throw new Error('invalid category');
    const capFilter = opts.capability ? `, nonfungible_token_capability:{_eq:"${opts.capability}"}` : '';
    const d = await this.query<{ output: Array<{ transaction_hash: string; output_index: string; value_satoshis: string; locking_bytecode: string; token_category: string | null; fungible_token_amount: string | null; nonfungible_token_capability: string | null; nonfungible_token_commitment: string | null }> }>(
      `query($c: bytea!, $limit: Int!){ output(where:{token_category:{_eq:$c}${capFilter}, locking_bytecode:{_neq:"\\\\x6a"}, _not:{spent_by:{}}}, limit:$limit){ transaction_hash output_index value_satoshis locking_bytecode token_category fungible_token_amount nonfungible_token_capability nonfungible_token_commitment } }`,
      { c: `\\x${categoryHex}`, limit: opts.limit ?? 1000 });
    return d.output.map((o) => ({
      outpoint: `${strip(o.transaction_hash)}:${o.output_index}`,
      valueSatoshis: BigInt(o.value_satoshis),
      lockingBytecode: strip(o.locking_bytecode)!,
      tokenCategory: strip(o.token_category),
      fungibleAmount: o.fungible_token_amount == null ? null : BigInt(o.fungible_token_amount),
      nftCapability: o.nonfungible_token_capability,
      nftCommitment: strip(o.nonfungible_token_commitment),
      spentBy: [],
    }));
  }
}

export class IndexerError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); }
}

/** Decode a raw transaction locally (independent of any indexer's parsed view). */
export function decodeRawTx(rawHex: string) {
  const tx = decodeTransaction(hexToBin(rawHex));
  if (typeof tx === 'string') throw new Error(`invalid raw transaction: ${tx}`);
  return tx;
}

export function txidOf(rawHex: string): string {
  return binToHex(hash256(hexToBin(rawHex)).reverse());
}
