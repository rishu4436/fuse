'use client';
// F41 visual strategy builder: arrange legs, validate structure locally (borrow must be repaid in the same
// transaction, the user leg must exist), then match it to a reference strategy and compile it for real.
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Reorder, motion } from 'motion/react';
import { api, sats } from '@/lib/api';
import { PageHeader, Panel, Badge, Button } from '@/components/ui';
import { Pipeline, STAGES, type StageRow } from '@/components/kit';

const BLOCKS = { BORROW: 'Borrow FlashVault shard', BUY_CHEAP: 'Buy on cheapest pool', SELL_RICH: 'Sell surplus on richest pool', REPAY: 'Repay shard + fee', PAY_USER: 'Deliver tokens to user', SOLVER_FEE: 'Pay solver fee', INVENTORY: 'Fill from solver inventory' } as const;
type B = keyof typeof BLOCKS;
const PRESETS: Record<string, B[]> = { FLASH_LIQUIDITY: ['BORROW', 'BUY_CHEAP', 'SELL_RICH', 'REPAY', 'PAY_USER'], ROUTING: ['BUY_CHEAP', 'PAY_USER', 'SOLVER_FEE'], DIRECT_LIQUIDITY: ['INVENTORY', 'PAY_USER'] };

function validate(legs: B[]): { errors: string[]; match?: string } {
  const e: string[] = [];
  const i = (b: B) => legs.indexOf(b);
  if (!legs.includes('PAY_USER')) e.push('The user must receive tokens (add "Deliver tokens to user").');
  if (legs.includes('BORROW') && !legs.includes('REPAY')) e.push('A borrowed shard must be repaid in the same transaction.');
  if (legs.includes('REPAY') && !legs.includes('BORROW')) e.push('Nothing to repay: add a borrow leg.');
  if (legs.includes('BORROW') && i('REPAY') < i('BORROW')) e.push('Repay must come after borrow.');
  if (legs.includes('SELL_RICH') && !legs.includes('BORROW')) e.push('Selling surplus needs borrowed capital (flash) in this recipe set.');
  if (legs.includes('INVENTORY') && legs.includes('BUY_CHEAP')) e.push('Mix of inventory and pool fills is not a supported recipe yet.');
  const key = [...legs].sort().join(',');
  const match = Object.entries(PRESETS).find(([, v]) => [...v].sort().join(',') === key)?.[0];
  if (!e.length && !match) e.push('Structurally valid, but no compiler strategy implements this combination yet.');
  return { errors: e, match };
}

interface Plan { ok: boolean; stages: StageRow[]; candidates: Array<{ strategy: string; ok: boolean; reasons: string[]; outcome?: { userNetSpendSats: bigint } }> }

function Builder() {
  const q = useSearchParams();
  const [legs, setLegs] = useState<B[]>(PRESETS[q.get('recipe') ?? 'FLASH_LIQUIDITY'] ?? PRESETS.FLASH_LIQUIDITY);
  useEffect(() => { const r = q.get('recipe'); if (r && PRESETS[r]) setLegs(PRESETS[r]); }, [q]);
  const v = useMemo(() => validate(legs), [legs]);
  const [plan, setPlan] = useState<Plan>();
  const compile = async () => { const d = await api<unknown>('/api/compile/draft'); setPlan(await api<Plan>('/api/compile', { method: 'POST', json: d })); };
  const mine = plan?.candidates.find((c) => c.strategy === v.match);
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr_360px]">
      <Panel title="Blocks" kicker="Click to add">
        <div className="grid gap-2">{(Object.keys(BLOCKS) as B[]).map((b) => <button key={b} onClick={() => setLegs((l) => (l.includes(b) ? l : [...l, b]))} disabled={legs.includes(b)} className="rounded-lg border hairline bg-ink-850 px-3 py-2 text-left text-[12px] text-fog-200 transition-colors hover:border-volt-400/40 disabled:opacity-40" data-testid={`block-${b}`}>{BLOCKS[b]}</button>)}</div>
      </Panel>
      <Panel title="Transaction legs" kicker="Drag to reorder · all legs settle in one transaction">
        <Reorder.Group axis="y" values={legs} onReorder={setLegs} className="grid gap-2" data-testid="legs">
          {legs.map((b, i) => (
            <Reorder.Item key={b} value={b} className="flex cursor-grab items-center justify-between rounded-lg border hairline bg-ink-800 px-3 py-2.5 text-[12.5px] active:cursor-grabbing">
              <span className="flex items-center gap-3"><span className="num text-[11px] text-volt-400">{String(i + 1).padStart(2, '0')}</span>{BLOCKS[b]}</span>
              <button onClick={() => setLegs((l) => l.filter((x) => x !== b))} className="text-fog-400 hover:text-rose-bad" aria-label={`Remove ${BLOCKS[b]}`}>✕</button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
        <div className="mt-4 grid gap-1 text-[12px]" data-testid="builder-validation">
          {v.errors.map((e) => <div key={e} className="text-rose-bad">✕ {e}</div>)}
          {!v.errors.length && <div className="text-volt-300">✓ Valid recipe · compiles as {v.match}</div>}
        </div>
      </Panel>
      <Panel title="Compile" kicker="Runs the real compiler" mode="SIMULATION" actions={<Button variant="ghost" onClick={compile} disabled={!!v.errors.length} data-testid="builder-compile">Compile</Button>}>
        {plan ? (
          <div className="grid gap-3">
            <Pipeline stages={plan.stages} all={STAGES} />
            {mine && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border hairline p-3 text-[12.5px]">{mine.ok ? <>This recipe: <span className="num text-volt-300">{sats(mine.outcome?.userNetSpendSats)}</span> sat net for the user</> : <span className="text-rose-bad">{mine.reasons.join('; ')}</span>}</motion.div>}
          </div>
        ) : <p className="text-[12.5px] text-fog-400">Validated recipes compile against the live local market.</p>}
      </Panel>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Strategy Builder" title="Assemble a one-transaction strategy" lede="Arrange legs, get structural checks instantly, then compile against the live local market. Recipes outside the supported set are rejected rather than guessed." right={<Badge mode="IMPLEMENTED" />} />
      <Suspense fallback={null}><Builder /></Suspense>
    </div>
  );
}
