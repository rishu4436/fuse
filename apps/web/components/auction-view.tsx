'use client';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
import type { Auction, BidRow } from '@/lib/types';
import { Badge, Panel, Stat, StatusDot, ApiOffline, Mono } from './ui';
import { TxGraph } from './tx-graph';

const strategyLabel: Record<string, string> = { DIRECT_LIQUIDITY: 'Direct inventory', ROUTING: 'Pool routing', FLASH_LIQUIDITY: 'Flash back-run', ADVERSARIAL_FIXTURE: 'Adversarial fixture' };

function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 200); return () => clearInterval(t); }, []);
  const left = Math.max(0, to - now);
  return <span className="num">{left.toFixed(1)}s</span>;
}

const PIPE = ['OPEN', 'EVALUATING', 'AWAITING_SIGNATURES', 'BROADCAST', 'SETTLED'] as const;
function Pipeline({ status }: { status: string }) {
  const idx = status === 'FAILED' ? -1 : PIPE.indexOf(status as (typeof PIPE)[number]);
  const labels = ['Bidding', 'Verifying in VM', 'Signing', 'Broadcast', 'Settled'];
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Auction progress">
      {labels.map((l, i) => (
        <li key={l} className="min-w-0">
          <div className="h-1 overflow-hidden rounded-full bg-ink-700">
            <motion.div className={clsx('h-full', status === 'FAILED' ? 'bg-rose-bad' : 'bg-volt-400')} initial={{ width: 0 }} animate={{ width: i <= idx ? '100%' : '0%' }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} />
          </div>
          <div className={clsx('mt-2 truncate text-[11px]', i <= idx ? 'text-fog-100' : 'text-fog-400')}>{l}</div>
        </li>
      ))}
    </ol>
  );
}

function BidTable({ bids, onPick, picked }: { bids: BidRow[]; onPick: (i: number) => void; picked: number }) {
  return (
    <div className="scrollbar-thin -mx-5 overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-[12.5px]">
        <thead>
          <tr className="border-b hairline text-[10.5px] uppercase tracking-[0.12em] text-fog-400">
            <th className="px-5 pb-2.5 font-medium">Solver</th><th className="pb-2.5 font-medium">Strategy</th>
            <th className="pb-2.5 text-right font-medium">You get · claimed → verified</th>
            <th className="pb-2.5 text-right font-medium">Net spend</th><th className="pb-2.5 text-right font-medium">Fee</th>
            <th className="px-5 pb-2.5 text-right font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {bids.map((b, i) => (
              <motion.tr key={b.templateHash} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: i * 0.05 }}
                onClick={() => b.template && onPick(i)} tabIndex={b.template ? 0 : -1} onKeyDown={(e) => e.key === 'Enter' && b.template && onPick(i)}
                className={clsx('cursor-pointer border-b hairline transition-colors last:border-0 hover:bg-ink-800/60', picked === i && 'bg-ink-800/80', b.winner && 'shadow-[inset_2px_0_0_#3ee0c4]')} data-testid={`bid-${b.strategy}`}>
                <td className="px-5 py-3"><Mono>{short(b.solverId.replace('solver_', ''), 4)}</Mono></td>
                <td className="py-3 text-fog-100">{strategyLabel[b.strategy] ?? b.strategy}</td>
                <td className="num py-3 text-right"><span className="text-fog-400">{sats(b.claims.userReceivesTokens)} → </span><span className={clsx(b.actual && b.actual.userReceivesTokens < b.claims.userReceivesTokens ? 'text-rose-bad' : 'text-fog-100')}>{b.actual ? sats(b.actual.userReceivesTokens) : '…'}</span></td>
                <td className="num py-3 text-right text-fog-100">{b.actual ? sats(b.actual.userNetSpendSats) : '…'}</td>
                <td className="num py-3 text-right text-fog-300">{b.actual ? sats(b.actual.minerFeeSats) : '…'}</td>
                <td className="px-5 py-3 text-right">
                  {b.valid === null ? <span className="text-fog-400">pending</span>
                    : b.winner ? <span className="inline-flex items-center gap-1.5 rounded-full bg-volt-400/12 px-2 py-0.5 text-[11px] font-medium text-volt-300">Winner · #{b.rank}</span>
                    : b.valid ? <span className="text-[11.5px] text-fog-200">Valid · #{b.rank}</span>
                    : <span className="text-[11.5px] font-medium text-rose-bad">Rejected</span>}
                </td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

export function AuctionView({ id }: { id: string }) {
  const { data: a, error } = usePoll<Auction>(`/api/auctions/${id}`, 700);
  const [picked, setPicked] = useState<number>(-1);
  if (error && !a) return <ApiOffline error={error} />;
  if (!a) return <div className="h-40 animate-pulse rounded-2xl bg-ink-800/50" />;
  const winnerIdx = a.bids.findIndex((b) => b.winner);
  const sel = picked >= 0 ? a.bids[picked] : a.bids[winnerIdx] ?? a.bids.find((b) => b.template);
  const routing = a.bids.find((b) => b.strategy === 'ROUTING' && b.valid);
  const winner = a.bids[winnerIdx];
  const saved = winner?.actual && routing?.actual && winner !== routing ? routing.actual.userNetSpendSats - winner.actual.userNetSpendSats : null;
  const rejected = a.bids.filter((b) => b.valid === false);
  return (
    <div className="flex flex-col gap-5">
      <Panel kicker={<span className="num">{a.auctionId}</span>} title={<span className="flex items-center gap-3">Buy {sats(a.intent.minOut)} FUSD for at most {sats(a.intent.maxIn)} sats <StatusDot status={a.status} /></span>} mode="SIMULATION"
        actions={a.status === 'OPEN' ? <span className="text-[12px] text-fog-300">closes in <Countdown to={a.closesAt} /></span> : null}>
        <Pipeline status={a.status} />
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
          <Stat size="md" label="Bids received" value={a.bids.length} sub={`${a.bids.filter((b) => b.valid).length} passed VM verification`} />
          <Stat size="md" label="You pay (verified)" value={winner?.actual ? sats(winner.actual.userNetSpendSats) : '—'} unit="sat" accent />
          <Stat size="md" label="You receive" value={winner?.actual ? sats(winner.actual.userReceivesTokens) : '—'} unit="FUSD" sub={`minimum ${sats(a.intent.minOut)}`} />
          <Stat size="md" label="Better than plain routing" value={saved !== null ? sats(saved) : '—'} unit={saved !== null ? 'sat' : undefined} sub={saved !== null ? 'from a flash back-run rebate' : 'shown once both bids are verified'} />
        </div>
        {a.error && <div className="mt-5 rounded-lg border border-rose-bad/30 bg-rose-bad/5 px-3 py-2 text-[12.5px] text-rose-bad">{a.error}</div>}
      </Panel>

      <Panel title="Solver bids" kicker="Each bid is re-checked against the template. Solver claims are not trusted.">
        {a.bids.length ? <BidTable bids={a.bids} onPick={setPicked} picked={picked >= 0 ? picked : winnerIdx} /> : <div className="py-6 text-center text-[13px] text-fog-400">Waiting for solvers… start them with <code className="num">pnpm solvers</code>.</div>}
        {rejected.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {rejected.map((b) => (
              <div key={b.templateHash} className="rounded-lg border border-rose-bad/25 bg-rose-bad/[0.05] px-3.5 py-2.5 text-[12px]" data-testid="rejection">
                <span className="font-medium text-rose-bad">{strategyLabel[b.strategy] ?? b.strategy} rejected:</span>{' '}
                <span className="text-fog-200">{b.reasons?.join(' · ')}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {sel?.template && (
        <Panel title={`${strategyLabel[sel.strategy] ?? sel.strategy}: transaction ${sel.winner ? '(selected)' : '(preview)'}`} kicker={sel.explanation}
          actions={a.certificateId && sel.winner ? <Link href={`/certificates/${a.certificateId}`} className="text-[12.5px] text-volt-300 hover:text-volt-400">Open certificate →</Link> : null}>
          <TxGraph key={sel.templateHash} template={sel.template} txid={sel.winner ? a.txid : undefined} caption="Every arrow is a real input or output in the transaction. FlashVault liquidity is borrowed and repaid inside the same transaction." />
          {sel.verification && (
            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sel.verification.checks.map((c) => (
                <div key={c.name} className="flex items-start gap-2 rounded-lg border hairline bg-ink-850 px-3 py-2">
                  <span className={clsx('mt-1 size-1.5 shrink-0 rounded-full', c.ok ? 'bg-volt-400' : 'bg-rose-bad')} />
                  <div className="min-w-0"><div className="text-[12px] text-fog-100">{c.name}</div><div className="truncate text-[11px] text-fog-400" title={c.detail}>{c.detail}</div></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      <Panel title="Auction log">
        <ol className="flex flex-col gap-1.5">
          {a.events.map((e, i) => (
            <li key={i} className="grid grid-cols-[86px_170px_1fr] gap-3 text-[12px]"><Mono className="text-fog-400">{new Date(e.at * 1000).toLocaleTimeString()}</Mono><span className="text-fog-200">{e.type}</span><span className="truncate text-fog-400" title={e.detail}>{e.detail}</span></li>
          ))}
        </ol>
        <div className="mt-3"><Badge mode="SIMULATION" /> <span className="text-[11.5px] text-fog-400">Settled on the local mock chain with the BCH 2026 VM. Not on mainnet.</span></div>
      </Panel>
    </div>
  );
}
