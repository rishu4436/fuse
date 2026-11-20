'use client';
import { useState } from 'react';
import { motion } from 'motion/react';
import { api, short } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Badge, Button, ApiOffline, Empty, Mono } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

interface Cert { certificateId: string; intentId: string; transactions: Array<{ txid: string }>; issuedAt: number }
interface M { checkedAt: string; protocol: string; category: string; source: string; note: string; results: Array<{ txid: string; blockHeight?: number; allValid?: boolean; inputs?: number; outputs?: number; error?: string }> }
interface R { txid: string; allValid: boolean; steps: Array<{ input: number; role: string; unlock: string; ok: boolean; detail: string }>; note: string }

export default function Replay() {
  const certs = usePoll<Cert[]>('/api/certificates', 4000);
  const moria = usePoll<M>('/api/replay/mainnet/moria', 0);
  const [sel, setSel] = useState<string>();
  const [r, setR] = useState<R>();
  const [err, setErr] = useState<string>();
  const go = async (id: string) => { setSel(id); setErr(undefined); setR(undefined); try { setR(await api<R>(`/api/replay/${id}`)); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Historical replay" title="Re-run a settled execution" lede="Takes the raw transaction FUSE settled and the source outputs it spent, and evaluates every input again in a fresh BCH 2026 VM. Moria V1 mainnet history is replayed the same way, read only." right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={certs.error} />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel title="Settled executions">
          {!certs.data?.length ? <Empty title="Nothing settled yet" body="Run an auction in the Intent Studio first." /> : (
            <ul className="grid gap-1.5">{certs.data.map((c) => <li key={c.certificateId}><button onClick={() => go(c.certificateId)} className={`w-full rounded-lg border px-3 py-2 text-left text-[12px] transition-colors ${sel === c.certificateId ? 'border-volt-400/40 bg-volt-400/5' : 'hairline hover:border-ink-500'}`} data-testid="replay-pick"><Mono>{short(c.transactions[0]?.txid, 8)}</Mono><div className="text-[11px] text-fog-400">{new Date(c.issuedAt * 1000).toLocaleTimeString()}</div></button></li>)}</ul>
          )}
        </Panel>
        <Panel title={r ? (r.allValid ? 'Every input valid' : 'Replay found an invalid input') : 'Replay'} mode={r ? (r.allValid ? 'VERIFIED' : 'BLOCKED') : undefined}>
          {err && <div role="alert" className="text-[12px] text-rose-bad">{err}</div>}
          {!r && !err && <p className="text-[12.5px] text-fog-400">Pick an execution.</p>}
          {r && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="replay-result">
              <Table head={['Input', 'Role', 'Unlock', 'VM result']} min={520}>
                {r.steps.map((s) => <Tr key={s.input}><Td first num className="!text-left">{s.input}</Td><Td>{s.role}</Td><Td><span className="num text-[11.5px]">{s.unlock}</span></Td><Td><span className={s.ok ? 'text-volt-300' : 'text-rose-bad'}>{s.detail}</span></Td></Tr>)}
              </Table>
              <p className="mt-3 text-[11.5px] text-fog-400">{r.note}</p>
            </motion.div>
          )}
          {r && <Button variant="quiet" className="mt-2 px-0" onClick={() => sel && go(sel)}>Replay again</Button>}
        </Panel>
      </div>
      <Panel className="mt-5" title="Moria V1 history on mainnet" kicker={moria.data ? `${moria.data.results.filter((x) => x.allValid).length}/${moria.data.results.length} replayed valid · snapshot ${new Date(moria.data.checkedAt).toLocaleString()}` : 'loading'} mode="READ-ONLY">
        <p className="mb-3 text-[12px] text-fog-400">Real MUSD-carrying mainnet transactions from the Moria V1 era, fetched from Chaingraph, re-hashed locally, and re-evaluated input by input in a fresh BCH 2026 VM. Moria V1 is disabled (April 2026) and is never offered as a venue. FUSE does not decode Moria contract semantics.</p>
        <Table head={['Transaction', 'Block', 'Inputs → outputs', 'Replay']} min={600}>
          {(moria.data?.results ?? []).map((x) => <Tr key={x.txid}><Td first><a className="hover:text-volt-300" href={`https://blockbook.pat.mn/tx/${x.txid}`} target="_blank" rel="noreferrer"><Mono>{short(x.txid, 10)}</Mono></a></Td><Td num>{x.blockHeight ?? '—'}</Td><Td num>{x.inputs !== undefined ? `${x.inputs} → ${x.outputs}` : '—'}</Td><Td>{x.error ? <span className="text-rose-bad">{x.error}</span> : x.allValid ? <span className="text-volt-300">all inputs valid</span> : <span className="text-rose-bad">invalid input</span>}</Td></Tr>)}
        </Table>
      </Panel>
    </div>
  );
}
