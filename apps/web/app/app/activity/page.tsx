'use client';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import clsx from 'clsx';
import { useEvents } from '@/lib/hooks';
import { PageHeader, Panel, Badge, Mono, Empty } from '@/components/ui';
const tone = (t: string) => (/REJECT|FAIL|REFUSED|ERROR/.test(t) ? 'text-rose-bad' : /ACCEPTED|ISSUED|SELECTED|VERIFIED/.test(t) ? 'text-volt-300' : 'text-fog-200');
export default function Activity() {
  const { events, live } = useEvents(120);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Activity" title="Network event stream" right={<span className="flex items-center gap-2 text-[12px] text-fog-300"><span className={clsx('size-2 rounded-full', live ? 'bg-volt-400 shadow-[0_0_8px_#3ee0c4]' : 'bg-fog-400')} />{live ? 'live (SSE)' : 'polling'} <Badge mode="SIMULATION" /></span>} />
      <Panel>
        {!events.length ? <Empty title="Quiet so far" body="Events appear here as solvers register, bid, and settle." /> : (
          <ol className="flex flex-col">
            <AnimatePresence initial={false}>
              {events.map((e) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="grid grid-cols-[78px_180px_1fr] gap-3 border-b hairline py-2 text-[12px] last:border-0">
                  <Mono className="text-fog-400">{new Date(e.at).toLocaleTimeString()}</Mono>
                  <span className={tone(e.type)}>{e.type}</span>
                  <span className="truncate text-fog-400" title={e.detail}>{e.auctionId && <Link href={`/app/execute/${e.auctionId}`} className="mr-2 text-fog-300 hover:text-volt-300">{e.auctionId.slice(0, 12)}</Link>}{e.detail}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </Panel>
    </div>
  );
}
