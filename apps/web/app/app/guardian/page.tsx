'use client';
import { useMode } from '@/lib/mode';
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { usePoll } from '@/lib/hooks';
import { sats, short, usd } from '@/lib/api';
import Link from 'next/link';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono, type DataMode } from '@/components/ui';

interface Loan { outpoint: string; collateralSats: string; debtCents: string; status: string; collateralRatioBps: string | null; periodsBehind: string; liquidationPriceCents: string | null; currentRateRaw: string }
interface P { coverage?: { loanUtxosListed: number; reusedFromSnapshotUnchanged: number; decodedLiveNow: number; pendingDecode: number }; checkedAt: string; tipHeight: number; operations: Record<string, string>; live: { latestPrice: { priceRaw: string; sequence: string; contract: string; outpoint: string }; loans: Loan[]; activeLoans: number; staleLoans: number; currentPeriod: string; collateralRatioBps: { min: number; median: number; max: number }; unspentMutableParyonNfts: number } }
const BUCKETS = [[11000, 12500], [12500, 15000], [15000, 20000], [20000, 30000], [30000, 1e9]] as const;

export default function Guardian() {
  const { mode } = useMode();
  const { data, error } = usePoll<P>(mode === 'live' ? '/api/live/paryon-view' : '/api/mainnet/paryon', 0);
  const [shock, setShock] = useState(0);
  const sentinel = usePoll<{ overall: string; signals: Array<{ name: string; status: string; detail: string }> }>(mode === 'live' ? '/api/live/guardian/sentinel' : '/api/guardian/sentinel', 0);
  const price = data?.live.latestPrice ? Number(data.live.latestPrice.priceRaw) : 0;
  const active = useMemo(() => (data?.live.loans ?? []).filter((l) => Number(l.periodsBehind) <= 1 && l.debtCents !== '0' && l.collateralRatioBps), [data]);
  const shocked = price * (1 - shock / 100);
  const atRisk = active.filter((l) => Number(l.liquidationPriceCents ?? 0) >= shocked);
  const sorted = [...active].sort((a, b) => Number(a.collateralRatioBps) - Number(b.collateralRatioBps));
  const hist = BUCKETS.map(([lo, hi]) => active.filter((l) => Number(l.collateralRatioBps) >= lo && Number(l.collateralRatioBps) < hi).length);
  const hmax = Math.max(1, ...hist);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Guardian · ParyonUSD V1" title="Loan health radar, from mainnet state"
        lede="FUSE rebuilt every Paryon V1 contract from @paryonusd/contracts and the published deployment config, and matched them to the mainnet genesis transactions. It decodes each loan NFT commitment and reads the oracle price from PriceContractGuarded. Collateral ratios are computed locally. Liquidation and loan management are not executed."
        right={<Badge mode="READ-ONLY" />} />
      <ApiOffline error={error} />
      {data?.coverage && <div className="mb-4 text-[11.5px] text-fog-400" data-testid="paryon-coverage">LIVE read at block {data.tipHeight}: oracle price read now; {data.coverage.loanUtxosListed} loan UTXOs listed, {data.coverage.reusedFromSnapshotUnchanged} unchanged since the decoded snapshot, {data.coverage.decodedLiveNow} decoded now{data.coverage.pendingDecode ? `, ${data.coverage.pendingDecode} still decoding (refresh in a minute)` : ''}.</div>}
      {data && (
        <div className="flex flex-col gap-5">
          <Panel title="Protocol health sentinel" kicker={`Overall: ${sentinel.data?.overall ?? '—'}`} mode="READ-ONLY" actions={<span className="flex gap-3 text-[12px]"><Link href="/app/guardian/rates" className="text-volt-300">Rates →</Link><Link href="/app/guardian/policies" className="text-volt-300">Policies →</Link><Link href="/app/guardian/alerts" className="text-volt-300">Alerts →</Link></span>}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="sentinel">
              {(sentinel.data?.signals ?? []).map((x) => (
                <div key={x.name} className="rounded-lg border hairline p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-[12px] text-fog-200">{x.name}</span><span className={clsx('num text-[10.5px]', x.status === 'OK' ? 'text-volt-300' : x.status === 'WARN' ? 'text-amber-sim' : x.status === 'ALERT' ? 'text-rose-bad' : 'text-fog-400')}>{x.status}</span></div>
                  <div className="mt-1 text-[11px] leading-snug text-fog-400">{x.detail}</div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Panel><Stat label="Oracle price" value={data.live.latestPrice ? usd(data.live.latestPrice.priceRaw) : '—'} sub={data.live.latestPrice ? `seq ${data.live.latestPrice.sequence}` : 'no price state read'} accent /></Panel>
            <Panel><Stat label="Active loans" value={data.live.activeLoans} sub={`${data.live.staleLoans} stale (interest overdue)`} /></Panel>
            <Panel><Stat label="Lowest CR" value={`${(data.live.collateralRatioBps.min / 100).toFixed(1)}%`} sub="minimum 110%" /></Panel>
            <Panel><Stat label="Snapshot height" value={sats(data.tipHeight)} sub={new Date(data.checkedAt).toLocaleString()} /></Panel>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
            <Panel title="Price-shock simulator" kicker="What if BCH/USD fell? (computed locally from the snapshot)" mode="SIMULATION">
              <label htmlFor="shock" className="flex items-center justify-between text-[12.5px] text-fog-300"><span>BCH price drop</span><span className="num text-fog-100">−{shock}% → {usd(Math.round(shocked))}</span></label>
              <input id="shock" type="range" min={0} max={60} value={shock} onChange={(e) => setShock(Number(e.target.value))} className="mt-3 w-full accent-[#3ee0c4]" />
              <div className="mt-6 grid grid-cols-2 gap-6">
                <Stat label="Loans below 110%" value={atRisk.length} accent={atRisk.length === 0} sub={`of ${active.length} active`} />
                <Stat label="Debt at risk" value={usd(atRisk.reduce((s, l) => s + BigInt(l.debtCents), 0n))} sub="PUSD" />
              </div>
              <div className="mt-6">
                <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-fog-400">Active loans by collateral ratio</div>
                <div className="flex h-28 items-end gap-3">
                  {hist.map((n, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="num text-[11px] text-fog-300">{n}</span>
                      <motion.div className={clsx('w-full rounded-t-md', i === 0 ? 'bg-amber-sim/70' : 'bg-volt-500/60')} initial={{ height: 0 }} animate={{ height: `${(n / hmax) * 80}px` }} transition={{ duration: 0.7, delay: i * 0.06 }} />
                      <span className="text-[10.5px] text-fog-400">{BUCKETS[i][1] > 1e8 ? '300%+' : `${BUCKETS[i][0] / 100}–${BUCKETS[i][1] / 100}%`}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
            <Panel title="Operation support" kicker="Honest capability map">
              <ul className="flex flex-col gap-2.5 text-[12.5px]">
                {Object.entries(data.operations).map(([op, st]) => (
                  <li key={op} className="flex items-center justify-between gap-3"><span className="text-fog-200">{op}</span><Badge mode={(st as DataMode) in { 'READ-ONLY': 1, BLOCKED: 1, UNSUPPORTED: 1 } ? (st as DataMode) : 'IMPLEMENTED'} /></li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] leading-relaxed text-fog-400">Writing to Paryon (manage, interest changes, liquidation) needs the unpublished @paryonusd/library transaction builders and owner-approved mainnet tests, so it is BLOCKED. Paryon V2 is not deployed. Moria V1 was disabled in April 2026 and is not treated as a live venue.</p>
            </Panel>
          </div>
          <Panel title="Closest to liquidation" kicker="Active loans, lowest collateral ratio first" mode="READ-ONLY">
            <div className="scrollbar-thin -mx-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead><tr className="border-b hairline text-[10.5px] uppercase tracking-[0.12em] text-fog-400"><th className="px-5 pb-2.5 font-medium">Loan UTXO</th><th className="pb-2.5 text-right font-medium">Collateral</th><th className="pb-2.5 text-right font-medium">Debt</th><th className="pb-2.5 text-right font-medium">CR</th><th className="pb-2.5 text-right font-medium">Liq. price</th><th className="px-5 pb-2.5 text-right font-medium">Headroom</th></tr></thead>
                <tbody>
                  {sorted.slice(0, 12).map((l) => {
                    const head = price ? (1 - Number(l.liquidationPriceCents) / price) * 100 : 0;
                    return (
                      <tr key={l.outpoint} className="border-b hairline last:border-0 hover:bg-ink-800/50">
                        <td className="px-5 py-3"><a href={`https://blockchair.com/bitcoin-cash/transaction/${l.outpoint.split(':')[0]}`} target="_blank" rel="noreferrer" className="hover:text-volt-300"><Mono>{short(l.outpoint.split(':')[0], 7)}:{l.outpoint.split(':')[1]}</Mono> ↗</a></td>
                        <td className="num py-3 text-right">{(Number(l.collateralSats) / 1e8).toFixed(4)} BCH</td>
                        <td className="num py-3 text-right">{usd(l.debtCents)}</td>
                        <td className={clsx('num py-3 text-right', Number(l.collateralRatioBps) < 12500 ? 'text-amber-sim' : 'text-fog-100')}>{(Number(l.collateralRatioBps) / 100).toFixed(1)}%</td>
                        <td className="num py-3 text-right">{usd(l.liquidationPriceCents ?? 0)}</td>
                        <td className="num px-5 py-3 text-right text-fog-300">{head.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
