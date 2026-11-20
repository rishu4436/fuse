'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; tag?: 'SIM' | 'RO' }> }> = [
  { group: 'Workspace', items: [{ href: '/app', label: 'Overview', tag: 'SIM' }, { href: '/app/portfolio', label: 'Portfolio', tag: 'SIM' }] },
  { group: 'Execute', items: [{ href: '/app/execute/new', label: 'Intent Studio', tag: 'SIM' }, { href: '/app/execute', label: 'Executions', tag: 'SIM' }, { href: '/app/parallel-worlds', label: 'Parallel Worlds', tag: 'SIM' }, { href: '/app/strategies', label: 'Strategies' }, { href: '/app/strategies/builder', label: 'Strategy builder', tag: 'SIM' }] },
  { group: 'Guardian', items: [{ href: '/app/guardian', label: 'Risk radar', tag: 'RO' }, { href: '/app/guardian/policies', label: 'Policies', tag: 'RO' }, { href: '/app/guardian/alerts', label: 'Alerts' }] },
  { group: 'Liquidity', items: [{ href: '/app/liquidity', label: 'Shards & LP', tag: 'SIM' }, { href: '/app/liquidity/vaults', label: 'Vaults', tag: 'SIM' }] },
  { group: 'Solvers', items: [{ href: '/app/solvers', label: 'Solver network', tag: 'SIM' }, { href: '/app/solvers/auctions', label: 'Bids', tag: 'SIM' }, { href: '/app/opportunities', label: 'Opportunities', tag: 'RO' }] },
  { group: 'Proof', items: [{ href: '/app/certificates', label: 'Certificates', tag: 'SIM' }, { href: '/verify', label: 'Verify' }, { href: '/app/replay', label: 'Replay', tag: 'SIM' }, { href: '/app/explorer', label: 'Explorer', tag: 'SIM' }, { href: '/app/contracts', label: 'Contracts' }] },
  { group: 'Project', items: [{ href: '/app/activity', label: 'Activity' }, { href: '/status', label: 'Integration status' }, { href: '/developers', label: 'Developers' }, { href: '/app/settings', label: 'Settings' }] },
];
const ALL_HREFS = NAV.flatMap((g) => g.items.map((i) => i.href));

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M4 8 C 14 8, 14 16, 22 16" fill="none" stroke="#3ee0c4" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M4 24 C 14 24, 14 16, 22 16" fill="none" stroke="#3ee0c4" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M22 16 H 28" stroke="#e3e9ef" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="22" cy="16" r="2.6" fill="#05070a" stroke="#e3e9ef" strokeWidth="1.6" />
    </svg>
  );
}

function HackathonBanner() {
  const pres = process.env.NEXT_PUBLIC_PRESENTATION_URL;
  const donation = process.env.NEXT_PUBLIC_DONATION_ADDRESS;
  return (
    <div className="border-b hairline bg-ink-900/80 text-[11.5px] text-fog-300">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2">
        <span className="font-medium text-fog-100">BCH BLAZE 2026</span>
        {pres ? <a className="hover:text-volt-300" href={pres} target="_blank" rel="noreferrer">Presentation ↗</a> : <span className="text-fog-400">Presentation: link pending</span>}
        <a className="hover:text-volt-300" href="https://github.com/rishu4436/fuse" target="_blank" rel="noreferrer">Source on GitHub ↗</a>
        <span className="min-w-0 truncate">EMBER2026 donations (CashTokens):{' '}
          {donation ? <code className="num text-fog-100">{donation}</code> : <span className="text-fog-400">address not published yet (set by owner)</span>}
        </span>
        <span className="ml-auto hidden text-fog-400 md:inline">Nothing on this site broadcasts mainnet transactions.</span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const activeHref = ALL_HREFS.filter((h) => path === h || path.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0];
  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-2 px-3 text-[10.5px] uppercase tracking-[0.16em] text-fog-400">{g.group}</div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = it.href === activeHref;
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
                    className={clsx('group relative flex items-center justify-between rounded-lg px-3 py-1.5 text-[13px] transition-colors', active ? 'text-fog-100' : 'text-fog-300 hover:bg-ink-800 hover:text-fog-100')}>
                    {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-volt-400/25 bg-volt-400/[0.06]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <span className="relative">{it.label}</span>
                    {it.tag && <span className={clsx('relative text-[9.5px] font-medium tracking-[0.1em]', it.tag === 'SIM' ? 'text-amber-sim/80' : 'text-sky-ro/80')}>{it.tag === 'SIM' ? 'SIM' : 'READ'}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="backdrop min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink-800 focus:px-3 focus:py-2">Skip to content</a>
      <HackathonBanner />
      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r hairline px-3 py-6 lg:flex">
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-3"><Logo className="size-7" /><span className="text-[17px] font-semibold tracking-[-0.02em]">fuse</span></Link>
          <div className="scrollbar-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">{nav}</div>
          <div className="mt-3 px-3 text-[11px] leading-relaxed text-fog-400">
            <div className="mb-1 flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-amber-sim" />SIM: local BCH VM</div>
            <div className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-sky-ro" />READ: mainnet, read only</div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between border-b hairline px-5 py-3 lg:hidden">
            <Link href="/" className="flex items-center gap-2"><Logo className="size-6" /><span className="font-semibold">fuse</span></Link>
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" className="rounded-lg border hairline px-3 py-1.5 text-[12px]">Menu</button>
          </div>
          <AnimatePresence>
            {open && (
              <motion.div id="mobile-nav" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b hairline px-3 py-4 lg:hidden">{nav}</motion.div>
            )}
          </AnimatePresence>
          <main id="main" className="px-5 py-8 md:px-9 md:py-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
