'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMode } from '@/lib/mode';
import { motion } from 'motion/react';

type Tag = 'LIVE' | 'SIM' | 'RO';
const LIVE_NAV: Array<{ group: string; items: Array<{ href: string; label: string; tag?: Tag }> }> = [
  { group: 'Mainnet', items: [{ href: '/app', label: 'Overview', tag: 'LIVE' }, { href: '/app/execute/live', label: 'Execute', tag: 'LIVE' }, { href: '/app/liquidity', label: 'FlashVault', tag: 'LIVE' }, { href: '/app/opportunities', label: 'Cauldron pools', tag: 'LIVE' }] },
  { group: 'Guardian', items: [{ href: '/app/guardian', label: 'Risk radar', tag: 'LIVE' }, { href: '/app/guardian/rates', label: 'Rate optimizer', tag: 'RO' }, { href: '/app/guardian/policies', label: 'Policies', tag: 'RO' }, { href: '/app/guardian/alerts', label: 'Alerts' }] },
  { group: 'Proof', items: [{ href: '/app/certificates', label: 'Certificates', tag: 'LIVE' }, { href: '/verify', label: 'Verify' }, { href: '/app/explorer', label: 'Explorer', tag: 'LIVE' }, { href: '/app/contracts', label: 'Contracts' }] },
  { group: 'Project', items: [{ href: '/app/activity', label: 'Activity' }, { href: '/status', label: 'Integration status' }, { href: '/developers', label: 'Developers' }, { href: '/app/settings', label: 'Settings' }] },
];
const SANDBOX_NAV: Array<{ group: string; items: Array<{ href: string; label: string; tag?: Tag }> }> = [
  { group: 'Sandbox · local BCH VM', items: [{ href: '/app/execute/new', label: 'Intent Studio', tag: 'SIM' }, { href: '/app/execute', label: 'Executions', tag: 'SIM' }, { href: '/app/execute/staged', label: 'Staged recovery', tag: 'SIM' }, { href: '/app/parallel-worlds', label: 'Parallel Worlds', tag: 'SIM' }, { href: '/app/strategies', label: 'Strategies' }, { href: '/app/strategies/builder', label: 'Strategy builder', tag: 'SIM' }, { href: '/app/solvers', label: 'Solver network', tag: 'SIM' }, { href: '/app/solvers/auctions', label: 'Bids', tag: 'SIM' }, { href: '/app/liquidity/vaults', label: 'Sandbox vaults', tag: 'SIM' }, { href: '/app/replay', label: 'Replay', tag: 'SIM' }, { href: '/app/portfolio', label: 'Portfolio', tag: 'SIM' }, { href: '/developers/recipes', label: 'Recipe marketplace', tag: 'SIM' }] },
];
const ALL_HREFS = [...LIVE_NAV, ...SANDBOX_NAV].flatMap((g) => g.items.map((i) => i.href));

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
  const pres = process.env.NEXT_PUBLIC_PRESENTATION_URL || '/judging/FUSE.pdf';
  const donation = process.env.NEXT_PUBLIC_DONATION_ADDRESS;
  const live = process.env.NEXT_PUBLIC_LIVE_URL;
  const hosted = process.env.NEXT_PUBLIC_FUSE_HOSTED === '1';
  return (
    <div className="border-b hairline bg-ink-900/80 text-[11.5px] text-fog-300">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2">
        <span className="font-medium text-fog-100">BCH BLAZE 2026</span>
        {pres ? <a className="hover:text-volt-300" href={pres} target="_blank" rel="noreferrer">Presentation ↗</a> : <span className="text-fog-400">Presentation: link pending</span>}
        {live ? <a className="hover:text-volt-300" href={live} target="_blank" rel="noreferrer">Live demo: {live.replace('https://', '')} ↗</a> : null}
        {hosted ? <span className="rounded border border-emerald-400/30 px-1.5 text-emerald-200" title="Default mode: live BCH mainnet (public indexers, real FlashVault + Cauldron state, wallet signing, broadcast relay). The opt-in sandbox runs in-process with ephemeral per-instance state.">LIVE mainnet · sandbox opt-in</span> : null}
        <a className="hover:text-volt-300" href="https://github.com/rishu4436/fuse" target="_blank" rel="noreferrer">Source on GitHub ↗</a>
        <span className="min-w-0 truncate">EMBER2026 donations (CashTokens):{' '}
          {donation ? <code className="num text-fog-100">{donation}</code> : <span className="text-fog-400">address not published yet (set by owner)</span>}
        </span>
        <span className="ml-auto hidden text-fog-400 md:inline">Live on BCH mainnet · the server holds no keys: you sign in your wallet, FUSE relays the signed tx.</span>
      </div>
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: 'live' | 'sandbox'; setMode: (m: 'live' | 'sandbox') => void }) {
  return (
    <div className="mx-1 rounded-xl border hairline p-1 text-[11.5px]" role="group" aria-label="Mode">
      <div className="grid grid-cols-2 gap-1">
        <button onClick={() => setMode('live')} aria-pressed={mode === 'live'} data-testid="mode-live" className={clsx('rounded-lg px-2 py-1.5 transition-colors', mode === 'live' ? 'bg-emerald-400/10 text-emerald-300' : 'text-fog-400 hover:text-fog-200')}>● Live mainnet</button>
        <button onClick={() => setMode('sandbox')} aria-pressed={mode === 'sandbox'} data-testid="mode-sandbox" className={clsx('rounded-lg px-2 py-1.5 transition-colors', mode === 'sandbox' ? 'bg-amber-sim/10 text-amber-sim' : 'text-fog-400 hover:text-fog-200')}>Sandbox</button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const directory = useRef<HTMLDetailsElement>(null);
  const closeDirectory = () => { if (directory.current) directory.current.open = false; };
  const activeHref = ALL_HREFS.filter((h) => path === h || path.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0];
  const { mode, setMode } = useMode();
  const NAV = mode === 'sandbox' ? [...SANDBOX_NAV, ...LIVE_NAV] : LIVE_NAV;
  const nav = (
    <nav aria-label="Route directory" className="flex flex-col gap-5">
      <ModeToggle mode={mode} setMode={setMode} />
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-2 px-3 text-[10.5px] uppercase tracking-[0.16em] text-fog-400">{g.group}</div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = it.href === activeHref;
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={closeDirectory} aria-current={active ? 'page' : undefined}
                    className={clsx('group relative flex items-center justify-between rounded-lg px-3 py-1.5 text-[13px] transition-colors', active ? 'text-fog-100' : 'text-fog-300 hover:bg-ink-800 hover:text-fog-100')}>
                    {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-volt-400/25 bg-volt-400/[0.06]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <span className="relative">{it.label}</span>
                    {it.tag && <span className={clsx('relative text-[9.5px] font-medium tracking-[0.1em]', it.tag === 'SIM' ? 'text-amber-sim/80' : it.tag === 'LIVE' ? 'text-emerald-300/90' : 'text-sky-ro/80')}>{it.tag === 'SIM' ? 'SANDBOX' : it.tag === 'LIVE' ? 'LIVE' : 'READ'}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  const isOverview = path === '/' || (path === '/app' && mode === 'live');
  return (
    <div className="atlas-shell">
      <a className="atlas-skip" href="#main">Skip to content</a>
      <header className="atlas-nav">
        <Link href="/" aria-label="FUSE home" className="atlas-brand"><Logo className="size-9" />FUSE</Link>
        <nav aria-label="Primary">
          <Link aria-current={path === '/app' ? 'page' : undefined} href="/app">Workspace</Link>
          <Link aria-current={path === '/app/execute/live' ? 'page' : undefined} href="/app/execute/live">Execute</Link>
          <Link aria-current={path === '/verify' ? 'page' : undefined} href="/verify">Verifier</Link>
          <Link aria-current={path === '/developers/sdk' ? 'page' : undefined} href="/developers/sdk">SDK</Link>
        </nav>
        <details ref={directory} className="atlas-menu" key={path}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeDirectory(); }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.querySelector('summary')?.focus();
              closeDirectory();
            }
          }}>
          <summary>Directory <span aria-hidden>☰</span></summary><div>{nav}</div>
        </details>
      </header>
      <main id="main" className={clsx('atlas-main', !isOverview && 'atlas-interior')}>{children}</main>
      <footer><HackathonBanner /></footer>
    </div>
  );
}
