// ParyonUSD V1 adapter (mainnet). Source of truth:
//  - contracts: npm @paryonusd/contracts@1.1.0 (github.com/ParyonUSD/contracts @ main)
//  - deployment: github.com/ParyonUSD/verify_contract_deployment/config.ts (mainnet-v1)
//  - state layouts: ParyonUSD/contracts contract_docs/contract_overview.md
// Paryon V2 is NOT deployed (paryonusd.com/blog/introducing-v2, 2026-10-02: "no launch date yet").
import { Contract, MockNetworkProvider, type Artifact } from 'cashscript';
import { paryonArtifacts } from '@paryonusd/contracts';
import { binToHex, hexToBin } from '@bitauth/libauth';

export const PARYON_SOURCES = {
  contractsPackage: '@paryonusd/contracts@1.1.0',
  deploymentConfig: 'https://github.com/ParyonUSD/verify_contract_deployment/blob/main/config.ts',
  stateDocs: 'https://github.com/ParyonUSD/contracts/blob/main/contract_docs/contract_overview.md',
};

export const PARYON_MAINNET_V1 = {
  name: 'mainnet-v1',
  network: 'mainnet' as const,
  tokenIds: {
    paryonTokenId: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
    poolTokenId: '7708645a7f30e97003573d9322202960a560a87527bef3666a30044a0dfdfa81',
    redeemerTokenId: '649b2d862f01a904addf9095ae64860a59071544ee4a3695f14cbbc75571f930',
    loanKeyFactoryTokenId: 'f07165f2c3448ced3bf0b33f9048ceb7567a2c07adb60d8f11b301c42db97405',
    oracleMigrationKeyTokenId: '7776202e8f4eca51d5e634799c66c6a87076cc6efcc64c1322e7e880c71f6d30',
  },
  contractParams: {
    oraclePublicKey: '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818',
    protocolFeeLockingBytecode: 'aa207c7a248c794af2cdf1b1a66a2311347c45b177fcb3aad730a7823c9e32fc754087',
    startBlockHeight: 948406n,
    periodLengthBlocks: 144n,
    timeLockRedemption: 12n,
  },
  genesisTxIds: {
    paryonTokenId: '9c938f53eb97e089c72c47e9e5cf5f68ad23fd5eb4cb579c5266f04bba4b4d62',
    poolTokenId: '6a9eb371b2f9379568dad9ed0d4757859f2aa1db33207b6b885135ed8db31c2f',
    redeemerTokenId: '693c322cf1f0012bd17e765ffb5fa46602c1a37af21f6a8a69447e0a511895ea',
    loanKeyFactoryTokenId: '9d432d0f13842ced1f37d03dc3d31faf628c24146292a4c69b09c1a6758a79ff',
    oracleMigrationKeyTokenId: '68180fe720cfd1240e8fc571843522a7fe151ddc6405d6c5d93f3543906051de',
  },
  /** Minimum collateral ratio for borrowing and liquidation threshold (contract_overview.md). */
  minCollateralRatioBps: 11_000n,
  pusdDecimals: 2,
};

const rev = (h: string) => binToHex(hexToBin(h).reverse());

/** Reconstruct the locking bytecode of every Paryon V1 contract from the npm artifacts + deployment params
 *  (port of verify_contract_deployment/contractAddresses.ts). Pure / offline. */
export function paryonContracts(dep = PARYON_MAINNET_V1) {
  const provider = new MockNetworkProvider();
  const mk = (a: unknown, args: unknown[]) => new Contract(a as Artifact, args as never, { provider });
  const { paryonTokenId, poolTokenId, redeemerTokenId, loanKeyFactoryTokenId, oracleMigrationKeyTokenId } = dep.tokenIds;
  const { oraclePublicKey, protocolFeeLockingBytecode, startBlockHeight, periodLengthBlocks, timeLockRedemption } = dep.contractParams;
  const A = paryonArtifacts as unknown as { [k: string]: Artifact & Record<string, Artifact> };
  const loan = mk(A.artifactLoan, []);
  const loanSidecar = mk(A.artifactLoanSidecar, []);
  const enforcer = mk(A.loanKey.artifactLoanKeyOriginEnforcer, [rev(loanKeyFactoryTokenId), rev(paryonTokenId)]);
  const borrowing = mk(A.artifactBorrowing, [loan.lockingBytecode, loanSidecar.lockingBytecode, protocolFeeLockingBytecode, enforcer.lockingBytecode, startBlockHeight, periodLengthBlocks]);
  const price = mk(A.artifactPriceContract, [oraclePublicKey, rev(oracleMigrationKeyTokenId)]);
  const priceGuarded = mk(A.artifactPriceContractGuarded, [oraclePublicKey, rev(oracleMigrationKeyTokenId)]);
  const F = A.loanContractFunctions;
  const loanFunctions = {
    liquidate: mk(F.artifactFunctionLiquidate, [rev(poolTokenId)]),
    manage: mk(F.artifactFunctionManage, []),
    redeem: mk(F.artifactFunctionRedeem, [rev(redeemerTokenId), timeLockRedemption, startBlockHeight, periodLengthBlocks]),
    startRedemption: mk(F.artifactFunctionStartRedemption, [rev(redeemerTokenId)]),
    swapInRedemption: mk(F.artifactFunctionSwapInRedemption, [rev(redeemerTokenId)]),
    swapOutRedemption: mk(F.artifactFunctionSwapOutRedemption, [rev(redeemerTokenId)]),
    payInterest: mk(F.artifactFunctionPayInterest, [rev(poolTokenId)]),
    changeInterest: mk(F.artifactFunctionChangeInterest, []),
  };
  const S = A.stabilityPool;
  const stabilityPool = mk(S.artifactStabilityPool, []);
  const payout = mk(S.artifactPayout, []);
  const collector = mk(S.artifactCollector, [rev(paryonTokenId), protocolFeeLockingBytecode]);
  const R = A.redeemer;
  const redemptionSidecar = mk(R.artifactRedemptionSidecar, []);
  const redemption = mk(R.artifactRedemption, [rev(paryonTokenId)]);
  const redeemer = mk(R.artifactRedeemer, [rev(paryonTokenId), redemption.lockingBytecode, redemptionSidecar.lockingBytecode]);
  const lb = (c: Contract) => c.lockingBytecode;
  return {
    loan: lb(loan), loanSidecar: lb(loanSidecar), borrowing: lb(borrowing), price: lb(price),
    priceGuarded: lb(priceGuarded),
    loanFunctions: Object.fromEntries(Object.entries(loanFunctions).map(([k, c]) => [k, lb(c)])),
    stabilityPool: lb(stabilityPool), payout: lb(payout), collector: lb(collector),
    redeemer: lb(redeemer), redemption: lb(redemption), redemptionSidecar: lb(redemptionSidecar),
  };
}

// ---------------------------------------------------------------------------
// State decoding (layouts from contract_overview.md)
// ---------------------------------------------------------------------------

const le = (hex: string): bigint => {
  let v = 0n;
  for (let i = hex.length - 2; i >= 0; i -= 2) v = (v << 8n) | BigInt(parseInt(hex.slice(i, i + 2), 16));
  return v;
};

export interface ParyonLoanState {
  borrowedTokenAmount: bigint; // PUSD base units (2 decimals)
  amountBeingRedeemed: bigint;
  status: 'new' | 'single-period' | 'mature' | 'unknown';
  lastPeriodInterestPaid: bigint;
  currentInterestRateRaw: bigint;
  nextInterestRateRaw: bigint;
  interestManager: string;
  minRateManagerRaw: bigint;
  maxRateManagerRaw: bigint;
}

/** Loan mutable-NFT commitment: 27 bytes, identifier 0x01. */
export function decodeLoanCommitment(hex: string): ParyonLoanState {
  if (hex.length !== 54) throw new Error(`loan commitment must be 27 bytes, got ${hex.length / 2}`);
  if (hex.slice(0, 2) !== '01') throw new Error('loan commitment identifier must be 0x01');
  let o = 2;
  const take = (n: number) => { const s = hex.slice(o, o + n * 2); o += n * 2; return s; };
  const borrowed = le(take(6));
  const redeeming = le(take(6));
  const statusByte = take(1);
  const lastPeriod = le(take(4));
  const cur = le(take(2));
  const next = le(take(2));
  const mgr = take(1);
  const minR = le(take(2));
  const maxR = le(take(2));
  return {
    borrowedTokenAmount: borrowed,
    amountBeingRedeemed: redeeming,
    status: statusByte === '00' ? 'new' : statusByte === '01' ? 'single-period' : statusByte === '02' ? 'mature' : 'unknown',
    lastPeriodInterestPaid: lastPeriod,
    currentInterestRateRaw: cur,
    nextInterestRateRaw: next,
    interestManager: mgr,
    minRateManagerRaw: minR,
    maxRateManagerRaw: maxR,
  };
}

export interface ParyonPriceState { sequence: bigint; priceRaw: bigint }

/** Price-contract mutable-NFT commitment: identifier 0x00, bytes4 sequence, bytes4 pricedata (may be extended by migration). */
export function decodePriceCommitment(hex: string): ParyonPriceState {
  if (hex.length < 18 || hex.slice(0, 2) !== '00') throw new Error('not a Paryon price-contract commitment');
  return { sequence: le(hex.slice(2, 10)), priceRaw: le(hex.slice(10, 18)) };
}

/**
 * Collateral ratio in basis points, exact integer math.
 * collateralSats (1e-8 BCH) * priceCentsPerBch / 1e8 = collateral value in US cents;
 * debt is PUSD base units = cents (2 decimals). ratioBps = value * 10000 / debt.
 * ASSUMPTION (documented, checked against live data in evidence/paryon-*.json): GP oracle price is US cents per BCH.
 */
export function collateralRatioBps(collateralSats: bigint, priceCentsPerBch: bigint, debtCents: bigint): bigint | null {
  if (debtCents <= 0n) return null;
  return (collateralSats * priceCentsPerBch * 10_000n) / (100_000_000n * debtCents);
}

/** BCH price (cents) at which the loan reaches the liquidation threshold. */
export function liquidationPriceCents(collateralSats: bigint, debtCents: bigint, thresholdBps = PARYON_MAINNET_V1.minCollateralRatioBps): bigint {
  if (collateralSats <= 0n) throw new Error('no collateral');
  return (debtCents * thresholdBps * 100_000_000n + collateralSats * 10_000n - 1n) / (collateralSats * 10_000n);
}

/** Operation support matrix for Paryon V1 from FUSE's point of view (see docs/INTEGRATION-FEASIBILITY.md). */
export const PARYON_OPERATION_STATUS = {
  loanDiscovery: 'READ-ONLY',
  healthMonitoring: 'READ-ONLY',
  redemptionQueueAnalysis: 'READ-ONLY',
  repayOrTopUp_manage: 'BLOCKED',
  changeInterest: 'BLOCKED',
  liquidation: 'BLOCKED',
  v2: 'UNSUPPORTED',
} as const;
