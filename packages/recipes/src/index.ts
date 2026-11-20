// F47 Recipe marketplace (LOCAL). A recipe is a signed, content-addressed description of a one-transaction
// strategy (ordered legs + bounds). Listing a recipe runs: schema → author Schnorr signature over the canonical
// hash → structural rules → a real compile against the market. Recipes are DATA: nothing in the marketplace
// executes a recipe. "Use" only pre-fills the builder / intent form; execution still needs the owner's own
// intent, auction and signature.
import { z } from 'zod';
import { secp256k1, hexToBin, binToHex } from '@bitauth/libauth';
import { commitment } from '@fuse/core';

export const LEGS = { BORROW: 'Borrow FlashVault shard', BUY_CHEAP: 'Buy on cheapest pool', SELL_RICH: 'Sell surplus on richest pool', REPAY: 'Repay shard + fee', PAY_USER: 'Deliver tokens to user', SOLVER_FEE: 'Pay solver fee', INVENTORY: 'Fill from solver inventory' } as const;
export type Leg = keyof typeof LEGS;
export const PRESETS: Record<'FLASH_LIQUIDITY' | 'ROUTING' | 'DIRECT_LIQUIDITY', Leg[]> = { FLASH_LIQUIDITY: ['BORROW', 'BUY_CHEAP', 'SELL_RICH', 'REPAY', 'PAY_USER'], ROUTING: ['BUY_CHEAP', 'PAY_USER', 'SOLVER_FEE'], DIRECT_LIQUIDITY: ['INVENTORY', 'PAY_USER'] };

const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n * 2}}$`));
export const RecipeSchema = z.object({
  schema: z.literal('fuse.recipe/v1'),
  name: z.string().min(3).max(60),
  description: z.string().max(400),
  legs: z.array(z.enum(Object.keys(LEGS) as [Leg, ...Leg[]])).min(1).max(8),
  bounds: z.object({ minOutTokens: z.string().regex(/^[1-9]\d{0,18}$/), maxInSats: z.string().regex(/^[1-9]\d{0,18}$/) }),
  author: z.object({ pubkey: hex(33), label: z.string().min(1).max(40) }),
  createdAt: z.number().int().positive(),
  tags: z.array(z.string().max(20)).max(5).default([]),
});
export type Recipe = z.output<typeof RecipeSchema>;
export interface SignedRecipe { recipe: Recipe; hash: string; signature: string }

export const recipeHash = (r: Recipe) => commitment('recipe/v1', r);
export function signRecipe(r: Recipe, priv: Uint8Array): SignedRecipe {
  const recipe = RecipeSchema.parse(r);
  const hash = recipeHash(recipe);
  const sig = secp256k1.signMessageHashSchnorr(priv, hexToBin(hash));
  if (typeof sig === 'string') throw new Error(sig);
  return { recipe, hash, signature: binToHex(sig) };
}

/** Structural rules (same as the Studio builder): a borrow must be repaid in the same tx, after the borrow, etc. */
export function structure(legs: Leg[]): { errors: string[]; strategy?: keyof typeof PRESETS } {
  const e: string[] = [];
  const i = (b: Leg) => legs.indexOf(b);
  if (new Set(legs).size !== legs.length) e.push('Each leg may appear once.');
  if (!legs.includes('PAY_USER')) e.push('The user must receive tokens (add "Deliver tokens to user").');
  if (legs.includes('BORROW') && !legs.includes('REPAY')) e.push('A borrowed shard must be repaid in the same transaction.');
  if (legs.includes('REPAY') && !legs.includes('BORROW')) e.push('Nothing to repay: add a borrow leg.');
  if (legs.includes('BORROW') && i('REPAY') < i('BORROW')) e.push('Repay must come after borrow.');
  if (legs.includes('SELL_RICH') && !legs.includes('BORROW')) e.push('Selling surplus needs borrowed capital (flash) in this recipe set.');
  if (legs.includes('INVENTORY') && legs.includes('BUY_CHEAP')) e.push('Mix of inventory and pool fills is not a supported recipe yet.');
  const key = [...legs].sort().join(',');
  const strategy = (Object.entries(PRESETS) as Array<[keyof typeof PRESETS, Leg[]]>).find(([, v]) => [...v].sort().join(',') === key)?.[0];
  if (!e.length && !strategy) e.push('Structurally valid, but no compiler strategy implements this combination yet.');
  return { errors: e, strategy };
}

export interface CompileProbe { ok: boolean; strategy?: string; selected?: string; userNetSpendSats?: bigint; reasons: string[] }
export interface Verdict { listed: boolean; checks: Array<{ name: string; ok: boolean; detail: string }>; strategy?: string; probe?: CompileProbe; autoExecute: false }

/** Full listing check. `compileProbe` runs the real compiler for the recipe's strategy and bounds. */
export function verifyRecipe(input: unknown, compileProbe?: (strategy: string, r: Recipe) => CompileProbe): Verdict & { recipe?: Recipe; hash?: string } {
  const checks: Verdict['checks'] = [];
  const s = z.object({ recipe: z.unknown(), hash: z.string(), signature: z.string() }).safeParse(input);
  if (!s.success) return { listed: false, checks: [{ name: 'envelope', ok: false, detail: 'expected { recipe, hash, signature }' }], autoExecute: false };
  const p = RecipeSchema.safeParse(s.data.recipe);
  if (!p.success) return { listed: false, checks: [{ name: 'schema', ok: false, detail: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }], autoExecute: false };
  const r = p.data; const h = recipeHash(r);
  checks.push({ name: 'schema', ok: true, detail: 'fuse.recipe/v1' });
  checks.push({ name: 'content hash', ok: h === s.data.hash, detail: h === s.data.hash ? h.slice(0, 16) + '…' : 'hash does not match recipe content' });
  const sigOk = /^[0-9a-f]{128}$/.test(s.data.signature) && secp256k1.verifySignatureSchnorr(hexToBin(s.data.signature), hexToBin(r.author.pubkey), hexToBin(h));
  checks.push({ name: 'author signature', ok: sigOk, detail: sigOk ? `Schnorr by ${r.author.pubkey.slice(0, 10)}…` : 'invalid signature for the author key' });
  const st = structure(r.legs);
  checks.push({ name: 'structure', ok: !st.errors.length, detail: st.errors.length ? st.errors.join(' ') : `matches ${st.strategy}` });
  let probe: CompileProbe | undefined;
  if (!st.errors.length && compileProbe && st.strategy) {
    probe = compileProbe(st.strategy, r);
    checks.push({ name: 'compiles (SIMULATION)', ok: probe.ok, detail: probe.ok ? `${probe.strategy} valid in the BCH VM; user net ${probe.userNetSpendSats} sats` : probe.reasons.join('; ') });
  }
  return { listed: checks.every((c) => c.ok), checks, strategy: st.strategy, probe, autoExecute: false, recipe: r, hash: h };
}
