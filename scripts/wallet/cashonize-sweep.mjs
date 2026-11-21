/* global console, process */
// Round 6: sweeps the Cashonize wallet back to the box test wallet with Cashonize's own Send → max (DRY=1: fill only).
import { chromium } from '@playwright/test';
const TO = 'bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9';
const ctx = await chromium.launchPersistentContext('/home/box/secrets/r6-cashonize-profile', { channel: 'chrome', headless: true, viewport: { width: 1200, height: 1000 } });
const c = ctx.pages()[0] ?? await ctx.newPage();
await c.goto('https://cashonize.com/', { waitUntil: 'domcontentloaded' }); await c.waitForTimeout(15000);
const body = async () => (await c.locator('body').innerText()).replace(/\s+/g, ' ');
console.log('before:', (await body()).slice(0, 300));
await c.locator('input[name=addressInput]').fill(TO);
await c.locator('button.fillInMaxBch').click(); await c.waitForTimeout(1000);
console.log('amount:', await c.locator('input[name=currencyInput]').inputValue());
await c.screenshot({ path: '/workspace/r6/shots/c07-sweep-form.png' });
if (process.env.DRY) { await ctx.close(); process.exit(0); }
await c.locator('input.primaryButton[type=button][value="Send"]').click();
await c.waitForTimeout(3000);
if (await c.locator('.q-dialog').count()) { console.log('dialog:', (await c.locator('.q-dialog').innerText()).replace(/\s+/g, ' ').slice(0, 400)); await c.screenshot({ path: '/workspace/r6/shots/c08-sweep-confirm.png' }); await c.locator('.q-dialog input.primaryButton, .q-dialog button:has-text("Send"), .q-dialog button:has-text("Confirm")').first().click(); }
await c.waitForTimeout(8000);
console.log('notify:', (await c.locator('.q-notification').allInnerTexts()).join(' | '));
await c.screenshot({ path: '/workspace/r6/shots/c09-sweep-sent.png' });
console.log('after:', (await body()).slice(0, 300));
await c.getByText('History', { exact: true }).first().click(); await c.waitForTimeout(4000);
console.log('history:', (await body()).slice(0, 800));
await ctx.close();
