'use client';
import { useState } from 'react';
import { motion } from 'motion/react';
import { api, sats } from '@/lib/api';
import { PageHeader, Panel, Badge, Button } from '@/components/ui';
import { Input, Bar } from '@/components/kit';

interface W { scenario: { id: string; label: string }; ok: boolean; strategy?: string; userNetSpendSats?: bigint; deltaVsBaseSats?: bigint; failedAt?: string; reason?: string; poolOnlyCostSats: bigint; explanation?: string }

export default function Worlds() {
  const [minOut, setMinOut] = useState('30000');
  const [maxIn, setMaxIn] = useState('40000000');
  const [res, setRes] = useState<W[]>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const run = async () => {
    setBusy(true); setErr(undefined);
    try { const d = await api<unknown>(`/api/compile/draft?minOut=${minOut}&maxIn=${maxIn}`); setRes(await api<W[]>('/api/parallel-worlds', { method: 'POST', json: d })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const max = Math.max(1, ...(res ?? []).map((r) => Number(r.userNetSpendSats ?? r.poolOnlyCostSats)));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Parallel Worlds" title="One intent, six markets" lede="The compiler runs your intent against perturbed copies of the current market: a closed arbitrage gap, a wider gap, thin liquidity, a paused vault and a single solver. Every world is composed and checked in the BCH VM." right={<Badge mode="SIMULATION" />} />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Panel title="Intent">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <Input id="wout" label="Receive at least" value={minOut} onChange={setMinOut} unit="FUSD" />
            <Input id="win" label="Spend at most" value={maxIn} onChange={setMaxIn} unit="sat" />
            <Button type="submit" disabled={busy} data-testid="run-worlds">{busy ? 'Simulating…' : 'Run all worlds'}</Button>
            {err && <div role="alert" className="text-[12px] text-rose-bad">{err}</div>}
          </form>
        </Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          {(res ?? []).map((r, i) => (
            <motion.div key={r.scenario.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="panel p-4" data-testid={`world-${r.scenario.id}`}>
              <div className="text-[11px] uppercase tracking-[0.12em] text-fog-400">{r.scenario.id}</div>
              <div className="mt-1 text-[13.5px] text-fog-100">{r.scenario.label}</div>
              {r.ok ? (
                <>
                  <div className="mt-3 flex items-baseline justify-between"><span className="num text-[18px] text-fog-100">{sats(r.userNetSpendSats)}</span><span className="num text-[11.5px] text-fog-400">sat net</span></div>
                  <div className="mt-2"><Bar value={Number(r.userNetSpendSats)} max={max} /></div>
                  <div className="mt-2 flex justify-between text-[11.5px]"><span className="num text-volt-300">{r.strategy}</span><span className={`num ${r.deltaVsBaseSats && r.deltaVsBaseSats > 0n ? 'text-rose-bad' : 'text-volt-300'}`}>{r.deltaVsBaseSats === undefined ? '' : `${r.deltaVsBaseSats > 0n ? '+' : ''}${sats(r.deltaVsBaseSats)} vs base`}</span></div>
                  <div className="mt-1 text-[11px] text-fog-400">Pool-only price: {sats(r.poolOnlyCostSats)} sat</div>
                </>
              ) : <div className="mt-3 text-[12px] text-rose-bad">Stopped at {r.failedAt}: {r.reason}</div>}
            </motion.div>
          ))}
          {!res && <Panel className="sm:col-span-2"><p className="py-10 text-center text-[13px] text-fog-400">Run the worlds to compare outcomes.</p></Panel>}
        </div>
      </div>
    </div>
  );
}
