'use client';
import { useState } from 'react';
import { usePoll } from '@/lib/hooks';
import { short } from '@/lib/api';
import { PageHeader, Panel, Badge, Mono } from '@/components/ui';
import { KV } from '@/components/kit';

interface C { name: string; bytecodeSha256: string; opcodes: number; compiler: string; abi: Array<{ name: string; inputs: Array<{ name: string; type: string }> }>; constructorInputs: Array<{ name: string; type: string }>; source: string; local: { lockingBytecode: string; address: string } | null }

export default function Contracts() {
  const { data } = usePoll<C[]>('/api/contracts', 0);
  const [open, setOpen] = useState<string>();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Contract inspector" title="What the vault contracts enforce" lede="Compiled with cashc 0.14.0. The sha256 of each bytecode is pinned in the artifact manifest and checked in CI." right={<Badge mode="TESTED" />} />
      <div className="grid gap-5 lg:grid-cols-2">
        {(data ?? []).map((c) => (
          <Panel key={c.name} title={c.name} kicker={c.compiler} mode={c.local ? 'SIMULATION' : undefined}>
            <KV rows={[['Bytecode sha256', <Mono key="h" title={c.bytecodeSha256}>{short(c.bytecodeSha256, 10)}</Mono>], ['Opcodes', c.opcodes], ['Constructor', c.constructorInputs?.map((i) => `${i.type} ${i.name}`).join(', ')], ['Functions', c.abi?.map((f) => `${f.name}(${f.inputs.map((i) => i.type).join(', ')})`).join(' · ')], ['Local address', c.local ? <Mono key="a">{short(c.local.address, 10)}</Mono> : 'not deployed']]} />
            <button onClick={() => setOpen(open === c.name ? undefined : c.name)} className="mt-4 text-[12px] text-volt-300 hover:underline">{open === c.name ? 'Hide source' : 'Show source'}</button>
            {open === c.name && <pre className="scrollbar-thin mt-3 max-h-[420px] overflow-auto rounded-lg border hairline bg-ink-950 p-4 text-[11px] leading-relaxed text-fog-200"><code>{c.source}</code></pre>}
          </Panel>
        ))}
      </div>
    </div>
  );
}
