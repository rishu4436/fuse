'use client';
import { motion } from 'motion/react';
import clsx from 'clsx';
export interface Verification { status: 'VERIFIED' | 'FAILED' | 'INSUFFICIENT_EVIDENCE'; checks: Array<{ name: string; ok: boolean; detail?: string }>; note: string }
export function VerifyResult({ v }: { v: Verification }) {
  const good = v.status === 'VERIFIED';
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={clsx('rounded-xl border p-4', good ? 'border-volt-400/35 bg-volt-400/[0.05]' : 'border-rose-bad/35 bg-rose-bad/[0.05]')} data-testid="verify-result">
      <div className="flex items-center gap-3">
        <span className={clsx('flex size-8 items-center justify-center rounded-full text-[15px]', good ? 'bg-volt-400/15 text-volt-300' : 'bg-rose-bad/15 text-rose-bad')} aria-hidden>{good ? '✓' : '✕'}</span>
        <div><div className={clsx('text-[14px] font-semibold tracking-wide', good ? 'text-volt-300' : 'text-rose-bad')}>{v.status}</div><div className="text-[12px] text-fog-300">{v.note}</div></div>
      </div>
      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {v.checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px]"><span className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', c.ok ? 'bg-volt-400' : 'bg-rose-bad')} /><span className="min-w-0"><span className="text-fog-100">{c.name}</span>{c.detail && <span className="block truncate text-fog-400" title={c.detail}>{c.detail}</span>}</span></li>
        ))}
      </ul>
    </motion.div>
  );
}
export const plainJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
