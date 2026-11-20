import Link from 'next/link';
import { PageHeader, Panel } from '@/components/ui';

const CARDS = [
  { href: '/developers/sdk', t: 'TypeScript SDK', d: 'Run a solver: watch auctions, build templates, sign bids, co-sign the winner.' },
  { href: '/developers/api', t: 'REST & real-time API', d: 'Every endpoint the Studio uses, plus the server-sent event stream.' },
  { href: '/developers/recipes', t: 'Recipes', d: 'Intent and policy documents you can paste into the API.' },
  { href: '/verify', t: 'Proof verification', d: 'Check an execution certificate against the chain, independently of FUSE.' },
];
export default function Developers() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Developers" title="Build on the FUSE execution network" lede="Solvers are independent processes with their own keys. The coordinator trusts none of them: every template is verified in the BCH VM and every outcome recomputed." />
      <div className="grid gap-4 sm:grid-cols-2">{CARDS.map((c) => <Link key={c.href} href={c.href} className="panel block p-5 transition-colors hover:border-volt-400/40"><div className="text-[14px] font-medium text-fog-100">{c.t}</div><p className="mt-2 text-[12.5px] text-fog-400">{c.d}</p></Link>)}</div>
      <Panel className="mt-5" title="Packages in this repository">
        <ul className="grid gap-1.5 text-[12.5px] text-fog-300 sm:grid-cols-2">
          {['@fuse/solver-sdk: SolverClient, strategies, bid signing, arbitrage scanner', '@fuse/transaction-composer: templates, signing, independent verifier', '@fuse/compiler: intent compiler, explanation, fee accounting, netting, parallel worlds', '@fuse/proof-verifier: certificate schema and verification', '@fuse/policy-engine: FEP-1 policies (sign, verify, evaluate)', '@fuse/flash-liquidity: shard manager and LP transactions', '@fuse/risk-engine: Guardian radar, readiness, sentinel', '@fuse/wallet: WizardConnect request, preflight, wallet-signature verification'].map((x) => <li key={x} className="num text-[12px]">{x}</li>)}
        </ul>
        <p className="mt-3 text-[11.5px] text-fog-400">Workspace packages, not yet published to npm.</p>
      </Panel>
    </div>
  );
}
