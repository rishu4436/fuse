'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export const ATOMIC_TXID = '994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f';
const steps = [
  { name: 'Borrow', venue: 'FlashVault', value: '30,100 sats', detail: 'The transaction spends the vault UTXO, making 30,100 sats available within the transaction.' },
  { name: 'Buy', venue: 'Cauldron pool A', value: '5,306 sats', detail: 'The route buys one base unit of PUSD from the first pool for 5,306 sats.' },
  { name: 'Sell', venue: 'Cauldron pool B', value: '5,273 sats', detail: 'The second pool buys back that PUSD unit for 5,273 sats.' },
  { name: 'Repay', venue: 'FlashVault', value: '30,200 sats', detail: 'The vault receives the principal plus a 100-sat fee in the same transaction.' },
];

export function SettlementReplay({ home = false }: { home?: boolean }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [spread, setSpread] = useState(80);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (active === steps.length - 1) setPlaying(false);
      else setActive(active + 1);
    }, 2800);
    return () => clearTimeout(timer);
  }, [active, playing]);

  const step = steps[active];
  const choose = (index: number) => { setPlaying(false); setActive(index); };
  return (
    <section className="atlas" aria-label="Atomic settlement">
      <div className="atlas-copy">
        <p className="atlas-caption"><i /> Bitcoin Cash / Transaction anatomy</p>
        <h1>{home ? <>Liquidity,<br /><em>in motion.</em></> : <>Inside the<br /><em>settlement.</em></>}</h1>
        <p className="atlas-deck">{home ? 'Borrow from a vault, trade across two pools and repay in one Bitcoin Cash transaction. Inspect each movement before you sign.' : 'Take apart a confirmed flash loan. Follow the same satoshis from the vault through two Cauldron pools and back.'}</p>
        <div className="atlas-links">
          <Link className="atlas-cta" href="/app/execute/live">Open live execution <span aria-hidden>↗</span></Link>
          <a href={home ? '/judging/FUSE-demo.mp4' : 'https://bchexplorer.cash/tx/'+ATOMIC_TXID}>{home ? 'Watch the film' : 'Inspect settlement'} <span>{home ? '▷' : '↗'}</span></a>
        </div>
        <div className="atlas-cost"><span>Recorded wallet cost</span><strong>1,991 <small>sats</small></strong></div>
      </div>
      <div className="atlas-instrument">
        <div className="atlas-instrument-top"><span>Atomic settlement</span><span>Recorded · block 978214</span></div>
        <div className="atlas-figure" role="group" aria-label="Exploded view of the four settlement steps">
          <div className="atlas-axis" aria-hidden />
          <div className="atlas-annotation" aria-hidden><b>0{active + 1}</b><span>{step.name}<small>{step.venue}</small></span></div>
          {steps.map((item, i) => {
            const offset = (i - 1.5) * (4 + spread * 0.17);
            return <button key={item.name} type="button" aria-label={'Inspect component ' + (i + 1) + ', ' + item.venue} aria-pressed={active === i}
              className="atlas-part" onClick={() => choose(i)}
              style={{ left: (50 + offset) + '%', top: (48 - offset * .55) + '%', zIndex: i + 1, '--entry-x': (1.5 - i) * 56 + '%', '--entry-y': (i - 1.5) * 14 + '%' } as CSSProperties}>
              <Image src={`/atlas/part-${i}.webp`} width={500} height={500} priority alt="" draggable={false} />
            </button>;
          })}

          <label className="atlas-spread">Spacing <input type="range" min="0" max="100" value={spread} onChange={e => setSpread(Number(e.target.value))} /></label>
        </div>
        <div className="atlas-steps" aria-label="Transaction steps" role="group">
          {steps.map((item, i) => <button key={item.name} type="button" aria-pressed={active === i} onClick={() => choose(i)}>
            <small aria-hidden>0{i+1}</small> {item.name}</button>)}
        </div>
        <div className="atlas-inspector" aria-live={playing ? 'off' : 'polite'}>
          <div key={step.name}><span>{step.venue}</span><strong>{step.value}</strong><p>{step.detail}</p></div>
          <button type="button" className="atlas-play" onClick={() => { if (playing) setPlaying(false); else { setActive(0); setPlaying(true); } }}>
            <b aria-hidden>{playing ? 'Ⅱ' : '▷'}</b>{playing ? 'Pause replay' : 'Replay route'}
          </button>
        </div>
      </div>
    </section>
  );
}
