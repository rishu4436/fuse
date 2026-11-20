import { PageHeader, Panel, Badge } from '@/components/ui';
import { Code } from '@/components/code';

const INTENT = `{
  "version": 1, "id": "intent_example_0001", "network": "local", "type": "TOKEN_SWAP",
  "owner": { "lockingBytecode": "76a914…88ac", "authorization": "WALLET_SIGNATURE" },
  "inputs": [{ "asset": "BCH", "amount": "40000000" }],
  "allowedAssets": ["BCH", "<token category>"],
  "operation": { "kind": "TOKEN_SWAP", "params": {} },
  "minOutput": { "asset": "<token category>", "amount": "30000" },
  "maxInput": { "asset": "BCH", "amount": "40000000" },
  "maxFee": { "asset": "BCH", "amount": "20000" },
  "maxSlippageBps": 100, "deadline": 1795000000,
  "protocols": ["cauldron", "fuse-flashvault"],
  "authorizationMode": "PER_TX_SIGNATURE", "nonce": "00112233445566778899",
  "replayDomain": "fuse-local", "atomicity": "ATOMIC_SINGLE_TX",
  "requiredEvidence": ["TX_CONFIRMED", "OUTPUT_TO_OWNER", "CERTIFICATE"]
}`;
const POLICY = `POST /api/guardian/policies
{
  "name": "Keep my loan above 150%",
  "loan": "<paryon loan txid>:<vout>",
  "channels": ["in-app"],
  "rules": [
    { "id": "r1", "when": { "crBelowBps": 15000 }, "then": "PROPOSE_TOP_UP", "targetCrBps": 17500, "severity": "warning" },
    { "id": "r2", "when": { "redemptionActive": true }, "then": "ALERT", "severity": "critical" }
  ]
}`;
export default function Recipes() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Developers · Recipes" title="Documents you can send today" lede="A public recipe marketplace is not built. These are the formats the compiler and Guardian accept now." right={<Badge mode="IMPLEMENTED" />} />
      <div className="grid gap-5">
        <Panel title="Token swap intent" kicker="POST /api/compile · validated by the FEP intent schema"><Code lang="json">{INTENT}</Code></Panel>
        <Panel title="Guardian policy" kicker="Proposals only, never executed"><Code lang="json">{POLICY}</Code></Panel>
      </div>
    </div>
  );
}
