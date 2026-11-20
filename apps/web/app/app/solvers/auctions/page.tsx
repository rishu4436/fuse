'use client';
import Link from 'next/link';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
import type { Auction } from '@/lib/types';
import { PageHeader, Panel, Badge, ApiOffline, Empty, Mono } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

export default function SolverAuctions() {
  const { data, error } = usePoll<Auction[]>('/api/auctions', 2500);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Solvers · Auctions" title="Every bid, from the solver's side" lede="Each row is one bid: what the solver claimed, what FUSE recomputed from the template, and why it won or lost." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={error} />
      <Panel>
        {!data?.length ? <Empty title="No auctions yet" /> : (
          <Table head={['Auction', 'Solver', 'Strategy', 'Claimed spend', 'Verified spend', 'Result']} min={820}>
            {data.flatMap((a) => a.bids.map((b) => (
              <Tr key={a.auctionId + b.solverId}>
                <Td first><Link href={`/app/execute/${a.auctionId}`} className="num text-volt-300">{short(a.auctionId, 6)}</Link></Td>
                <Td><Mono>{short(b.solverId, 6)}</Mono></Td>
                <Td><span className="num text-[11.5px]">{b.strategy}</span></Td>
                <Td num>{sats(b.claims.userPaysSats)}</Td>
                <Td num>{b.actual ? sats(b.actual.userNetSpendSats) : '—'}</Td>
                <Td>{b.winner ? <span className="text-volt-300">winner</span> : b.valid === false ? <span className="text-rose-bad" title={b.reasons?.join('; ')}>rejected</span> : b.valid ? <span className="text-fog-300">valid · rank {b.rank}</span> : <span className="text-fog-400">pending</span>}</Td>
              </Tr>
            )))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
