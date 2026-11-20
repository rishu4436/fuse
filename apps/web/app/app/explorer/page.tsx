'use client';
import { Suspense, useState } from 'react';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
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
      <PageHeader eyebrow="Explorer" title="Transactions on the local chain" lede="Decoded inputs, outputs and CashTokens for every transaction the local mock chain accepted. Mainnet transactions open on a public explorer." right={<Badge mode="SIMULATION" />} />
      <Suspense fallback={null}><Explorer /></Suspense>
    </div>
  );
}
