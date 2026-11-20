'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePoll } from '@/lib/hooks';
import { sats, bch, usd } from '@/lib/api';
import type { Auction, Solver, Vault } from '@/lib/types';
import { Badge, Panel, Stat, Button } from '@/components/ui';

const steps = [
  { n: '01', t: 'State an intent', d: 'Say what you want, e.g. "buy 30,000 FUSD for at most 0.4 BCH". It is compiled into a canonical intent and a commitment.' },
  { n: '02', t: 'Solvers compete', d: 'Separate solver processes bid fully specified transactions. They route through Cauldron, sell from inventory, or back-run with FlashVault liquidity.' },
  { n: '03', t: 'Verify, then sign', d: 'Every bid runs in the BCH VM against the real contracts, and its outcome is recomputed from the transaction itself. Lying bids are rejected.' },
  { n: '04', t: 'Proof you can check', d: 'Each settlement issues a certificate. Anyone can re-verify it against chain data, without trusting FUSE.' },
];

export default function Home() {
  const vault = usePoll<Vault>('/api/vault', 4000);
  const auctions = usePoll<Auction[]>('/api/auctions', 4000);
  const solvers = usePoll<Solver[]>('/api/solvers', 4000);
  const paryon = usePoll<{ live?: { activeLoans: number; latestPrice: { priceRaw: string }; collateralRatioBps: { median: number } }; checkedAt?: string }>('/api/mainnet/paryon', 0);
  const cauldron = usePoll<{ poolsReturned?: number; checked?: Array<{ scriptMatchesPublishedCauldronArtifact: boolean }>; checkedAt?: string }>('/api/mainnet/cauldron', 0);
  const settled = auctions.data?.filter((a) => a.status === 'SETTLED').length ?? 0;
  return (
    <div className="mx-auto max-w-6xl">
      <section className="relative pb-14 pt-6 md:pt-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border hairline bg-ink-850 px-3 py-1 text-[11.5px] text-fog-300">
            <span className="size-1.5 rounded-full bg-volt-400 shadow-[0_0_10px_#3ee0c4]" /> Intent execution network for Bitcoin Cash
          </div>
          <h1 className="max-w-3xl text-[44px] font-semibold leading-[1.04] tracking-[-0.035em] text-fog-100 md:text-[60px]">
            Say what you want.<br /><span className="text-fog-400">Solvers compete to do it in</span> <span className="text-volt-300">one transaction.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-fog-300">
            FUSE runs intent auctions on Bitcoin Cash. Solvers bid complete, atomic transactions that combine Cauldron pools, solver inventory and FlashVault covenant liquidity. A bid is only accepted after it passes the BCH virtual machine and the user&apos;s outcome has been recomputed from the transaction.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/app/execute/new"><Button>Open Intent Studio →</Button></Link>
            <Link href="/verify"><Button variant="ghost">Verify a certificate</Button></Link>
            <span className="ml-1 text-[12px] text-fog-400">The demo runs on a local BCH VM. Mainnet panels are read only.</span>
          </div>
        </motion.div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Local execution world" kicker="Real contracts · real VM · simulated coins" mode="SIMULATION">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Vault liquidity" value={vault.data ? bch(vault.data.totalSats).slice(0, -4) : '—'} unit="BCH" />
            <Stat label="Vault fees earned" value={vault.data ? sats(vault.data.cumulativeFees) : '—'} unit="sat" accent />
            <Stat label="Auctions settled" value={settled} />
            <Stat label="Solvers online" value={solvers.data?.length ?? '—'} />
          </div>
        </Panel>
        <Panel title="Bitcoin Cash mainnet" kicker={`Snapshot ${paryon.data?.checkedAt ? new Date(paryon.data.checkedAt).toLocaleString() : '—'}`} mode="READ-ONLY">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Cauldron pools checked" value={cauldron.data?.checked ? `${cauldron.data.checked.filter((c) => c.scriptMatchesPublishedCauldronArtifact).length}/${cauldron.data.checked.length}` : '—'} sub={`of ${cauldron.data?.poolsReturned ?? '—'} PUSD pools`} />
            <Stat label="Paryon oracle" value={paryon.data?.live ? usd(paryon.data.live.latestPrice.priceRaw) : '—'} sub="BCH/USD, on-chain" />
            <Stat label="Active loans" value={paryon.data?.live?.activeLoans ?? '—'} />
            <Stat label="Median CR" value={paryon.data?.live ? `${(paryon.data.live.collateralRatioBps.median / 100).toFixed(0)}%` : '—'} />
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
        <div className="flex items-start gap-2"><Badge mode="SIMULATION" /> <span>The local mock chain uses the cashscript MockNetworkProvider with the BCH 2026 VM and the compiled FlashVault and Cauldron bytecode.</span></div>
        <div className="flex items-start gap-2"><Badge mode="READ-ONLY" /> <span>Mainnet data comes from Chaingraph snapshots. Every raw transaction is re-hashed locally.</span></div>
        <div className="flex items-start gap-2"><Badge mode="BLOCKED" /> <span>Mainnet broadcast is off until the owner authorizes it. Moria V1 is disabled and is shown as historical only.</span></div>
      </section>
    </div>
  );
}
