'use client';
import { motion } from 'motion/react';
import { usePoll } from '@/lib/hooks';
import { sats, short, bch } from '@/lib/api';
import type { Vault } from '@/lib/types';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono } from '@/components/ui';

export default function VaultPage() {
  const { data: v, error } = usePoll<Vault>('/api/vault', 2000);
  const max = v ? v.shards.reduce((m, s) => (s.satoshis > m ? s.satoshis : m), 1n) : 1n;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="FlashVault" title="Covenant liquidity that must come back in the same transaction"
        lede="A FlashVault shard can be spent only if the same transaction returns principal plus fee to an identical continuation at the same output index. The state commitment must be updated and the identity NFT kept. This is enforced in CashScript, with no off-chain trust."
        right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={error} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="Shards" kicker="Each shard is an independent UTXO, so solvers can borrow in parallel">
          <div className="mb-6 grid grid-cols-3 gap-6">
            <Stat label="Total liquidity" value={v ? bch(v.totalSats).slice(0, -4) : '—'} unit="BCH" />
            <Stat label="Fees earned" value={v ? sats(v.cumulativeFees) : '—'} unit="sat" accent />
            <Stat label="Flash loans" value={v ? String(v.flashCount) : '—'} />
          </div>
          <ul className="flex flex-col gap-3">
            {v?.shards.map((s) => (
              <li key={s.outpoint} className="rounded-xl border hairline bg-ink-850 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Mono className="text-fog-300">{short(s.outpoint.split(':')[0], 8)}:{s.outpoint.split(':')[1]}</Mono>
                  <span className="text-[11px] text-fog-400">{s.state.paused ? <span className="text-rose-bad">paused</span> : 'active'} · {String(s.state.flashCount)} flashes · <span className="text-volt-300">{sats(s.state.cumulativeFees)} sat</span> fees</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-volt-600 to-volt-400" initial={{ width: 0 }} animate={{ width: `${Number((s.satoshis * 1000n) / max) / 10}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
                </div>
                <div className="num mt-2 text-[13px] text-fog-100">{sats(s.satoshis)} <span className="text-fog-400">sat</span></div>
              </li>
            ))}
          </ul>
        </Panel>
        <div className="flex flex-col gap-5">
          <Panel title="Contract parameters">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[12.5px]">
              <dt className="text-fog-400">Fee</dt><dd className="num text-right">{v ? `${String(v.params.feeBps)} bps` : '—'}</dd>
              <dt className="text-fog-400">Minimum fee</dt><dd className="num text-right">{v ? `${sats(v.params.minFee)} sat` : '—'}</dd>
              <dt className="text-fog-400">Max exposure</dt><dd className="num text-right">{v ? `${sats(v.params.maxExposure)} sat` : '—'}</dd>
              <dt className="text-fog-400">Identity NFT</dt><dd className="text-right"><Mono>{short(v?.params.vaultCategory, 6)}</Mono></dd>
              <dt className="text-fog-400">Owner pkh</dt><dd className="text-right"><Mono>{short(v?.params.ownerPkh, 6)}</Mono></dd>
            </dl>
          </Panel>
          <Panel title="What the covenant enforces">
            <ul className="flex flex-col gap-2 text-[12.5px] text-fog-300">
              {['Continuation at the same index with the same locking bytecode', 'Value ≥ principal + max(minFee, ⌈value·bps/10⁴⌉)', 'Identity NFT category and mutable capability kept', 'State commitment: count+1, fees += actual surplus', 'No pausing or token injection by solvers', 'Owner path: 65-byte Schnorr sig, hashtype 0x61 only'].map((t) => (
                <li key={t} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-volt-400" />{t}</li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] text-fog-400">43 contract tests run in the BCH VM, including fast-check property tests. See docs/TEST-REPORT.md.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
