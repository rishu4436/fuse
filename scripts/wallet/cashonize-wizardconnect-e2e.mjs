/* global console, process, window, navigator, document */
// Round 6 driver: pairs the real Cashonize wallet (persistent headless Chrome profile outside the repo) with the
// deployed FUSE app over WizardConnect, composes a flash on fuse-live-1, approves the sign request in Cashonize,
// broadcasts through the hosted relay and verifies the certificate. STOP_BEFORE_SIGN=1 stops at the wallet dialog.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const OUT = '/workspace/r6/run.json'; const rec = { startedAt: new Date().toISOString(), events: [] };
const save = () => writeFileSync(OUT, JSON.stringify(rec, null, 1));
const log = (m) => { console.log(new Date().toISOString(), m); rec.events.push([new Date().toISOString(), m]); save(); };
const FUSE = 'https://fusebch.vercel.app';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const fctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await fctx.addInitScript(() => { window.__wiz = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__wiz = t; }, readText: async () => window.__wiz } }); });
const f = await fctx.newPage();
f.on('response', async (r) => { const u = r.url(); if (/\/api\/(live\/prepare|live\/verify-signed|broadcast|live\/certificate)/.test(u) && r.request().method() === 'POST') { try { const body = await r.text(); const key = u.split('/api/')[1]; rec[key] = { status: r.status(), request: r.request().postData(), response: body }; save(); log(`FUSE ${key} → ${r.status()}`); } catch { /* page closed */ } } });
const cctx = await chromium.launchPersistentContext('/home/box/secrets/r6-cashonize-profile', { channel: 'chrome', headless: true, viewport: { width: 1200, height: 1000 } });
const c = cctx.pages()[0] ?? await cctx.newPage();
c.on('console', (m) => { const t = m.text(); log('cashonize console[' + m.type() + ']: ' + t.slice(0, 600)); });
await c.goto('https://cashonize.com/', { waitUntil: 'domcontentloaded' }); await c.waitForTimeout(12000);
await f.goto(FUSE + '/app/execute/live', { waitUntil: 'networkidle' });
await f.getByTestId('wc-connect').click();
await f.getByTestId('wc-qr').waitFor({ timeout: 30000 });
await f.getByRole('button', { name: 'Copy link' }).click();
const uri = await f.evaluate(() => window.__wiz); log('wiz uri obtained: ' + String(uri).slice(0, 12) + '…');
await f.screenshot({ path: '/workspace/r6/shots/f01-pairing.png' });
await c.getByText('Connect', { exact: true }).first().click(); await c.waitForTimeout(1500);
const uriInput = c.locator('input[placeholder]').filter({ visible: true }).last();
await uriInput.fill(uri); await c.screenshot({ path: '/workspace/r6/shots/c04-connect-tab.png' });
await c.locator('input.primaryButton[type=button]').filter({ visible: true }).last().click();
await c.waitForTimeout(4000); await c.screenshot({ path: '/workspace/r6/shots/c05-pairing-dialog.png' });
log('cashonize dialog: ' + (await c.locator('.q-dialog').innerText().catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 400));
await c.locator('.q-dialog input.primaryButton').click();
await f.getByText('protocol').waitFor({ timeout: 60000 });
const conn = (await f.getByTestId('wallet-connect').innerText()).replace(/\s+/g, ' '); log('FUSE connected: ' + conn); rec.connected = conn;
await f.screenshot({ path: '/workspace/r6/shots/f02-connected.png' });
await f.getByTestId('live-action-flash').click();
await f.waitForFunction(() => document.querySelector('[data-testid=live-vault]')?.value?.length > 0, null, { timeout: 60000 });
log('vault: ' + await f.getByTestId('live-vault').inputValue());
await f.getByTestId('live-compose').click();
await f.getByTestId('live-authorization').waitFor({ timeout: 90000 });
log('authorization: ' + (await f.getByTestId('live-authorization').innerText()).replace(/\s+/g, ' '));
log('guardian: ' + await f.getByTestId('live-guardian').innerText());
await f.screenshot({ path: '/workspace/r6/shots/f03-preflight.png', fullPage: true });
await f.getByTestId('live-sign-wc').click();
for (let i = 0; i < 30; i++) { if (await c.locator('.q-dialog').count()) break; const n = await c.locator('.q-notification').allInnerTexts().catch(() => []); if (n.length) log('cashonize notify: ' + n.join(' | ')); const fa = await f.locator('[role=alert]').allInnerTexts(); if (fa.length) log('FUSE alert: ' + fa.join(' | ')); await c.waitForTimeout(2000); }
await c.screenshot({ path: '/workspace/r6/shots/c06a-after-sign-click.png' });
await c.locator('.q-dialog').waitFor({ timeout: 5000 }); await c.waitForTimeout(2500);
log('cashonize sign dialog: ' + (await c.locator('.q-dialog').innerText()).replace(/\s+/g, ' ').slice(0, 1200));
await c.screenshot({ path: '/workspace/r6/shots/c06-sign-request.png', fullPage: true });
if (process.env.STOP_BEFORE_SIGN) { log('stopping before sign'); process.exit(0); }
await c.locator('.q-dialog input.primaryButton').click();
await f.getByTestId('live-verified').waitFor({ timeout: 90000 });
log('verified: ' + await f.getByTestId('live-verified').innerText());
await f.getByTestId('live-broadcast').click();
await f.getByTestId('live-sent').waitFor({ timeout: 60000 });
log('sent: ' + (await f.getByTestId('live-sent').innerText()).replace(/\s+/g, ' '));
await f.screenshot({ path: '/workspace/r6/shots/f04-broadcast.png', fullPage: true });
await cctx.close();
await f.getByTestId('live-certify').and(f.locator(':enabled')).waitFor({ timeout: 45 * 60000 });
await f.getByTestId('live-certify').click();
await f.getByTestId('live-cert').waitFor({ timeout: 120000 });
log('cert: ' + (await f.getByTestId('live-cert').innerText()).replace(/\s+/g, ' ').slice(0, 600));
await f.screenshot({ path: '/workspace/r6/shots/f05-certificate.png', fullPage: true });
await b.close(); log('done');
