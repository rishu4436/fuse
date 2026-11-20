'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, sats, bchTrim as bch, short } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Stat, Badge, Button, ApiOffline, Mono } from '@/components/ui';
import { Table, Tr, Td, Input, Select, Bar } from '@/components/kit';

interface Health { shards: number; totalSats: bigint; leasedSats: bigint; utilizationBps: bigint; paused: number; cumulativeFees: bigint; flashCount: bigint; largestFreeSats: bigint }
interface L { health: Health; params: { feeBps: bigint; minFee: bigint; maxExposure: bigint }; leases: Array<{ id: string; outpoint: string; holder: string }>; plan: { target: bigint[]; rationale: string } }
interface V { shards: Array<{ outpoint: string; satoshis: bigint; state: { flashCount: bigint; cumulativeFees: bigint; paused: boolean } }> }

interface Hist { metrics: { points: number; peakUtilizationBps: bigint; avgUtilizationBps: bigint; maxDrawdownBps: bigint; feesEarned: bigint; flashes: bigint; pausedObservations: number }; series: Array<{ at: number; event: string; totalSats: bigint; utilizationBps: bigint }>; note: string }
function Spark({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return <div className="h-16 text-[11px] text-fog-400">Needs at least two snapshots.</div>;
  const lo = Math.min(...values), hi = Math.max(...values), d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 300).toFixed(1)},${(56 - ((v - lo) / Math.max(1e-9, hi - lo)) * 48).toFixed(1)}`).join(' ');
  return <svg viewBox="0 0 300 60" className="h-16 w-full" aria-hidden><path d={d} fill="none" strokeWidth="1.6" className={tone} /></svg>;
}
function RiskHistory() {
  const h = usePoll<Hist>('/api/liquidity/history', 5000);
  if (!h.data) return null;
  const m = h.data.metrics, pct = (b: bigint) => `${(Number(b) / 100).toFixed(2)}%`;
  return (
    <Panel title="LP risk history" kicker={`${m.points} persisted snapshots this session`} mode="SIMULATION">
      <div className="grid gap-5 md:grid-cols-[1fr_1fr_260px]" data-testid="lp-history">
        <div><div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-fog-400">Vault sats</div><Spark values={h.data.series.map((x) => Number(x.totalSats))} tone="stroke-volt-400" /></div>
        <div><div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-fog-400">Utilization</div><Spark values={h.data.series.map((x) => Number(x.utilizationBps))} tone="stroke-sky-ro" /></div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Max drawdown" value={pct(m.maxDrawdownBps)} size="md" /><Stat label="Peak util." value={pct(m.peakUtilizationBps)} size="md" />
          <Stat label="Fees earned" value={sats(m.feesEarned)} unit="sat" size="md" accent /><Stat label="Flash loans" value={String(m.flashes)} size="md" />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-fog-400">{h.data.note}</p>
    </Panel>
  );
}

export default function Liquidity() {
  const l = usePoll<L>('/api/liquidity', 3000);
  const v = usePoll<V>('/api/vault', 3000);
  const [op, setOp] = useState('deposit');
  const [shard, setShard] = useState('');
  const [amount, setAmount] = useState('1000000');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const shards = v.data?.shards ?? [];
  const sel = shard || shards[0]?.outpoint || '';
  const run = async () => {
    setMsg(undefined);
    const s = shards.find((x) => x.outpoint === sel);
    const body = op === 'merge' ? { op, shards: shards.map((x) => x.outpoint) } : op === 'split' ? { op, shard: sel, parts: s ? [s.satoshis / 2n, s.satoshis - s.satoshis / 2n - 2_000n] : [] } : op === 'pause' || op === 'unpause' ? { op: 'pause', shard: sel, paused: op === 'pause' } : { op, shard: sel, amount };
    try { const r = await api<{ ok: boolean; txid?: string; verification?: { checks: Array<{ name: string; ok: boolean }> } }>('/api/liquidity/op', { method: 'POST', json: body }); setMsg({ ok: r.ok, text: r.ok ? `Accepted on the LOCAL chain: ${r.txid}` : `Rejected by verification: ${r.verification?.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}` }); l.reload(); v.reload(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const h = l.data?.health;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Liquidity" title="FlashVault shards and LP operations" lede="Every LP operation is a transaction through the vault's owner path with a SIGHASH_ALL|FORKID|UTXOS signature, verified in the BCH VM before the local chain accepts it. The LP key is a local fixture." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={l.error} />
      <div className="grid grid-cols-2 gap-5 md:grid-cols-5">
        <Panel><Stat label="Liquidity" value={h ? bch(h.totalSats) : '—'} unit="BCH" accent /></Panel>
        <Panel><Stat label="Shards" value={h?.shards ?? '—'} sub={h ? `${h.paused} paused` : undefined} /></Panel>
        <Panel><Stat label="Leased now" value={h ? `${(Number(h.utilizationBps) / 100).toFixed(1)}%` : '—'} /></Panel>
        <Panel><Stat label="Fees earned" value={h ? sats(h.cumulativeFees) : '—'} unit="sat" /></Panel>
        <Panel><Stat label="Largest free" value={h ? bch(h.largestFreeSats) : '—'} unit="BCH" /></Panel>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Panel title="Shards" kicker={<Link href="/app/liquidity/vaults" className="hover:text-volt-300">All vaults →</Link>} mode="SIMULATION">
          <Table head={['Shard', 'Value (sat)', 'Share', 'Flashes', 'Fees', 'State']} min={620}>
            {shards.map((s) => <Tr key={s.outpoint}><Td first><Mono>{short(s.outpoint, 8)}</Mono></Td><Td num>{sats(s.satoshis)}</Td><Td><div className="w-24"><Bar value={Number(s.satoshis)} max={Number(h?.totalSats ?? 1n)} /></div></Td><Td num>{sats(s.state.flashCount)}</Td><Td num>{sats(s.state.cumulativeFees)}</Td><Td>{s.state.paused ? <span className="text-amber-sim">paused</span> : <span className="text-volt-300">active</span>}</Td></Tr>)}
          </Table>
          {l.data && <p className="mt-4 text-[11.5px] text-fog-400">Adaptive layout target: {l.data.plan.target.map((x) => bch(x)).join(' · ')} BCH. {l.data.plan.rationale}</p>}
        </Panel>
        <Panel title="LP operation" kicker="Owner path · 0x61">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <Select id="lop" label="Operation" value={op} onChange={setOp} options={[{ value: 'deposit', label: 'Deposit (top up shard)' }, { value: 'withdraw', label: 'Withdraw' }, { value: 'pause', label: 'Emergency pause' }, { value: 'unpause', label: 'Unpause' }, { value: 'merge', label: 'Merge all shards' }, { value: 'split', label: 'Split shard in two (minting baton)' }]} />
            {op !== 'merge' && <Select id="lshard" label="Shard" value={sel} onChange={setShard} options={shards.map((s) => ({ value: s.outpoint, label: `${short(s.outpoint, 6)} · ${bch(s.satoshis)} BCH` }))} />}
            {(op === 'deposit' || op === 'withdraw') && <Input id="lamt" label="Amount" value={amount} onChange={setAmount} unit="sat" />}
            <Button type="submit" data-testid="lp-submit">Sign as LP and submit locally</Button>
            {msg && <div role="status" className={`break-all text-[12px] ${msg.ok ? 'text-volt-300' : 'text-rose-bad'}`} data-testid="lp-result">{msg.text}</div>}
          </form>
        </Panel>
      </div>
      <div className="mt-5"><RiskHistory /></div>
    </div>
  );
}
