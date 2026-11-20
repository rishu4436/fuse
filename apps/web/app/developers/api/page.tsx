import { PageHeader, Panel, Badge } from '@/components/ui';
import { Table, Tr, Td } from '@/components/kit';

const API: Array<[string, string, string, string]> = [
  ['GET', '/api/health', 'Liveness, network, broadcast flag', 'ALL'],
  ['GET', '/api/network/status', 'Mode of each network', 'ALL'],
  ['GET', '/api/events', 'Server-sent event stream', 'LOCAL'],
  ['GET', '/api/compile/draft', 'A valid draft intent for the local wallet', 'LOCAL'],
  ['POST', '/api/compile', 'Run the 10-stage compiler on an intent', 'LOCAL'],
  ['POST', '/api/parallel-worlds', 'Compile across six market scenarios', 'LOCAL'],
  ['POST', '/api/netting/simulate', 'Cross-intent netting, VM-verified, not submitted', 'LOCAL'],
  ['POST', '/api/intents/swap', 'Open a solver auction', 'LOCAL'],
  ['GET', '/api/auctions[/:id]', 'Auctions with verified bids', 'LOCAL'],
  ['POST', '/api/solvers/register', 'Register a solver key', 'LOCAL'],
  ['GET', '/api/auctions/open', 'Open auctions + market view (solvers)', 'LOCAL'],
  ['POST', '/api/solver/bids', 'Submit a signed bid', 'LOCAL'],
  ['GET', '/api/solver/sign-requests', 'Winner co-sign requests', 'LOCAL'],
  ['POST', '/api/solver/signatures', 'Winner co-signatures', 'LOCAL'],
  ['GET', '/api/certificates[/:id][/html]', 'Execution certificates', 'LOCAL'],
  ['POST', '/api/certificates/verify', 'Verify a certificate against the chain', 'LOCAL'],
  ['GET', '/api/replay/:certId', 'Re-run a settled tx in a fresh VM', 'LOCAL'],
  ['GET', '/api/liquidity', 'Vault health, leases, adaptive plan', 'LOCAL'],
  ['POST', '/api/liquidity/op', 'LP deposit/withdraw/merge/split/pause', 'LOCAL'],
  ['GET', '/api/explorer[/:txid]', 'Decoded local transactions', 'LOCAL'],
  ['GET', '/api/contracts', 'Artifacts, hashes, ABI, source', 'ALL'],
  ['GET', '/api/opportunities', 'Arbitrage scan: local + mainnet snapshot', 'READ-ONLY'],
  ['GET', '/api/mainnet/cauldron', 'Verified Cauldron pool snapshot', 'READ-ONLY'],
  ['GET', '/api/mainnet/paryon', 'Paryon V1 deployment + loans snapshot', 'READ-ONLY'],
  ['GET', '/api/guardian/radar', 'Liquidation + redemption radar, price shock', 'READ-ONLY'],
  ['GET', '/api/guardian/sentinel', 'Protocol health sentinel', 'READ-ONLY'],
  ['GET/POST', '/api/guardian/policies', 'Guardian policies (proposals only)', 'READ-ONLY'],
  ['GET', '/api/guardian/readiness', 'Protection readiness for a loan', 'READ-ONLY'],
  ['GET', '/api/notifications', 'In-app notifications', 'ALL'],
  ['POST', '/api/wallet/preflight', 'Mainnet preflight for a WizardConnect wallet', 'MAINNET (no broadcast)'],
  ['POST', '/api/wallet/verify-signed', 'Verify a wallet-signed transaction', 'MAINNET (no broadcast)'],
];
export default function ApiPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Developers · API" title="REST and real-time API" lede="JSON over HTTP on port 8787. bigint values are encoded as strings with an n suffix (&quot;123n&quot;). There is no broadcast endpoint." right={<Badge mode="TESTED" />} />
      <Panel>
        <Table head={['Method', 'Path', 'Purpose', 'Network']} min={720}>
          {API.map(([m, p, d, n]) => <Tr key={m + p}><Td first><span className="num text-[11.5px] text-volt-300">{m}</span></Td><Td><span className="num text-[12px] text-fog-100">{p}</span></Td><Td>{d}</Td><Td><span className="text-[11.5px] text-fog-400">{n}</span></Td></Tr>)}
        </Table>
      </Panel>
    </div>
  );
}
