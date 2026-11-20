import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FuseStore, MIGRATIONS } from '../src/index.js';

describe('@fuse/store (SQLite, versioned migrations)', () => {
  it('applies every migration once, is idempotent on reopen, and round-trips bigint values', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fuse-store-')), 'fuse.db');
    const a = new FuseStore(path, 's1');
    expect(a.migrations().map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
    a.putPolicy({ id: 'gp1', createdAt: 1, limit: 5_000_000n } as never);
    a.appendLedger({ solverId: 'sv1', auctionId: 'a1', outcome: 'WIN', userNetSpendSats: 123n, improvementSats: 7n, revenueSats: 546n, latencyMs: 40, at: 2 });
    a.appendLedger({ solverId: 'sv1', auctionId: 'a2', outcome: 'REJECTED', reason: 'delivers 29700 tokens < minOut 30000', at: 3 });
    a.appendLedger({ solverId: 'sv1', auctionId: 'a3', outcome: 'LOSS', reason: 'rank 2', latencyMs: 60, at: 4 });
    a.close();
    const b = new FuseStore(path, 's2');
    expect(b.migrations()).toHaveLength(MIGRATIONS.length);
    expect(b.listPolicies<{ limit: bigint }>()[0].limit).toBe(5_000_000n);
    const [p] = b.performance();
    expect(p).toMatchObject({ solverId: 'sv1', bids: 3, wins: 1, rejected: 1, losses: 1, winRateBps: 3333, validityRateBps: 6667, avgLatencyMs: 50, revenueSats: 546n, userImprovementSats: 7n });
    expect(p.topRejections[0].reason).toBe('delivers N tokens < minOut N');
    expect(b.deletePolicy('gp1')).toBe(true);
    expect(b.listPolicies()).toHaveLength(0);
    b.close();
  });
  it('a failing migration rolls back and leaves the schema version unchanged', () => {
    const s = new FuseStore(':memory:');
    MIGRATIONS.push({ version: 99, name: 'broken', sql: 'CREATE TABLE ok_part (x INTEGER); THIS IS NOT SQL;' });
    try { expect(() => s.migrate()).toThrow(); } finally { MIGRATIONS.pop(); }
    expect(s.migrations().map((m) => m.version)).not.toContain(99);
    expect(() => s.db.prepare('SELECT * FROM ok_part').all()).toThrow();
  });
});
