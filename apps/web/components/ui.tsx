'use client';
import clsx from 'clsx';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export type DataMode = 'SIMULATION' | 'READ-ONLY' | 'BLOCKED' | 'UNSUPPORTED' | 'TESTED' | 'VERIFIED' | 'IMPLEMENTED';
const modeStyle: Record<DataMode, string> = {
  SIMULATION: 'text-amber-sim border-amber-sim/30 bg-amber-sim/[0.07]',
  'READ-ONLY': 'text-sky-ro border-sky-ro/30 bg-sky-ro/[0.07]',
  BLOCKED: 'text-rose-bad border-rose-bad/30 bg-rose-bad/[0.07]',
  UNSUPPORTED: 'text-fog-300 border-ink-500 bg-ink-700/50',
  TESTED: 'text-volt-300 border-volt-400/30 bg-volt-400/[0.07]',
  VERIFIED: 'text-volt-300 border-volt-400/30 bg-volt-400/[0.07]',
  IMPLEMENTED: 'text-fog-200 border-ink-500 bg-ink-700/60',
};
const modeHint: Record<DataMode, string> = {
  SIMULATION: 'Local mock chain running the real BCH VM. No real value.',
  'READ-ONLY': 'Real BCH mainnet data, read only. Nothing is broadcast.',
  BLOCKED: 'Not available: see the blocker note.',
  UNSUPPORTED: 'Not supported by the protocol or deployment.',
  TESTED: 'Covered by automated tests.', VERIFIED: 'Independently verified.', IMPLEMENTED: 'Implemented, not yet fully tested.',
};

export function Badge({ mode, className }: { mode: DataMode; className?: string }) {
  return (
    <span title={modeHint[mode]} className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em]', modeStyle[mode], className)}>
      <span className={clsx('size-1.5 rounded-full', mode === 'SIMULATION' ? 'bg-amber-sim' : mode === 'READ-ONLY' ? 'bg-sky-ro' : mode === 'BLOCKED' ? 'bg-rose-bad' : 'bg-current')} aria-hidden />
      {mode}
    </span>
  );
}

export function Panel({ title, kicker, actions, children, className, mode }: { title?: ReactNode; kicker?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; mode?: DataMode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className={clsx('panel overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b hairline px-5 py-3.5">
          <div className="min-w-0">
            {kicker && <div className="mb-0.5 text-[10.5px] uppercase tracking-[0.14em] text-fog-400">{kicker}</div>}
            <h2 className="truncate text-[13.5px] font-medium text-fog-100">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">{mode && <Badge mode={mode} />}{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </motion.section>
  );
}

export function Stat({ label, value, unit, sub, accent, size = 'lg' }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; accent?: boolean; size?: 'lg' | 'md' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.12em] text-fog-400">{label}</div>
      <div className={clsx('num mt-1.5 truncate leading-none', size === 'lg' ? 'text-[22px]' : 'text-[18px]', accent ? 'text-volt-300' : 'text-fog-100')}>
        {value}{unit && <span className="ml-1 text-[12px] text-fog-400">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-fog-400">{sub}</div>}
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = 'primary', type = 'button', className, ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'ghost' | 'quiet'; type?: 'button' | 'submit'; className?: string; 'aria-label'?: string; 'data-testid'?: string }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      className={clsx('inline-flex h-9 items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-medium transition-[background,color,border,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary' && 'bg-volt-400 text-ink-950 hover:bg-volt-300 shadow-[0_0_0_1px_rgb(62_224_196/0.4),0_8px_24px_-8px_rgb(62_224_196/0.5)]',
        variant === 'ghost' && 'border hairline bg-ink-800 text-fog-100 hover:border-ink-500 hover:bg-ink-700',
        variant === 'quiet' && 'text-fog-300 hover:text-fog-100', className)}>
      {children}
    </button>
  );
}

export function Mono({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx('num text-[12px] text-fog-200', className)}>{children}</span>;
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="size-9 rounded-full border hairline bg-ink-800 [background-image:radial-gradient(circle,rgb(62_224_196/0.35)_1.5px,transparent_2px)]" aria-hidden />
      <div className="text-[13.5px] text-fog-100">{title}</div>
      {body && <div className="max-w-sm text-[12.5px] text-fog-400">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ApiOffline({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-bad/30 bg-rose-bad/[0.06] px-4 py-3 text-[12.5px] text-fog-200">
      <span className="font-medium text-rose-bad">FUSE API unreachable.</span> Start it with <code className="num text-fog-100">pnpm dev:api</code> (and <code className="num text-fog-100">pnpm solvers</code>). <span className="text-fog-400">({error})</span>
    </div>
  );
}

export function PageHeader({ eyebrow, title, lede, right }: { eyebrow: string; title: string; lede?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-volt-400">{eyebrow}</div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fog-100">{title}</h1>
        {lede && <p className="mt-2 text-[14px] leading-relaxed text-fog-300">{lede}</p>}
      </div>
      {right}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const c = status === 'SETTLED' ? 'bg-volt-400' : status === 'FAILED' || status === 'EXPIRED' ? 'bg-rose-bad' : 'bg-amber-sim';
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-fog-200">
      <span className="relative flex size-2">
        {!['SETTLED', 'FAILED', 'EXPIRED'].includes(status) && <span className={clsx('absolute inline-flex size-full animate-ping rounded-full opacity-60', c)} />}
        <span className={clsx('relative inline-flex size-2 rounded-full', c)} />
      </span>
      {status.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
