'use client';
// LIVE execute path on BCH mainnet: compose → simulate (BCH 2026 VM) → Guardian risk → sign in YOUR wallet →
// broadcast (relay of already-signed hex) → confirmation tracking → certificate verified against mainnet.
// The server never sees a private key. Signing happens in WizardConnect, or offline with the exported package.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api, sats, short, toJson } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Badge, Button, Mono } from '@/components/ui';
import { WalletConnect } from '@/components/wallet-connect';
import type { WalletHandle } from '@/components/preflight';

type Action = 'flash' | 'flash-cauldron' | 'deposit' | 'withdraw' | 'deploy-vault';
const ACTIONS: Array<{ id: Action; t: string; d: string }> = [
  { id: 'flash', t: 'Flash loan', d: 'Borrow the vault principal and repay it + fee in the same transaction. Permissionless.' },
  { id: 'flash-cauldron', t: 'Flash → Cauldron route', d: 'Borrowed sats buy PUSD on one live Cauldron pool and sell it on another; the proceeds repay the vault atomically.' },
  { id: 'deposit', t: 'LP deposit', d: 'Add sats to a vault you own (FlashVault v1 owner path).' },
  { id: 'withdraw', t: 'LP withdraw', d: 'Take sats out of a vault you own (owner signature).' },
  { id: 'deploy-vault', t: 'Deploy a vault', d: 'Mint a new FlashVault identity NFT funded from your coins; you become its owner.' },
];
interface Check { name: string; ok: boolean; level: string; detail: string }
interface Prepared {
  templateHash: string; minerFee: bigint; expectedUserCost: bigint; estimatedSizeBytes: number; notes?: string[];
  template: { inputs: Array<{ txid: string; vout: number; satoshis: bigint; role: string; unlock: { kind: string } }>; outputs: Array<{ satoshis: bigint; role: string; label?: string; token?: { amount: bigint } }> };
  simulation: Array<{ inputIndex: number; kind: string; evaluated: boolean; ok: boolean; detail: string }>;
  risk: { ok: boolean; level: string; checks: Check[] };
  route?: Record<string, unknown> | null;
  sign: { transactionHex: string; sourceOutputs: Array<Record<string, unknown>>; userPrompt: string; userInputs: number[]; inputPaths: Array<[number, string, number]> };
}
interface Verified { txid: string; vmValid: boolean; vmDetail: string; minerFee: bigint; sizeBytes: number; broadcast?: boolean; explorer?: string }
interface TxStatus { confirmations: number; confirmed: boolean; block_height?: number; explorer: string }
interface LiveVault { id: string; label: string; open: boolean; address: string; params: { ownerPkh: string; feeBps: bigint; minFee: bigint }; current: { satoshis: bigint; state: { flashCount: bigint; cumulativeFees: bigint } } | null; error?: string }

const Step = ({ n, t, done, active }: { n: number; t: string; done: boolean; active: boolean }) => (
  <li className={clsx('flex items-center gap-2 text-[12px]', done ? 'text-volt-300' : active ? 'text-fog-100' : 'text-fog-500')}>
    <span className={clsx('grid size-5 place-items-center rounded-full border text-[10px]', done ? 'border-volt-400 bg-volt-400/10' : 'hairline')}>{done ? '✓' : n}</span>{t}
  </li>
);

export default function LiveExecute() {
  const vaults = usePoll<LiveVault[]>('/api/live/vaults', 0);
  const [action, setAction] = useState<Action>('flash');
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [manual, setManual] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [amount, setAmount] = useState('10000');
  const [principal, setPrincipal] = useState('30000');
  const [pf, setPf] = useState<Prepared>();
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const [signedHex, setSignedHex] = useState('');
  const [ver, setVer] = useState<Verified>();
  const [sent, setSent] = useState<Verified>();
  const [st, setSt] = useState<TxStatus>();
  const [cert, setCert] = useState<{ kind: string; verification: { status: string; note: string }; certificate: { id?: string } } & Record<string, unknown>>();
  const address = wallet?.address ?? manual.trim();
  const open = (vaults.data ?? []).filter((v) => v.open && !v.error);
  useEffect(() => { if (!vaultId && open[0]) setVaultId(open[0].id); }, [open, vaultId]);
  const reset = () => { setPf(undefined); setVer(undefined); setSent(undefined); setSt(undefined); setCert(undefined); setSignedHex(''); setErr(undefined); };
  const run = async <T,>(label: string, f: () => Promise<T>) => { setErr(undefined); setBusy(label); try { return await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(undefined); } };

  const compose = () => run('Composing from live chain state, simulating in the BCH 2026 VM, running Guardian…', async () => {
    reset();
    const body: Record<string, unknown> = { action, address };
    if (action !== 'deploy-vault') body.vaultId = vaultId;
    if (action === 'deposit' || action === 'withdraw') body.amount = amount;
    if (action === 'deploy-vault') body.principal = principal;
    if (action === 'flash-cauldron') body.units = '1';
    setPf(await api<Prepared>('/api/live/prepare', { method: 'POST', json: body }));
  });
  const verify = (hex: string) => run('Verifying the signed transaction against mainnet source outputs…', async () => { setSignedHex(hex); setVer(await api<Verified>('/api/live/verify-signed', { method: 'POST', json: { rawHex: hex } })); });
  const signWallet = () => run('Confirm in your wallet…', async () => { if (!wallet || !pf) return; const hex = await wallet.sign({ transactionHex: pf.sign.transactionHex, sourceOutputs: pf.sign.sourceOutputs, userPrompt: pf.sign.userPrompt }, pf.sign.inputPaths); setSignedHex(hex); setVer(await api<Verified>('/api/live/verify-signed', { method: 'POST', json: { rawHex: hex } })); });
  const exportPkg = () => { if (!pf) return; const blob = new Blob([toJson({ network: 'mainnet', templateHash: pf.templateHash, ...pf.sign, template: pf.template })], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fuse-${action}-${pf.templateHash.slice(0, 8)}.json`; a.click(); };
  const broadcast = () => run('Relaying the signed hex to BCH mainnet…', async () => { setSent(await api<Verified>('/api/broadcast', { method: 'POST', json: { rawHex: signedHex } })); });
  useEffect(() => {
    if (!sent?.txid) return; let stop = false;
    const tick = async () => { try { const s = await api<TxStatus>(`/api/live/tx/${sent.txid}`); if (!stop) setSt(s); } catch { /* retry */ } };
    tick(); const t = setInterval(tick, 15000); return () => { stop = true; clearInterval(t); };
  }, [sent?.txid]);
  const certify = () => run('Building and verifying the certificate against mainnet…', async () => { if (sent) setCert(await api('/api/live/certificate', { method: 'POST', json: { txid: sent.txid } })); });

  const stage = cert ? 6 : sent ? 5 : ver?.vmValid ? 4 : pf ? (pf.risk.ok ? 3 : 2) : 0;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Execute · BCH mainnet" title="Live execution" lede="FUSE composes the transaction from live chain state, simulates every covenant in the BCH 2026 VM and runs Guardian before you sign. Your wallet signs; FUSE only relays the signed hex. No key ever reaches the server." right={<Badge mode="LIVE" />} />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Pipeline">
            <ol className="grid gap-2" data-testid="live-steps">
              {['Compose from live state', 'Simulate (BCH 2026 VM)', 'Guardian risk check', 'Sign in your wallet', 'Broadcast', 'Confirm + certificate'].map((t, i) => <Step key={t} n={i + 1} t={t} done={stage > i} active={stage === i} />)}
            </ol>
          </Panel>
          <Panel title="Wallet" kicker="keys stay in your wallet">
            <WalletConnect onHandle={setWallet} />
            {!wallet && (
              <label className="mt-4 block text-[11.5px] text-fog-400">or paste a BCH address (sign offline with the exported package)
                <input data-testid="live-address" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="bitcoincash:q…" className="mt-1 w-full rounded-md border hairline bg-ink-900 px-2 py-1.5 font-mono text-[11.5px] text-fog-100" />
              </label>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-5">
          <Panel title="1 · Choose an action">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="live-actions">
              {ACTIONS.map((a) => (
                <button key={a.id} data-testid={`live-action-${a.id}`} onClick={() => { setAction(a.id); reset(); }} className={clsx('rounded-lg border p-3 text-left transition-colors', action === a.id ? 'border-volt-400/60 bg-volt-400/5' : 'hairline hover:border-fog-500')}>
                  <div className="text-[13px] font-medium text-fog-100">{a.t}</div><div className="mt-1 text-[11.5px] leading-relaxed text-fog-400">{a.d}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3 text-[12px]">
              {action !== 'deploy-vault' && (
                <label className="text-fog-400">Vault
                  <select data-testid="live-vault" value={vaultId} onChange={(e) => setVaultId(e.target.value)} className="ml-2 rounded-md border hairline bg-ink-900 px-2 py-1 text-fog-100">
                    {open.map((v) => <option key={v.id} value={v.id}>{v.id} · {v.current ? sats(v.current.satoshis) : '—'} sats</option>)}
                    {!open.length && <option value="">{vaults.loading ? 'reading mainnet…' : 'no open vault'}</option>}
                  </select>
                </label>
              )}
              {(action === 'deposit' || action === 'withdraw') && <label className="text-fog-400">Amount (sats)<input value={amount} onChange={(e) => setAmount(e.target.value)} className="ml-2 w-28 rounded-md border hairline bg-ink-900 px-2 py-1 font-mono text-fog-100" /></label>}
              {action === 'deploy-vault' && <label className="text-fog-400">Principal (sats)<input value={principal} onChange={(e) => setPrincipal(e.target.value)} className="ml-2 w-28 rounded-md border hairline bg-ink-900 px-2 py-1 font-mono text-fog-100" /></label>}
              <Button onClick={compose} disabled={!address || Boolean(busy)} data-testid="live-compose">Compose + preflight</Button>
            </div>
            {!address && <p className="mt-2 text-[11.5px] text-fog-500">Connect a wallet or paste an address to compose.</p>}
          </Panel>

          {busy && <div className="text-[12px] text-amber-sim" role="status">{busy}</div>}
          {err && <div role="alert" className="rounded-lg border border-rose-bad/30 bg-rose-bad/5 p-3 text-[12px] text-rose-bad">{err}</div>}

          {pf && (
            <Panel title="2 · Simulation and Guardian" actions={<span className={clsx('num text-[12px]', pf.risk.ok ? 'text-volt-300' : 'text-rose-bad')} data-testid="live-guardian">Guardian {pf.risk.level}</span>}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-fog-500">Transaction</div>
                  <ul className="grid gap-1 text-[11.5px]">
                    {pf.template.inputs.map((x, i) => <li key={`i${i}`} className="flex justify-between gap-2"><span className="text-fog-400">in {i} · {x.unlock.kind}</span><Mono className="text-fog-200">{sats(x.satoshis)}</Mono></li>)}
                    {pf.template.outputs.map((o, i) => <li key={`o${i}`} className="flex justify-between gap-2"><span className="truncate text-fog-400" title={o.label}>out {i} · {o.label ?? o.role}</span><Mono className="text-fog-200">{sats(o.satoshis)}</Mono></li>)}
                  </ul>
                  <div className="mt-2 text-[11.5px] text-fog-400">miner fee <Mono className="text-fog-200">{sats(pf.minerFee)}</Mono> · you pay ≈ <Mono className="text-fog-200">{sats(pf.expectedUserCost)}</Mono> sats · template <Mono>{short(pf.templateHash)}</Mono></div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-fog-500">VM simulation</div>
                  <ul className="grid gap-1 text-[11.5px]" data-testid="live-sim">{pf.simulation.map((s) => <li key={s.inputIndex} className="flex gap-2"><span className={clsx('mt-1 size-1.5 shrink-0 rounded-full', s.ok ? 'bg-volt-400' : 'bg-rose-bad')} /><span className="text-fog-300">input {s.inputIndex} {s.kind}: {s.detail}</span></li>)}</ul>
                  <div className="mb-1 mt-3 text-[11px] uppercase tracking-wide text-fog-500">Guardian checks</div>
                  <ul className="grid gap-1 text-[11.5px]">{pf.risk.checks.map((c) => <li key={c.name} className="flex gap-2"><span className={clsx('mt-1 size-1.5 shrink-0 rounded-full', c.ok ? 'bg-volt-400' : c.level === 'warn' ? 'bg-amber-sim' : 'bg-rose-bad')} /><span><span className="text-fog-200">{c.name}</span> <span className="text-fog-400">{c.detail}</span></span></li>)}</ul>
                </div>
              </div>
              {pf.route && <pre className="mt-3 overflow-x-auto rounded-md bg-ink-900 p-2 text-[10.5px] text-fog-400">{JSON.stringify(pf.route, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1)}</pre>}
            </Panel>
          )}

          {pf?.risk.ok && (
            <Panel title="3 · Sign in your wallet" kicker="FUSE never sees your key">
              <div className="flex flex-wrap gap-3">
                {wallet && <Button onClick={signWallet} disabled={Boolean(busy)} data-testid="live-sign-wc">Sign with {`WizardConnect`}</Button>}
                <Button variant="ghost" onClick={exportPkg} data-testid="live-export">Export signing package (.json)</Button>
              </div>
              <p className="mt-2 text-[11.5px] text-fog-400">The package holds the unsigned transaction hex (covenant unlocks already filled), every source output (with tokens) and the input indexes your key must sign with SIGHASH_ALL|FORKID|UTXOS. Sign it with any libauth-compatible signer, then paste the signed hex.</p>
              <textarea data-testid="live-signed-hex" value={signedHex} onChange={(e) => setSignedHex(e.target.value.trim())} placeholder="signed transaction hex" rows={3} className="mt-3 w-full rounded-md border hairline bg-ink-900 p-2 font-mono text-[11px] text-fog-100" />
              <Button variant="ghost" onClick={() => verify(signedHex)} disabled={!signedHex || Boolean(busy)} className="mt-2">Verify signed hex</Button>
              {ver && <div className={clsx('mt-3 text-[12px]', ver.vmValid ? 'text-volt-300' : 'text-rose-bad')} data-testid="live-verified">{ver.vmValid ? '✓' : '✗'} {ver.vmDetail} · txid <Mono>{short(ver.txid, 10)}</Mono> · fee {sats(ver.minerFee)} sats · {ver.sizeBytes} B</div>}
            </Panel>
          )}

          {ver?.vmValid && (
            <Panel title="4 · Broadcast and track">
              {!sent && <Button onClick={broadcast} disabled={Boolean(busy)} data-testid="live-broadcast">Broadcast to BCH mainnet</Button>}
              {sent && (
                <div className="grid gap-2 text-[12px]" data-testid="live-sent">
                  <div className="text-volt-300">Broadcast · txid <a className="underline" href={sent.explorer} target="_blank" rel="noreferrer"><Mono>{sent.txid}</Mono></a></div>
                  <div className="text-fog-300">{st ? (st.confirmations > 0 ? `${st.confirmations} confirmation(s) · block ${st.block_height}` : 'in mempool · waiting for a block (~10 min)') : 'checking…'}</div>
                  <Button variant="ghost" onClick={certify} disabled={!st || st.confirmations < 1 || Boolean(busy)} className="self-start" data-testid="live-certify">Verify certificate against mainnet</Button>
                  {cert && <div className={cert.verification.status === 'VERIFIED' ? 'text-volt-300' : 'text-rose-bad'} data-testid="live-cert">{cert.verification.status === 'VERIFIED' ? '✓' : '✗'} certificate {cert.verification.status} — {cert.verification.note} · {cert.kind}<pre className="mt-2 max-h-72 overflow-auto rounded-md bg-ink-900 p-2 text-[10.5px] text-fog-400">{JSON.stringify(cert, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1)}</pre></div>}
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
