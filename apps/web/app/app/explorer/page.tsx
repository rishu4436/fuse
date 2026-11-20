'use client';
import { Suspense, useState } from 'react';
import { usePoll } from '@/lib/hooks';
import { api, sats, short } from '@/lib/api';
import { Button } from '@/components/ui';
import { PageHeader, Panel, Badge, ApiOffline, Empty, Mono } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

interface Row { txid: string; sizeBytes: number; inputs: number; outputs: number }
interface Tx { txid: string; sizeBytes: number; version: number; locktime: number; inputs: Array<{ outpoint: string; unlockingBytes: number }>; outputs: Array<{ n: number; lockingBytecode: string; satoshis: string; token?: { category: string; amount: string; nft?: { capability: string; commitment: string } } }> }

function Detail({ txid }: { txid: string }) {
  const { data, error } = usePoll<Tx>(`/api/explorer/${txid}`, 0);
  if (error) return <div className="text-[12px] text-rose-bad">{error}</div>;
  if (!data) return null;
  return (
    <div className="grid gap-4" data-testid="tx-detail">
      <div className="text-[12px] text-fog-400">v{data.version} · locktime {data.locktime} · {data.sizeBytes} bytes</div>
      <Table head={['Input', 'Spends', 'Unlock bytes']} min={480}>{data.inputs.map((i, k) => <Tr key={k}><Td first>{k}</Td><Td><Mono>{short(i.outpoint, 10)}</Mono></Td><Td num>{i.unlockingBytes}</Td></Tr>)}</Table>
      <Table head={['Output', 'Locking bytecode', 'Satoshis', 'Token']} min={560}>{data.outputs.map((o) => <Tr key={o.n}><Td first>{o.n}</Td><Td><Mono>{short(o.lockingBytecode, 8)}</Mono></Td><Td num>{sats(o.satoshis)}</Td><Td>{o.token ? <span className="num text-[11.5px]">{o.token.nft ? `NFT ${o.token.nft.capability} ${short(o.token.nft.commitment, 4)}` : `${sats(o.token.amount)} ${short(o.token.category, 3)}`}</span> : '—'}</Td></Tr>)}</Table>
    </div>
  );
}

interface MTx extends Tx { network: 'mainnet'; status: 'READ-ONLY'; txidVerifiedLocally: boolean; source: string; confirmed: boolean; blockHeight: number | null; confirmations: number; protocols: string[]; outputs: Array<Tx['outputs'][number] & { label: string | null; asset: string | null; state: Record<string, unknown> | null }> }
const EXAMPLE = '5ab3f4aa4c43c49ab66516333033e87b0babb5dde313bdac0534b092b3f20362';
function MainnetLookup() {
  const [txid, setTxid] = useState(EXAMPLE); const [res, setRes] = useState<MTx>(); const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(undefined); setRes(undefined); try { setRes(await api<MTx>(`/api/explorer/mainnet/${txid.trim().toLowerCase()}`)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <Panel title="Mainnet transaction" kicker="raw hex from a public indexer, txid re-derived locally" mode="READ-ONLY">
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="mtx">Mainnet txid</label>
        <input id="mtx" value={txid} onChange={(e) => setTxid(e.target.value)} spellCheck={false} className="num min-w-0 flex-1 rounded-[10px] border hairline bg-ink-850 px-3 py-2 text-[12px] text-fog-100 outline-none focus:border-volt-400/60" />
        <Button type="submit" disabled={busy} data-testid="mainnet-lookup">{busy ? 'Fetching…' : 'Decode'}</Button>
      </form>
      {err && <p className="mt-3 text-[12px] text-rose-bad">{err}</p>}
      {res && (
        <div className="mt-4 grid gap-4" data-testid="mainnet-tx">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fog-300">
            <span className="text-volt-300">✓ hash256(raw) = txid</span>
            <span>{res.confirmed ? `block ${res.blockHeight} · ${res.confirmations} conf` : 'unconfirmed'}</span>
            <span>{res.sizeBytes} bytes</span>
            {res.protocols.map((p) => <span key={p} className="rounded-full border border-sky-ro/30 px-2 py-0.5 text-[11px] text-sky-ro">{p}</span>)}
          </div>
          <Table head={['Output', 'Contract', 'Satoshis', 'Token', 'Decoded state']} min={720}>{res.outputs.map((o) => (
            <Tr key={o.n}><Td first>{o.n}</Td><Td>{o.label ? <span className="text-[12px] text-fog-100">{o.label}</span> : <Mono>{short(o.lockingBytecode, 8)}</Mono>}</Td><Td num>{sats(o.satoshis)}</Td>
              <Td>{o.token ? <span className="text-[11.5px]">{o.asset} {o.token.nft ? `NFT ${o.token.nft.capability}` : sats(o.token.amount)}</span> : '—'}</Td>
              <Td>{o.state ? <span className="num text-[11px] text-fog-300">{Object.entries(o.state).slice(0, 4).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</span> : '—'}</Td></Tr>
          ))}</Table>
          <p className="text-[11px] text-fog-400">Source {res.source}. Contracts are labelled only on exact matches with locally rebuilt Paryon V1 scripts.</p>
        </div>
      )}
    </Panel>
  );
}

function Explorer() {
  const list = usePoll<Row[]>('/api/explorer', 3000);
  const [sel, setSel] = useState<string>();
  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <ApiOffline error={list.error} />
      <Panel title="Local chain transactions" kicker={`${list.data?.length ?? 0} recent`}>
        {!list.data?.length ? <Empty title="No transactions yet" /> : <ul className="grid gap-1">{list.data.map((t) => <li key={t.txid}><button onClick={() => setSel(t.txid)} className={`flex w-full justify-between rounded-lg px-3 py-2 text-left text-[12px] ${sel === t.txid ? 'bg-volt-400/10 text-volt-300' : 'hover:bg-ink-800'}`} data-testid="tx-row"><Mono>{short(t.txid, 8)}</Mono><span className="num text-fog-400">{t.inputs}→{t.outputs}</span></button></li>)}</ul>}
      </Panel>
      <Panel title={sel ? <Mono>{short(sel, 12)}</Mono> : 'Transaction'} mode="SIMULATION">{sel ? <Detail txid={sel} /> : <p className="text-[12.5px] text-fog-400">Select a transaction.</p>}</Panel>
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Explorer" title="Transactions on the local chain" lede="Decoded inputs, outputs and CashTokens for every transaction the local mock chain accepted. Paste any mainnet txid to decode it READ-ONLY; the raw transaction is re-hashed locally, so the indexer cannot alter it." right={<Badge mode="SIMULATION" />} />
      <div className="mb-5"><MainnetLookup /></div>
      <Suspense fallback={null}><Explorer /></Suspense>
    </div>
  );
}
