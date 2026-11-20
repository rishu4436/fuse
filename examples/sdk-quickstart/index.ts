// Standalone FUSE SDK quickstart. Run the API and solvers first (`pnpm dev:api`, `pnpm solvers`), then:
//   FUSE_API=http://127.0.0.1:8787 pnpm --filter fuse-sdk-quickstart start
// Everything happens on the LOCAL simulated chain (real BCH VM, simulated coins). Nothing touches mainnet.
import { FuseClient } from '@fuse/sdk';

export async function quickstart(baseUrl = process.env.FUSE_API ?? 'http://127.0.0.1:8787', o: { settle?: boolean; log?: (s: string) => void } = {}) {
  const log = o.log ?? console.log;
  const fuse = new FuseClient(baseUrl);
  const h = await fuse.health();
  log(`connected: network=${h.network} simulated=${h.simulated} mainnetBroadcast=${h.mainnetBroadcast}`);
  const plan = await fuse.compile(await fuse.draftSwap({ minOut: 30_000n }));
  log(`compiled: ${plan.stages.filter((s) => s.ok).length}/${plan.stages.length} stages · best ${plan.selected?.strategy} · ${plan.explanation?.headline}`);
  const arb = await fuse.compileTyped({ type: 'ATOMIC_ARBITRAGE' });
  log(`arbitrage intent: ${arb.plan.ok ? `owner nets ${-(arb.plan.selected?.outcome?.userNetSpendSats ?? 0n)} sats` : `stopped at ${arb.plan.error?.stage}: ${arb.plan.error?.reason}`}`);
  const radar = await fuse.radar(1_000);
  log(`guardian (READ-ONLY): ${radar.total} Paryon loans · tiers ${JSON.stringify(radar.tiers)}`);
  const rates = await fuse.rateAdvice({ multiple: 2 });
  log(`rate advice (advisory, executable=${rates.executable}): recommended raw ${rates.recommended?.rateRaw ?? '—'}`);
  const m = await fuse.recipes();
  log(`marketplace: ${m.recipes.filter((r) => r.verdict.listed).length} listed / ${m.recipes.length} submitted (autoExecute=${m.autoExecute})`);
  let verification: string | undefined;
  if (o.settle !== false) {
    const opened = await fuse.openSwap({ minOut: 30_000n, maxIn: 40_000_000n, maxFee: 20_000n });
    const a = await fuse.waitForAuction(opened.auctionId, { timeoutMs: 40_000 });
    log(`auction ${a.auctionId}: ${a.status}${a.txid ? ` tx ${a.txid}` : ''}`);
    if (a.certificateId) {
      const v = await fuse.verifyLocally(await fuse.certificate(a.certificateId));
      verification = v.status;
      log(`certificate ${a.certificateId}: ${v.status} (verified client-side, ${v.checks.filter((c) => c.ok).length}/${v.checks.length} checks)`);
    }
  }
  return { plan, arb, radar, rates, recipes: m, verification };
}

if (import.meta.url === `file://${process.argv[1]}`) quickstart().catch((e) => { console.error(e); process.exit(1); });
