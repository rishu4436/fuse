'use client';
// Mainnet preflight (spec §19 gate): FUSE builds a self-consolidation of the connected wallet's own coins,
// shows every gate item, asks the wallet to sign with broadcast:false, then independently verifies the signed
// transaction. There is deliberately no broadcast control.
import { useState } from 'react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { listUnspent } from '@/lib/electrum';
import { Button, Badge, Mono } from './ui';

export interface WalletHandle { address: string; sign: (req: { transactionHex: string; sourceOutputs: Array<Record<string, unknown>>; userPrompt: string }, inputPaths: Array<[number, string, number]>) => Promise<string> }
interface Pf { preflight: { ok: boolean; templateHash: string; items: Array<{ label: string; value: string }>; checks: Array<{ name: string; ok: boolean; detail: string }> }; inputPaths: Array<[number, string, number]>; wcRequest: { transactionHex: string; sourceOutputs: Array<Record<string, unknown>>; userPrompt: string } }
interface Vr { ok: boolean; txid: string; checks: Array<{ name: string; ok: boolean; detail?: string }>; note: string }

export function MainnetPreflight({ wallet }: { wallet: WalletHandle }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'review' | 'signing' | 'done'>('idle');
  const [pf, setPf] = useState<Pf>();
  const [vr, setVr] = useState<Vr>();
  const [err, setErr] = useState<string>();
  const [source, setSource] = useState<string>();
  const load = async () => {
    setErr(undefined); setStep('loading');
    try {
      const { server, utxos } = await listUnspent(wallet.address);
      setSource(server);
      const coins = utxos.map((u) => ({ txid: u.tx_hash, vout: u.tx_pos, satoshis: String(u.value), hasToken: Boolean(u.token_data), path: 'receive', addressIndex: 0 }));
      if (!coins.length) throw new Error('This address has no coins. Nothing to preflight.');
      setPf(await api<Pf>('/api/wallet/preflight', { method: 'POST', json: { network: 'mainnet', address: wallet.address, coins } }));
      setStep('review');
    } catch (e) { setErr((e as Error).message); setStep('idle'); }
  };
  const sign = async () => {
    if (!pf) return; setErr(undefined); setStep('signing');
    try {
      const signed = await wallet.sign(pf.wcRequest, pf.inputPaths);
      setVr(await api<Vr>('/api/wallet/verify-signed', { method: 'POST', json: { templateHash: pf.preflight.templateHash, signedTransaction: signed } }));
      setStep('done');
    } catch (e) { setErr(`Wallet did not sign: ${(e as Error).message}`); setStep('review'); }
  };
  return (
    <div className="mt-4 border-t hairline pt-4" data-testid="preflight">
      <div className="mb-2 flex items-center justify-between"><span className="text-[12.5px] font-medium text-fog-100">Mainnet preflight</span><Badge mode="BLOCKED" className="!normal-case" /></div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-fog-400">FUSE builds a consolidation of your own coins back to your own address, checks it, and asks your wallet to sign with <code className="num">broadcast:false</code>. The signed result is verified independently. Broadcasting is disabled until the owner authorizes it.</p>
      {step === 'idle' && <Button variant="ghost" onClick={load} data-testid="preflight-run">Build preflight</Button>}
      {step === 'loading' && <div className="text-[12px] text-fog-300">Reading your coins from Fulcrum…</div>}
      {pf && step !== 'idle' && step !== 'loading' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11.5px]">
            {pf.preflight.items.map((i) => (<div key={i.label} className="contents"><dt className="text-fog-400">{i.label}</dt><dd className="num break-all text-right text-fog-200">{i.value}</dd></div>))}
          </dl>
          <ul className="grid gap-1 text-[11.5px]">{pf.preflight.checks.map((c) => <li key={c.name} className="flex items-center gap-2"><span className={clsx('size-1.5 rounded-full', c.ok ? 'bg-volt-400' : 'bg-rose-bad')} /><span className="text-fog-200">{c.name}</span><span className="truncate text-fog-400">{c.detail}</span></li>)}</ul>
          <div className="text-[11px] text-fog-400">Coins read from <Mono className="text-fog-400">{source}</Mono></div>
          {step === 'review' && <Button onClick={sign} disabled={!pf.preflight.ok}>Request signature in wallet</Button>}
          {step === 'signing' && <div className="text-[12px] text-amber-sim">Confirm in your wallet…</div>}
        </motion.div>
      )}
      {vr && (
        <div className={clsx('mt-3 rounded-lg border p-3 text-[12px]', vr.ok ? 'border-volt-400/30 bg-volt-400/5' : 'border-rose-bad/30 bg-rose-bad/5')} data-testid="preflight-verify">
          <div className={vr.ok ? 'text-volt-300' : 'text-rose-bad'}>{vr.ok ? 'Signed transaction verified' : 'Wallet response rejected'}</div>
          <div className="mt-1 text-fog-400">{vr.note}</div>
          {vr.txid && <div className="mt-1">txid (not broadcast) <Mono>{vr.txid}</Mono></div>}
        </div>
      )}
      {err && <div role="alert" className="mt-2 text-[12px] text-rose-bad">{err}</div>}
    </div>
  );
}
