'use client';
// Shared building blocks for Studio pages: data tables, inputs, compile pipeline, key/value lists.
import clsx from 'clsx';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export function Table({ head, children, min = 640 }: { head: ReactNode[]; children: ReactNode; min?: number }) {
  return (
    <div className="scrollbar-thin -mx-5 overflow-x-auto">
      <table className="w-full text-left text-[12.5px]" style={{ minWidth: min }}>
        <thead><tr className="border-b hairline text-[10.5px] uppercase tracking-[0.12em] text-fog-400">{head.map((h, i) => <th key={i} className={clsx('pb-2.5 font-medium', i === 0 ? 'px-5' : 'pr-5')}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Tr = ({ children, className }: { children: ReactNode; className?: string }) => <tr className={clsx('border-b hairline last:border-0 hover:bg-ink-800/50', className)}>{children}</tr>;
export const Td = ({ children, first, num, className }: { children: ReactNode; first?: boolean; num?: boolean; className?: string }) => <td className={clsx('py-3', first ? 'px-5' : 'pr-5', num && 'num text-right', className)}>{children}</td>;

export function Input({ id, label, value, onChange, unit, hint, numeric = true }: { id: string; label: string; value: string; onChange: (v: string) => void; unit?: string; hint?: string; numeric?: boolean }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-[12px] text-fog-300">{label}</span>
      <div className="mt-1.5 flex items-center rounded-[10px] border hairline bg-ink-850 focus-within:border-volt-400/60">
        <input id={id} inputMode={numeric ? 'numeric' : 'text'} value={value} onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)} className="num w-full bg-transparent px-3 py-2 text-[14px] text-fog-100 outline-none" />
        {unit && <span className="pr-3 text-[12px] text-fog-400">{unit}</span>}
      </div>
      {hint && <span className="mt-1 block text-[11px] text-fog-400">{hint}</span>}
    </label>
  );
}
export function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-[12px] text-fog-300">{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-[10px] border hairline bg-ink-850 px-3 py-2 text-[13px] text-fog-100 outline-none focus:border-volt-400/60">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export interface StageRow { stage: string; ok: boolean; ms: number; detail: string }
export function Pipeline({ stages, all }: { stages: StageRow[]; all: readonly string[] }) {
  return (
    <ol className="grid gap-1.5" aria-label="Compiler stages">
      {all.map((name, i) => {
        const s = stages.find((x) => x.stage === name);
        const state = !s ? 'skipped' : s.ok ? 'ok' : 'fail';
        return (
          <motion.li key={name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="grid grid-cols-[18px_96px_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-[12px] hover:bg-ink-800/60" data-testid={`stage-${name}`} data-state={state}>
            <span className={clsx('grid size-[18px] place-items-center rounded-full text-[10px]', state === 'ok' ? 'bg-volt-400/15 text-volt-300' : state === 'fail' ? 'bg-rose-bad/15 text-rose-bad' : 'bg-ink-700 text-fog-400')} aria-hidden>{state === 'ok' ? '✓' : state === 'fail' ? '✕' : '·'}</span>
            <span className="num text-[11px] tracking-[0.06em] text-fog-200">{name}</span>
            <span className={clsx('truncate', state === 'fail' ? 'text-rose-bad' : 'text-fog-400')} title={s?.detail}>{s?.detail ?? 'not reached'}</span>
            <span className="num text-[10.5px] text-fog-400">{s ? `${s.ms.toFixed(1)} ms` : ''}</span>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function KV({ rows }: { rows: Array<[ReactNode, ReactNode]> }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">{rows.map(([k, v], i) => <div key={i} className="contents"><dt className="text-fog-400">{k}</dt><dd className="num min-w-0 break-all text-right text-fog-100">{v}</dd></div>)}</dl>;
}

export function Bar({ value, max, tone = 'volt' }: { value: number; max: number; tone?: 'volt' | 'amber' | 'rose' }) {
  const w = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700"><motion.div initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className={clsx('h-full rounded-full', tone === 'volt' ? 'bg-volt-400' : tone === 'amber' ? 'bg-amber-sim' : 'bg-rose-bad')} /></div>;
}

export const STAGES = ['PARSE', 'AUTHORIZE', 'POLICY', 'RESOLVE', 'PLAN', 'COMPOSE', 'SIMULATE', 'CONSTRAIN', 'RANK', 'EXPLAIN'] as const;
