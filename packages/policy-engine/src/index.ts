// FUSE Portable Execution Policy (FEP-1). A versioned, canonical, signable policy any wallet or dApp can
// verify without trusting a FUSE server. Evaluation is deterministic and returns every failing rule.
import { z } from 'zod';
import { secp256k1, sha256, hexToBin, binToHex, utf8ToBin } from '@bitauth/libauth';
import { canonicalize, commitment } from '@fuse/core';

const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n * 2}}$`));
const Amount = z.string().regex(/^(0|[1-9]\d{0,30})$/).transform((s) => BigInt(s));
const AssetId = z.union([z.literal('BCH'), hex(32)]);

export const ACTIONS = ['LOAN_REPAYMENT', 'COLLATERAL_TOP_UP', 'INTEREST_RATE_ADJUSTMENT', 'POSITION_DELEVERAGE', 'POSITION_EXIT', 'TOKEN_SWAP', 'FLASH_LIQUIDITY', 'RESCUE_BOUNTY', 'LIQUIDITY_DEPOSIT', 'LIQUIDITY_WITHDRAWAL'] as const;

export const PolicySchema = z.object({
  standard: z.literal('FEP-1'),
  version: z.number().int().min(1),
  policyId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  network: z.enum(['local', 'chipnet', 'mainnet']),
  domain: z.string().min(3).max(64), // replay / application domain separation
  owner: z.object({ pubkey: hex(33) }),
  delegate: z.object({ pubkey: hex(33), label: z.string().max(64) }).optional(),
  assets: z.array(z.object({ asset: AssetId, maxPerAction: Amount, maxPerPeriod: Amount, periodSeconds: z.number().int().min(60) })).min(1),
  allowedActions: z.array(z.enum(ACTIONS)).min(1),
  allowedProtocols: z.array(z.string()).min(1),
  approvedRecipients: z.array(z.string().regex(/^([0-9a-f]{2}){20,64}$/)).default([]),
  approvedSourceVaults: z.array(z.string()).default([]),
  minHealthImprovementBps: z.number().int().min(0).max(100_000).default(0),
  maxFeeSats: Amount,
  minOutputs: z.array(z.object({ asset: AssetId, amount: Amount })).default([]),
  validFrom: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  revocationNonce: z.number().int().nonnegative(),
  mode: z.enum(['DISABLED', 'MONITORING', 'APPROVAL_REQUIRED', 'AUTONOMOUS_LIMITED', 'PAUSED', 'REVOKED']),
}).refine((p) => p.expiresAt > p.validFrom, { message: 'expiresAt must be after validFrom' });

export type Policy = z.output<typeof PolicySchema>;
export const policyHash = (p: Policy) => commitment('policy/FEP-1', p);

export interface SignedPolicy { policy: Policy; signature: string; hash: string }

export function signPolicy(policy: Policy, ownerPrivateKey: Uint8Array): SignedPolicy {
  const hash = policyHash(policy);
  const sig = secp256k1.signMessageHashSchnorr(ownerPrivateKey, hexToBin(hash));
  if (typeof sig === 'string') throw new Error(sig);
  return { policy, signature: binToHex(sig), hash };
}

/** Independent verification: schema, canonical hash, owner Schnorr signature, network/domain binding. */
export function verifySignedPolicy(sp: { policy: unknown; signature: string; hash: string }, expect: { network: string; domain: string }): { ok: boolean; reasons: string[]; policy?: Policy } {
  const reasons: string[] = [];
  const parsed = PolicySchema.safeParse(sp.policy);
  if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((i) => `schema: ${i.path.join('.')}: ${i.message}`) };
  const policy = parsed.data;
  const hash = policyHash(policy);
  if (hash !== sp.hash) reasons.push('hash mismatch: policy content differs from signed commitment');
  const valid = /^[0-9a-f]{128}$/.test(sp.signature) && secp256k1.verifySignatureSchnorr(hexToBin(sp.signature), hexToBin(policy.owner.pubkey), hexToBin(hash));
  if (!valid) reasons.push('owner signature invalid');
  if (policy.network !== expect.network) reasons.push(`network mismatch: policy=${policy.network} expected=${expect.network}`);
  if (policy.domain !== expect.domain) reasons.push(`domain mismatch: policy=${policy.domain} expected=${expect.domain}`);
  return { ok: reasons.length === 0, reasons, policy };
}

export interface ProposedAction {
  action: (typeof ACTIONS)[number];
  protocol: string;
  asset: string;
  amount: bigint;
  recipient?: string;
  sourceVault?: string;
  feeSats: bigint;
  outputs: Array<{ asset: string; amount: bigint }>;
  healthBeforeBps?: bigint;
  healthAfterBps?: bigint;
  now: number;
  signer: 'owner' | 'delegate';
}

export interface SpendRecord { asset: string; amount: bigint; at: number }

export interface PolicyDecision { allowed: boolean; requiresApproval: boolean; reasons: string[] }

export function evaluatePolicy(policy: Policy, a: ProposedAction, history: SpendRecord[] = [], revokedNonces: number[] = []): PolicyDecision {
  const r: string[] = [];
  if (policy.mode === 'DISABLED' || policy.mode === 'REVOKED' || policy.mode === 'PAUSED') r.push(`policy mode is ${policy.mode}`);
  if (policy.mode === 'MONITORING') r.push('policy is monitoring-only: execution not authorized');
  if (revokedNonces.includes(policy.revocationNonce)) r.push('policy revoked');
  if (a.now < policy.validFrom) r.push('policy not yet valid');
  if (a.now >= policy.expiresAt) r.push('policy expired');
  if (!policy.allowedActions.includes(a.action)) r.push(`action ${a.action} not allowed`);
  if (!policy.allowedProtocols.includes(a.protocol)) r.push(`protocol ${a.protocol} not allowed`);
  if (a.signer === 'delegate' && !policy.delegate) r.push('no delegate configured');
  const lim = policy.assets.find((x) => x.asset === a.asset);
  if (!lim) r.push(`asset ${a.asset} not allowed`);
  else {
    if (a.amount > lim.maxPerAction) r.push(`amount ${a.amount} exceeds per-action limit ${lim.maxPerAction}`);
    const spent = history.filter((h) => h.asset === a.asset && h.at > a.now - lim.periodSeconds).reduce((s, h) => s + h.amount, 0n);
    if (spent + a.amount > lim.maxPerPeriod) r.push(`period spend ${spent + a.amount} exceeds ${lim.maxPerPeriod}`);
  }
  if (a.amount < 0n || a.feeSats < 0n) r.push('negative amounts');
  if (a.feeSats > policy.maxFeeSats) r.push(`fee ${a.feeSats} exceeds max ${policy.maxFeeSats}`);
  if (a.recipient && policy.approvedRecipients.length && !policy.approvedRecipients.includes(a.recipient)) r.push('recipient not approved');
  if (a.sourceVault && policy.approvedSourceVaults.length && !policy.approvedSourceVaults.includes(a.sourceVault)) r.push('source vault not approved');
  for (const m of policy.minOutputs) {
    const got = a.outputs.filter((o) => o.asset === m.asset).reduce((s, o) => s + o.amount, 0n);
    if (got < m.amount) r.push(`output ${m.asset} ${got} below minimum ${m.amount}`);
  }
  if (policy.minHealthImprovementBps > 0) {
    if (a.healthBeforeBps === undefined || a.healthAfterBps === undefined) r.push('health improvement cannot be evaluated');
    else if (a.healthAfterBps - a.healthBeforeBps < BigInt(policy.minHealthImprovementBps)) r.push(`health improvement ${a.healthAfterBps - a.healthBeforeBps} bps below required ${policy.minHealthImprovementBps}`);
  }
  return { allowed: r.length === 0, requiresApproval: policy.mode !== 'AUTONOMOUS_LIMITED', reasons: r };
}

export const POLICY_TEMPLATES = {
  conservativeRescue: (owner: string, network: 'local' | 'chipnet' | 'mainnet', now: number) => ({
    standard: 'FEP-1', version: 1, policyId: `rescue-${now}`, network, domain: 'fuse.guardian', owner: { pubkey: owner },
    assets: [{ asset: 'BCH', maxPerAction: '5000000', maxPerPeriod: '20000000', periodSeconds: 86_400 }],
    allowedActions: ['COLLATERAL_TOP_UP', 'LOAN_REPAYMENT'], allowedProtocols: ['fuse-native'], approvedRecipients: [], approvedSourceVaults: [],
    minHealthImprovementBps: 500, maxFeeSats: '20000', minOutputs: [], validFrom: now, expiresAt: now + 30 * 86_400, revocationNonce: 0, mode: 'APPROVAL_REQUIRED',
  }),
  swapGuard: (owner: string, network: 'local' | 'chipnet' | 'mainnet', now: number) => ({
    standard: 'FEP-1', version: 1, policyId: `swap-${now}`, network, domain: 'fuse.execute', owner: { pubkey: owner },
    assets: [{ asset: 'BCH', maxPerAction: '100000000', maxPerPeriod: '300000000', periodSeconds: 86_400 }],
    allowedActions: ['TOKEN_SWAP', 'FLASH_LIQUIDITY'], allowedProtocols: ['cauldron', 'fuse-flashvault'], approvedRecipients: [], approvedSourceVaults: [],
    minHealthImprovementBps: 0, maxFeeSats: '50000', minOutputs: [], validFrom: now, expiresAt: now + 7 * 86_400, revocationNonce: 0, mode: 'APPROVAL_REQUIRED',
  }),
} as const;

export { canonicalize };
export const sha256hex = (s: string) => binToHex(sha256.hash(utf8ToBin(s)));
