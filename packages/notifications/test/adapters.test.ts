import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { NotificationCenter, adaptersFromEnv, channelStatus, dispatch, webhookAdapter, telegramAdapter, emailAdapter, type Notification } from '../src/index.js';

const calls: Array<{ url: string; init: RequestInit }> = [];
const fakeFetch = (status = 200, json: unknown = { ok: true }) => (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(json), { status }); }) as unknown as typeof fetch;
const n: Notification = { id: 'ntf_1_x', at: 1, severity: 'critical', title: 'Loan CR 118%', body: 'Top up 0.4 BCH proposed (not executable)', key: 'k', read: false, source: 'guardian' };

describe('F22 notification channels', () => {
  it('nothing external is built or sent without FUSE_NOTIFY_EXTERNAL=1, even with credentials', async () => {
    calls.length = 0;
    const env = { FUSE_TELEGRAM_BOT_TOKEN: '123:SECRET', FUSE_TELEGRAM_CHAT_ID: '42', FUSE_WEBHOOK_URL: 'https://hooks.example.test/x' };
    expect(adaptersFromEnv(env, fakeFetch())).toHaveLength(0);
    expect(channelStatus(env)).toEqual({ 'in-app': 'IMPLEMENTED', webhook: 'CONFIGURED_DISABLED', telegram: 'CONFIGURED_DISABLED', email: 'NOT_CONFIGURED' });
    const d = await dispatch(n, adaptersFromEnv(env, fakeFetch()), ['in-app', 'telegram', 'webhook']);
    expect(d.map((x) => x.status)).toEqual(['SENT', 'SKIPPED', 'SKIPPED']);
    expect(calls).toHaveLength(0);
  });
  it('webhook signs the exact body with HMAC-SHA256; telegram and email use their API shapes; secrets are redacted', async () => {
    calls.length = 0;
    const env = { FUSE_NOTIFY_EXTERNAL: '1', FUSE_TELEGRAM_BOT_TOKEN: '123:SECRET', FUSE_TELEGRAM_CHAT_ID: '42', FUSE_WEBHOOK_URL: 'https://hooks.example.test/x', FUSE_WEBHOOK_SECRET: 'whsec', FUSE_EMAIL_API_KEY: 'ekey', FUSE_EMAIL_FROM: 'fuse@example.test', FUSE_EMAIL_TO: 'owner@example.test' };
    const ads = adaptersFromEnv(env, fakeFetch());
    expect(ads.map((a) => a.id).sort()).toEqual(['email', 'telegram', 'webhook']);
    const d = await dispatch(n, ads, ['webhook', 'telegram', 'email']);
    expect(d.every((x) => x.status === 'SENT')).toBe(true);
    const wh = calls.find((c) => c.url === 'https://hooks.example.test/x')!;
    const sig = (wh.init.headers as Record<string, string>)['x-fuse-signature'];
    expect(sig).toBe('sha256=' + createHmac('sha256', 'whsec').update(wh.init.body as string).digest('hex'));
    const tg = calls.find((c) => c.url.includes('api.telegram.org'))!;
    expect(tg.url).toBe('https://api.telegram.org/bot123:SECRET/sendMessage');
    expect(JSON.parse(tg.init.body as string)).toMatchObject({ chat_id: '42' });
    const em = calls.find((c) => c.url.includes('resend'))!;
    expect((em.init.headers as Record<string, string>).authorization).toBe('Bearer ekey');
    // failures never leak the token
    const bad = telegramAdapter({ botToken: '999:TOPSECRET', chatId: '1' }, (async () => { throw new Error('connect ECONNREFUSED https://api.telegram.org/bot999:TOPSECRET/sendMessage'); }) as unknown as typeof fetch);
    const r = await bad.send(n);
    expect(r.status).toBe('FAILED'); expect(r.detail).not.toContain('TOPSECRET');
    expect(JSON.stringify(channelStatus(env))).not.toContain('SECRET');
  });
  it('severity thresholds and HTTP failures are reported, not hidden', async () => {
    const info = { ...n, severity: 'info' as const };
    const d = await dispatch(info, [webhookAdapter({ url: 'https://h.test' }, fakeFetch())], ['webhook']);
    expect(d[0]).toMatchObject({ status: 'SKIPPED', detail: 'below warning threshold' });
    const e = await emailAdapter({ apiKey: 'k', from: 'a@b.test', to: 'c@d.test' }, fakeFetch(500)).send(n);
    expect(e).toMatchObject({ status: 'FAILED', detail: 'HTTP 500' });
  });
  it('restores persisted items and keeps dedupe across restarts', () => {
    const pushed: Notification[] = [];
    const a = new NotificationCenter({ cooldownMs: 60_000, now: () => 1_000, onPush: (x) => pushed.push(x) });
    a.push({ severity: 'warning', title: 't', body: 'b', key: 'loan:r1', source: 'guardian' });
    const b = new NotificationCenter({ cooldownMs: 60_000, now: () => 2_000 });
    b.restore(pushed);
    expect(b.list()).toHaveLength(1);
    expect(b.push({ severity: 'warning', title: 't', body: 'b', key: 'loan:r1', source: 'guardian' })).toBeNull();
    expect(b.push({ severity: 'warning', title: 't2', body: 'b', key: 'loan:r2', source: 'guardian' })!.id).not.toBe(pushed[0].id);
  });
});
