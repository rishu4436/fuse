'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export const ATOMIC_TXID = '994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f';
const steps = [
  { name: 'Borrow', venue: 'FlashVault', value: '30,100 sats', detail: 'The transaction spends the vault UTXO, making 30,100 sats available within the transaction.' },
  { name: 'Buy', venue: 'Cauldron pool A', value: '5,306 sats', detail: 'The route buys one base unit of PUSD from the first pool for 5,306 sats.' },
  { name: 'Sell', venue: 'Cauldron pool B', value: '5,273 sats', detail: 'The second pool buys back that PUSD unit for 5,273 sats.' },
  { name: 'Repay', venue: 'FlashVault', value: '30,200 sats', detail: 'The vault receives the principal plus a 100-sat fee in the same transaction.' },
];

export function SettlementReplay() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (active === steps.length - 1) setPlaying(false);
      else setActive(active + 1);
    }, 2800);
    return () => clearTimeout(timer);
  }, [active, playing]);

  const step = steps[active];
  return (
    <section aria-labelledby="settlement-title" className="dashboard-replay">
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <h2 id="settlement-title" className="font-medium tracking-tight text-fog-100">Atomic settlement</h2>
        <span className="dashboard-pill">Recorded · block 978214</span>
      </div>
      <div className="dashboard-flow" role="group" aria-label="Transaction steps">
        {steps.map((item, index) => (
          <button key={item.name} type="button" onClick={() => { setPlaying(false); setActive(index); }}
            aria-pressed={active === index} className="dashboard-step">
            <span className="dashboard-step-node" aria-hidden>{index + 1}</span>
            <span className="dashboard-step-label">{item.name}</span>
          </button>
        ))}
      </div>
      <div className="dashboard-detail" aria-live={playing ? 'off' : 'polite'}>
        <AnimatePresence initial={false} mode="wait">
          <motion.div key={step.name} initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}>
            <div className="text-xs text-fog-200">{step.venue}</div>
            <div className="num mt-1 text-2xl text-volt-300">{step.value}</div>
            <p className="mt-2 text-sm leading-relaxed text-fog-200">{step.detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="relative mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-fog-200">Wallet cost <strong className="num ml-1 font-medium text-fog-100">1,991 sats</strong></span>
        <button type="button" className="dashboard-replay-button" onClick={() => {
          if (playing) setPlaying(false);
          else { setActive(0); setPlaying(true); }
        }}>{playing ? 'Pause replay' : '▶ Replay route'}</button>
      </div>
    </section>
  );
}
