'use client';
import { usePoll } from '@/lib/hooks';
import { sats, short } from '@/lib/api';
import { PageHeader, Panel, Stat, Badge, ApiOffline, Mono } from '@/components/ui';

interface Pool { pool_id: string; outpoint: string; scriptMatchesPublishedCauldronArtifact: boolean; satsMatchIndexer: boolean; tokensMatchIndexer: boolean; categoryMatches: boolean; sats: string; tokens: string }
interface C { checkedAt: string; network: string; token: string; indexer: string; chainSource: string; poolsReturned: number; checked: Pool[] }
const tick = (b: boolean) => <span className={b ? 'text-volt-300' : 'text-rose-bad'}>{b ? '✓' : '✕'}</span>;

export default function Mainnet() {
  const { data, error } = usePoll<C>('/api/mainnet/cauldron', 0);
  const ok = data?.checked.filter((p) => p.scriptMatchesPublishedCauldronArtifact && p.satsMatchIndexer && p.tokensMatchIndexer && p.categoryMatches).length ?? 0;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Mainnet · Cauldron" title="Live pools, checked against the published contract"
        lede="For each PUSD pool returned by the Cauldron indexer, FUSE rebuilds the pool's P2SH32 locking bytecode from the published, unmodified Cauldron artifact and the pool owner's pkh. It then fetches the UTXO from Chaingraph and checks script, satoshis, token amount and category. The solver routes through this same artifact in the local VM."
        right={<Badge mode="READ-ONLY" />} />
      <ApiOffline error={error} />
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-5 md:grid-cols-4">
            <Panel><Stat label="Pools returned" value={data.poolsReturned} sub="PUSD/BCH, Cauldron indexer" /></Panel>
            <Panel><Stat label="Fully matched" value={`${ok}/${data.checked.length}`} accent sub="script · sats · tokens · category" /></Panel>
            <Panel><Stat label="Token" value={short(data.token, 4)} sub="ParyonUSD (PUSD)" /></Panel>
            <Panel><Stat label="Snapshot" value={new Date(data.checkedAt).toLocaleTimeString()} sub={new Date(data.checkedAt).toLocaleDateString()} /></Panel>
          </div>
          <Panel title="Checked pools" kicker={`Source: ${data.chainSource}`} mode="READ-ONLY">
            <div className="scrollbar-thin -mx-5 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[12.5px]">
                <thead><tr className="border-b hairline text-[10.5px] uppercase tracking-[0.12em] text-fog-400"><th className="px-5 pb-2.5 font-medium">Pool UTXO</th><th className="pb-2.5 text-right font-medium">BCH (sat)</th><th className="pb-2.5 text-right font-medium">PUSD (cents)</th><th className="pb-2.5 text-center font-medium">Script</th><th className="pb-2.5 text-center font-medium">Sats</th><th className="pb-2.5 text-center font-medium">Tokens</th><th className="px-5 pb-2.5 text-center font-medium">Category</th></tr></thead>
                <tbody>
                  {data.checked.map((p) => (
                    <tr key={p.outpoint} className="border-b hairline last:border-0 hover:bg-ink-800/50">
                      <td className="px-5 py-3"><a className="hover:text-volt-300" href={`https://blockchair.com/bitcoin-cash/transaction/${p.outpoint.split(':')[0]}`} target="_blank" rel="noreferrer"><Mono>{short(p.outpoint.split(':')[0], 8)}:{p.outpoint.split(':')[1]}</Mono> ↗</a></td>
                      <td className="num py-3 text-right">{sats(p.sats)}</td><td className="num py-3 text-right">{sats(p.tokens)}</td>
                      <td className="py-3 text-center">{tick(p.scriptMatchesPublishedCauldronArtifact)}</td><td className="py-3 text-center">{tick(p.satsMatchIndexer)}</td><td className="py-3 text-center">{tick(p.tokensMatchIndexer)}</td><td className="px-5 py-3 text-center">{tick(p.categoryMatches)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[11.5px] text-fog-400">Swaps against these pools are not broadcast from FUSE. Mainnet execution needs explicit owner authorization and a wallet signature through WizardConnect.</p>
          </Panel>
        </>
      )}
    </div>
  );
}
