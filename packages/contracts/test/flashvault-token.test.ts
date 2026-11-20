import { describe, it, expect } from 'vitest';
import { randomUtxo, type Output } from 'cashscript';
import { setupTokenVault, builder, testKey, randomHex32 } from './helpers.js';
import { tokenVaultContract } from '../src/index.js';

type F = ReturnType<typeof setupTokenVault>;
const VM_REJECT = /FlashVaultToken\.cash:\d+ Require statement failed/;

function cont(f: F, over: Partial<{ to: string; tokens: bigint; category: string; sats: bigint; nft: { capability: 'none' | 'mutable' | 'minting'; commitment: string } }> = {}): Output {
  return {
    to: over.to ?? f.vault.tokenAddress,
    amount: over.sats ?? f.shard.satoshis,
    token: { category: over.category ?? f.params.assetCategory, amount: over.tokens ?? f.shard.token!.amount + f.fee, ...(over.nft ? { nft: over.nft } : {}) },
  };
}

function flashTx(f: F, c: Output) {
  const tokensReturned = c.token!.category === f.params.assetCategory ? c.token!.amount : 0n;
  const borrowerTokenChange = f.shard.token!.amount + f.borrowerTokens.token!.amount - tokensReturned;
  const b = builder(f.provider)
    .addInput(f.shard, f.vault.unlock.flash())
    .addInput(f.borrowerTokens, f.borrower.sig.unlockP2PKH())
    .addInput(f.funding, f.borrower.sig.unlockP2PKH())
    .addOutput(c);
  if (borrowerTokenChange > 0n) b.addOutput({ to: f.borrower.address, amount: 1_000n, token: { category: f.params.assetCategory, amount: borrowerTokenChange } });
  const satsUsed = c.amount + (borrowerTokenChange > 0n ? 1_000n : 0n);
  b.addOutput({ to: f.borrower.address, amount: f.shard.satoshis + f.borrowerTokens.satoshis + f.funding.satoshis - satsUsed - 3_000n });
  return b;
}

describe('FlashVaultToken — BCH VM (real cashc 0.14 bytecode)', () => {
  it('accepts valid flash: tokens + fee returned, sats preserved', async () => {
    const f = setupTokenVault();
    await expect(flashTx(f, cont(f)).send()).resolves.toBeTruthy();
    const [u] = await f.provider.getUtxos(f.vault.tokenAddress);
    expect(u.token!.amount).toBe(1_000_000n + f.fee);
  });

  it('rejects token principal underpayment', async () => {
    const f = setupTokenVault();
    await expect(flashTx(f, cont(f, { tokens: f.shard.token!.amount - 1n })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects token fee underpayment', async () => {
    const f = setupTokenVault();
    await expect(flashTx(f, cont(f, { tokens: f.shard.token!.amount + f.fee - 1n })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects token-category substitution (repay with a worthless token)', async () => {
    const f = setupTokenVault();
    const junkCat = randomHex32();
    // attacker mints a junk token in the same tx (genesis needs vout 0 input) — represent by a pre-existing junk UTXO
    const junk = f.provider.addUtxo(f.borrower.address, randomUtxo({ satoshis: 1_000n, token: { category: junkCat, amount: 10_000_000n } }));
    const b = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.flash())
      .addInput(junk, f.borrower.sig.unlockP2PKH())
      .addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput({ to: f.vault.tokenAddress, amount: f.shard.satoshis, token: { category: junkCat, amount: 10_000_000n } })
      .addOutput({ to: f.borrower.address, amount: 1_000n, token: { category: f.params.assetCategory, amount: f.shard.token!.amount } })
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - 3_000n });
    await expect(b.send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects fake continuation to attacker', async () => {
    const f = setupTokenVault();
    await expect(flashTx(f, cont(f, { to: testKey().address })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects continuation into a look-alike token vault with zero fee', async () => {
    const f = setupTokenVault();
    const evil = tokenVaultContract({ ...f.params, feeBps: 0n, minFee: 0n }, f.provider);
    await expect(flashTx(f, cont(f, { to: evil.tokenAddress })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects extracting the BCH carried by the shard', async () => {
    const f = setupTokenVault();
    await expect(flashTx(f, cont(f, { sats: f.shard.satoshis - 1n })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects exceeding the per-operation exposure cap', async () => {
    const f = setupTokenVault({ maxExposure: 999_999n });
    await expect(flashTx(f, cont(f)).send()).rejects.toThrow(VM_REJECT);
  });

  it('owner withdraw works; non-owner withdraw fails', async () => {
    const f = setupTokenVault();
    const ok = builder(f.provider).addInput(f.shard, f.vault.unlock.withdraw(f.owner.pub, f.owner.sig)).addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput({ to: f.owner.address, amount: f.shard.satoshis, token: f.shard.token })
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - 2_000n });
    await expect(ok.send()).resolves.toBeTruthy();
    const g = setupTokenVault();
    const atk = testKey();
    const bad = builder(g.provider).addInput(g.shard, g.vault.unlock.withdraw(atk.pub, atk.sig)).addInput(g.funding, g.borrower.sig.unlockP2PKH())
      .addOutput({ to: atk.address, amount: g.shard.satoshis, token: g.shard.token })
      .addOutput({ to: g.borrower.address, amount: g.funding.satoshis - 2_000n });
    await expect(bad.send()).rejects.toThrow(VM_REJECT);
  });
});
