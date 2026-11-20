import { z } from 'zod';
import { commitment } from '@fuse/core';

export const INTENT_TYPES = [
  'FLASH_LIQUIDITY', 'TOKEN_SWAP', 'ATOMIC_ARBITRAGE', 'LOAN_REPAYMENT', 'COLLATERAL_TOP_UP',
  'INTEREST_RATE_ADJUSTMENT', 'LOAN_REFINANCE', 'POSITION_DELEVERAGE', 'POSITION_EXIT', 'LIQUIDATION',
  'REDEMPTION_ARBITRAGE', 'LIQUIDITY_DEPOSIT', 'LIQUIDITY_WITHDRAWAL', 'HEDGE_ADJUSTMENT',
  'CROSS_INTENT_NETTING', 'RESCUE_BOUNTY',
] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export const EXECUTION_CLASSES = ['ATOMIC_SINGLE_TX', 'STAGED_RECOVERABLE', 'MONITOR_ONLY'] as const;
export type ExecutionClass = (typeof EXECUTION_CLASSES)[number];

const hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), `expected ${bytes}-byte lowercase hex`);
/** Asset id: 'BCH' or a 32-byte CashToken category (display order). */
export const AssetId = z.union([z.literal('BCH'), hex(32)]);
/** Base-unit amount as a decimal string (never a float). */
export const Amount = z.string().regex(/^(0|[1-9]\d{0,30})$/, 'amount must be a base-unit integer string').transform((s) => BigInt(s));

export const AssetAmount = z.object({ asset: AssetId, amount: Amount });

export const IntentSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  network: z.enum(['local', 'chipnet', 'mainnet']),
  type: z.enum(INTENT_TYPES),
  owner: z.object({
    /** Locking bytecode (hex) that must receive proceeds / that funds the intent. */
    lockingBytecode: z.string().regex(/^([0-9a-f]{2}){20,64}$/),
    /** How ownership was established. A bare address is monitoring-only, never execution authority. */
    authorization: z.enum(['WALLET_SIGNATURE', 'WIZARDCONNECT_SESSION', 'POLICY_VAULT', 'READ_ONLY_ADDRESS']),
    authorizationRef: z.string().max(256).optional(),
  }),
  inputs: z.array(AssetAmount).max(8),
  allowedAssets: z.array(AssetId).max(16),
  operation: z.object({
    kind: z.enum(INTENT_TYPES),
    params: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
  }),
  desiredPosition: z.object({ description: z.string().max(280), assets: z.array(AssetAmount).max(8).default([]) }).optional(),
  minOutput: AssetAmount.optional(),
  maxInput: AssetAmount.optional(),
  maxFee: AssetAmount,
  maxSlippageBps: z.number().int().min(0).max(5_000),
  deadline: z.number().int().positive(),
  protocols: z.array(z.enum(['fuse-flashvault', 'cauldron', 'paryon-v1', 'moria-v1-historical', 'fuse-native'])).min(1),
  maxResidualDebt: Amount.optional(),
  minCollateralRatioBps: z.number().int().min(10_000).max(100_000).optional(),
  partialFill: z.boolean().default(false),
  solverEligibility: z.object({ allowlist: z.array(z.string()).max(64).optional(), minBond: Amount.optional() }).default({}),
  authorizationMode: z.enum(['PER_TX_SIGNATURE', 'LIMITED_POLICY', 'MONITOR_ONLY']),
  nonce: z.string().regex(/^[0-9a-f]{16,64}$/),
  replayDomain: z.string().min(3).max(64),
  policyHash: hex(32).optional(),
  atomicity: z.enum(EXECUTION_CLASSES),
  requiredEvidence: z.array(z.enum(['TX_CONFIRMED', 'OUTPUT_TO_OWNER', 'VAULT_CONTINUATION', 'HEALTH_IMPROVED', 'CERTIFICATE'])).min(1),
}).superRefine((v, ctx) => {
  if (v.operation.kind !== v.type) ctx.addIssue({ code: 'custom', message: 'operation.kind must equal type', path: ['operation', 'kind'] });
  if (v.owner.authorization === 'READ_ONLY_ADDRESS' && v.authorizationMode !== 'MONITOR_ONLY') ctx.addIssue({ code: 'custom', message: 'a read-only address cannot authorize execution', path: ['authorizationMode'] });
  if (v.authorizationMode === 'MONITOR_ONLY' && v.atomicity !== 'MONITOR_ONLY') ctx.addIssue({ code: 'custom', message: 'monitor-only intents must use MONITOR_ONLY atomicity', path: ['atomicity'] });
  if (v.maxInput && !v.allowedAssets.includes(v.maxInput.asset)) ctx.addIssue({ code: 'custom', message: 'maxInput asset not allowed', path: ['maxInput'] });
  if (v.minOutput && !v.allowedAssets.includes(v.minOutput.asset)) ctx.addIssue({ code: 'custom', message: 'minOutput asset not allowed', path: ['minOutput'] });
});

export type Intent = z.output<typeof IntentSchema>;
export type IntentInput = z.input<typeof IntentSchema>;

export function parseIntent(input: unknown, now = Math.floor(Date.now() / 1000)): Intent {
  const intent = IntentSchema.parse(input);
  if (intent.deadline <= now) throw new IntentValidationError('DEADLINE_PASSED', 'intent deadline has passed');
  return intent;
}

export class IntentValidationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export const intentCommitment = (i: Intent) => commitment('intent/v1', i);
