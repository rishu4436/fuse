'use client';
import Link from 'next/link';
import { usePoll } from '@/lib/hooks';
import { short, sats } from '@/lib/api';
import { PageHeader, Panel, Empty, Badge, Button, ApiOffline, Mono } from '@/components/ui';

interface Cert { certificateId: string; intentId: string; solverId: string; transactions: Array<{ txid: string }>; fees: { minerFeeSats: bigint; liquidityFee: bigint; solverFee: bigint }; outcome: { ownerReceives: Array<{ amount: bigint }> }; issuedAt: number; confirmation: string }
export default function Certificates() {
  const { data, error } = usePoll<Cert[]>('/api/certificates', 2500);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Execution certificates" title="Receipts that do not ask for trust" lede="A certificate commits to the intent, the selected quote, every input and output, the vault continuations and the outcome. The verifier re-fetches the transaction, re-hashes it and recomputes everything." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={error} />
      <Panel title={`${data?.length ?? 0} certificates`}>
        {!data?.length ? <Empty title="No certificates yet" body="Settle an auction to issue one." action={<Link href="/studio"><Button>Open Studio</Button></Link>} /> : (
          <ul className="flex flex-col divide-y divide-ink-600">
            {data.map((c) => (
              <li key={c.certificateId}>
                <Link href={`/certificates/${c.certificateId}`} className="grid grid-cols-2 gap-3 py-3.5 text-[12.5px] hover:bg-ink-800/40 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
                  <Mono className="text-volt-300">{c.certificateId}</Mono>
                  <span className="text-fog-300">tx <Mono>{short(c.transactions[0]?.txid)}</Mono></span>
                  <span className="num text-fog-200">{sats(c.outcome.ownerReceives[0]?.amount)} FUSD</span>
                  <span className="num text-fog-400">fee {sats(c.fees.minerFeeSats)} sat</span>
                  <span className="text-[11px] text-amber-sim">{c.confirmation.replace('_', ' ').toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
