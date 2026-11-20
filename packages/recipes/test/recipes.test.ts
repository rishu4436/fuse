import { describe, it, expect } from 'vitest';
import { binToHex, secp256k1 } from '@bitauth/libauth';
import { signRecipe, verifyRecipe, structure, recipeHash, PRESETS, type Recipe } from '../src/index.js';

const priv = new Uint8Array(32).fill(7);
const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
const base: Recipe = { schema: 'fuse.recipe/v1', name: 'Flash route', description: 'test', legs: PRESETS.FLASH_LIQUIDITY, bounds: { minOutTokens: '30000', maxInSats: '40000000' }, author: { pubkey: binToHex(pub), label: 'tester' }, createdAt: 1_795_000_000, tags: [] };
const okProbe = () => ({ ok: true, strategy: 'FLASH_LIQUIDITY', userNetSpendSats: 1n, reasons: [] });

describe('@fuse/recipes', () => {
  it('structure rules: unrepaid borrow, repay-before-borrow, duplicate legs, no user payout are rejected; presets map to strategies', () => {
    expect(structure(['BORROW', 'BUY_CHEAP', 'PAY_USER']).errors.join(' ')).toMatch(/repaid/);
    expect(structure(['REPAY', 'BORROW', 'BUY_CHEAP', 'SELL_RICH', 'PAY_USER']).errors.join(' ')).toMatch(/after borrow/);
    expect(structure(['PAY_USER', 'PAY_USER']).errors.join(' ')).toMatch(/once/);
    expect(structure(['BUY_CHEAP', 'SOLVER_FEE']).errors.join(' ')).toMatch(/receive tokens/);
    for (const [k, legs] of Object.entries(PRESETS)) expect(structure(legs)).toEqual({ errors: [], strategy: k });
  });
  it('signed recipe verifies; tampering with content or signature fails; listing never auto-executes', () => {
    const s = signRecipe(base, priv);
    expect(s.hash).toBe(recipeHash(base));
    const v = verifyRecipe(s, okProbe);
    expect(v.listed).toBe(true); expect(v.autoExecute).toBe(false); expect(v.strategy).toBe('FLASH_LIQUIDITY');
    const t = verifyRecipe({ ...s, recipe: { ...s.recipe, bounds: { ...s.recipe.bounds, minOutTokens: '1' } } }, okProbe);
    expect(t.listed).toBe(false); expect(t.checks.find((c) => c.name === 'content hash')!.ok).toBe(false);
    const sig = verifyRecipe({ ...s, signature: '00'.repeat(64) }, okProbe);
    expect(sig.checks.find((c) => c.name === 'author signature')!.ok).toBe(false);
  });
  it('compile probe failure blocks the listing; malformed input is rejected at the schema', () => {
    const s = signRecipe(base, priv);
    expect(verifyRecipe(s, () => ({ ok: false, reasons: ['no valid plan'] })).listed).toBe(false);
    expect(verifyRecipe({ recipe: { ...base, legs: ['STEAL'] }, hash: 'x', signature: 'y' }).checks[0].name).toBe('schema');
    expect(verifyRecipe('nope').checks[0].name).toBe('envelope');
  });
});
