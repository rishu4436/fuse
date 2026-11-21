'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePoll } from '@/lib/hooks';
import { sats, usd } from '@/lib/api';
import { Badge, Panel, Stat, Button } from '@/components/ui';
import type { LiveVault } from '@/components/live';

const steps = [
  { n: '01', t: 'Compose from live state', d: 'Pick a flash loan, a flash → Cauldron route, an LP move or a new vault. FUSE builds the unsigned transaction from the current mainnet UTXOs of the vault, the pools and your wallet.' },
  { n: '02', t: 'Simulate + Guardian', d: 'Every covenant input is evaluated in the BCH 2026 VM before you sign. Guardian blocks hidden transfers, fee or cost overruns, token side effects and unrepaid vaults.' },
  { n: '03', t: 'Sign in your wallet', d: 'WizardConnect signs in your wallet, or export the signing package and paste the signed hex. FUSE never sees a key; the server only relays already-signed hex after a full VM check.' },
  { n: '04', t: 'Broadcast + certificate', d: 'The txid is tracked to confirmation, then a certificate is rebuilt from the mainnet transaction and verified independently.' },
];

export default function Home() {
  const vaults = usePoll<LiveVault[]>('/api/live/vaults', 30000);
  const status = usePoll<{ tipHeight: number; broadcast: string }>('/api/live/status', 30000);
  const pools = usePoll<{ pools: unknown[]; indexerCount: number }>('/api/live/cauldron', 60000);
  const paryon = usePoll<{ live?: { activeLoans: number; latestPrice: { priceRaw: string } } }>('/api/live/paryon-view', 0);
  const v = (vaults.data ?? []).find((x) => x.open && !x.error);
  return (
    <div className="mx-auto max-w-6xl">
      <section className="relative pb-14 pt-6 md:pt-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border hairline bg-ink-850 px-3 py-1 text-[11.5px] text-fog-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" /> Live on Bitcoin Cash mainnet
          </div>
          <h1 className="max-w-3xl text-[44px] font-semibold leading-[1.04] tracking-[-0.035em] text-fog-100 md:text-[60px]">
            Live BCH DeFi execution.<br /><span className="text-fog-400">Simulated and risk-checked</span> <span className="text-volt-300">before you sign.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-fog-300">
            FUSE executes flash loans, Cauldron routes and FlashVault liquidity moves on BCH mainnet. Each transaction is composed from live chain state, run through the BCH 2026 VM and the Guardian risk engine, signed in your own wallet and broadcast, then proven with a certificate anyone can re-verify.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/app/execute/live"><Button>Execute on mainnet →</Button></Link>
            <Link href="/app/certificates"><Button variant="ghost">Verify a certificate</Button></Link>
            <span className="ml-1 text-[12px] text-fog-400">A local sandbox (simulated coins) is available from the mode switch.</span>
          </div>
          <nav aria-label="Recorded mainnet evidence" className="mt-4 flex flex-wrap gap-4 text-sm underline">
            <a href="https://bchexplorer.cash/tx/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f">Two-pool transaction</a>
            <a href="https://bchexplorer.cash/tx/cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c">Solver settlement</a>
            <a href="https://github.com/rishu4436/fuse/tree/feat/phase-0-1-foundation/evidence/mainnet/wizardconnect-cashonize">Cashonize approval</a>
            <Link href="/developers/sdk">Developer SDK</Link>
          </nav>
        </motion.div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="FlashVault on mainnet" kicker={v ? v.id : vaults.loading ? 'reading chain' : 'current data unavailable'} mode="LIVE">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Principal" value={v?.current ? sats(v.current.satoshis) : '—'} unit="sats" accent />
            <Stat label="Flash loans" value={v?.current ? sats(v.current.state.flashCount) : '—'} />
            <Stat label="Fees earned" value={v?.current ? sats(v.current.state.cumulativeFees) : '—'} unit="sat" />
            <Stat label="Transitions" value={v ? v.history.length - 1 : '—'} />
          </div>
        </Panel>
        <Panel title="Bitcoin Cash mainnet" kicker={status.data ? `block ${status.data.tipHeight}` : '—'} mode="LIVE">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Cauldron pools" value={pools.data ? `${pools.data.pools.length}/${pools.data.indexerCount}` : '—'} sub="verified / listed" />
            <Stat label="Paryon oracle" value={paryon.data?.live ? usd(paryon.data.live.latestPrice.priceRaw) : '—'} sub="BCH/USD, on-chain" />
            <Stat label="Paryon loans" value={paryon.data?.live?.activeLoans ?? '—'} />
            <Stat label="Broadcast" value={status.data ? (status.data.broadcast.startsWith('ENABLED') ? 'ON' : 'OFF') : '—'} sub="signed hex only" />
          </div>
        </Panel>
      </div>

      <section className="mt-16">
        <div className="mb-6 text-[11px] uppercase tracking-[0.18em] text-volt-400">How it works</div>
        <div className="grid gap-px overflow-hidden rounded-2xl border hairline bg-ink-600 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <motion.div key={s.n} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5 }} className="bg-ink-900 p-6">
              <div className="num text-[12px] text-volt-400">{s.n}</div>
              <div className="mt-3 text-[15px] font-medium text-fog-100">{s.t}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-fog-400">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mt-16 grid gap-4 text-[12.5px] text-fog-400 md:grid-cols-3">
        <div className="flex items-start gap-2"><Badge mode="LIVE" /> <span>Execute, FlashVault, Cauldron pools, Guardian and certificates read and write BCH mainnet. The server holds no keys.</span></div>
        <div className="flex items-start gap-2"><Badge mode="SIMULATION" /> <span>Sandbox: intent auctions, solvers, Parallel Worlds and Replay run on a local BCH 2026 VM with simulated coins.</span></div>
        <div className="flex items-start gap-2"><Badge mode="BLOCKED" /> <span>Moria V1 is disabled and shown as historical only. Paryon V2 is not deployed. WalletConnect v2 is not wired.</span></div>
      </section>
    </div>
  );
}
