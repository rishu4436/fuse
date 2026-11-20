'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { PageHeader, Panel, type DataMode } from '@/components/ui';

const RECIPES: Array<{ id: string; name: string; kind: string; d: string; legs: string[]; mode: DataMode }> = [
  { id: 'FLASH_LIQUIDITY', name: 'Flash back-run rebate', kind: 'Solver strategy', d: 'Buys the user\'s tokens, back-runs the pool gap with a FlashVault shard, and shares the profit with the user, all in one transaction.', legs: ['Borrow shard', 'Buy on cheap pool', 'Sell on rich pool', 'Repay + fee', 'Rebate user'], mode: 'TESTED' },
  { id: 'ROUTING', name: 'Best single-pool route', kind: 'Solver strategy', d: 'Routes the whole order through the cheapest Cauldron pool with a 10 bps solver fee.', legs: ['Swap on best pool', 'Pay solver fee'], mode: 'TESTED' },
  { id: 'DIRECT_LIQUIDITY', name: 'Inventory fill', kind: 'Solver strategy', d: 'Fills from solver inventory at the pool reference price plus a markup.', legs: ['Transfer inventory', 'Pay solver'], mode: 'TESTED' },
  { id: 'NETTING', name: 'Cross-intent netting', kind: 'X01', d: 'Matches a buy and an opposite sell intent peer-to-peer at the pool mid price; no AMM fee on the netted size.', legs: ['Buyer pays seller', 'Seller delivers tokens', 'Residual reported'], mode: 'TESTED' },
  { id: 'GUARD_TOPUP', name: 'Keep loan above target CR', kind: 'Guardian policy', d: 'Watches a Paryon V1 loan and proposes an exact collateral top-up. Execution is blocked.', legs: ['Watch CR', 'Propose top-up', 'Notify in-app'], mode: 'READ-ONLY' },
];

export default function Strategies() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Strategies" title="Recipes that compile to one transaction" lede="Reference strategies used by the solver network, plus Guardian policy templates. Open a recipe in the builder to inspect or rearrange its legs." right={<Link href="/app/strategies/builder" className="text-[12.5px] text-volt-300">Open builder →</Link>} />
      <div className="grid gap-4 md:grid-cols-2">
        {RECIPES.map((r, i) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Panel title={r.name} kicker={r.kind} mode={r.mode}>
              <p className="text-[12.5px] leading-relaxed text-fog-300">{r.d}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">{r.legs.map((l, k) => <span key={l} className="flex items-center gap-1.5"><span className="rounded-md border hairline bg-ink-850 px-2 py-0.5 text-[11px] text-fog-200">{l}</span>{k < r.legs.length - 1 && <span className="text-fog-400">→</span>}</span>)}</div>
              {['FLASH_LIQUIDITY', 'ROUTING', 'DIRECT_LIQUIDITY'].includes(r.id) && <Link href={`/app/strategies/builder?recipe=${r.id}`} className="mt-3 inline-block text-[12px] text-volt-300">Open in builder →</Link>}
            </Panel>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
