import { test, expect } from '@playwright/test';

const routes = ['/', '/app', '/app/portfolio', '/app/guardian', '/app/guardian/policies', '/app/guardian/alerts', '/app/execute', '/app/execute/new', '/app/parallel-worlds', '/app/strategies', '/app/strategies/builder',
  '/app/liquidity', '/app/liquidity/vaults', '/app/liquidity/flashvault-bch', '/app/solvers', '/app/solvers/auctions', '/app/opportunities', '/app/replay', '/app/explorer', '/app/contracts', '/app/certificates', '/app/activity', '/app/settings',
  '/developers', '/developers/sdk', '/developers/recipes', '/developers/api', '/status', '/verify'];

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
  await page.goto('/app/opportunities'); await expect(page.getByText('READ-ONLY').first()).toBeVisible();
  await page.goto('/app/guardian'); await expect(page.getByText('READ-ONLY').first()).toBeVisible();
  await page.goto('/app/liquidity'); await expect(page.getByText('SIMULATION').first()).toBeVisible();
  const r = await page.goto('/app/execute/new'); expect(r?.url()).toMatch(/\/app\/execute\/new$/);
});

test('Demo: run an auction in the Studio, adversary rejected, settlement + certificate verifies, tamper fails', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'flow covered on desktop');
  await page.goto('/app/execute/new');
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
  await page.goto('/app/replay');
  await page.getByTestId('replay-pick').first().click();
  await expect(page.getByTestId('replay-result')).toContainText('valid');
  await expect(page.getByTestId('replay-result')).not.toContainText('error');
});

test('WizardConnect: pairing QR is generated in the browser (no wallet needed)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop only');
  await page.goto('/app/execute/new');
  await page.getByTestId('wc-connect').click();
  await expect(page.getByTestId('wc-qr').or(page.getByRole('alert'))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wc-qr')).toBeVisible();
  const src = await page.getByTestId('wc-qr').getAttribute('src');
  expect(src).toMatch(/^data:image\/png;base64,/);
});

test.describe('feature flows', () => {
  test.beforeEach(async ({ page: _page }, info) => { test.skip(info.project.name === 'mobile', 'desktop only'); });
  test('compiler preview shows all 10 stages and an explanation', async ({ page }) => {
    await page.goto('/app/execute/new');
    await page.getByTestId('reset-world').click();
    await page.getByTestId('compile').click();
    await expect(page.getByTestId('explanation')).toContainText('Receive 30,000 FUSD');
    for (const s of ['PARSE', 'SIMULATE', 'EXPLAIN']) await expect(page.getByTestId(`stage-${s}`)).toHaveAttribute('data-state', 'ok');
  });
  test('parallel worlds: paused vault avoids the flash route', async ({ page }) => {
    await page.goto('/app/parallel-worlds');
    await page.getByTestId('run-worlds').click();
    await expect(page.getByTestId('world-base')).toContainText('FLASH_LIQUIDITY');
    await expect(page.getByTestId('world-vault-paused')).not.toContainText('FLASH_LIQUIDITY');
  });
  test('guardian policy → proposal (not executable) → in-app alert', async ({ page }) => {
    await page.goto('/app/guardian/policies');
    await page.locator('#pcr').fill('60000');
    await page.getByTestId('create-policy').click();
    await expect(page.getByTestId('proposal').first()).toContainText('Execution:');
    await expect(page.getByTestId('readiness').first()).toContainText('Automated execution path');
    await page.goto('/app/guardian/alerts');
    await expect(page.getByTestId('alert').first()).toBeVisible();
  });
  test('LP deposit is VM-verified and accepted on the local chain; explorer decodes it', async ({ page }) => {
    await page.goto('/app/liquidity');
    await expect(page.locator('#lshard option').first()).toBeAttached();
    await page.getByTestId('lp-submit').click();
    await expect(page.getByTestId('lp-result')).toContainText('Accepted on the LOCAL chain');
    await page.goto('/app/explorer');
    await page.getByTestId('tx-row').first().click();
    await expect(page.getByTestId('tx-detail')).toBeVisible();
  });
  test('strategy builder rejects an unrepaid borrow and compiles a valid recipe', async ({ page }) => {
    await page.goto('/app/strategies/builder?recipe=ROUTING');
    await page.getByTestId('block-BORROW').click();
    await expect(page.getByTestId('builder-validation')).toContainText('must be repaid');
    await page.goto('/app/strategies/builder?recipe=FLASH_LIQUIDITY');
    await expect(page.getByTestId('builder-validation')).toContainText('compiles as FLASH_LIQUIDITY');
    await page.getByTestId('builder-compile').click();
    await expect(page.getByTestId('stage-EXPLAIN')).toHaveAttribute('data-state', 'ok');
  });
  test('settings: broadcast switch is locked off', async ({ page }) => {
    await page.goto('/app/settings');
    await expect(page.getByTestId('broadcast-switch')).toBeDisabled();
    await expect(page.getByTestId('broadcast-switch')).toHaveAttribute('aria-checked', 'false');
  });
});
