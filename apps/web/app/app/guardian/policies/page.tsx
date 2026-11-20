'use client';
import { useState } from 'react';
import { motion } from 'motion/react';
import { api, short } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Badge, Button, ApiOffline, Mono } from '@/components/ui';
import { Input, Select } from '@/components/kit';

interface Risk { outpoint: string; tier: string; crBps: bigint | null }
interface Radar { risks: Risk[] }
interface Policy { id: string; name: string; loan: string; rules: Array<{ id: string; then: string; when: Record<string, unknown>; severity: string; targetCrBps?: number }>; channels: string[] }
interface Proposal { ruleId: string; action: string; message: string; blockedBy: string; executable: false }
interface Ready { level: string; autoProtection: string; checks: Array<{ name: string; ok: boolean; detail: string }> }

function Readiness({ loan }: { loan: string }) {
  const { data } = usePoll<Ready>(`/api/guardian/readiness?loan=${loan}`, 0);
  if (!data) return null;
  return (
    <div className="mt-3 grid gap-1 text-[11.5px]" data-testid="readiness">
      <div className="mb-1 flex gap-2"><Badge mode={data.level === 'MONITORING_READY' ? 'TESTED' : 'BLOCKED'} className="!normal-case" /><span className="text-fog-300">{data.level.replace('_', ' ').toLowerCase()} · auto-protection {data.autoProtection.toLowerCase()}</span></div>
      {data.checks.map((c) => <div key={c.name} className="flex gap-2"><span className={c.ok ? 'text-volt-300' : 'text-rose-bad'}>{c.ok ? '✓' : '✕'}</span><span className="text-fog-200">{c.name}</span><span className="truncate text-fog-400">{c.detail}</span></div>)}
    </div>
  );
}

export default function Policies() {
  const radar = usePoll<Radar>('/api/guardian/radar?limit=40', 0);
  const list = usePoll<Policy[]>('/api/guardian/policies', 0);
  const loans = (radar.data?.risks ?? []).filter((r) => r.crBps !== null);
  const [loan, setLoan] = useState('');
  const [name, setName] = useState('Keep my loan above 150%');
  const [cr, setCr] = useState('15000');
  const [action, setAction] = useState('PROPOSE_TOP_UP');
  const [target, setTarget] = useState('17500');
  const [sev, setSev] = useState('warning');
  const [props, setProps] = useState<Proposal[]>();
  const [err, setErr] = useState<string>();
  const create = async () => {
    setErr(undefined);
    try {
      const r = await api<{ proposals: Proposal[] }>('/api/guardian/policies', { method: 'POST', json: { name, loan: loan || loans[0]?.outpoint, channels: ['in-app'], rules: [{ id: 'r1', when: { crBelowBps: Number(cr) }, then: action, targetCrBps: Number(target), severity: sev }, { id: 'r2', when: { redemptionActive: true }, then: 'ALERT', severity: 'critical' }] } });
      setProps(r.proposals); list.reload();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Guardian · Policies" title="Strategy policies for your loans" lede="Rules watch a Paryon V1 loan and produce proposals with exact amounts. FUSE does not execute them: Paryon manage and liquidate stay blocked until their transaction builders are verified." right={<Badge mode="READ-ONLY" />} />
      <ApiOffline error={radar.error} />
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Panel title="New policy" kicker="FEP-1 rule set">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <Input id="pname" label="Name" value={name} onChange={setName} numeric={false} />
            <Select id="ploan" label="Loan (lowest CR first)" value={loan || loans[0]?.outpoint || ''} onChange={setLoan} options={loans.map((l) => ({ value: l.outpoint, label: `${short(l.outpoint, 6)} · CR ${(Number(l.crBps) / 100).toFixed(1)}% · ${l.tier}` }))} />
            <Input id="pcr" label="When CR falls below" value={cr} onChange={setCr} unit="bps" hint={`${(Number(cr) / 100).toFixed(1)}%`} />
            <Select id="pact" label="Then" value={action} onChange={setAction} options={[{ value: 'ALERT', label: 'Alert only' }, { value: 'PROPOSE_TOP_UP', label: 'Propose collateral top-up' }, { value: 'PROPOSE_REPAY', label: 'Propose debt repayment' }, { value: 'PROPOSE_EXIT', label: 'Propose exit' }]} />
            <Input id="ptarget" label="Target CR" value={target} onChange={setTarget} unit="bps" />
            <Select id="psev" label="Severity" value={sev} onChange={setSev} options={['info', 'warning', 'critical'].map((x) => ({ value: x, label: x }))} />
            <Button type="submit" data-testid="create-policy">Create policy</Button>
            {err && <div role="alert" className="text-[12px] text-rose-bad">{err}</div>}
          </form>
        </Panel>
        <div className="flex flex-col gap-5">
          {props && (
            <Panel title="Proposals from the new policy" kicker="Not executable">
              {props.length ? props.map((p) => <motion.div key={p.ruleId + p.message} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-2 rounded-lg border hairline p-3 text-[12.5px]" data-testid="proposal"><div className="text-fog-100">{p.message}</div><div className="mt-1 text-[11.5px] text-amber-sim">Execution: {p.blockedBy}</div></motion.div>) : <p className="text-[12.5px] text-fog-400">No rule triggers at the current price.</p>}
            </Panel>
          )}
          <Panel title="Active policies" kicker={`${list.data?.length ?? 0} configured`}>
            {(list.data ?? []).map((p) => (
              <div key={p.id} className="mb-4 border-b hairline pb-4 last:mb-0 last:border-0 last:pb-0">
                <div className="flex items-center justify-between"><span className="text-[13px] text-fog-100">{p.name}</span><Mono className="text-fog-400">{short(p.loan, 8)}</Mono></div>
                <div className="mt-1 text-[11.5px] text-fog-400">{p.rules.map((r) => `${r.then.toLowerCase()} when ${Object.entries(r.when).map(([k, v]) => `${k}=${v}`).join(', ')}`).join(' · ')}</div>
                <Readiness loan={p.loan} />
              </div>
            ))}
            {!list.data?.length && <p className="text-[12.5px] text-fog-400">No policies yet.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
