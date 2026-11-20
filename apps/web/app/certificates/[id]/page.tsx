'use client';
import { Fragment, use, useState } from 'react';
import Link from 'next/link';
import { usePoll } from '@/lib/hooks';
import { api, sats, short } from '@/lib/api';
import { Panel, Button, Badge, ApiOffline, Mono, PageHeader } from '@/components/ui';
import { VerifyResult, plainJson, type Verification } from '@/components/verify-result';

type Cert = Record<string, unknown> & { certificateId: string; network: string; simulated: boolean; solverId: string; intentId: string; intentCommitment: string; quoteCommitment: string; commitment: string; transactions: Array<{ txid: string }>; inputs: Array<{ outpoint: string }>; outputs: Array<{ vout: number; satoshis: bigint; role: string; token?: { amount: bigint } }>; fees: { minerFeeSats: bigint; liquidityFee: bigint; solverFee: bigint }; outcome: { ownerReceives: Array<{ asset: string; amount: bigint }> }; vaultContinuations: Array<{ inputIndex: number; minReturn: bigint }> };

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: c, error } = usePoll<Cert>(`/api/certificates/${id}`, 0);
  const [v, setV] = useState<Verification>();
  const [busy, setBusy] = useState(false);
  const verify = async (tamper = false) => {
    if (!c) return; setBusy(true);
    const body = tamper ? { ...c, outcome: { ...c.outcome, ownerReceives: c.outcome.ownerReceives.map((r) => ({ ...r, amount: r.amount * 10n })) } } : c;
    try { setV(await api<Verification>('/api/certificates/verify', { method: 'POST', json: body })); } finally { setBusy(false); }
  };
  const download = () => { if (!c) return; const url = URL.createObjectURL(new Blob([plainJson(c)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${c.certificateId}.json`; a.click(); URL.revokeObjectURL(url); };
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/certificates" className="mb-5 inline-block text-[12.5px] text-fog-400 hover:text-fog-100">← Certificates</Link>
      <PageHeader eyebrow="Certificate" title={id} right={c ? <Badge mode={c.simulated ? 'SIMULATION' : 'READ-ONLY'} /> : null} />
      <ApiOffline error={error} />
      {c && (
        <div className="flex flex-col gap-5">
          <Panel title="Independent verification" actions={<><Button variant="ghost" onClick={download}>Download JSON</Button><Button variant="ghost" onClick={() => verify(true)} disabled={busy} data-testid="tamper">Try a tampered copy</Button><Button onClick={() => verify(false)} disabled={busy} data-testid="verify">Verify</Button></>}>
            {v ? <VerifyResult v={v} /> : <p className="text-[12.5px] text-fog-400">Verification re-fetches the raw transaction from the chain reader (here, the local mock chain), checks that it hashes to the txid, and compares every input, output, vault continuation and the owner outcome with the certificate.</p>}
          </Panel>
          <div className="grid gap-5 md:grid-cols-2">
            <Panel title="Commitments">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[12px]">
                {[['Intent', c.intentCommitment], ['Quote', c.quoteCommitment], ['Certificate', c.commitment], ['Transaction', c.transactions[0]?.txid]].map(([k, val]) => (<Fragment key={k}><dt className="text-fog-400">{k}</dt><dd className="text-right"><Mono title={val}>{short(val, 10)}</Mono></dd></Fragment>))}
                <dt className="text-fog-400">Solver</dt><dd className="text-right"><Mono>{c.solverId}</Mono></dd>
                <dt className="text-fog-400">Network</dt><dd className="text-right text-amber-sim">{c.network}</dd>
              </dl>
            </Panel>
            <Panel title="Outcome & fees">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[12.5px]">
                <dt className="text-fog-400">You received</dt><dd className="num text-right text-volt-300">{sats(c.outcome.ownerReceives[0]?.amount)} FUSD</dd>
                <dt className="text-fog-400">Miner fee</dt><dd className="num text-right">{sats(c.fees.minerFeeSats)} sat</dd>
                <dt className="text-fog-400">Liquidity fee (vault)</dt><dd className="num text-right">{sats(c.fees.liquidityFee)} sat</dd>
                <dt className="text-fog-400">Solver share</dt><dd className="num text-right">{sats(c.fees.solverFee)} sat</dd>
                <dt className="text-fog-400">Vault continuations</dt><dd className="num text-right">{c.vaultContinuations.length}</dd>
              </dl>
            </Panel>
          </div>
          <Panel title="Raw certificate"><pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg bg-ink-950 p-4 text-[11.5px] leading-relaxed text-fog-300">{plainJson(c)}</pre></Panel>
        </div>
      )}
    </div>
  );
}
