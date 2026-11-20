// F22 notifications: in-app store with dedupe + per-key cooldown, plus external channel adapters (webhook,
// Telegram Bot API, HTTP email API) that are OFF unless the owner configures them. External delivery needs
// BOTH the channel's credentials in the environment AND FUSE_NOTIFY_EXTERNAL=1 (explicit opt-in). Secrets are
// never echoed back in status or delivery records.
import { createHmac } from 'node:crypto';
export type Severity = 'info' | 'warning' | 'critical';
export interface Notification { id: string; at: number; severity: Severity; title: string; body: string; key: string; read: boolean; source: string }
export type ChannelId = 'in-app' | 'webhook' | 'email' | 'telegram';
export type ChannelStatus = 'IMPLEMENTED' | 'CONFIGURED' | 'NOT_CONFIGURED' | 'CONFIGURED_DISABLED';
/** Static default (no configuration). Use `channelStatus(env)` for the live status. */
export const CHANNELS: Record<ChannelId, ChannelStatus> = { 'in-app': 'IMPLEMENTED', webhook: 'NOT_CONFIGURED', email: 'NOT_CONFIGURED', telegram: 'NOT_CONFIGURED' };

export class NotificationCenter {
  private items: Notification[] = [];
  private last = new Map<string, number>();
  private seq = 0;
  constructor(private o: { cooldownMs?: number; max?: number; now?: () => number; onPush?: (n: Notification) => void; onRead?: (id?: string) => void } = {}) {}
  private get now() { return (this.o.now ?? Date.now)(); }
  /** Restore persisted items (newest first) without re-triggering delivery. */
  restore(items: Notification[]) {
    this.items = [...items].sort((a, b) => b.at - a.at);
    for (const i of this.items) { const n = Number(i.id.replace(/^ntf_/, '').split('_')[0]); if (Number.isFinite(n)) this.seq = Math.max(this.seq, n); if (!this.last.has(i.key)) this.last.set(i.key, i.at); }
  }
  /** Returns the notification, or null when deduplicated within the cooldown window. */
  push(n: { severity: Severity; title: string; body: string; key: string; source: string }): Notification | null {
    const t = this.now, prev = this.last.get(n.key);
    if (prev !== undefined && t - prev < (this.o.cooldownMs ?? 10 * 60_000)) return null;
    this.last.set(n.key, t);
    const item: Notification = { ...n, id: `ntf_${++this.seq}_${t.toString(36)}`, at: t, read: false };
    this.items.unshift(item);
    this.items.length = Math.min(this.items.length, this.o.max ?? 500);
    this.o.onPush?.(item);
    return item;
  }
  list(f: { unread?: boolean; severity?: Severity } = {}) { return this.items.filter((i) => (!f.unread || !i.read) && (!f.severity || i.severity === f.severity)); }
  markRead(id?: string) { for (const i of this.items) if (!id || i.id === id) i.read = true; this.o.onRead?.(id); }
  get unread() { return this.items.filter((i) => !i.read).length; }
}

// ---------------- external channel adapters ----------------
export interface Delivery { channel: ChannelId; status: 'SENT' | 'FAILED' | 'SKIPPED'; detail: string }
export interface Adapter { id: ChannelId; minSeverity: Severity; send(n: Notification): Promise<Delivery> }
type Fetch = typeof fetch;
const rank: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const text = (n: Notification) => `[FUSE ${n.severity.toUpperCase()}] ${n.title}\n${n.body}`;
const redact = (s: string, secrets: string[]) => secrets.filter(Boolean).reduce((x, k) => x.split(k).join('***'), s);

/** POSTs the notification as JSON. If a secret is set, adds `x-fuse-signature: sha256=<hex HMAC of body>`. */
export function webhookAdapter(cfg: { url: string; secret?: string; minSeverity?: Severity }, f: Fetch = fetch): Adapter {
  return { id: 'webhook', minSeverity: cfg.minSeverity ?? 'warning', async send(n) {
    const body = JSON.stringify({ schema: 'fuse.notification/v1', id: n.id, at: n.at, severity: n.severity, title: n.title, body: n.body, source: n.source });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.secret) headers['x-fuse-signature'] = 'sha256=' + createHmac('sha256', cfg.secret).update(body).digest('hex');
    try { const r = await f(cfg.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) }); return { channel: 'webhook', status: r.ok ? 'SENT' : 'FAILED', detail: `HTTP ${r.status}` }; }
    catch (e) { return { channel: 'webhook', status: 'FAILED', detail: redact((e as Error).message, [cfg.secret ?? '']) }; }
  } };
}
/** Telegram Bot API sendMessage. */
export function telegramAdapter(cfg: { botToken: string; chatId: string; minSeverity?: Severity; apiBase?: string }, f: Fetch = fetch): Adapter {
  return { id: 'telegram', minSeverity: cfg.minSeverity ?? 'warning', async send(n) {
    const url = `${cfg.apiBase ?? 'https://api.telegram.org'}/bot${cfg.botToken}/sendMessage`;
    try {
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: cfg.chatId, text: text(n), disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      return { channel: 'telegram', status: r.ok && j.ok !== false ? 'SENT' : 'FAILED', detail: redact(`HTTP ${r.status}${j.description ? ' ' + j.description : ''}`, [cfg.botToken]) };
    } catch (e) { return { channel: 'telegram', status: 'FAILED', detail: redact((e as Error).message, [cfg.botToken]) }; }
  } };
}
/** Email through an HTTP email API with a Resend-compatible request shape (POST {from,to,subject,text}, Bearer key). */
export function emailAdapter(cfg: { apiUrl?: string; apiKey: string; from: string; to: string; minSeverity?: Severity }, f: Fetch = fetch): Adapter {
  return { id: 'email', minSeverity: cfg.minSeverity ?? 'critical', async send(n) {
    try {
      const r = await f(cfg.apiUrl ?? 'https://api.resend.com/emails', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject: `[FUSE ${n.severity}] ${n.title}`, text: text(n) }), signal: AbortSignal.timeout(10_000) });
      return { channel: 'email', status: r.ok ? 'SENT' : 'FAILED', detail: `HTTP ${r.status}` };
    } catch (e) { return { channel: 'email', status: 'FAILED', detail: redact((e as Error).message, [cfg.apiKey]) }; }
  } };
}

/** Build adapters from environment variables. Nothing is returned unless FUSE_NOTIFY_EXTERNAL=1. */
export function adaptersFromEnv(env: Record<string, string | undefined>, f: Fetch = fetch): Adapter[] {
  if (env.FUSE_NOTIFY_EXTERNAL !== '1') return [];
  const out: Adapter[] = [];
  if (env.FUSE_WEBHOOK_URL) out.push(webhookAdapter({ url: env.FUSE_WEBHOOK_URL, secret: env.FUSE_WEBHOOK_SECRET }, f));
  if (env.FUSE_TELEGRAM_BOT_TOKEN && env.FUSE_TELEGRAM_CHAT_ID) out.push(telegramAdapter({ botToken: env.FUSE_TELEGRAM_BOT_TOKEN, chatId: env.FUSE_TELEGRAM_CHAT_ID }, f));
  if (env.FUSE_EMAIL_API_KEY && env.FUSE_EMAIL_FROM && env.FUSE_EMAIL_TO) out.push(emailAdapter({ apiUrl: env.FUSE_EMAIL_API_URL, apiKey: env.FUSE_EMAIL_API_KEY, from: env.FUSE_EMAIL_FROM, to: env.FUSE_EMAIL_TO }, f));
  return out;
}
export function channelStatus(env: Record<string, string | undefined>): Record<ChannelId, ChannelStatus> {
  const on = env.FUSE_NOTIFY_EXTERNAL === '1';
  const st = (configured: boolean): ChannelStatus => (!configured ? 'NOT_CONFIGURED' : on ? 'CONFIGURED' : 'CONFIGURED_DISABLED');
  return { 'in-app': 'IMPLEMENTED', webhook: st(!!env.FUSE_WEBHOOK_URL), telegram: st(!!(env.FUSE_TELEGRAM_BOT_TOKEN && env.FUSE_TELEGRAM_CHAT_ID)), email: st(!!(env.FUSE_EMAIL_API_KEY && env.FUSE_EMAIL_FROM && env.FUSE_EMAIL_TO)) };
}

/** Fan out a notification to the adapters whose threshold and the policy's channel list allow it. */
export async function dispatch(n: Notification, adapters: Adapter[], allowed: ChannelId[]): Promise<Delivery[]> {
  const out: Delivery[] = [];
  for (const id of allowed) {
    if (id === 'in-app') { out.push({ channel: 'in-app', status: 'SENT', detail: 'stored' }); continue; }
    const a = adapters.find((x) => x.id === id);
    if (!a) { out.push({ channel: id, status: 'SKIPPED', detail: 'channel not configured (or FUSE_NOTIFY_EXTERNAL≠1)' }); continue; }
    if (rank[n.severity] < rank[a.minSeverity]) { out.push({ channel: id, status: 'SKIPPED', detail: `below ${a.minSeverity} threshold` }); continue; }
    out.push(await a.send(n));
  }
  return out;
}
