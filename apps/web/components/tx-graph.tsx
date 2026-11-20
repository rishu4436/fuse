'use client';
import { motion } from 'motion/react';
import { useId, useState } from 'react';
import { sats, short } from '@/lib/api';
import type { Template, TIn, TOut } from '@/lib/types';

const roleColor: Record<string, string> = {
  vault: '#3ee0c4', 'vault-continuation': '#3ee0c4', pool: '#6aa8ff', wallet: '#e3e9ef', user: '#e3e9ef', change: '#8fa0b3', solver: '#e8b04a',
};
const roleName: Record<string, string> = { vault: 'FlashVault shard', 'vault-continuation': 'Vault continuation', pool: 'Cauldron pool', wallet: 'Your wallet', user: 'You receive', change: 'Your change', solver: 'Solver' };
const colorOf = (r: string) => roleColor[r] ?? '#8fa0b3';

const compact = (v: bigint) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(v));
function weight(s: bigint) { const n = Number(s); return Math.max(1.25, Math.min(9, Math.log10(Math.max(n, 1)) - 1.5)); }

/** Animated value-flow graph of a transaction template: inputs → atomic transaction → outputs. */
export function TxGraph({ template, txid, caption }: { template: Template; txid?: string; caption?: string }) {
  const gid = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const W = 820, rowH = 60, pad = 26;
  const rows = Math.max(template.inputs.length, template.outputs.length);
  const H = pad * 2 + rows * rowH;
  const cx = W / 2, cy = H / 2, nodeW = 120, nodeH = Math.min(H - pad * 2, 40 + rows * 18);
  const yAt = (i: number, n: number) => pad + rowH / 2 + i * rowH + ((rows - n) * rowH) / 2;
  const inX = 196, outX = W - 196;

  const Label = ({ x, y, align, item, kind, idx }: { x: number; y: number; align: 'start' | 'end'; item: TIn | TOut; kind: 'in' | 'out'; idx: number }) => {
    const key = `${kind}${idx}`;
    const dim = hover && hover !== key;
    return (
      <g onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} style={{ opacity: dim ? 0.35 : 1, transition: 'opacity .2s' }}>
        <circle cx={align === 'end' ? x + 8 : x - 8} cy={y} r={4} fill={colorOf(item.role)} />
        <text x={align === 'end' ? x - 4 : x + 4} y={y - 6} textAnchor={align} className="fill-fog-100" style={{ font: '500 13.5px var(--font-geist-sans)' }}>
          {('label' in item && item.label) || roleName[item.role] || item.role}
        </text>
        <text x={align === 'end' ? x - 4 : x + 4} y={y + 11} textAnchor={align} className="fill-fog-400" style={{ font: '12px var(--font-geist-mono)' }}>
          {compact(item.satoshis)} sat{item.token && !item.token.nft ? ` · ${compact(item.token.amount)} tok` : ''}{item.token?.nft ? ' · NFT' : ''}
          <title>{`${sats(item.satoshis)} sat${item.token ? ` · ${sats(item.token.amount)} tokens` : ''}`}</title>
        </text>
      </g>
    );
  };

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Transaction graph: ${template.inputs.length} inputs, ${template.outputs.length} outputs`}>
        <defs>
          <linearGradient id={`core-${gid}`} x1="0" x2="1"><stop offset="0" stopColor="#0f141c" /><stop offset="1" stopColor="#161d27" /></linearGradient>
          <filter id={`glow-${gid}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {template.inputs.map((inp, i) => {
          const y = yAt(i, template.inputs.length);
          const d = `M ${inX + 14} ${y} C ${cx - 110} ${y}, ${cx - 110} ${cy}, ${cx - nodeW / 2} ${cy}`;
          const key = `in${i}`; const dim = hover && hover !== key;
          return (
            <g key={key} style={{ opacity: dim ? 0.15 : 1, transition: 'opacity .2s' }}>
              <motion.path d={d} fill="none" stroke={colorOf(inp.role)} strokeOpacity={0.22} strokeWidth={weight(inp.satoshis)} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }} />
              <path d={d} fill="none" stroke={colorOf(inp.role)} strokeWidth={1.4} strokeDasharray="2 14" strokeLinecap="round" className="fuse-flow" style={{ animationDelay: `${i * 0.2}s` }} />
            </g>
          );
        })}
        {template.outputs.map((o, i) => {
          const y = yAt(i, template.outputs.length);
          const d = `M ${cx + nodeW / 2} ${cy} C ${cx + 110} ${cy}, ${cx + 110} ${y}, ${outX - 14} ${y}`;
          const key = `out${i}`; const dim = hover && hover !== key;
          return (
            <g key={key} style={{ opacity: dim ? 0.15 : 1, transition: 'opacity .2s' }}>
              <motion.path d={d} fill="none" stroke={colorOf(o.role)} strokeOpacity={0.22} strokeWidth={weight(o.satoshis)} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.5 + 0.08 * i, ease: [0.16, 1, 0.3, 1] }} />
              <path d={d} fill="none" stroke={colorOf(o.role)} strokeWidth={1.4} strokeDasharray="2 14" strokeLinecap="round" className="fuse-flow" style={{ animationDelay: `${0.4 + i * 0.2}s` }} />
            </g>
          );
        })}
        <motion.g initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.3 }} style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <rect x={cx - nodeW / 2} y={cy - nodeH / 2} width={nodeW} height={nodeH} rx={14} fill={`url(#core-${gid})`} stroke="#3ee0c4" strokeOpacity={0.55} filter={`url(#glow-${gid})`} />
          <text x={cx} y={cy - 6} textAnchor="middle" className="fill-volt-300" style={{ font: '600 10.5px var(--font-geist-sans)', letterSpacing: '0.16em' }}>ATOMIC TX</text>
          <text x={cx} y={cy + 12} textAnchor="middle" className="fill-fog-300" style={{ font: '11px var(--font-geist-mono)' }}>{txid ? short(txid, 5) : 'unsigned'}</text>
        </motion.g>
        {template.inputs.map((inp, i) => <Label key={`li${i}`} x={inX} y={yAt(i, template.inputs.length)} align="end" item={inp} kind="in" idx={i} />)}
        {template.outputs.map((o, i) => <Label key={`lo${i}`} x={outX} y={yAt(i, template.outputs.length)} align="start" item={o} kind="out" idx={i} />)}
      </svg>
      <style>{`.fuse-flow{animation:fuse-dash 1.6s linear infinite}@keyframes fuse-dash{to{stroke-dashoffset:-32}}@media (prefers-reduced-motion: reduce){.fuse-flow{animation:none}}`}</style>
      {caption && <figcaption className="mt-2 text-center text-[11.5px] text-fog-400">{caption}</figcaption>}
    </figure>
  );
}
