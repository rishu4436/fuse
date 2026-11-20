'use client';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
import type { Solver } from '@/lib/types';
import { PageHeader, Panel, Empty, Badge, ApiOffline, Mono, Stat } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

interface Perf { solverId: string; name: string; strategy: string; bids: number; wins: number; losses: number; rejected: number; leaseConflicts: number; fallbacks: number; winRateBps: number; validityRateBps: number; avgLatencyMs: number; revenueSats: bigint; userImprovementSats: bigint; topRejections: Array<{ reason: string; count: number }> }
const pct = (b: number) => `${(b / 100).toFixed(1)}%`;

const desc: Record<string, string> = {
  DIRECT_LIQUIDITY: 'Sells from its own token inventory at the pool reference price plus a markup.',
  ROUTING: 'Routes the order through the best single Cauldron pool and charges a small fee.',
  FLASH_LIQUIDITY: 'Borrows a FlashVault shard, back-runs the price gap between two pools, and rebates part of the profit to you.',
  ADVERSARIAL_FIXTURE: 'Test adversary. Claims it delivers the full amount but skims 1%. It should always be rejected.',
};

export default function Solvers() {
  const { data, error } = usePoll<Solver[]>('/api/solvers', 2000);
  const total = data?.reduce((s, x) => s + x.bids, 0) ?? 0;
  const perf = usePoll<Perf[]>('/api/solvers/performance', 4000);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Solver network" title="Independent solvers, authenticated bids" lede="Each solver is its own OS process with its own key. Bids are Schnorr-signed over a commitment to the exact transaction template. Nonces cannot be replayed, and bids are rate limited." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={error} />
      <div className="mb-5 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Panel><Stat label="Registered" value={data?.length ?? '—'} /></Panel>
        <Panel><Stat label="Bids" value={total} /></Panel>
        <Panel><Stat label="Rejected by verifier" value={data?.reduce((s, x) => s + x.rejected, 0) ?? '—'} /></Panel>
        <Panel><Stat label="Solver revenue" value={sats(data?.reduce((s, x) => s + x.revenueSats, 0n) ?? 0n)} unit="sat" accent /></Panel>
      </div>
      {!data?.length ? <Panel><Empty title="No solvers registered" body={<>Start the reference workers with <code className="num">pnpm solvers</code>.</>} /></Panel> : (
        <div className="grid gap-5 md:grid-cols-2">
          {data.map((s) => (
            <Panel key={s.solverId} title={s.name} kicker={<Mono className="text-fog-400">{s.solverId}</Mono>} mode={s.strategy === 'ADVERSARIAL_FIXTURE' ? 'BLOCKED' : undefined}>
              <p className="mb-5 text-[12.5px] leading-relaxed text-fog-300">{desc[s.strategy]}</p>
              <div className="grid grid-cols-4 gap-4">
                <Stat label="Bids" value={s.bids} /><Stat label="Wins" value={s.wins} accent={s.wins > 0} /><Stat label="Rejected" value={s.rejected} /><Stat label="Revenue" value={sats(s.revenueSats)} unit="sat" />
              </div>
              <div className="mt-4 text-[11px] text-fog-400">pubkey <Mono className="text-fog-400">{short(s.pubkey, 10)}</Mono></div>
            </Panel>
          ))}
        </div>
      )}
      <div className="mt-5">
        <Panel title="Performance ledger" kicker="persisted in SQLite · survives restarts" mode="SIMULATION">
          {!perf.data?.length ? <Empty title="No ledger rows yet" /> : (
            <Table head={['Solver', 'Bids', 'Win rate', 'Valid', 'Avg latency', 'Lease conflicts', 'Revenue', 'User improvement', 'Top rejection']} min={980}>
              {perf.data.map((p) => <Tr key={p.solverId}><Td first>{p.name}</Td><Td num>{p.bids}</Td><Td num>{pct(p.winRateBps)}</Td><Td num>{pct(p.validityRateBps)}</Td><Td num>{p.avgLatencyMs} ms</Td><Td num>{p.leaseConflicts}</Td><Td num>{sats(p.revenueSats)}</Td><Td num>{sats(p.userImprovementSats)}</Td><Td><span className="text-[11.5px] text-fog-400">{p.topRejections[0] ? `${p.topRejections[0].reason} (${p.topRejections[0].count})` : '—'}</span></Td></Tr>)}
            </Table>
          )}
          <p className="mt-3 text-[11px] text-fog-400">User improvement = tokens or sats a winning bid gave beyond the next-best valid bid, summed. Latency = bid receipt minus auction open.</p>
        </Panel>
      </div>
    </div>
  );
}
