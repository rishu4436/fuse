import type { VaultState } from '@fuse/contracts';
import type { Certificate, CertificateVerification, ChainReader } from '@fuse/proof-verifier';
import type { TokenSpec, TxTemplate } from '@fuse/transaction-composer';

export type LiveAction = 'flash' | 'flash-cauldron' | 'deposit' | 'withdraw' | 'deploy-vault' | 'consolidate';

export interface LivePrepareInput {
  action: LiveAction;
  address: string;
  vaultId?: string;
  amount?: bigint;
  principal?: bigint;
  units?: bigint;
  maxUserCost?: bigint;
}

export interface LiveVault {
  id: string;
  label: string;
  checkedAt: string;
  configuredStatus: string;
  category: string;
  owner: string;
  address: string;
  lockingBytecode: string;
  params: { feeBps: bigint; minFee: bigint; maxExposure: bigint; ownerPkh: string };
  open: boolean;
  current: { txid: string; vout: number; satoshis: bigint; commitment: string; state: VaultState } | null;
  history: Array<{
    txid: string;
    vout: number;
    satoshis: bigint;
    commitment: string | null;
    kind: 'genesis' | 'flash' | 'flash+cauldron' | 'deposit' | 'withdraw' | 'closed' | 'other';
    flashCount?: bigint;
    cumulativeFees?: bigint;
  }>;
}

export type LiveVaultEntry = LiveVault | { id: string; error: string };
export interface LiveChainTip { height: number; hash: string; checkedAt: string }
export interface ExecutionAuthorization { payload: string; authHash: string; serverPubkey: string; serverSig: string }
export interface IntentSignature { pubkey: string; sig: string }

export type LiveVaultIdentity = Pick<LiveVault, 'id' | 'category' | 'params'>;
export interface LiveExecutionPolicy {
  attestationPubkey: string;
  maxMinerFee: bigint;
  maxUserCost: bigint;
  vault?: LiveVaultIdentity;
  reader: ChainReader;
}

export interface LiveRoute {
  units: string;
  buyPool: string;
  sellPool: string;
  buyOutpoint: string;
  sellOutpoint: string;
  satsIn: bigint;
  satsOut: bigint;
  roundTripLoss: bigint;
  financedByFlash: true;
  note: string;
}

export interface LiveConstraints {
  userLockingBytecode: string;
  maxMinerFee: bigint;
  expectedUserCost: bigint;
  capital: bigint;
  maxUserCost: bigint;
  allowedRecipients: string[];
  vault: (LiveVault['params'] & { id: string; category: string; lockingBytecode: string; requiredReturn: bigint | null }) | null;
  route: (Pick<LiveRoute, 'units' | 'buyOutpoint' | 'sellOutpoint' | 'satsIn'> & { minSatsOut: bigint; slippageBps: number }) | null;
}

/** Decimal strings in the wallet request must stay strings when the package is forwarded. */
export interface LiveSigningPackage {
  transactionHex: string;
  sourceOutputs: Array<{
    outpointIndex: number;
    outpointTransactionHash: string;
    sequenceNumber: number;
    unlockingBytecode: string;
    lockingBytecode: string;
    valueSatoshis: string;
    token?: Omit<TokenSpec, 'amount'> & { amount: string };
  }>;
  userPrompt: string;
  broadcast: false;
  userInputs: number[];
  inputPaths: Array<[number, string, number]>;
}

export interface LivePreflight {
  chainTip: LiveChainTip;
  network: 'mainnet';
  action: LiveAction;
  address: string;
  templateHash: string;
  template: TxTemplate;
  minerFee: bigint;
  estimatedSizeBytes: number;
  expectedUserCost: bigint;
  vault: Pick<LiveVault, 'id' | 'address' | 'current'> | { id: 'new'; category: string; ownerPkh: string; lockingBytecode: string } | null;
  route: LiveRoute | null;
  simulation: Array<{ inputIndex: number; kind: string; evaluated: boolean; ok: boolean; detail: string }>;
  risk: {
    ok: boolean;
    level: 'PASS' | 'WARN' | 'BLOCK';
    checks: Array<{ name: string; ok: boolean; level: 'block' | 'warn'; detail: string }>;
    netUserCost: bigint;
    capitalToOwnVault: bigint;
  };
  notes: string[];
  constraints: LiveConstraints;
  sign: LiveSigningPackage;
  authorization: ExecutionAuthorization | null;
  authorizationNote?: string;
}

export interface LiveSignedVerification {
  txid: string;
  vmValid: boolean;
  vmDetail: string;
  minerFee: bigint;
  sizeBytes: number;
  inputs: number;
  outputs: number;
}

export interface LiveTransactionStatus {
  txid: string;
  explorer: string;
  confirmed: boolean;
  confirmations: number;
  tip: number;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface LiveRfqInput { address: string; units?: bigint; vaultId?: string }

export interface LiveRfq {
  v: 1;
  kind: 'fuse.rfq/v1';
  auctionId: string;
  network: 'mainnet';
  action: 'flash-cauldron';
  address: string;
  vaultId: string | null;
  units: string;
  issuedAt: number;
  expiresAt: number;
}

export interface LiveSolver { solverId: string; pubkey: string; strategy: string; operator: string }
export interface LiveRfqEnvelope { rfq: LiveRfq; rfqHash: string; rfqSig: string; attestationPubkey: string; solvers: LiveSolver[] }
export interface LiveQuoteRoute { units: string; buyOutpoint: string; sellOutpoint: string; satsIn: string; satsOut: string; loss: string }
export interface LiveQuote {
  v: 1;
  kind: 'fuse.solver-quote/v1';
  auctionId: string;
  rfqHash: string;
  solverPubkey: string;
  strategy: string;
  route: LiveQuoteRoute;
  quotedAt: number;
  expiresAt: number;
}
export interface LiveSignedQuote { quote: LiveQuote; sig: string }
export interface LiveAuctionInput { rfq: LiveRfq; rfqSig: string; quotes: LiveSignedQuote[] }
export interface LiveQuoteVerdict {
  solverId: string;
  strategy: string;
  quoteHash: string;
  valid: boolean;
  reasons: string[];
  recomputed?: { satsIn: string; satsOut: string; loss: string; expectedUserCost: string; minerFee: string; guardian: string };
  score?: string;
  rank?: number;
}
export interface LiveAuctionTranscript extends LiveAuctionInput {
  v: 1;
  kind: 'fuse.auction-transcript/v1';
  rfqHash: string;
  verdicts: LiveQuoteVerdict[];
  scoring: string;
  winner: string;
  settledAt: number;
}
export interface LiveAuctionEvidence { transcript: LiveAuctionTranscript; transcriptHash: string; winner: LiveQuoteVerdict }
export type LiveAuctionResult = LivePreflight & { auction: LiveAuctionEvidence };

export interface LiveIntentEvidence {
  authorization?: ExecutionAuthorization | null;
  userSignature?: IntentSignature | null;
}

export interface LiveReceiptInput extends LiveIntentEvidence { txid: string; auction?: LiveAuctionEvidence }
export interface LiveReceipt {
  kind: 'FLASH_VIA_CAULDRON' | 'FLASH_USE' | 'VAULT_CLOSE' | 'LP_DEPOSIT' | 'LP_WITHDRAW';
  auction: unknown;
  authorization: ExecutionAuthorization | null;
  userSignature: IntentSignature | null;
  vault: string;
  explorer: string;
  vaultStateBefore: VaultState;
  vaultStateAfter: VaultState | null;
  routing: Array<{
    inputIndex: number;
    outpoint: string;
    satsDelta: string;
    tokenDelta: string;
    sameScriptContinuation: boolean;
    invariantHolds: boolean;
  }>;
  certificate: Certificate;
  verification: CertificateVerification;
}
