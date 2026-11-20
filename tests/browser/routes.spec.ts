import { test, expect } from '@playwright/test';

const routes = ['/', '/studio', '/auctions', '/solvers', '/vault', '/certificates', '/verify', '/mainnet', '/guardian', '/status', '/activity'];

for (const r of routes) {
  test(`route ${r} renders without errors and is labeled`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/EventSource|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (res) => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`); });
    const res = await page.goto(r);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByText('FUSE API unreachable')).toHaveCount(0);
    expect(errors).toEqual([]);
    if (process.env.SHOTS) await page.screenshot({ path: `test-results/shots/${test.info().project.name}${r === '/' ? '-home' : r.replaceAll('/', '-')}.png`, fullPage: true });
  });
}

test('mainnet pages are labeled READ-ONLY and simulation pages SIMULATION', async ({ page }) => {
  await page.goto('/mainnet'); await expect(page.getByText('READ-ONLY').first()).toBeVisible();
  await page.goto('/guardian'); await expect(page.getByText('READ-ONLY').first()).toBeVisible();
  await page.goto('/vault'); await expect(page.getByText('SIMULATION').first()).toBeVisible();
});

test('Demo: run an auction in the Studio, adversary rejected, settlement + certificate verifies, tamper fails', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'flow covered on desktop');
  await page.goto('/studio');
  await page.getByTestId('reset-world').click();
  await page.waitForTimeout(300);
  await page.getByTestId('submit-intent').click();
  await expect(page.getByText('Settled', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bid-ADVERSARIAL_FIXTURE')).toContainText('Rejected');
  await expect(page.getByTestId('rejection').first()).toContainText('minOut');
  await expect(page.getByTestId('bid-FLASH_LIQUIDITY')).toContainText('Winner');
  await expect(page.getByRole('img', { name: /Transaction graph/ })).toBeVisible();
  await page.waitForTimeout(2000);
  if (process.env.SHOTS) await page.screenshot({ path: 'test-results/shots/desktop-studio-settled.png', fullPage: true });
  await page.getByText('Open certificate →').click();
  await page.getByTestId('verify').click();
  await expect(page.getByTestId('verify-result')).toContainText('VERIFIED');
  await page.getByTestId('tamper').click();
  await expect(page.getByTestId('verify-result')).toContainText('FAILED');
  if (process.env.SHOTS) await page.screenshot({ path: 'test-results/shots/desktop-certificate.png', fullPage: true });
});

test('WizardConnect: pairing QR is generated in the browser (no wallet needed)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop only');
  await page.goto('/studio');
  await page.getByTestId('wc-connect').click();
  await expect(page.getByTestId('wc-qr').or(page.getByRole('alert'))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wc-qr')).toBeVisible();
  const src = await page.getByTestId('wc-qr').getAttribute('src');
  expect(src).toMatch(/^data:image\/png;base64,/);
});
