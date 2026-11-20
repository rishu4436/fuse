'use client';
import Link from 'next/link';
import { usePoll } from '@/lib/hooks';
import { sats, bch, short } from '@/lib/api';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';
import { WalletConnect } from '@/components/wallet-connect';

interface Net { local: { addresses: { user: string } } }
interface Utxo { txid: string; vout: number; satoshis: bigint; token?: { category: string; amount: bigint; nft?: unknown } }
interface Policy { id: string; name: string; loan: string; rules: unknown[] }

export default function Portfolio() {
  const net = usePoll<Net>('/api/network/status', 0);
  const user = net.data?.local.addresses.user;
  const coins = usePoll<Utxo[]>(user ? `/api/chain/utxos?address=${user}` : null, 4000);
  const policies = usePoll<Policy[]>('/api/guardian/policies', 5000);
  const bchTotal = (coins.data ?? []).reduce((s, c) => s + c.satoshis, 0n);
  const tokens = (coins.data ?? []).filter((c) => c.token && !c.token.nft).reduce((s, c) => s + c.token!.amount, 0n);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Portfolio" title="Positions across the local world and mainnet" lede="The local demo wallet holds only simulated coins. Your own wallet connects read-only through WizardConnect; watched Paryon loans come from Guardian policies." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={net.error} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-5">
            <Panel><Stat label="BCH" value={bch(bchTotal)} accent /></Panel>
            <Panel><Stat label="FUSD" value={sats(tokens)} sub="local fixture token" /></Panel>
            <Panel><Stat label="UTXOs" value={coins.data?.length ?? '—'} /></Panel>
          </div>
          <Panel title="Local demo wallet" kicker={user ? <Mono>{short(user, 10)}</Mono> : 'loading'} mode="SIMULATION">
            <Table head={['Outpoint', 'Satoshis', 'Token']} min={520}>
              {(coins.data ?? []).map((c) => <Tr key={`${c.txid}:${c.vout}`}><Td first><Mono>{short(c.txid, 8)}:{c.vout}</Mono></Td><Td num>{sats(c.satoshis)}</Td><Td num>{c.token ? `${sats(c.token.amount)} ${short(c.token.category, 3)}` : '—'}</Td></Tr>)}
            </Table>
          </Panel>
          <Panel title="Watched Paryon V1 loans" kicker="Guardian policies" mode="READ-ONLY" actions={<Link href="/app/guardian/policies" className="text-[12px] text-volt-300">Manage →</Link>}>
            {(policies.data ?? []).length ? <ul className="grid gap-2 text-[12.5px]">{policies.data!.map((p) => <li key={p.id} className="flex justify-between"><span>{p.name}</span><Mono className="text-fog-400">{short(p.loan, 8)}</Mono></li>)}</ul> : <p className="text-[12.5px] text-fog-400">No loans watched yet.</p>}
          </Panel>
        </div>
        <Panel title="Your wallet" kicker="WizardConnect · mainnet, read only"><WalletConnect /></Panel>
      </div>
    </div>
  );
}
