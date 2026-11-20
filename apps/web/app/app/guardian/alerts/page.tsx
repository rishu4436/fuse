'use client';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Badge, Button, ApiOffline, Empty } from '@/components/ui';

interface N { id: string; at: number; severity: 'info' | 'warning' | 'critical'; title: string; body: string; read: boolean; source: string }
interface R { unread: number; channels: Record<string, string>; items: N[] }

export default function Alerts() {
  const { data, error, reload } = usePoll<R>('/api/notifications', 3000);
  const read = async (id?: string) => { await api('/api/notifications/read', { method: 'POST', json: id ? { id } : {} }); reload(); };
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Guardian · Alerts" title="Notifications" lede="In-app alerts from Guardian policies, deduplicated per rule for 10 minutes. External channels stay off until you configure and approve them." right={<Badge mode="IMPLEMENTED" />} />
      <ApiOffline error={error} />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <Panel title={`${data?.unread ?? 0} unread`} actions={<Button variant="ghost" onClick={() => read()}>Mark all read</Button>}>
          {!data?.items.length ? <Empty title="No alerts" body="Create a Guardian policy to start monitoring a loan." /> : (
            <ul className="grid gap-2">
              {data.items.map((n) => (
                <li key={n.id} className={clsx('rounded-lg border p-3 text-[12.5px]', n.read ? 'hairline opacity-70' : n.severity === 'critical' ? 'border-rose-bad/40 bg-rose-bad/5' : n.severity === 'warning' ? 'border-amber-sim/40 bg-amber-sim/5' : 'hairline')} data-testid="alert">
                  <div className="flex items-center justify-between gap-3"><span className="font-medium text-fog-100">{n.title}</span><span className="num text-[11px] text-fog-400">{new Date(n.at).toLocaleTimeString()}</span></div>
                  <p className="mt-1 text-fog-300">{n.body}</p>
                  {!n.read && <button className="mt-2 text-[11.5px] text-volt-300 hover:underline" onClick={() => read(n.id)}>Mark read</button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Channels">
          <ul className="grid gap-2 text-[12.5px]">{Object.entries(data?.channels ?? {}).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><span className={v === 'IMPLEMENTED' ? 'text-volt-300' : 'text-fog-400'}>{v.replace('_', ' ').toLowerCase()}</span></li>)}</ul>
        </Panel>
      </div>
    </div>
  );
}
