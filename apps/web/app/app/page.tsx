'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePoll, useEvents } from '@/lib/hooks';
import { sats, bchTrim as bch } from '@/lib/api';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono, type DataMode } from '@/components/ui';
import { useMode } from '@/lib/mode';
import { short } from '@/lib/api';

interface Vault { totalSats: bigint; cumulativeFees: bigint; flashCount: bigint; shards: unknown[] }
const MODULES: Array<{ href: string; t: string; d: string; mode: DataMode }> = [
  { href: '/app/execute/new', t: 'Intent Studio', d: 'Compile, auction and settle an intent in one atomic transaction.', mode: 'SIMULATION' },
  { href: '/app/parallel-worlds', t: 'Parallel Worlds', d: 'Run the same intent against six perturbed markets.', mode: 'SIMULATION' },
  { href: '/app/guardian', t: 'Guardian', d: 'Risk radar over every ParyonUSD V1 loan on mainnet.', mode: 'READ-ONLY' },
  { href: '/app/liquidity', t: 'Liquidity', d: 'FlashVault shards, leases, LP deposits and withdrawals.', mode: 'SIMULATION' },
  { href: '/app/opportunities', t: 'Opportunities', d: 'Arbitrage scanner over local and mainnet Cauldron pools.', mode: 'READ-ONLY' },
  { href: '/app/replay', t: 'Replay', d: 'Re-run any settled execution in a fresh BCH VM.', mode: 'SIMULATION' },
];

interface LiveVault { id: string; label: string; open: boolean; address: string; current: { txid: string; satoshis: bigint; state: { flashCount: bigint; cumulativeFees: bigint } } | null; history: Array<{ txid: string; kind: string }>; error?: string }
const LIVE_MODULES: Array<{ href: string; t: string; d: string; mode: DataMode }> = [
  { href: '/app/execute/live', t: 'Execute on mainnet', d: 'Flash loans, flash → Cauldron routes, LP deposit/withdraw, vault deployment. Simulate → Guardian → sign in your wallet → broadcast → certificate.', mode: 'LIVE' },
  { href: '/app/liquidity', t: 'FlashVault', d: 'The live mainnet FlashVault: principal, flash count, fees and every state transition, read from chain.', mode: 'LIVE' },
  { href: '/app/opportunities', t: 'Cauldron pools', d: 'Live PUSD pools from the Cauldron indexer, each verified against the raw mainnet output.', mode: 'LIVE' },
  { href: '/app/guardian', t: 'Guardian', d: 'Live ParyonUSD V1 risk radar and sentinel over the mainnet oracle and loans.', mode: 'LIVE' },
  { href: '/app/certificates', t: 'Certificates', d: 'Execution certificates verified against BCH mainnet transactions.', mode: 'VERIFIED' },
];
export default function Overview() { const { mode } = useMode(); return mode === 'sandbox' ? <SandboxOverview /> : <LiveOverview />; }

function LiveOverview() {
  const status = usePoll<{ tipHeight: number; latencyMs: number; broadcast: string; error: string | null }>('/api/live/status', 30000);
  const vaults = usePoll<LiveVault[]>('/api/live/vaults', 30000);
  const pools = usePoll<{ pools: unknown[]; bestRoundTrip1Unit: { loss: bigint } | null }>('/api/live/cauldron', 60000);
  const sentinel = usePoll<{ overall: string }>('/api/live/guardian/sentinel', 0);
  const v = (vaults.data ?? []).find((x) => x.open && !x.error);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Overview · BCH mainnet" title="Live BCH DeFi execution" lede="Everything on this page is read from BCH mainnet right now. Every transaction you execute is simulated in the BCH 2026 VM and checked by Guardian before your wallet signs it." right={<Badge mode="LIVE" />} />
      <ApiOffline error={status.error} />
      <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6" data-testid="live-overview">
        <Panel><Stat label="Chain tip" value={status.data?.tipHeight ?? '—'} size="md" sub={status.data ? `${status.data.latencyMs} ms` : undefined} /></Panel>
        <Panel><Stat label="Live vault" value={v?.current ? sats(v.current.satoshis) : vaults.loading ? '…' : '—'} unit="sats" accent /></Panel>
        <Panel><Stat label="Flash loans" value={v?.current ? sats(v.current.state.flashCount) : '—'} sub={v?.current ? `${sats(v.current.state.cumulativeFees)} sat fees` : undefined} /></Panel>
        <Panel><Stat label="Cauldron pools" value={pools.data?.pools.length ?? '—'} sub={pools.data?.bestRoundTrip1Unit ? `round trip −${sats(pools.data.bestRoundTrip1Unit.loss)} sats` : undefined} /></Panel>
        <Panel><Stat label="Sentinel" value={sentinel.data?.overall ?? '—'} size="md" /></Panel>
        <Panel><Stat label="Broadcast" value={status.data ? (status.data.broadcast.startsWith('ENABLED') ? 'ON' : 'OFF') : '—'} size="md" sub="relays signed hex only" /></Panel>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {LIVE_MODULES.map((m, i) => (
            <motion.div key={m.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link href={m.href} className="panel group block h-full p-5 transition-colors hover:border-volt-400/40">
                <div className="flex items-center justify-between"><span className="text-[14px] font-medium text-fog-100 group-hover:text-volt-300">{m.t}</span><Badge mode={m.mode} /></div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-fog-400">{m.d}</p>
              </Link>
            </motion.div>
          ))}
        </div>
        <Panel title="Vault history on mainnet" kicker={v?.id ?? 'reading chain'}>
          <ul className="grid gap-2 text-[12px]">
            {(v?.history ?? []).slice().reverse().slice(0, 12).map((h) => <li key={h.txid} className="flex justify-between gap-2"><span className="num text-volt-400">{h.kind}</span><a className="hover:text-fog-100" href={`https://bchexplorer.cash/tx/${h.txid}`} target="_blank" rel="noreferrer"><Mono className="text-fog-400">{short(h.txid, 8)}</Mono></a></li>)}
            {!v && <li className="text-fog-400">{vaults.loading ? 'Reading mainnet…' : 'No open vault'}</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function SandboxOverview() {
  const vault = usePoll<Vault>('/api/vault', 4000);
  const certs = usePoll<unknown[]>('/api/certificates', 4000);
  const solvers = usePoll<unknown[]>('/api/solvers', 4000);
  const sentinel = usePoll<{ overall: string }>('/api/guardian/sentinel', 0);
  const notes = usePoll<{ unread: number }>('/api/notifications', 5000);
  const { events } = useEvents(12);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Overview · sandbox" title="Sandbox execution world" lede="Local BCH 2026 VM world with simulated coins. Switch to LIVE for BCH mainnet." right={<Badge mode="SIMULATION" />} />
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
