import type { Metadata } from 'next';
import { STATUS } from '@/lib/status';
import { PageHeader, Panel, Badge } from '@/components/ui';
export const metadata: Metadata = { title: 'Integration status' };
const order = ['VERIFIED', 'TESTED', 'READ-ONLY', 'IMPLEMENTED', 'BLOCKED', 'UNSUPPORTED'] as const;
export default function Status() {
  const counts = order.map((s) => [s, STATUS.filter((r) => r.status === s).length] as const);
  const areas = [...new Set(STATUS.map((r) => r.area))];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Integration status" title="What is real, what is simulated, what is blocked" lede="Each label means one thing: VERIFIED (checked against live chain data), TESTED (automated tests), READ-ONLY (real data, no writes), IMPLEMENTED (code without full tests), BLOCKED (named external blocker), UNSUPPORTED (not possible or not deployed)." />
      <div className="mb-6 flex flex-wrap gap-2">{counts.map(([s, n]) => <span key={s} className="flex items-center gap-2 rounded-full border hairline bg-ink-850 px-3 py-1 text-[12px]"><Badge mode={s} /> <span className="num text-fog-200">{n}</span></span>)}</div>
      <div className="flex flex-col gap-5">
        {areas.map((a) => (
          <Panel key={a} title={a}>
            <ul className="divide-y divide-ink-600">
              {STATUS.filter((r) => r.area === a).map((r) => (
                <li key={r.item} className="grid gap-2 py-3 md:grid-cols-[1fr_130px_1.2fr] md:items-center">
                  <span className="text-[13px] text-fog-100">{r.item}</span><span><Badge mode={r.status} /></span><span className="text-[12px] text-fog-400">{r.evidence}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
