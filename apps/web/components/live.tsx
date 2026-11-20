'use client';
// LIVE (BCH mainnet) views used when the app is in LIVE mode. Every number here is read from chain this request.
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';
import { api, sats, short, bchTrim as bch } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Stat, Badge, Button, Mono, ApiOffline } from './ui';

const TX = (t: string) => `https://bchexplorer.cash/tx/${t}`;
interface Hop { txid: string; vout: number; satoshis: bigint; kind: string; flashCount?: bigint; cumulativeFees?: bigint }
export interface LiveVault { id: string; label: string; configuredStatus: string; open: boolean; address: string; category: string; owner: string; params: { feeBps: bigint; minFee: bigint; maxExposure: bigint; ownerPkh: string }; current: { txid: string; vout: number; satoshis: bigint; state: { flashCount: bigint; cumulativeFees: bigint; paused: boolean } } | null; history: Hop[]; error?: string }

export function LiveFlashVault() {
  const { data, error, loading } = usePoll<LiveVault[]>('/api/live/vaults', 30000);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="FlashVault · BCH mainnet" title="Live FlashVault" lede="FlashVaultBCH covenants on mainnet, tracked from their identity-NFT genesis through every spend. Anyone can flash-borrow the principal; repayment + fee is enforced by the covenant in the same transaction." right={<Badge mode="LIVE" />} />
      <ApiOffline error={error} />
      {loading && <div className="text-[12px] text-fog-400">Reading mainnet…</div>}
      <div className="grid gap-5" data-testid="live-vaults">
        {(data ?? []).map((v) => (
          <Panel key={v.id} title={`${v.id} · ${v.label}`} actions={<Badge mode={v.open ? 'LIVE' : 'READ-ONLY'} />}>
            {v.error ? <div className="text-[12px] text-rose-bad">{v.error}</div> : (
              <>
                <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
                  <Stat label="Principal" value={v.current ? sats(v.current.satoshis) : 'closed'} unit={v.current ? 'sats' : undefined} accent={v.open} size="md" />
                  <Stat label="Flash loans" value={v.current ? sats(v.current.state.flashCount) : '—'} size="md" />
                  <Stat label="Fees earned" value={v.current ? sats(v.current.state.cumulativeFees) : '—'} unit="sats" size="md" />
                  <Stat label="Fee" value={`${v.params.feeBps} bps`} sub={`min ${sats(v.params.minFee)} sats`} size="md" />
                </div>
                <div className="mt-4 grid gap-1 text-[11.5px] text-fog-400">
                  <div>address <Mono className="break-all text-fog-200">{v.address}</Mono></div>
                  <div>identity category <Mono className="text-fog-200">{short(v.category, 10)}</Mono> · owner <Mono className="text-fog-200">{v.owner}</Mono></div>
                </div>
                <table className="mt-4 w-full text-[11.5px]">
                  <thead className="text-left text-fog-500"><tr><th className="py-1">#</th><th>transition</th><th>txid</th><th className="text-right">vault sats</th><th className="text-right">flashes</th></tr></thead>
                  <tbody>{v.history.map((h, i) => <tr key={h.txid} className="border-t hairline"><td className="py-1 text-fog-500">{i}</td><td className="num text-volt-400">{h.kind}</td><td><a href={TX(h.txid)} target="_blank" rel="noreferrer" className="hover:text-fog-100"><Mono className="text-fog-300">{short(h.txid, 10)}</Mono></a></td><td className="num text-right text-fog-200">{h.kind === 'closed' ? '—' : sats(h.satoshis)}</td><td className="num text-right text-fog-300">{h.flashCount !== undefined ? sats(h.flashCount) : '—'}</td></tr>)}</tbody>
                </table>
                {v.open && <Link href="/app/execute/live" className="mt-4 inline-block text-[12.5px] text-volt-300 hover:underline">Flash-borrow from this vault →</Link>}
              </>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}

interface Pool { poolId: string; ownerPkh: string; txid: string; vout: number; satoshis: bigint; tokens: bigint; satsPerUnit: number }
export function LivePools() {
  const { data, error, loading } = usePoll<{ pools: Pool[]; indexerCount: number; checkedAt: string; source: string; bestRoundTrip1Unit: { buyPool: string; sellPool: string; satsIn: bigint; satsOut: bigint; loss: bigint } | null }>('/api/live/cauldron', 60000);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Cauldron · BCH mainnet" title="Live Cauldron PUSD pools" lede="Pools listed by the Cauldron indexer; each one shown here was re-verified against its raw mainnet output (script, category, sats, tokens). FUSE can route a flash loan through two of them atomically." right={<Badge mode="LIVE" />} />
      <ApiOffline error={error} />
      {loading && <div className="text-[12px] text-fog-400">Reading mainnet…</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Panel><Stat label="Indexer pools" value={data.indexerCount} size="md" /></Panel>
            <Panel><Stat label="Verified on chain" value={data.pools.length} size="md" /></Panel>
            <Panel><Stat label="Best 1-unit round trip" value={data.bestRoundTrip1Unit ? `−${sats(data.bestRoundTrip1Unit.loss)}` : '—'} unit="sats" size="md" sub="buy on A, sell on B" /></Panel>
            <Panel><Stat label="Checked" value={new Date(data.checkedAt).toLocaleTimeString()} size="md" /></Panel>
          </div>
          <Panel title="Verified pools" className="mt-5">
            <table className="w-full text-[11.5px]" data-testid="live-pools">
              <thead className="text-left text-fog-500"><tr><th className="py-1">pool</th><th>outpoint</th><th className="text-right">BCH</th><th className="text-right">PUSD</th><th className="text-right">sats / PUSD unit</th></tr></thead>
              <tbody>{data.pools.map((p) => <tr key={p.poolId} className="border-t hairline"><td className="py-1"><Mono className="text-fog-200">{short(p.poolId, 6)}</Mono></td><td><a href={TX(p.txid)} target="_blank" rel="noreferrer"><Mono className="text-fog-400">{short(p.txid, 6)}:{p.vout}</Mono></a></td><td className="num text-right text-fog-200">{bch(p.satoshis)}</td><td className="num text-right text-fog-200">{(Number(p.tokens) / 100).toLocaleString('en-US')}</td><td className="num text-right text-fog-300">{p.satsPerUnit.toFixed(1)}</td></tr>)}</tbody>
            </table>
            <p className="mt-3 text-[11.5px] text-fog-400">A round trip loses 2 × 0.3% pool fee plus rounding; it proves atomic routing, not profit. Profitable arbitrage needs pools that diverge by more than that. Source: {data.source}</p>
          </Panel>
        </>
      )}
    </div>
  );
}

export function LiveCertificates() {
  const vaults = usePoll<LiveVault[]>('/api/live/vaults', 0);
  const [txid, setTxid] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, unknown> & { kind?: string; verification?: { status: string; note: string; checks: Array<{ name: string; ok: boolean; detail?: string }> } }>();
  const [err, setErr] = useState<string>();
  const check = async (t: string) => { setTxid(t); setBusy(true); setErr(undefined); setRes(undefined); try { setRes(await api('/api/live/certificate', { method: 'POST', json: { txid: t } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const hops = (vaults.data ?? []).flatMap((v) => (v.history ?? []).filter((h) => h.kind !== 'genesis').map((h) => ({ ...h, vault: v.id })));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Certificates · BCH mainnet" title="Mainnet execution certificates" lede="A certificate is rebuilt from the confirmed mainnet transaction and verified independently: inputs, outputs, vault state before/after, pool legs and the k-invariant. Nothing here is taken from FUSE's own database." right={<Badge mode="VERIFIED" />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Panel title="Vault transactions on mainnet">
          <ul className="grid gap-1.5 text-[12px]" data-testid="live-cert-list">
            {hops.map((h) => <li key={h.txid} className="flex items-center justify-between gap-2"><span className="num text-volt-400">{h.kind}</span><Mono className="text-fog-300">{short(h.txid, 10)}</Mono><Button variant="quiet" onClick={() => check(h.txid)} disabled={busy}>Verify</Button></li>)}
            {!hops.length && <li className="text-fog-400">{vaults.loading ? 'Reading mainnet…' : 'No vault transactions yet'}</li>}
          </ul>
          <div className="mt-4 flex gap-2">
            <input value={txid} onChange={(e) => setTxid(e.target.value.trim())} placeholder="any FUSE mainnet txid" className="flex-1 rounded-md border hairline bg-ink-900 px-2 py-1 font-mono text-[11.5px] text-fog-100" />
            <Button variant="ghost" onClick={() => check(txid)} disabled={busy || !/^[0-9a-f]{64}$/.test(txid)}>Verify</Button>
          </div>
        </Panel>
        <Panel title="Verification">
          {busy && <div className="text-[12px] text-amber-sim">Reading the transaction from mainnet and verifying…</div>}
          {err && <div role="alert" className="text-[12px] text-rose-bad">{err}</div>}
          {res?.verification && (
            <div className="text-[12px]" data-testid="live-cert-result">
              <div className={clsx('mb-2 font-medium', res.verification.status === 'VERIFIED' ? 'text-volt-300' : 'text-rose-bad')}>{res.verification.status} · {res.kind}</div>
              <div className="mb-2 text-fog-400">{res.verification.note}</div>
              <ul className="grid gap-1">{res.verification.checks.map((c) => <li key={c.name} className="flex gap-2"><span className={clsx('mt-1 size-1.5 shrink-0 rounded-full', c.ok ? 'bg-volt-400' : 'bg-rose-bad')} /><span className="text-fog-200">{c.name}</span><span className="truncate text-fog-400">{c.detail}</span></li>)}</ul>
              <a href={TX(txid)} target="_blank" rel="noreferrer" className="mt-3 inline-block text-volt-300 hover:underline">Open on bchexplorer.cash →</a>
            </div>
          )}
          {!busy && !res && !err && <div className="text-[12px] text-fog-400">Pick a transaction to verify.</div>}
        </Panel>
      </div>
    </div>
  );
}
