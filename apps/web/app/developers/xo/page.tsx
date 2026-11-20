'use client';
import { useState } from 'react';
import { usePoll } from '@/lib/hooks';
import { api, short } from '@/lib/api';
import { PageHeader, Panel, Badge, Button, Mono, ApiOffline } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

interface T { key: string; name: string; description: string; templateIdentifier: string; actions: string[]; roles: string[]; supported: string[] }
interface X { engine: { status: 'BLOCKED'; reason: string; verifiedPackages: string[] }; templates: T[] }
interface Payout { templateIdentifier: string; compiledText: string; lockingBytecode: string; address: string | null }

export default function Xo() {
  const { data, error } = usePoll<X>('/api/xo/templates', 0);
  const [pk, setPk] = useState('02' + '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const [p, setP] = useState<Payout>(); const [err, setErr] = useState<string>();
  const compile = async () => { setErr(undefined); setP(undefined); try { setP(await api<Payout>('/api/xo/payout', { method: 'POST', json: { publicKey: pk.trim() } })); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Developers · XO Stack" title="XO templates, pinned and compiled locally"
        lede="FUSE uses the published @xo-cash/utils validator and CashAssembly compiler. Templates are pinned by their content identifier, and an XO wallet's P2PKH receiving script, compiled from a public key, can be the payout of any FUSE intent. FUSE never asks for an XO mnemonic."
        right={<Badge mode="TESTED" />} />
      <ApiOffline error={error} />
      <div className="grid gap-5">
        <Panel title="Pinned official templates" kicker="identifier = generateTemplateIdentifier(parseTemplate(t))">
          <Table head={['Template', 'Identifier', 'Actions', 'VM']} min={720}>
            {(data?.templates ?? []).map((t) => <Tr key={t.key}><Td first><div className="text-[12.5px] text-fog-100">{t.name}</div><div className="text-[11px] text-fog-400">{t.key}</div></Td><Td><Mono title={t.templateIdentifier}>{short(t.templateIdentifier, 10)}</Mono></Td><Td><span className="text-[11.5px] text-fog-300">{t.actions.join(', ')}</span></Td><Td><span className="num text-[11px] text-fog-400">{t.supported.at(-1)}</span></Td></Tr>)}
          </Table>
        </Panel>
        <Panel title="Compile an intent payout with the XO compiler" kicker="P2PKH receivingLockingScript · public key only">
          <form onSubmit={(e) => { e.preventDefault(); compile(); }} className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="pk">Compressed public key</label>
            <input id="pk" value={pk} onChange={(e) => setPk(e.target.value)} spellCheck={false} className="num min-w-0 flex-1 rounded-[10px] border hairline bg-ink-850 px-3 py-2 text-[12px] text-fog-100 outline-none focus:border-volt-400/60" />
            <Button type="submit" data-testid="xo-compile">Compile</Button>
          </form>
          {err && <p className="mt-3 text-[12px] text-rose-bad">{err}</p>}
          {p && <div className="mt-4 grid gap-1.5 text-[12px]" data-testid="xo-payout"><div className="text-fog-300">CashAssembly <Mono>{p.compiledText}</Mono></div><div className="text-fog-300">Locking bytecode <Mono>{p.lockingBytecode}</Mono></div><div className="text-fog-300">Chipnet address <Mono>{p.address ?? '—'}</Mono></div></div>}
        </Panel>
        {data && <Panel title="XO Engine sessions" mode="BLOCKED"><p className="text-[12.5px] leading-relaxed text-fog-300">{data.engine.reason}</p></Panel>}
      </div>
    </div>
  );
}
