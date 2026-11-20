'use client';
import Link from 'next/link';
import { usePoll } from '@/lib/hooks';
import { bch, short } from '@/lib/api';
import { PageHeader, Panel, Badge, Mono } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

interface C { name: string; bytecodeSha256: string; opcodes: number; local: { address: string } | null }
interface V { totalSats: bigint; shards: unknown[] }

export default function Vaults() {
  const c = usePoll<C[]>('/api/contracts', 0);
  const v = usePoll<V>('/api/vault', 4000);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Liquidity · Vaults" title="Vault contracts" lede="FlashVaultBCH is deployed on the local chain. FlashVaultToken is compiled and covered by tests but has no local deployment in the demo world. Neither is deployed on chipnet or mainnet." right={<Badge mode="SIMULATION" />} />
      <Panel>
        <Table head={['Vault', 'Network', 'Liquidity', 'Shards', 'Bytecode sha256', '']} min={720}>
          {(c.data ?? []).map((x) => (
            <Tr key={x.name}>
              <Td first><span className="text-fog-100">{x.name}</span></Td>
              <Td>{x.local ? <Badge mode="SIMULATION" /> : <span className="text-[12px] text-fog-400">not deployed</span>}</Td>
              <Td num>{x.local && v.data ? `${bch(v.data.totalSats)} BCH` : '—'}</Td>
              <Td num>{x.local && v.data ? v.data.shards.length : '—'}</Td>
              <Td><Mono>{short(x.bytecodeSha256, 6)}</Mono></Td>
              <Td>{x.local ? <Link className="text-volt-300" href="/app/liquidity/flashvault-bch">Open →</Link> : null}</Td>
            </Tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
