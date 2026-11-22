'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePoll, useEvents } from '@/lib/hooks';
import { sats, bchTrim as bch } from '@/lib/api';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono, type DataMode } from '@/components/ui';
import { useMode } from '@/lib/mode';
import { short } from '@/lib/api';
import { SettlementReplay } from '@/components/settlement-replay';
import styles from './dashboard.module.css';

interface Vault { totalSats: bigint; cumulativeFees: bigint; flashCount: bigint; shards: unknown[] }
const MODULES: Array<{ href: string; t: string; d: string; mode: DataMode }> = [
  { href: '/app/execute/new', t: 'Intent Studio', d: 'Compile, auction and settle an intent in one atomic transaction.', mode: 'SIMULATION' },
  { href: '/app/parallel-worlds', t: 'Parallel Worlds', d: 'Run the same intent against six perturbed markets.', mode: 'SIMULATION' },
  { href: '/app/guardian', t: 'Guardian', d: 'Risk radar for ParyonUSD V1 loans on mainnet.', mode: 'READ-ONLY' },
  { href: '/app/liquidity', t: 'Liquidity', d: 'FlashVault shards, leases, LP deposits and withdrawals.', mode: 'SIMULATION' },
  { href: '/app/opportunities', t: 'Opportunities', d: 'Arbitrage scanner over local and mainnet Cauldron pools.', mode: 'READ-ONLY' },
  { href: '/app/replay', t: 'Replay', d: 'Re-run any settled execution in a fresh BCH VM.', mode: 'SIMULATION' },
];

interface LiveVault { id: string; label: string; open: boolean; address: string; current: { txid: string; satoshis: bigint; state: { flashCount: bigint; cumulativeFees: bigint } } | null; history: Array<{ txid: string; kind: string }>; error?: string }
const LIVE_MODULES: Array<{ href: string; t: string; d: string; mode: DataMode }> = [
  { href: '/app/execute/live', t: 'Execute on mainnet', d: 'Compose a route, review Guardian checks and sign in your wallet.', mode: 'LIVE' },
  { href: '/app/liquidity', t: 'FlashVault', d: 'The live mainnet FlashVault: principal, flash count, fees and every state transition, read from chain.', mode: 'LIVE' },
  { href: '/app/opportunities', t: 'Cauldron pools', d: 'Inspect PUSD pools with reserves verified against BCH transaction bytes.', mode: 'READ-ONLY' },
  { href: '/app/guardian', t: 'Guardian', d: 'Track Paryon loans and oracle conditions from BCH mainnet.', mode: 'READ-ONLY' },
  { href: '/app/certificates', t: 'Certificates', d: 'Execution certificates verified against BCH mainnet transactions.', mode: 'VERIFIED' },
];
export default function Overview() { const { mode } = useMode(); return mode === 'sandbox' ? <SandboxOverview /> : <LiveOverview />; }

function LiveOverview() {
  const status = usePoll<{ tipHeight: number | null; broadcast: string; checkedAt: string; error: string | null }>('/api/live/status', 30000);
  const vaults = usePoll<LiveVault[]>('/api/live/vaults', 30000);
  const pools = usePoll<{ pools: unknown[]; checkedAt: string }>('/api/live/cauldron', 60000);
  const sentinel = usePoll<{ overall: string }>('/api/live/guardian/sentinel', 0);
  const v = (vaults.data ?? []).find(x => x.open && !x.error);
  const chainError = status.error || status.data?.error;
  const vaultError = vaults.error || vaults.data?.some(x => x.error);
  const { setMode } = useMode();
  const metrics = [
    { label: 'Chain tip', value: status.data?.tipHeight?.toLocaleString('en-US'), note: status.data?.checkedAt && !chainError ? 'Checked ' + new Date(status.data.checkedAt).toISOString().slice(11, 19) + ' UTC' : 'Bitcoin Cash', loading: status.loading, error: chainError, retry: status.reload },
    { label: 'Vault balance', value: v?.current ? sats(v.current.satoshis) : undefined, note: v?.id ?? 'satoshis', unit: 'sats', loading: vaults.loading, error: vaultError && !v, retry: vaults.reload },
    { label: 'Flash loans', value: v?.current ? sats(v.current.state.flashCount) : undefined, note: v?.current ? `${sats(v.current.state.cumulativeFees)} sats in fees` : 'FlashVault', loading: vaults.loading, error: vaultError && !v, retry: vaults.reload },
    { label: 'Cauldron pools', value: pools.data?.pools.length, note: pools.data?.checkedAt ? 'Checked ' + new Date(pools.data.checkedAt).toISOString().slice(11, 19) + ' UTC' : 'Verified PUSD reserves', loading: pools.loading, error: pools.error, retry: pools.reload },
  ];

  return (
    <div className={`${styles.dashboard} mx-auto max-w-6xl`}>
      <div className="dashboard-context">
        <span>FUSE <span aria-hidden>/</span> Overview</span>
        <Link href="/status" className="dashboard-chain" data-healthy={Boolean(status.data?.tipHeight && !chainError)}>
          <span aria-hidden />
          {chainError ? 'Chain reader unavailable' : status.data?.tipHeight ? 'BCH mainnet connected' : 'Connecting to BCH mainnet'}
        </Link>
      </div>
      <SettlementReplay />

      <section aria-labelledby="live-metrics-title" data-testid="live-overview">
        <div className="dashboard-heading">
          <h2 id="live-metrics-title">Mainnet state</h2>
          <span className="dashboard-broadcast">Relay {status.data ? (status.data.broadcast.startsWith('ENABLED') ? 'enabled' : 'disabled') : 'status pending'}</span>
        </div>
        <div className="dashboard-metrics">
          {metrics.map(metric => (
            <div key={metric.label} className="dashboard-metric">
              <div className="dashboard-metric-label">{metric.label}</div>
              <div className="dashboard-metric-value num">{metric.value ?? '—'}{metric.value != null && metric.unit && <small>{metric.unit}</small>}</div>
              {metric.error ? <button type="button" onClick={metric.retry} className="dashboard-retry">Unavailable · retry</button> :
                <p>{metric.loading ? 'Reading chain…' : metric.note}</p>}
            </div>
          ))}
        </div>
      </section>

      <div className="dashboard-lower">
        <section aria-labelledby="workspace-title">
          <div className="dashboard-heading"><h2 id="workspace-title">Workspace</h2>
            <button type="button" onClick={() => setMode('sandbox')} className="dashboard-replay-button">Open sandbox <span aria-hidden>↗</span></button>
          </div>
          <div className="dashboard-tools">
            {LIVE_MODULES.map(module => (
              <Link key={module.href} href={module.href} className="dashboard-tool">
                <div>
                  <h3>{module.t}</h3>
                  <p>{module.href === '/app/guardian' && sentinel.data?.overall ? `Sentinel status · ${sentinel.data.overall}` : module.d}</p>
                </div>
                <span aria-hidden>↗</span>
              </Link>
            ))}
            <Link href="/developers/sdk" className="dashboard-tool">
              <div><h3>Developer SDK</h3><p>Build with the composer and proof verifier.</p></div>
              <span aria-hidden>↗</span>
            </Link>
          </div>
        </section>
        <section aria-labelledby="history-title">
          <div className="dashboard-heading"><h2 id="history-title">Vault activity</h2><Badge mode="READ-ONLY" /></div>
          <ul className="dashboard-history">
            {(v?.history ?? []).slice().reverse().slice(0, 12).map(h => (
              <li key={h.txid}><span>{h.kind.replaceAll('_', ' ')}</span><a href={`https://bchexplorer.cash/tx/${h.txid}`}><Mono>{short(h.txid, 6)} ↗</Mono></a></li>
            ))}
            {!v && <li>{vaults.loading ? 'Reading vault activity…' : vaultError ? 'Vault activity unavailable' : 'No open vault'}</li>}
          </ul>
        </section>
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
