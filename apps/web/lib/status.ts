// Single source for the Studio's integration status page. Keep in sync with docs/INTEGRATION-FEASIBILITY.md.
export type Status = 'VERIFIED' | 'IMPLEMENTED' | 'TESTED' | 'READ-ONLY' | 'BLOCKED' | 'UNSUPPORTED';
export interface Row { area: string; item: string; status: Status; evidence: string }
export const STATUS: Row[] = [
  { area: 'Contracts', item: 'FlashVaultBCH covenant (cashc 0.14)', status: 'TESTED', evidence: '27 BCH-VM tests + property tests (packages/contracts/test)' },
  { area: 'Contracts', item: 'FlashVaultToken covenant (cashc 0.14)', status: 'TESTED', evidence: '9 BCH-VM tests + property test' },
  { area: 'Contracts', item: 'FlashVault deployment to chipnet / mainnet', status: 'BLOCKED', evidence: 'Needs funded keys and owner authorization; no deployment made' },
  { area: 'Cauldron', item: 'V0 pool script vs. live mainnet pools', status: 'VERIFIED', evidence: '10/10 checked PUSD pools match (evidence/cauldron-pool-verification.json)' },
  { area: 'Cauldron', item: 'Atomic flash arbitrage through real pool bytecode', status: 'TESTED', evidence: 'composition.test.ts (local VM)' },
  { area: 'Cauldron', item: 'Mainnet swap broadcast', status: 'BLOCKED', evidence: 'No owner authorization for value-moving mainnet transactions' },
  { area: 'ParyonUSD', item: 'V1 deployment matches @paryonusd/contracts 1.1.0', status: 'VERIFIED', evidence: 'All scripts reconstructed and matched (evidence/paryon-deployment-verification.json)' },
  { area: 'ParyonUSD', item: 'Loan discovery, health & oracle price', status: 'READ-ONLY', evidence: '360 loan UTXOs decoded; PriceContractGuarded price read' },
  { area: 'ParyonUSD', item: 'Manage / change interest / liquidation', status: 'BLOCKED', evidence: 'Transaction builders (@paryonusd/library) not published; needs owner-approved live tests' },
  { area: 'ParyonUSD', item: 'Paryon V2', status: 'UNSUPPORTED', evidence: 'Not deployed' },
  { area: 'Moria', item: 'Moria V1 as live venue', status: 'UNSUPPORTED', evidence: 'Disabled April 2026; never used as an active opportunity' },
  { area: 'Wallet', item: 'WizardConnect pairing (hdwalletv1)', status: 'IMPLEMENTED', evidence: 'QR and relay tested in browser. Real-wallet pairing untested. No signing requested' },
  { area: 'Execution', item: 'Transaction composer + independent verifier', status: 'TESTED', evidence: 'composer.test.ts: conservation, sighash, tamper checks' },
  { area: 'Execution', item: 'FEP-1 policy engine', status: 'TESTED', evidence: 'policy.test.ts' },
  { area: 'Execution', item: 'Auction engine, fallback, anti-replay', status: 'TESTED', evidence: 'auction.test.ts (5) + network e2e across 5 processes' },
  { area: 'Execution', item: 'Execution certificates + verifier', status: 'TESTED', evidence: 'Fabricated / tampered certificates rejected' },
  { area: 'Infra', item: 'Chaingraph indexer client', status: 'READ-ONLY', evidence: 'Raw transactions re-hashed locally' },
  { area: 'Infra', item: 'Electrum (Fulcrum) connectivity', status: 'BLOCKED', evidence: 'Ports 50002/50004 blocked from build environment' },
  { area: 'Infra', item: 'Chipnet transactions', status: 'BLOCKED', evidence: 'No chipnet network path from build environment; none performed' },
];
