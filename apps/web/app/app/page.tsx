'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePoll, useEvents } from '@/lib/hooks';
import { sats, bchTrim as bch } from '@/lib/api';
import { PageHeader, Panel, Stat, Badge, ApiOffline, type DataMode } from '@/components/ui';

interface Vault { totalSats: bigint; cumulativeFees: bigint; flashCount: bigint; shards: unknown[] }
const MODULES: Array<{ href: string; t: string; d: string; mode: DataMode }> = [
  { href: '/app/execute/new', t: 'Intent Studio', d: 'Compile, auction and settle an intent in one atomic transaction.', mode: 'SIMULATION' },
  { href: '/app/parallel-worlds', t: 'Parallel Worlds', d: 'Run the same intent against six perturbed markets.', mode: 'SIMULATION' },
  { href: '/app/guardian', t: 'Guardian', d: 'Risk radar over every ParyonUSD V1 loan on mainnet.', mode: 'READ-ONLY' },
  { href: '/app/liquidity', t: 'Liquidity', d: 'FlashVault shards, leases, LP deposits and withdrawals.', mode: 'SIMULATION' },
  { href: '/app/opportunities', t: 'Opportunities', d: 'Arbitrage scanner over local and mainnet Cauldron pools.', mode: 'READ-ONLY' },
  { href: '/app/replay', t: 'Replay', d: 'Re-run any settled execution in a fresh BCH VM.', mode: 'SIMULATION' },
];

export default function Overview() {
  const vault = usePoll<Vault>('/api/vault', 4000);
  const certs = usePoll<unknown[]>('/api/certificates', 4000);
  const solvers = usePoll<unknown[]>('/api/solvers', 4000);
  const sentinel = usePoll<{ overall: string }>('/api/guardian/sentinel', 0);
  const notes = usePoll<{ unread: number }>('/api/notifications', 5000);
  const { events } = useEvents(12);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Overview" title="Execution network at a glance" lede="Live state of the local execution world and the read-only mainnet monitors." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={vault.error} />
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
        <Panel><Stat label="Vault liquidity" value={vault.data ? bch(vault.data.totalSats) : '—'} unit="BCH" accent /></Panel>
        <Panel><Stat label="Flash loans" value={vault.data ? sats(vault.data.flashCount) : '—'} sub={vault.data ? `${sats(vault.data.cumulativeFees)} sat fees` : undefined} /></Panel>
        <Panel><Stat label="Certificates" value={certs.data?.length ?? '—'} /></Panel>
        <Panel><Stat label="Solvers" value={solvers.data?.length ?? '—'} /></Panel>
        <Panel><Stat label="Sentinel" value={sentinel.data?.overall ?? '—'} size="md" /></Panel>
        <Panel><Stat label="Unread alerts" value={notes.data?.unread ?? '—'} /></Panel>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {MODULES.map((m, i) => (
            <motion.div key={m.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link href={m.href} className="panel group block h-full p-5 transition-colors hover:border-volt-400/40">
                <div className="flex items-center justify-between"><span className="text-[14px] font-medium text-fog-100 group-hover:text-volt-300">{m.t}</span><Badge mode={m.mode} /></div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-fog-400">{m.d}</p>
              </Link>
            </motion.div>
          ))}
        </div>
        <Panel title="Live activity" kicker="Server-sent events">
          <ul className="grid gap-2 text-[12px]">
            {events.map((e) => <li key={e.id} className="flex gap-2"><span className="num shrink-0 text-volt-400">{e.type}</span><span className="truncate text-fog-400" title={e.detail}>{e.detail}</span></li>)}
            {!events.length && <li className="text-fog-400">Waiting for events…</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
