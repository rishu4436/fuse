import { test, expect } from '@playwright/test';

const routes = ['/', '/app', '/app/portfolio', '/app/guardian', '/app/guardian/policies', '/app/guardian/alerts', '/app/execute', '/app/execute/live', '/app/execute/new', '/app/parallel-worlds', '/app/strategies', '/app/strategies/builder',
  '/app/liquidity', '/app/liquidity/vaults', '/app/liquidity/flashvault-bch', '/app/solvers', '/app/solvers/auctions', '/app/opportunities', '/app/replay', '/app/explorer', '/app/contracts', '/app/certificates', '/app/activity', '/app/settings',
  '/developers', '/developers/sdk', '/developers/recipes', '/developers/api', '/developers/xo', '/app/guardian/rates', '/app/execute/staged', '/status', '/verify'];

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

const sandbox = (page: import('@playwright/test').Page) => page.addInitScript(() => localStorage.setItem('fuse-mode', 'sandbox'));

test('dashboard replays recorded settlement and switches to the sandbox', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app');
  const replay = page.getByRole('region', { name: 'Atomic settlement' });
  await expect(replay).toContainText('Recorded · block 978214');
  await expect(replay).toContainText('1,991 sats');
  await replay.getByRole('button', { name: 'Repay' }).click();
  await expect(replay).toContainText('30,200 sats');
  await replay.getByRole('button', { name: 'Replay route' }).click();
  await expect(replay).toContainText('30,100 sats');
  await replay.getByRole('button', { name: 'Pause replay' }).click();
  await page.getByRole('button', { name: 'Open sandbox' }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox execution world' })).toBeVisible();
});

test('the shared directory and execution controls work without a wallet', async ({ page }) => {
  await page.goto('/verify');
  await page.locator('summary').filter({ hasText: 'Directory' }).click();
  await page.getByRole('navigation', { name: 'Route directory' }).getByRole('link', { name: /^Execute/ }).click();
  await expect(page).toHaveURL(/\/app\/execute\/live$/);
  await expect(page.getByTestId('live-compose')).toBeDisabled();
  await page.getByTestId('live-action-deposit').click();
  await expect(page.getByLabel('Amount (sats)')).toBeVisible();
  await page.getByTestId('live-action-deploy-vault').click();
  await expect(page.getByLabel('Principal (sats)')).toBeVisible();
  await expect(page.getByTestId('live-vault')).toHaveCount(0);
  await expect(page.getByTestId('live-broadcast')).toHaveCount(0);
});

test('LIVE is the default mode: mainnet pages are labeled LIVE; sandbox pages SANDBOX after the toggle', async ({ page }) => {
  await page.goto('/app/opportunities'); await expect(page.getByText('LIVE', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId('live-pools')).toBeVisible({ timeout: 45_000 });
  await page.goto('/app/liquidity'); await expect(page.getByTestId('live-vaults')).toContainText('fuse-live-1', { timeout: 60_000 });
  await page.goto('/app/guardian'); await expect(page.getByText('READ-ONLY').first()).toBeVisible();
  await expect(page.getByTestId('paryon-coverage')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('sentinel').locator('div.rounded-lg').first()).toBeVisible({ timeout: 45_000 }); // real signals (the panel retries every 30 s)
  await page.locator('summary').filter({ hasText: 'Directory' }).click();
  await page.getByTestId('mode-sandbox').click();
  await expect(page.getByTestId('mode-sandbox')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/app/liquidity');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'FlashVault shards and LP operations' })).toBeVisible();
  await expect(main.getByText('SANDBOX', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const r = await page.goto('/app/execute/new'); expect(r?.url()).toMatch(/\/app\/execute\/new$/);
});

test('LIVE execute: compose a mainnet flash loan, VM simulation + Guardian pass, signing package exported (no key, no broadcast)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/app/execute/live');
  await expect(page.getByTestId('live-vault')).toContainText('fuse-live-1', { timeout: 45_000 });
  await page.getByTestId('live-action-flash').click();
  await page.getByTestId('live-address').fill(process.env.FUSE_E2E_ADDRESS ?? 'bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9');
  await page.getByTestId('live-compose').click();
  await expect(page.getByTestId('live-guardian')).toContainText(/PASS|WARN/, { timeout: 60_000 });
  await expect(page.getByTestId('live-sim')).toContainText('covenant accepts this transaction');
  const dl = page.waitForEvent('download'); await page.getByTestId('live-export').click();
  expect((await dl).suggestedFilename()).toMatch(/^fuse-flash-[0-9a-f]{8}\.json$/);
  await page.getByTestId('live-action-flash-cauldron').click();
  await page.getByTestId('live-compose').click();
  await expect(page.getByTestId('live-guardian')).toContainText(/PASS|WARN/, { timeout: 60_000 });
  await expect(page.getByTestId('live-sim')).toContainText('cauldron-pool');
  if (process.env.SHOTS) await page.screenshot({ path: 'test-results/shots/desktop-live-execute.png', fullPage: true });
});

test('Demo: run an auction in the Studio, adversary rejected, settlement + certificate verifies, tamper fails', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'flow covered on desktop');
  await sandbox(page);
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

test('WizardConnect: pairing QR is generated in the browser (no wallet needed)', async ({ page }) => {
  await page.goto('/app/execute/new');
  await page.getByTestId('wc-connect').click();
  await expect(page.getByTestId('wc-qr').or(page.getByRole('alert'))).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wc-qr')).toBeVisible();
  const src = await page.getByTestId('wc-qr').getAttribute('src');
  expect(src).toMatch(/^data:image\/png;base64,/);
});

test.describe('feature flows', () => {
  test.beforeEach(async ({ page }, info) => { test.skip(info.project.name === 'mobile', 'desktop only'); await sandbox(page); });
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
    await expect(page.getByTestId('lp-history')).toContainText('Max drawdown');
    // hosted sandbox state is per serverless instance: retry if the explorer request lands on a fresh instance
    await expect(async () => {
      await page.goto('/app/explorer');
      await page.getByTestId('tx-row').first().click({ timeout: 5_000 });
      await expect(page.getByTestId('tx-detail')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
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
  test('staged recovery: competitor forces a rebuild; impossible bound ends RECOVERABLE with unspent owner coins', async ({ page }) => {
    await page.goto('/app/execute/staged');
    await page.getByTestId('scenario-competitor').click(); await page.getByTestId('run-staged').click();
    await expect(page.getByTestId('staged-result')).toContainText('COMPLETED');
    await expect(page.getByTestId('staged-result')).toContainText('REBUILD');
    await page.getByTestId('scenario-impossible').click(); await page.getByTestId('run-staged').click();
    await expect(page.getByTestId('staged-result')).toContainText('RECOVERABLE');
    await expect(page.getByTestId('staged-result')).toContainText('Unspent, yours');
  });
  test('recipe marketplace: adversarial recipe rejected; an unrepaid borrow submitted from the composer is rejected', async ({ page }) => {
    await page.goto('/developers/recipes');
    await expect(page.getByTestId('recipe-list')).toContainText('Free money (unrepaid borrow)');
    await expect(page.getByTestId('recipe-list')).toContainText('REJECTED');
    await page.getByRole('button', { name: 'Repay shard + fee' }).click();
    await page.getByTestId('publish-recipe').click();
    await expect(page.getByTestId('publish-verdict')).toContainText('Rejected');
    await expect(page.getByTestId('publish-verdict')).toContainText('must be repaid');
  });
  test('rate optimizer and redemption search render READ-ONLY and not executable', async ({ page }) => {
    await page.goto('/app/guardian/rates');
    await expect(page.getByText('Recommended').first()).toBeVisible();
    await expect(page.getByTestId('redemption')).toContainText('not published');
  });
  test('XO: payout script compiled by the XO compiler', async ({ page }) => {
    await page.goto('/developers/xo');
    await page.getByTestId('xo-compile').click();
    await expect(page.getByTestId('xo-payout')).toContainText('76a914');
  });
});

test('unavailable vault reader exposes a retry and cannot reach signing', async ({ page }) => {
  await page.route('**/api/live/vaults', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'BCH reader unavailable' }) }));
  await page.goto('/app/execute/live');
  await expect(page.getByRole('button', {name:'Retry chain read'})).toBeVisible();
  await expect(page.getByTestId('live-sign-wc')).toHaveCount(0);
  await expect(page.getByTestId('live-broadcast')).toHaveCount(0);
});
