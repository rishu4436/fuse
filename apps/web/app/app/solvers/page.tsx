'use client';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
import type { Solver } from '@/lib/types';
import { PageHeader, Panel, Empty, Badge, ApiOffline, Mono, Stat } from '@/components/ui';

const desc: Record<string, string> = {
  DIRECT_LIQUIDITY: 'Sells from its own token inventory at the pool reference price plus a markup.',
  ROUTING: 'Routes the order through the best single Cauldron pool and charges a small fee.',
  FLASH_LIQUIDITY: 'Borrows a FlashVault shard, back-runs the price gap between two pools, and rebates part of the profit to you.',
  ADVERSARIAL_FIXTURE: 'Test adversary. Claims it delivers the full amount but skims 1%. It should always be rejected.',
};

export default function Solvers() {
  const { data, error } = usePoll<Solver[]>('/api/solvers', 2000);
  const total = data?.reduce((s, x) => s + x.bids, 0) ?? 0;
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
    </div>
  );
}
