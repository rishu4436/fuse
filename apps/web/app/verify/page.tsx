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
    try { setV(await api<Verification>('/api/certificates/verify', { method: 'POST', body: JSON.stringify(parsed) })); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Verifier" title="Paste a certificate, check it yourself" lede="The verifier never trusts the certificate. It re-derives the commitment, re-fetches the transaction, re-hashes it, and checks every claimed output and outcome against chain data. The same code ships as @fuse/proof-verifier." />
      <Panel title="Certificate JSON" actions={<Button onClick={run} disabled={!text.trim()} data-testid="verify-paste">Verify</Button>}>
        <label htmlFor="cert" className="sr-only">Certificate JSON</label>
        <textarea id="cert" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder='{ "schema": "fuse.certificate/v1", … }' className="num h-64 w-full resize-y rounded-lg border hairline bg-ink-950 p-4 text-[12px] text-fog-200 outline-none focus:border-volt-400/50" />
        {err && <div role="alert" className="mt-3 text-[12.5px] text-rose-bad">{err}</div>}
        {v && <div className="mt-4"><VerifyResult v={v} /></div>}
      </Panel>
    </div>
  );
}
