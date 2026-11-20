// Persistence for the FUSE API: intents, auctions, certificates, Guardian policies, alerts, the solver
// performance ledger (F32) and the local recipe marketplace (F47). Backed by SQLite through Node's built-in
// `node:sqlite` (no native addon). Schema changes are versioned migrations recorded in `schema_migrations`.
// Postgres was not available on the build box (no docker); the SQL is kept to the portable subset.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
const dec = <T>(s: string): T => JSON.parse(s, (_k, x) => (typeof x === 'string' && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));

export const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  { version: 1, name: 'core tables', sql: `
    CREATE TABLE intents (id TEXT PRIMARY KEY, commitment TEXT NOT NULL, type TEXT NOT NULL, network TEXT NOT NULL, body TEXT NOT NULL, session TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE auctions (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, status TEXT NOT NULL, winner_solver TEXT, txid TEXT, summary TEXT NOT NULL, session TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE certificates (id TEXT PRIMARY KEY, txid TEXT NOT NULL, network TEXT NOT NULL, simulated INTEGER NOT NULL, body TEXT NOT NULL, session TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE policies (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, key TEXT NOT NULL, severity TEXT NOT NULL, body TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE solvers (id TEXT PRIMARY KEY, pubkey TEXT NOT NULL, strategy TEXT NOT NULL, name TEXT NOT NULL, registered_at INTEGER NOT NULL);
    CREATE TABLE solver_ledger (seq INTEGER PRIMARY KEY AUTOINCREMENT, solver_id TEXT NOT NULL, auction_id TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, user_net_spend_sats TEXT, improvement_sats TEXT, revenue_sats TEXT, latency_ms INTEGER, session TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX solver_ledger_solver ON solver_ledger(solver_id, at);
  ` },
  { version: 2, name: 'recipe marketplace + notification deliveries', sql: `
    CREATE TABLE recipes (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, author_pubkey TEXT NOT NULL, signature TEXT NOT NULL, body TEXT NOT NULL, verdict TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE deliveries (seq INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);
  ` },
  { version: 3, name: 'LP vault health snapshots (F40)', sql: `
    CREATE TABLE vault_snapshots (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, event TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX vault_snapshots_session ON vault_snapshots(session, seq);
  ` },
];

export type LedgerOutcome = 'WIN' | 'LOSS' | 'REJECTED' | 'LEASE_CONFLICT' | 'FALLBACK' | 'SETTLE_FAILED';
export interface LedgerRow { solverId: string; auctionId: string; outcome: LedgerOutcome; reason?: string; userNetSpendSats?: bigint; improvementSats?: bigint; revenueSats?: bigint; latencyMs?: number; at: number }

export class FuseStore {
  readonly db: DatabaseSync;
  constructor(readonly path: string, readonly session = `s_${Date.now().toString(36)}`) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }
  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    const have = new Set((this.db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (have.has(m.version)) continue;
      this.db.exec('BEGIN');
      try { this.db.exec(m.sql); this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(m.version, m.name, Date.now()); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }
  migrations() { return this.db.prepare('SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string; appliedAt: number }>; }
  close() { this.db.close(); }

  // ---- intents / auctions / certificates ----
  putIntent(i: { id: string; commitment: string; type: string; network: string; body: unknown }) {
    this.db.prepare('INSERT OR REPLACE INTO intents VALUES (?, ?, ?, ?, ?, ?, ?)').run(i.id, i.commitment, i.type, i.network, enc(i.body), this.session, Date.now());
  }
  listIntents(limit = 100) { return (this.db.prepare('SELECT id, commitment, type, network, body, session, created_at AS createdAt FROM intents ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>).map((r) => ({ ...r, body: dec(r.body as string), restored: r.session !== this.session })); }
  putAuction(a: { id: string; intentId: string; status: string; winnerSolver?: string; txid?: string; summary: unknown }) {
    this.db.prepare('INSERT OR REPLACE INTO auctions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(a.id, a.intentId, a.status, a.winnerSolver ?? null, a.txid ?? null, enc(a.summary), this.session, Date.now());
  }
  listAuctions(limit = 100) { return (this.db.prepare('SELECT * FROM auctions ORDER BY updated_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>).map((r) => ({ id: r.id, intentId: r.intent_id, status: r.status, winnerSolver: r.winner_solver, txid: r.txid, summary: dec(r.summary as string), restored: r.session !== this.session, updatedAt: r.updated_at })); }
  putCertificate(c: { certificateId: string; network: string; simulated: boolean; transactions: Array<{ txid: string }> }) {
    this.db.prepare('INSERT OR REPLACE INTO certificates VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.certificateId, c.transactions[0]?.txid ?? '', c.network, c.simulated ? 1 : 0, enc(c), this.session, Date.now());
  }
  listCertificates<T>(): Array<{ certificate: T; restored: boolean }> { return (this.db.prepare('SELECT body, session FROM certificates ORDER BY created_at DESC').all() as Array<{ body: string; session: string }>).map((r) => ({ certificate: dec<T>(r.body), restored: r.session !== this.session })); }

  // ---- Guardian policies + alerts ----
  putPolicy(p: { id: string; createdAt: number }) { this.db.prepare('INSERT OR REPLACE INTO policies VALUES (?, ?, ?, NULL)').run(p.id, enc(p), p.createdAt); }
  deletePolicy(id: string) { return Number(this.db.prepare('UPDATE policies SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(Date.now(), id).changes) > 0; }
  listPolicies<T>(): T[] { return (this.db.prepare('SELECT body FROM policies WHERE deleted_at IS NULL ORDER BY created_at').all() as Array<{ body: string }>).map((r) => dec<T>(r.body)); }
  putAlert(n: { id: string; key: string; severity: string; at: number; read: boolean }) { this.db.prepare('INSERT OR REPLACE INTO alerts VALUES (?, ?, ?, ?, ?, ?)').run(n.id, n.key, n.severity, enc(n), n.read ? 1 : 0, n.at); }
  markAlertsRead(id?: string) { if (id) this.db.prepare('UPDATE alerts SET read = 1 WHERE id = ?').run(id); else this.db.exec('UPDATE alerts SET read = 1'); }
  listAlerts<T>(limit = 500): T[] { return (this.db.prepare('SELECT body, read FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{ body: string; read: number }>).map((r) => ({ ...dec<Record<string, unknown>>(r.body), read: r.read === 1 }) as T); }
  putDelivery(d: { alertId: string; channel: string; status: string; detail?: string }) { this.db.prepare('INSERT INTO deliveries (alert_id, channel, status, detail, at) VALUES (?, ?, ?, ?, ?)').run(d.alertId, d.channel, d.status, d.detail ?? null, Date.now()); }
  listDeliveries(limit = 100) { return this.db.prepare('SELECT alert_id AS alertId, channel, status, detail, at FROM deliveries ORDER BY seq DESC LIMIT ?').all(limit); }

  // ---- solvers + performance ledger (F32) ----
  putSolver(s: { solverId: string; pubkey: string; strategy: string; name: string; registeredAt: number }) { this.db.prepare('INSERT OR IGNORE INTO solvers VALUES (?, ?, ?, ?, ?)').run(s.solverId, s.pubkey, s.strategy, s.name, s.registeredAt); }
  listSolvers() { return this.db.prepare('SELECT id AS solverId, pubkey, strategy, name, registered_at AS registeredAt FROM solvers').all() as Array<{ solverId: string; pubkey: string; strategy: string; name: string; registeredAt: number }>; }
  appendLedger(r: LedgerRow) {
    this.db.prepare('INSERT INTO solver_ledger (solver_id, auction_id, outcome, reason, user_net_spend_sats, improvement_sats, revenue_sats, latency_ms, session, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.solverId, r.auctionId, r.outcome, r.reason ?? null, r.userNetSpendSats?.toString() ?? null, r.improvementSats?.toString() ?? null, r.revenueSats?.toString() ?? null, r.latencyMs ?? null, this.session, r.at);
  }
  ledger(solverId?: string, limit = 200): LedgerRow[] {
    const rows = (solverId ? this.db.prepare('SELECT * FROM solver_ledger WHERE solver_id = ? ORDER BY seq DESC LIMIT ?').all(solverId, limit) : this.db.prepare('SELECT * FROM solver_ledger ORDER BY seq DESC LIMIT ?').all(limit)) as Array<Record<string, string | number | null>>;
    const big = (v: unknown) => (v == null ? undefined : BigInt(v as string));
    return rows.map((r) => ({ solverId: r.solver_id as string, auctionId: r.auction_id as string, outcome: r.outcome as LedgerOutcome, reason: (r.reason as string) ?? undefined, userNetSpendSats: big(r.user_net_spend_sats), improvementSats: big(r.improvement_sats), revenueSats: big(r.revenue_sats), latencyMs: (r.latency_ms as number) ?? undefined, at: r.at as number }));
  }
  /** F32 performance per solver, computed from the append-only ledger (never from solver claims). */
  performance() {
    const rows = this.db.prepare(`SELECT solver_id AS solverId, COUNT(*) AS bids,
        SUM(outcome = 'WIN') AS wins, SUM(outcome = 'LOSS') AS losses, SUM(outcome = 'REJECTED') AS rejected,
        SUM(outcome = 'LEASE_CONFLICT') AS leaseConflicts, SUM(outcome = 'FALLBACK') AS fallbacks, SUM(outcome = 'SETTLE_FAILED') AS settleFailed,
        AVG(latency_ms) AS avgLatencyMs, MAX(at) AS lastAt FROM solver_ledger GROUP BY solver_id`).all() as Array<Record<string, number | string>>;
    return rows.map((r) => {
      const mine = this.ledger(r.solverId as string, 10_000);
      const revenue = mine.reduce((s, x) => s + (x.outcome === 'WIN' ? x.revenueSats ?? 0n : 0n), 0n);
      const improvement = mine.reduce((s, x) => s + (x.outcome === 'WIN' ? x.improvementSats ?? 0n : 0n), 0n);
      const reasons = new Map<string, number>();
      for (const x of mine) if (x.outcome === 'REJECTED' && x.reason) { const k = x.reason.split(':')[0].replace(/\d+/g, 'N').slice(0, 60); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
      const bids = Number(r.bids), wins = Number(r.wins);
      return { solverId: r.solverId as string, bids, wins, losses: Number(r.losses), rejected: Number(r.rejected), leaseConflicts: Number(r.leaseConflicts), fallbacks: Number(r.fallbacks), settleFailed: Number(r.settleFailed),
        winRateBps: bids ? Math.round((wins * 10_000) / bids) : 0, validityRateBps: bids ? Math.round(((bids - Number(r.rejected)) * 10_000) / bids) : 0,
        avgLatencyMs: r.avgLatencyMs == null ? null : Math.round(Number(r.avgLatencyMs)), revenueSats: revenue, userImprovementSats: improvement,
        topRejections: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })), lastAt: Number(r.lastAt) };
    });
  }

  // ---- recipe marketplace (F47) ----
  putRecipe(r: { id: string; hash: string; authorPubkey: string; signature: string; body: unknown; verdict: unknown }) {
    this.db.prepare('INSERT INTO recipes VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.id, r.hash, r.authorPubkey, r.signature, enc(r.body), enc(r.verdict), Date.now());
  }
  listRecipes() { return (this.db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all() as Array<Record<string, string | number>>).map((r) => ({ id: r.id as string, hash: r.hash as string, authorPubkey: r.author_pubkey as string, signature: r.signature as string, body: dec(r.body as string), verdict: dec(r.verdict as string), createdAt: r.created_at as number })); }
  putVaultSnapshot(event: string, body: unknown) { this.db.prepare('INSERT INTO vault_snapshots (session, event, body, at) VALUES (?, ?, ?, ?)').run(this.session, event, enc(body), Date.now()); }
  listVaultSnapshots<T = unknown>(o: { session?: string; limit?: number } = {}) { return (this.db.prepare('SELECT * FROM vault_snapshots WHERE session = ? ORDER BY seq DESC LIMIT ?').all(o.session ?? this.session, o.limit ?? 500) as Array<Record<string, string | number>>).reverse().map((r) => ({ seq: r.seq as number, event: r.event as string, at: r.at as number, body: dec(r.body as string) as T })); }
  getRecipe(id: string) { return this.listRecipes().find((r) => r.id === id || r.hash === id); }
}
