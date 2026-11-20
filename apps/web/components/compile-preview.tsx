'use client';
// F03 + explanation engine + F08 fee accounting, rendered from /api/compile.
import { useState } from 'react';
import clsx from 'clsx';
import { api, sats } from '@/lib/api';
import { Panel, Button, Badge } from './ui';
import { Pipeline, Table, Tr, Td, STAGES, type StageRow } from './kit';

interface Party { party: string; kind: string; sats: bigint; tokens: Record<string, bigint> }
interface Cand { strategy: string; ok: boolean; reasons: string[]; outcome?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint }; fees?: { parties: Party[]; minerFee: bigint; vaultFee: bigint; conservation: { sats: boolean; tokens: boolean } } }
export interface Plan { ok: boolean; stages: StageRow[]; candidates: Cand[]; selected?: Cand; explanation?: { headline: string; steps: string[]; fees: Array<{ label: string; sats: bigint; note: string }>; guarantees: string[]; risks: string[] }; error?: { stage: string; reason: string } }

export function CompilePreview({ minOut, maxIn, maxFee }: { minOut: string; maxIn: string; maxFee: string }) {
  const [plan, setPlan] = useState<Plan>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(undefined);
    try { const d = await api<unknown>(`/api/compile/draft?minOut=${minOut}&maxIn=${maxIn}&maxFee=${maxFee}`); setPlan(await api<Plan>('/api/compile', { method: 'POST', json: d })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Compile & explain" kicker="Intent compiler · 10 stages" mode="SIMULATION" actions={<Button variant="ghost" onClick={run} disabled={busy} data-testid="compile">{busy ? 'Compiling…' : 'Compile preview'}</Button>}>
      {!plan && !err && <p className="text-[12.5px] text-fog-400">Runs the intent through PARSE → EXPLAIN without opening an auction. Each candidate route is composed, run in the BCH VM, checked against your limits, and costed to the satoshi.</p>}
      {err && <div role="alert" className="text-[12px] text-rose-bad">{err}</div>}
      {plan && (
        <div className="grid gap-5">
          <Pipeline stages={plan.stages} all={STAGES} />
          {plan.explanation && (
            <div className="rounded-xl border border-volt-400/20 bg-volt-400/[0.04] p-4" data-testid="explanation">
              <div className="text-[14px] font-medium text-fog-100">{plan.explanation.headline}</div>
              <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-[12.5px] text-fog-200">{plan.explanation.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              <div className="mt-3 grid gap-1 text-[11.5px] text-fog-400">{plan.explanation.guarantees.map((g) => <div key={g}>✓ {g}</div>)}{plan.explanation.risks.map((g) => <div key={g} className="text-amber-sim">! {g}</div>)}</div>
            </div>
          )}
          <Table head={['Strategy', 'Verdict', 'You receive', 'Net spend (sat)', 'Miner fee', 'Conservation']} min={680}>
            {plan.candidates.map((c) => (
              <Tr key={c.strategy}>
                <Td first><span className="num text-[11.5px]">{c.strategy}</span>{plan.selected?.strategy === c.strategy && <span className="ml-2 text-[10.5px] text-volt-300">selected</span>}</Td>
                <Td>{c.ok ? <span className="text-volt-300">valid</span> : <span className="text-rose-bad" title={c.reasons.join('; ')}>{c.reasons[0]?.slice(0, 48) ?? 'invalid'}</span>}</Td>
                <Td num>{c.outcome ? sats(c.outcome.userReceivesTokens) : '—'}</Td>
                <Td num>{c.outcome ? sats(c.outcome.userNetSpendSats) : '—'}</Td>
                <Td num>{c.outcome ? sats(c.outcome.minerFeeSats) : '—'}</Td>
                <Td>{c.fees ? <span className={clsx(c.fees.conservation.sats && c.fees.conservation.tokens ? 'text-volt-300' : 'text-rose-bad')}>{c.fees.conservation.sats && c.fees.conservation.tokens ? 'exact' : 'leak'}</span> : '—'}</Td>
              </Tr>
            ))}
          </Table>
          {plan.selected?.fees && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[12px] text-fog-300">Fee accounting · selected route <Badge mode="TESTED" /></div>
              <Table head={['Party', 'Kind', 'Δ sats', 'Δ tokens']} min={520}>
                {plan.selected.fees.parties.map((p) => (
                  <Tr key={p.party}><Td first>{p.party}</Td><Td>{p.kind}</Td><Td num className={p.sats < 0n ? 'text-rose-bad' : 'text-volt-300'}>{p.sats > 0n ? '+' : ''}{sats(p.sats)}</Td><Td num>{Object.values(p.tokens).map((t) => `${t > 0n ? '+' : ''}${sats(t)}`).join(', ') || '—'}</Td></Tr>
                ))}
                <Tr><Td first>Miner</Td><Td>network</Td><Td num>+{sats(plan.selected.fees.minerFee)}</Td><Td num>—</Td></Tr>
              </Table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
