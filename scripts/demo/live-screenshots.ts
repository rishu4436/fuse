// Captures the LIVE (mainnet) screens of the hosted app at 1440x900 into evidence/screenshots/live-*.png.
// Read-only: composes a flash loan preflight (no signing, no broadcast) and verifies an existing certificate.
import { chromium } from '@playwright/test';
const WEB = process.env.FUSE_WEB ?? 'https://fusebch.vercel.app';
const ADDR = process.env.FUSE_E2E_ADDRESS ?? 'bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9';
const CERT = process.argv[2];
const out = new URL('../../evidence/screenshots/', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const shots: string[] = [];
async function shot(name: string, path: string, prep?: () => Promise<void>, full = false) {
  await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (prep) await prep();
  await page.waitForTimeout(1500);
  const f = `${out}${name}.png`; await page.screenshot({ path: f, fullPage: full }); shots.push(f);
}
await shot('live-01-landing', '/', async () => { await page.getByText('Principal').first().waitFor(); });
await shot('live-02-overview', '/app', async () => { await page.getByTestId('live-overview').waitFor(); await page.waitForTimeout(4000); });
await shot('live-03-execute-flash-preflight', '/app/execute/live', async () => {
  await page.getByTestId('live-vault').getByText(/fuse-live-1/).waitFor({ state: 'attached', timeout: 60_000 });
  await page.getByTestId('live-action-flash').click();
  await page.getByTestId('live-address').fill(ADDR);
  await page.getByTestId('live-compose').click();
  await page.getByTestId('live-guardian').or(page.getByRole('alert')).first().waitFor({ timeout: 60_000 });
}, true);
await shot('live-04-execute-flash-cauldron-preflight', '/app/execute/live', async () => {
  await page.getByTestId('live-vault').getByText(/fuse-live-1/).waitFor({ state: 'attached', timeout: 60_000 });
  await page.getByTestId('live-action-flash-cauldron').click();
  await page.getByTestId('live-address').fill(ADDR);
  await page.getByTestId('live-compose').click();
  await page.getByTestId('live-guardian').or(page.getByRole('alert')).first().waitFor({ timeout: 60_000 });
}, true);
await shot('live-05-flashvault', '/app/liquidity', async () => { await page.getByTestId('live-vaults').waitFor(); await page.getByText('fuse-live-1').first().waitFor({ timeout: 60_000 }); }, true);
await shot('live-06-cauldron-pools', '/app/opportunities', async () => { await page.getByTestId('live-pools').waitFor({ timeout: 60_000 }); });
await shot('live-07-guardian', '/app/guardian', async () => { await page.waitForTimeout(8000); });
if (CERT) await shot('live-08-certificate-verified', '/app/certificates', async () => {
  await page.getByPlaceholder('any FUSE mainnet txid').fill(CERT);
  await page.getByRole('button', { name: 'Verify' }).last().click();
  await page.getByTestId('live-cert-result').waitFor({ timeout: 90_000 });
});
await browser.close();
console.log(shots.join('\n'));
