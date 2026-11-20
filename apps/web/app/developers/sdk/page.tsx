import { PageHeader, Panel, Badge } from '@/components/ui';
import { Code } from '@/components/code';

const SNIPPET = `import { SolverClient, STRATEGIES, signBid, solverIdOf } from '@fuse/solver-sdk';
import { signInputs } from '@fuse/transaction-composer';

const client = new SolverClient('http://127.0.0.1:8787', solverIdOf(pubkeyHex));
await client.register(pubkeyHex, 'ROUTING', 'my-solver');

for (const a of await client.openAuctions()) {
  // Build a complete transaction template for the intent.
  const p = STRATEGIES.ROUTING(a.market, { ...a.intent, auctionId: a.auctionId }, me);
  // Sign the bid (Schnorr over the canonical bid commitment).
  await client.submitBid(signBid({ auctionId: a.auctionId, strategy: 'ROUTING', ...p }, privKey));
}

// If you win, co-sign your own inputs (SIGHASH_ALL|FORKID|UTXOS only).
for (const r of await client.signRequests()) {
  const unlocks = signInputs(r.bid.template, 'solver', privKey);
  await client.submitSignatures(r.auctionId, Object.fromEntries(unlocks));
}`;
const VERIFY = `import { verifyCertificate, indexerChainReader } from '@fuse/proof-verifier';
const result = await verifyCertificate(cert, indexerChainReader('mainnet', chaingraph));
// result.status: 'VERIFIED' | 'FAILED' | 'INSUFFICIENT_EVIDENCE'`;

export default function Sdk() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Developers · SDK" title="Write a solver in TypeScript" lede="The reference workers in services/solver-reference use exactly this loop. Run four of them with pnpm solvers." right={<Badge mode="TESTED" />} />
      <div className="grid gap-5">
        <Panel title="Solver loop"><Code>{SNIPPET}</Code></Panel>
        <Panel title="Verify a certificate"><Code>{VERIFY}</Code></Panel>
        <Panel title="Rules the coordinator enforces">
          <ul className="grid gap-1.5 text-[12.5px] text-fog-300">
            {['Bids are signed; solverId must equal hash of the pubkey.', 'Max 3 bids per solver per auction, rate-limited, nonces never reused.', 'Every input must exist in the current market view (stale UTXOs rejected).', 'Covenant inputs are dry-run in the BCH 2026 VM before ranking.', 'User outcome is recomputed from the template; claims that disagree are rejected.', 'Solvers may only use FlashVault flash(), never the LP owner path.'].map((x) => <li key={x}>• {x}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
