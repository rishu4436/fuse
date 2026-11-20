'use client';
import { useState } from 'react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { usePoll } from '@/lib/hooks';
import { sats, short, usd } from '@/lib/api';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono } from '@/components/ui';
import { Table, Tr, Td, Select } from '@/components/kit';

interface Cand { rateRaw: bigint; aprBps: bigint; annualCostSats: bigint; shieldCents: bigint; shieldMultiple: number; loansAhead: number }
interface Rates { status: string; checkedAt: string; priceCents: bigint; loan: string; period: bigint; currentRateRaw: bigint; currentAprBps: bigint; debtCents: bigint; demandCents: bigint; demandSource: string; targetMultiple: number; peers: number; current: Cand; recommended: Cand | null; candidates: Cand[]; executable: false; blockedBy: string; notes: string[] }
interface Redemption { status: string; pools: number; oraclePriceCents: bigint; best: { amountCents: bigint; costSats: bigint; redeemSats: bigint; profitSats: bigint; profitBps: bigint; redemptionPriceCents: bigint; spot: { bestPoolSatsPerCent: number; redemptionSatsPerCent: number; discountBps: number }; target: { loan: string; rateRaw: bigint; debtCents: bigint } | null; risks: string[]; executable: false; blockedBy: string }; curve: Array<{ amountCents: bigint; profitSats: bigint }> }
const pct = (bps: bigint | number) => `${(Number(bps) / 100).toFixed(2)}%`;

function Curve({ points }: { points: Array<{ amountCents: bigint; profitSats: bigint }> }) {
  if (!points.length) return null;
  const xs = points.map((p) => Number(p.amountCents)), ys = points.map((p) => Number(p.profitSats));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(0, ...ys), Math.max(0, ...ys)];
  const X = (x: number) => 8 + ((x - x0) / Math.max(1, x1 - x0)) * 584, Y = (y: number) => 8 + (1 - (y - y0) / Math.max(1, y1 - y0)) * 144;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(Number(p.amountCents)).toFixed(1)},${Y(Number(p.profitSats)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 600 160" className="h-40 w-full" role="img" aria-label="Redemption profit by size">
      <line x1="8" x2="592" y1={Y(0)} y2={Y(0)} className="stroke-ink-500" strokeDasharray="3 4" />
      <motion.path d={d} fill="none" className={ys.some((y) => y > 0) ? 'stroke-volt-400' : 'stroke-rose-bad'} strokeWidth="1.8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
      <text x="592" y={Y(0) - 6} textAnchor="end" className="fill-fog-400 text-[10px]">break-even</text>
    </svg>
  );
}

export default function RatesPage() {
  const [multiple, setMultiple] = useState('2');
  const r = usePoll<Rates>(`/api/guardian/rates?multiple=${multiple}`, 0);
  const x = usePoll<Redemption>('/api/opportunities/redemption', 0);
  const d = r.data;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Guardian · Interest rate optimizer" title="Pay the least interest that still keeps you out of redemptions"
        lede="Paryon redeems against the lowest-rate mature loan first (Redemption.swapTargetLoan requires a strictly lower rate). The optimizer ranks your loan against every active peer in the mainnet snapshot and finds the cheapest rate whose queue ahead of you covers the redemption demand by your chosen multiple. Advice only: rate changes need Paryon's builders."
        right={<Badge mode="READ-ONLY" />} />
      <ApiOffline error={r.error} />
      {d && (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Panel><Stat label="Current APR" value={pct(d.currentAprBps)} sub={<>raw rate <span className="num">{String(d.currentRateRaw)}</span></>} /></Panel>
            <Panel><Stat label="Recommended APR" value={d.recommended ? pct(d.recommended.aprBps) : '—'} accent sub={d.recommended ? <>saves <span className="num">{sats(d.current.annualCostSats - d.recommended.annualCostSats)}</span> sat/yr</> : 'no safe cheaper rate'} /></Panel>
            <Panel><Stat label="Shield ahead of you" value={usd(d.recommended?.shieldCents ?? d.current.shieldCents)} sub={`${(d.recommended ?? d.current).loansAhead} ${(d.recommended ?? d.current).loansAhead === 1 ? "loan" : "loans"} with lower rates`} /></Panel>
            <Panel><Stat label="Redemption demand" value={usd(d.demandCents)} sub={d.demandSource} /></Panel>
          </div>
          <Panel title="Candidate rates" kicker={<>loan <Mono>{short(d.loan, 8)}</Mono> · debt {usd(d.debtCents)} · {d.peers} active peers · period {String(d.period)}</>} mode="READ-ONLY"
            actions={<div className="w-40"><Select id="multiple" label="Safety multiple" value={multiple} onChange={setMultiple} options={[{ value: '1', label: '1× demand' }, { value: '2', label: '2× demand' }, { value: '5', label: '5× demand' }, { value: '10', label: '10× demand' }]} /></div>}>
            <Table head={['Rate (raw)', 'APR', 'Annual cost', 'Shield ahead', 'Cover', 'Verdict']} min={720}>
              {d.candidates.map((c) => {
                const isRec = d.recommended?.rateRaw === c.rateRaw, isCur = c.rateRaw === d.currentRateRaw, safe = c.shieldMultiple >= d.targetMultiple;
                return (
                  <Tr key={String(c.rateRaw)} className={clsx(isRec && 'bg-volt-400/[0.06]')}>
                    <Td first num>{String(c.rateRaw)}</Td><Td num>{pct(c.aprBps)}</Td><Td num>{sats(c.annualCostSats)} sat</Td><Td num>{usd(c.shieldCents)}</Td><Td num>{c.shieldMultiple.toFixed(1)}×</Td>
                    <Td><span className={clsx('text-[11.5px]', isRec ? 'text-volt-300' : safe ? 'text-fog-300' : 'text-rose-bad')}>{isRec ? 'Recommended' : isCur ? 'Current' : safe ? 'Safe, costs more' : 'Exposed'}</span></Td>
                  </Tr>
                );
              })}
            </Table>
            <p className="mt-4 text-[11.5px] leading-relaxed text-fog-400">Interest per period = rate × borrowed value / 10,000,000; one period is 144 blocks. Not executable: {d.blockedBy}.</p>
          </Panel>
        </div>
      )}
      <div className="mt-5">
        <Panel title="Redemption arbitrage search" kicker={x.data ? `${x.data.pools} Cauldron PUSD pools · oracle ${usd(x.data.oraclePriceCents)}` : 'loading'} mode="READ-ONLY">
          <ApiOffline error={x.error} />
          {x.data && (
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]" data-testid="redemption">
              <div>
                <Curve points={x.data.curve} />
                <p className="text-[11.5px] text-fog-400">Profit in sats by PUSD amount bought on Cauldron (exact constant-product fills) and redeemed at oracle × 1.005.</p>
              </div>
              <div className="grid content-start gap-3">
                <Stat label="Best size" value={usd(x.data.best.amountCents)} size="md" />
                <Stat label="Profit" value={`${sats(x.data.best.profitSats)} sat`} sub={pct(x.data.best.profitBps)} size="md" accent={x.data.best.profitSats > 0n} />
                <div className="text-[11.5px] text-fog-400">Pool spot {x.data.best.spot.bestPoolSatsPerCent.toFixed(1)} sat/¢ vs redemption {x.data.best.spot.redemptionSatsPerCent.toFixed(1)} sat/¢ ({x.data.best.spot.discountBps} bps)</div>
                <ul className="grid gap-1.5 text-[11.5px] text-fog-300">{x.data.best.risks.map((k) => <li key={k} className="flex gap-2"><span className="text-amber-sim" aria-hidden>!</span>{k}</li>)}</ul>
                <div className="rounded-lg border border-rose-bad/30 bg-rose-bad/[0.05] p-3 text-[11.5px] text-fog-300"><Badge mode="BLOCKED" /> <span className="ml-1">{x.data.best.blockedBy}</span></div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
