'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader, Panel, Button } from '@/components/ui';
import { VerifyResult, type Verification } from '@/components/verify-result';

export default function VerifyPage() {
  const [text, setText] = useState('');
  const [v, setV] = useState<Verification>();
  const [err, setErr] = useState<string>();
  const run = async () => {
    setErr(undefined); setV(undefined);
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { setErr('That is not valid JSON.'); return; }
    // a mainnet certificate (or a live result {certificate, authorization, userSignature}) is re-derived from mainnet data
    // with the contract rederivers and, if an authorization is attached, checked for INTENT_BOUND
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setErr('Paste a certificate JSON object.'); return; }
    const o = parsed as { network?: string; certificate?: { network?: string }; authorization?: unknown; userSignature?: unknown };
    const cert = o.certificate ?? parsed; const net = (cert as { network?: string }).network;
    try { setV(net === 'mainnet' ? await api<Verification>('/api/live/verify-certificate', { method: 'POST', body: JSON.stringify({ certificate: cert, authorization: o.authorization ?? null, userSignature: o.userSignature ?? null }) }) : await api<Verification>('/api/certificates/verify', { method: 'POST', body: JSON.stringify(parsed) })); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Verifier" title="Verify an execution certificate" lede="FUSE fetches the transaction from chain data and checks the receipt against it. Mainnet verification progresses from inclusion to transaction structure, contract outcomes, and intent binding." />
      <Panel title="Certificate JSON" actions={<Button onClick={run} disabled={!text.trim()} data-testid="verify-paste">Verify</Button>}>
        <label htmlFor="cert" className="sr-only">Certificate JSON</label>
        <textarea id="cert" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder='{ "schema": "fuse.certificate/v1", … }' className="num h-64 w-full resize-y rounded-lg border hairline bg-ink-950 p-4 text-[12px] text-fog-200 outline-none focus:border-volt-400/50" />
        <p className="mt-3 text-sm">INTENT_BOUND means the transaction matches an authorization signed by the FUSE deployment. A separate wallet signature over that authorization is optional. Paste the full live receipt to include both when available.</p>
        {err && <div role="alert" className="mt-3 text-[12.5px] text-rose-bad">{err}</div>}
        {v && <div className="mt-4"><VerifyResult v={v} /></div>}
      </Panel>
    </div>
  );
}
