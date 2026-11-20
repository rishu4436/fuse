import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeMainnet, fetchMainnetTx, type Fetcher } from '../src/mainnet-explorer.js';

const fx = JSON.parse(readFileSync(new URL('../../../tests/fixtures/mainnet-paryon-oracle-tx.json', import.meta.url), 'utf8')) as { txid: string; rawHex: string; status: { confirmed: boolean; block_height: number; block_hash: string } };

describe('F50 mainnet explorer (READ-ONLY, real mainnet tx fixture)', () => {
  it('decodes a real Paryon oracle update; labels the reconstructed price contract and decodes its commitment', () => {
    const r = decodeMainnet(fx.txid, fx.rawHex, fx.status, fx.status.block_height + 2);
    expect(r.status).toBe('READ-ONLY'); expect(r.txidVerifiedLocally).toBe(true); expect(r.confirmations).toBe(3);
    const price = r.outputs.find((o) => (o.state as { kind?: string } | null)?.kind === 'price');
    expect(price?.label).toMatch(/Paryon price/i);
    expect((price!.state as { priceRaw: bigint }).priceRaw).toBe(19911n); // matches the snapshot's latestPrice for this outpoint
    expect(r.protocols.length).toBeGreaterThan(0);
  });
  it('rejects an indexer that returns a different transaction (hash mismatch) and malformed txids', async () => {
    const lying: Fetcher = async (p) => (p.endsWith('/hex') ? fx.rawHex : p.endsWith('/status') ? '{"confirmed":true}' : '1');
    await expect(fetchMainnetTx('00'.repeat(32), lying)).rejects.toThrow(/hashes to/);
    await expect(fetchMainnetTx('xyz', lying)).rejects.toThrow(/64 lowercase hex/);
  });
});
