'use client';
import { usePoll } from '@/lib/hooks';
import { PageHeader, Panel, Badge } from '@/components/ui';
import { KV } from '@/components/kit';
import { ELECTRUM_SERVERS } from '@/lib/electrum';

interface N { local: { mode: string; engine: string }; mainnet: { mode: string; broadcast: string; source: string }; chipnet: { mode: string; reason: string } }
interface Notes { channels: Record<string, string>; externalOptIn: boolean }
interface Store { engine: string; path: string; migrations: Array<{ version: number; name: string }>; counts: Record<string, number> }

export default function Settings() {
  const n = usePoll<N>('/api/network/status', 0);
  const c = usePoll<Notes>('/api/notifications', 0);
  const st = usePoll<Store>('/api/store', 0);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Settings" title="Networks, safety and channels" lede="Safety switches are read-only here on purpose. Mainnet broadcasting cannot be turned on from the UI; it needs explicit owner authorization in the deployment configuration." />
      <div className="grid gap-5">
        <Panel title="Networks">
          <KV rows={[['Local', <span key="l"><Badge mode="SIMULATION" /> <span className="ml-2 text-fog-300">{n.data?.local.engine}</span></span>], ['Mainnet', <span key="m"><Badge mode="READ-ONLY" /> <span className="ml-2 text-fog-300">{n.data?.mainnet.source}</span></span>], ['Chipnet', <span key="c" className="text-fog-300">{n.data?.chipnet.mode}: {n.data?.chipnet.reason}</span>]]} />
        </Panel>
        <Panel title="Safety">
          <div className="flex items-center justify-between rounded-lg border hairline p-3">
            <div><div className="text-[13px] text-fog-100">Mainnet broadcast</div><div className="text-[11.5px] text-fog-400">{n.data?.mainnet.broadcast ?? 'disabled'}</div></div>
            <button role="switch" aria-checked="false" disabled className="h-6 w-11 cursor-not-allowed rounded-full bg-ink-600 p-0.5 opacity-60" aria-label="Mainnet broadcast (locked off)" data-testid="broadcast-switch"><span className="block size-5 rounded-full bg-fog-400" /></button>
          </div>
          <p className="mt-3 text-[11.5px] text-fog-400">Wallet signing requests are always sent with broadcast:false. Signed transactions are verified and shown, never sent.</p>
        </Panel>
        <Panel title="Wallet data (your browser)">
          <KV rows={[['Fulcrum servers', ELECTRUM_SERVERS.join(', ')], ['Used for', 'listing your own coins for the mainnet preflight (read only)']]} />
        </Panel>
        <Panel title="Notification channels" kicker={c.data?.externalOptIn ? 'external delivery opted in' : 'external delivery OFF (FUSE_NOTIFY_EXTERNAL not set)'}>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="channels">
            {Object.entries(c.data?.channels ?? {}).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between rounded-lg border hairline px-3 py-2.5">
                <span className="text-[13px] capitalize text-fog-100">{k}</span>
                <span className={v === 'CONFIGURED' || v === 'IMPLEMENTED' ? 'num text-[10.5px] text-volt-300' : 'num text-[10.5px] text-fog-400'}>{v.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-fog-400">Webhook (HMAC-signed), Telegram and email adapters exist but send nothing unless the operator sets their credentials and FUSE_NOTIFY_EXTERNAL=1. Secrets are never shown or logged.</p>
        </Panel>
        <Panel title="Persistence">
          <KV rows={[['Engine', st.data?.engine ?? '—'], ['Database', st.data?.path ?? '—'], ['Migrations', st.data?.migrations.map((m) => `v${m.version} ${m.name}`).join(' · ') ?? '—'], ['Rows', st.data ? Object.entries(st.data.counts).map(([k, v]) => `${k} ${v}`).join(' · ') : '—']]} />
        </Panel>
      </div>
    </div>
  );
}
