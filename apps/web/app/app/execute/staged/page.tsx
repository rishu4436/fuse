'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { api, short } from '@/lib/api';
import { PageHeader, Panel, Badge, Button, Mono } from '@/components/ui';

interface Attempt { kind: 'BROADCAST' | 'REBROADCAST' | 'REBUILD' | 'VERIFY_FAILED' | 'ALREADY_KNOWN'; detail: string }
interface Stage { id: string; status: 'ACCEPTED' | 'FAILED' | 'SKIPPED' | 'CONFLICTED'; txid?: string; attempts: Attempt[]; ownerOutputs: string[]; error?: string }
interface Result { status: 'COMPLETED' | 'RECOVERABLE'; stages: Stage[]; recovery?: { position: Array<{ outpoint: string; unspent: boolean }>; failedStage: string; reason: string; next: string } }
const SCENARIOS = [
  { id: 'clean', label: 'Clean run', body: {}, blurb: 'Both stages broadcast in order.' },
  { id: 'competitor', label: 'Competitor spends the pool', body: { competitor: true }, blurb: 'Another trader moves the pool between stage 1 and 2. Stage 2 is rebuilt against the new pool state, re-verified, then broadcast.' },
  { id: 'impossible', label: 'Bound cannot be met', body: { minOut: 50_000_000n }, blurb: 'Stage 2 can never satisfy your minimum output. FUSE stops and shows exactly which of your coins are safe and unspent.' },
] as const;
const kindTone: Record<Attempt['kind'], string> = { BROADCAST: 'text-volt-300', REBROADCAST: 'text-sky-ro', REBUILD: 'text-amber-sim', VERIFY_FAILED: 'text-rose-bad', ALREADY_KNOWN: 'text-fog-300' };

export default function Staged() {
  const [sel, setSel] = useState<(typeof SCENARIOS)[number]['id']>('competitor');
  const [res, setRes] = useState<Result>(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const run = async () => { setBusy(true); setErr(undefined); setRes(undefined); try { setRes(await api<Result>('/api/staged/run', { method: 'POST', json: SCENARIOS.find((s) => s.id === sel)!.body })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Execute · Staged recovery" title="When one transaction is not enough, fail safe"
        lede="Some intents need two transactions. FUSE runs them as stages: each stage is verified before broadcast, conflicts are classified (transient, conflict, rejected), a conflicted stage is rebuilt against fresh chain state, and if a bound can no longer be met it stops with your funds in outputs you own."
        right={<Badge mode="SIMULATION" />} />
      <Panel title="Scenario" mode="SIMULATION">
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Scenario">
          {SCENARIOS.map((s) => (
            <button key={s.id} role="radio" aria-checked={sel === s.id} onClick={() => setSel(s.id)} data-testid={`scenario-${s.id}`}
              className={clsx('rounded-xl border p-4 text-left transition-colors', sel === s.id ? 'border-volt-400/50 bg-volt-400/[0.06]' : 'hairline hover:border-ink-500')}>
              <div className="text-[13px] font-medium text-fog-100">{s.label}</div><div className="mt-1 text-[11.5px] leading-snug text-fog-400">{s.blurb}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3"><Button onClick={run} disabled={busy} data-testid="run-staged">{busy ? 'Running in the BCH VM…' : 'Run on the local chain'}</Button>{err && <span className="text-[12px] text-rose-bad">{err}</span>}</div>
      </Panel>
      <AnimatePresence>
        {res && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 grid gap-5" data-testid="staged-result">
            <div className="flex items-center gap-3"><span className={clsx('num text-[12px] font-medium tracking-[0.08em]', res.status === 'COMPLETED' ? 'text-volt-300' : 'text-amber-sim')}>{res.status}</span><span className="h-px flex-1 bg-ink-600" /></div>
            <ol className="grid gap-4 md:grid-cols-2">
              {res.stages.map((s, i) => (
                <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }}>
                  <Panel title={`Stage ${i + 1} · ${s.id}`} kicker={s.txid ? <Mono>{short(s.txid, 10)}</Mono> : s.status}>
                    <ul className="grid gap-2">
                      {s.attempts.map((a, k) => <li key={k} className="flex gap-3 text-[12px]"><span className={clsx('num w-28 shrink-0', kindTone[a.kind])}>{a.kind}</span><span className="break-all text-fog-300">{a.detail}</span></li>)}
                    </ul>
                    {s.ownerOutputs.length > 0 && <div className="mt-3 text-[11.5px] text-fog-400">Your outputs: {s.ownerOutputs.map((o) => <Mono key={o} className="mr-2">{short(o, 6)}</Mono>)}</div>}
                    {s.error && <div className="mt-3 text-[12px] text-rose-bad">{s.error}</div>}
                  </Panel>
                </motion.li>
              ))}
            </ol>
            {res.recovery && (
              <Panel title="Recovery position" kicker={`stopped at ${res.recovery.failedStage}`} mode="SIMULATION">
                <p className="text-[12.5px] text-fog-300">{res.recovery.reason}</p>
                <ul className="mt-3 grid gap-1.5">{res.recovery.position.map((p) => <li key={p.outpoint} className="flex items-center gap-3 text-[12px]"><span className={p.unspent ? 'text-volt-300' : 'text-rose-bad'}>{p.unspent ? 'Unspent, yours' : 'Spent'}</span><Mono>{short(p.outpoint, 12)}</Mono></li>)}</ul>
                <p className="mt-3 text-[11.5px] text-fog-400">{res.recovery.next}</p>
              </Panel>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
