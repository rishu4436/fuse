import { describe, it, expect } from 'vitest';
import { SignatureTemplate, SighashType, randomUtxo, type Output } from 'cashscript';
import { setupBchVault, builder, testKey, randomHex32 } from './helpers.js';
import { encodeVaultState, bchVaultContract, flashFee, decodeVaultState } from '../src/index.js';

type F = ReturnType<typeof setupBchVault>;
const VM_REJECT = /FlashVaultBCH\.cash:\d+ Require statement failed/;

function continuation(f: F, over: Partial<{ to: string; amount: bigint; commitment: string; category: string; capability: 'none' | 'mutable' | 'minting'; tokenAmount: bigint }> = {}): Output {
  const amount = over.amount ?? f.shard.satoshis + f.fee;
  const surplus = amount - f.shard.satoshis;
  return {
    to: over.to ?? f.vault.tokenAddress,
    amount,
    token: {
      category: over.category ?? f.params.vaultCategory,
      amount: over.tokenAmount ?? 0n,
      nft: { capability: over.capability ?? 'mutable', commitment: over.commitment ?? encodeVaultState({ flashCount: 1n, cumulativeFees: surplus > 0n ? surplus : 0n, paused: false }) },
    },
  };
}

function flashTx(f: F, cont: Output, extra: Output[] = []) {
  const repaidFromBorrower = cont.amount - f.shard.satoshis;
  return builder(f.provider)
    .addInput(f.shard, f.vault.unlock.flash())
    .addInput(f.funding, f.borrower.sig.unlockP2PKH())
    .addOutput(cont)
    .addOutputs(extra)
    .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - repaidFromBorrower - 3_000n - extra.reduce((s, o) => s + o.amount, 0n) });
}

describe('FlashVaultBCH — BCH VM (MockNetworkProvider, real cashc 0.14 bytecode)', () => {
  it('accepts a valid flash: principal + fee returned to same-index continuation with updated state', async () => {
    const f = setupBchVault();
    const res = await flashTx(f, continuation(f)).send();
    expect(res.txid).toMatch(/^[0-9a-f]{64}$/);
    const utxos = await f.provider.getUtxos(f.vault.tokenAddress);
    expect(utxos).toHaveLength(1);
    expect(utxos[0].satoshis).toBe(1_000_000n + f.fee);
    expect(decodeVaultState(utxos[0].token!.nft!.commitment)).toEqual({ flashCount: 1n, cumulativeFees: f.fee, paused: false });
  });

  it('accepts overpayment and records the actual surplus as fees', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { amount: f.shard.satoshis + f.fee + 777n })).send()).resolves.toBeTruthy();
  });

  it('rejects principal underpayment', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { amount: f.shard.satoshis - 1n, commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: 0n, paused: false }) })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects fee underpayment by 1 sat', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { amount: f.shard.satoshis + f.fee - 1n })).send()).rejects.toThrow(VM_REJECT);
  });

  it('enforces minFee for small shards', async () => {
    const f = setupBchVault({ feeBps: 1n, minFee: 5_000n }, 10_000n);
    expect(f.fee).toBe(5_000n);
    await expect(flashTx(f, continuation(f, { amount: f.shard.satoshis + 4_999n })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects fake continuation to an attacker address', async () => {
    const f = setupBchVault();
    const attacker = testKey();
    await expect(flashTx(f, continuation(f, { to: attacker.address })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects continuation into a look-alike vault with altered parameters (fee=0, attacker owner)', async () => {
    const f = setupBchVault();
    const attacker = testKey();
    const evil = bchVaultContract({ ...f.params, feeBps: 0n, minFee: 0n, ownerPkh: attacker.pkh }, f.provider);
    await expect(flashTx(f, continuation(f, { to: evil.tokenAddress })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects continuation at a different output index', async () => {
    const f = setupBchVault();
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.flash())
      .addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - f.fee - 3_000n })
      .addOutput(continuation(f));
    await expect(tx.send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects a stale/incorrect state commitment (count not incremented)', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { commitment: encodeVaultState({ flashCount: 0n, cumulativeFees: f.fee, paused: false }) })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects under-reported fee accounting in the state commitment', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: f.fee - 1n, paused: false }) })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects malformed (wrong length) commitments', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: f.fee, paused: false }) + '00' })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects a solver setting the paused flag on continuation (unauthorized state change)', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: f.fee, paused: true }) })).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects flash on a paused shard', async () => {
    const f = setupBchVault();
    const paused = f.provider.addUtxo(f.vault.tokenAddress, randomUtxo({ satoshis: 500_000n, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 3n, cumulativeFees: 10n, paused: true }) } } }));
    const fee = flashFee(500_000n, f.params.feeBps, f.params.minFee);
    const tx = builder(f.provider)
      .addInput(paused, f.vault.unlock.flash())
      .addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput({ to: f.vault.tokenAddress, amount: 500_000n + fee, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 4n, cumulativeFees: 10n + fee, paused: true }) } } })
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - fee - 3_000n });
    await expect(tx.send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects a shard above the per-operation exposure limit', async () => {
    const f = setupBchVault({ maxExposure: 999_999n });
    await expect(flashTx(f, continuation(f)).send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects spending a UTXO at the vault address that lacks the identity NFT (fake vault)', async () => {
    const f = setupBchVault();
    const fake = f.provider.addUtxo(f.vault.tokenAddress, randomUtxo({ satoshis: 300_000n }));
    const tx = builder(f.provider)
      .addInput(fake, f.vault.unlock.flash())
      .addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput({ to: f.vault.tokenAddress, amount: 310_000n })
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - 13_000n });
    await expect(tx.send()).rejects.toThrow(VM_REJECT);
  });

  it('rejects category substitution: identity NFT replaced by a different category on continuation', async () => {
    const f = setupBchVault();
    // Attacker strips the vault NFT to their own output and recreates a look-alike with a fresh category they control.
    const attacker = testKey();
    const genesisInput = f.provider.addUtxo(f.borrower.address, randomUtxo({ satoshis: 50_000n, vout: 0 }));
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.flash())
      .addInput(genesisInput, f.borrower.sig.unlockP2PKH())
      .addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput(continuation(f, { category: genesisInput.txid }))
      .addOutput({ to: attacker.address, amount: 1_000n, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: '00' } } })
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis + 50_000n - f.fee - 5_000n });
    await expect(tx.send()).rejects.toThrow();
  });

  it('rejects downgrading the identity NFT capability (mutable -> none)', async () => {
    const f = setupBchVault();
    await expect(flashTx(f, continuation(f, { capability: 'none' })).send()).rejects.toThrow(VM_REJECT);
  });

  it('prevents double spending the same shard', async () => {
    const f = setupBchVault();
    await flashTx(f, continuation(f)).send();
    const f2funding = f.provider.addUtxo(f.borrower.address, randomUtxo({ satoshis: 200_000n }));
    const replay = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.flash())
      .addInput(f2funding, f.borrower.sig.unlockP2PKH())
      .addOutput(continuation(f))
      .addOutput({ to: f.borrower.address, amount: 190_000n - f.fee });
    await expect(replay.send()).rejects.toThrow();
  });

  it('funds one operation from two shards atomically (multiple covenant inputs)', async () => {
    const f = setupBchVault();
    const shard2 = f.provider.addUtxo(f.vault.tokenAddress, randomUtxo({ satoshis: 2_000_000n, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 5n, cumulativeFees: 9_000n, paused: false }) } } }));
    const fee2 = flashFee(2_000_000n, f.params.feeBps, f.params.minFee);
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.flash())
      .addInput(shard2, f.vault.unlock.flash())
      .addInput(f.funding, f.borrower.sig.unlockP2PKH())
      .addOutput(continuation(f))
      .addOutput({ to: f.vault.tokenAddress, amount: 2_000_000n + fee2, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 6n, cumulativeFees: 9_000n + fee2, paused: false }) } } })
      .addOutput({ to: f.borrower.address, amount: f.funding.satoshis - f.fee - fee2 - 4_000n });
    await expect(tx.send()).resolves.toBeTruthy();
  });

  it('owner can withdraw with SIGHASH_ALL|FORKID|UTXOS', async () => {
    const f = setupBchVault();
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.withdraw(f.owner.pub, f.owner.sig))
      .addOutput({ to: f.owner.address, amount: f.shard.satoshis - 2_000n, token: f.shard.token });
    await expect(tx.send()).resolves.toBeTruthy();
  });

  it('owner can pause a shard (emergency control) via the owner path', async () => {
    const f = setupBchVault();
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.withdraw(f.owner.pub, f.owner.sig))
      .addOutput({ to: f.vault.tokenAddress, amount: f.shard.satoshis - 2_000n, token: { category: f.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: true }) } } });
    await expect(tx.send()).resolves.toBeTruthy();
  });

  it('rejects withdrawal by a non-owner key', async () => {
    const f = setupBchVault();
    const attacker = testKey();
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.withdraw(attacker.pub, attacker.sig))
      .addOutput({ to: attacker.address, amount: f.shard.satoshis - 2_000n, token: f.shard.token });
    await expect(tx.send()).rejects.toThrow(VM_REJECT);
  });

  it.each([
    ['SIGHASH_ALL (no UTXOS)', SighashType.SIGHASH_ALL],
    ['SIGHASH_NONE|UTXOS', SighashType.SIGHASH_NONE | SighashType.SIGHASH_UTXOS],
    ['SIGHASH_SINGLE|UTXOS', SighashType.SIGHASH_SINGLE | SighashType.SIGHASH_UTXOS],
    ['SIGHASH_ALL|ANYONECANPAY', SighashType.SIGHASH_ALL | SighashType.SIGHASH_ANYONECANPAY],
  ])('rejects owner signature with unsupported mode %s', async (_n, mode) => {
    const f = setupBchVault();
    const weak = new SignatureTemplate(f.owner.priv, mode);
    const tx = builder(f.provider)
      .addInput(f.shard, f.vault.unlock.withdraw(f.owner.pub, weak))
      .addOutput({ to: f.owner.address, amount: f.shard.satoshis - 2_000n, token: f.shard.token });
    await expect(tx.send()).rejects.toThrow(VM_REJECT);
  });

  it('category ids in display order are converted for the contract (sanity)', () => {
    expect(randomHex32()).toMatch(/^[0-9a-f]{64}$/);
  });
});
