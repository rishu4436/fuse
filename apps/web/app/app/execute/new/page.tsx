'use client';
import { useState } from 'react';
import { motion } from 'motion/react';
import { api, sats } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import type { Auction, Solver } from '@/lib/types';
import { Button, PageHeader, Panel, Badge, ApiOffline } from '@/components/ui';
import { AuctionView } from '@/components/auction-view';
import { WalletConnect } from '@/components/wallet-connect';
import { CompilePreview } from '@/components/compile-preview';

const presets = [{ out: 30_000n, max: 40_000_000n, label: '30k FUSD' }, { out: 10_000n, max: 15_000_000n, label: '10k FUSD' }, { out: 60_000n, max: 80_000_000n, label: '60k FUSD' }];

function Field({ label, hint, value, onChange, unit, id }: { label: string; hint: string; value: string; onChange: (v: string) => void; unit: string; id: string }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-[12px] text-fog-300">{label}</span>
      <div className="mt-1.5 flex items-center rounded-[10px] border hairline bg-ink-850 focus-within:border-volt-400/60">
        <input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))} className="num w-full bg-transparent px-3 py-2.5 text-[15px] text-fog-100 outline-none" aria-describedby={`${id}-hint`} />
        <span className="pr-3 text-[12px] text-fog-400">{unit}</span>
      </div>
      <span id={`${id}-hint`} className="mt-1 block text-[11px] text-fog-400">{hint}</span>
    </label>
  );
}

export default function Studio() {
  const [minOut, setMinOut] = useState('30000');
  const [maxIn, setMaxIn] = useState('40000000');
  const [maxFee, setMaxFee] = useState('20000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [current, setCurrent] = useState<string>();
  const solvers = usePoll<Solver[]>('/api/solvers', 3000);
  const reset = async () => { setErr(undefined); try { await api('/api/world/reset', { method: 'POST', json: {} }); setCurrent(undefined); } catch (e) { setErr((e as Error).message); } };
  const submit = async () => {
    setBusy(true); setErr(undefined);
    try { const a = await api<Auction>('/api/intents/swap', { method: 'POST', json: { minOut, maxIn, maxFee } }); setCurrent(a.auctionId); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Intent Studio" title="Compose an intent, watch solvers compete"
        lede="Set your limits. Solvers bid complete transactions, FUSE verifies each one in the BCH VM, and the cheapest valid bid wins. You only sign what was verified."
        right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={solvers.error} />
      <div className="mt-4 grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-5">
          <Panel title="Token swap intent" kicker="TOKEN_SWAP · ATOMIC_SINGLE_TX">
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
                {presets.map((p) => (
                  <button type="button" key={p.label} onClick={() => { setMinOut(String(p.out)); setMaxIn(String(p.max)); }}
                    className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${minOut === String(p.out) ? 'border-volt-400/50 bg-volt-400/10 text-volt-300' : 'hairline text-fog-300 hover:text-fog-100'}`}>{p.label}</button>
                ))}
              </div>
              <Field id="minOut" label="Receive at least" hint="FUSD base units (local fixture token)" value={minOut} onChange={setMinOut} unit="FUSD" />
              <Field id="maxIn" label="Spend at most" hint={`${(Number(maxIn || 0) / 1e8).toFixed(4)} BCH`} value={maxIn} onChange={setMaxIn} unit="sat" />
              <Field id="maxFee" label="Max miner fee" hint="Bids with a higher network fee are rejected" value={maxFee} onChange={setMaxFee} unit="sat" />
              <Button type="submit" disabled={busy || !minOut || !maxIn} data-testid="submit-intent">{busy ? 'Opening auction…' : 'Run auction'}</Button>
              {err && <div role="alert" className="text-[12px] text-rose-bad">{err}</div>}
              <button type="button" onClick={reset} className="text-left text-[11.5px] text-fog-400 underline-offset-2 hover:text-fog-100 hover:underline" data-testid="reset-world">Reset local world (pools, vault and wallet back to genesis)</button>
              <p className="text-[11px] leading-relaxed text-fog-400">Arbitrage closes the gap between the two pools, so the flash solver may stop bidding after it has run. Reset the world to replay the demo. The local demo wallet is a fixed test key that only holds simulated coins. On mainnet the same template would be signed in your own wallet through WizardConnect with SIGHASH_ALL|FORKID|UTXOS.</p>
            </form>
          </Panel>
          <Panel title="Your wallet" kicker="WizardConnect · mainnet, read only"><WalletConnect /></Panel>
          <Panel title="Solvers listening" kicker="Separate processes, each with its own key">
            <ul className="flex flex-col gap-2">
              {(solvers.data ?? []).map((s) => (
                <motion.li key={s.solverId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between text-[12.5px]">
                  <span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${s.strategy === 'ADVERSARIAL_FIXTURE' ? 'bg-rose-bad' : 'bg-volt-400'}`} />{s.name}</span>
                  <span className="num text-fog-400">{s.wins}W · {s.rejected}R</span>
                </motion.li>
              ))}
              {!solvers.data?.length && <li className="text-[12px] text-fog-400">No solvers yet. Run <code className="num">pnpm solvers</code>.</li>}
            </ul>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {current ? <AuctionView id={current} /> : (
            <Panel title="No auction running">
              <div className="py-12 text-center">
                <div className="mx-auto mb-4 h-px w-40 bg-gradient-to-r from-transparent via-volt-400/60 to-transparent" />
                <p className="text-[13.5px] text-fog-300">Run an auction to see bids arrive, get verified, and settle atomically.</p>
                <p className="mt-1 text-[12px] text-fog-400">Spend limit: {sats(BigInt(maxIn || '0'))} sat · minimum receive: {sats(BigInt(minOut || '0'))} FUSD</p>
              </div>
            </Panel>
          )}
          <CompilePreview minOut={minOut} maxIn={maxIn} maxFee={maxFee} />
        </div>
      </div>
    </div>
  );
}
