// Captures key screens at 1440x900 into evidence/screenshots/. Needs API + solvers + web running (LOCAL only).
import { chromium } from '@playwright/test';
const WEB = process.env.FUSE_WEB ?? 'http://127.0.0.1:3000';
const API = process.env.FUSE_API ?? 'http://127.0.0.1:8787';
const out = new URL('../../evidence/screenshots/', import.meta.url).pathname;
const j = async <T>(p: string, init?: RequestInit) => (await (await fetch(API + p, init)).json()) as T;

// settle a fresh auction so the execute view has a real flow graph
const a = await j<{ auctionId: string }>('/api/intents/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minOut: '30000', maxIn: '40000000' }) });
for (let i = 0; i < 60; i++) { const s = await j<{ status: string }>(`/api/auctions/${a.auctionId}`); if (['SETTLED', 'FAILED'].includes(s.status)) break; await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const shots: string[] = [];
async function shot(name: string, path: string, prep?: () => Promise<void>) {
  await page.goto(WEB + path, { waitUntil: 'networkidle' });
  if (prep) await prep();
  await page.waitForTimeout(1200);
  const f = `${out}${name}.png`; await page.screenshot({ path: f }); shots.push(f);
}
await shot('01-landing', '/');
await shot('02-execute-flow-graph', `/app/execute/${a.auctionId}`, async () => { await page.getByText('Every arrow is a real input').first().scrollIntoViewIfNeeded().catch(() => {}); await page.mouse.wheel(0, -200); });
await shot('03-solver-auction', '/app/solvers/auctions');
await shot('04-guardian-radar', '/app/guardian');
await shot('05-parallel-worlds', '/app/parallel-worlds', async () => { await page.getByTestId('run-worlds').click(); await page.getByTestId('world-base').waitFor(); });
await shot('06-liquidity', '/app/liquidity');
await shot('07-guardian-rate-optimizer', '/app/guardian/rates');
await shot('08-recipe-marketplace', '/developers/recipes');
await browser.close();
console.log(shots.join('\n'));
