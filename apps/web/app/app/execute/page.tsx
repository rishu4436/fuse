'use client';
import Link from 'next/link';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
import type { Auction } from '@/lib/types';
import { PageHeader, Panel, StatusDot, Empty, Button, Badge, ApiOffline, Mono } from '@/components/ui';

export default function Auctions() {
  const { data, error } = usePoll<Auction[]>('/api/auctions', 1500);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Auctions" title="Every intent, every bid, every verdict" right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={error} />
      <Panel title={`${data?.length ?? 0} auctions`}>
        {!data?.length ? <Empty title="No auctions yet" body="Run one from the Intent Studio." action={<Link href="/app/execute/new"><Button>Open Studio</Button></Link>} /> : (
          <div className="scrollbar-thin -mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12.5px]">
              <thead><tr className="border-b hairline text-[10.5px] uppercase tracking-[0.12em] text-fog-400"><th className="px-5 pb-2.5 font-medium">Auction</th><th className="pb-2.5 font-medium">Status</th><th className="pb-2.5 text-right font-medium">Min receive</th><th className="pb-2.5 text-right font-medium">Bids</th><th className="pb-2.5 text-right font-medium">Rejected</th><th className="px-5 pb-2.5 text-right font-medium">Transaction</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.auctionId} className="border-b hairline last:border-0 hover:bg-ink-800/60">
                    <td className="px-5 py-3"><Link href={`/app/execute/${a.auctionId}`} className="num text-volt-300 hover:text-volt-400">{a.auctionId}</Link></td>
                    <td className="py-3"><StatusDot status={a.status} /></td>
                    <td className="num py-3 text-right">{sats(a.intent.minOut)}</td>
                    <td className="num py-3 text-right">{a.bids.length}</td>
                    <td className="num py-3 text-right text-rose-bad/90">{a.bids.filter((b) => b.valid === false).length}</td>
                    <td className="px-5 py-3 text-right"><Mono>{short(a.txid)}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
