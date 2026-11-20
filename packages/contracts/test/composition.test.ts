import { describe, it, expect } from 'vitest';
import { randomUtxo } from 'cashscript';
import { setupBchVault, builder, randomHex32, testKey, addSpendable, spendableUtxos } from './helpers.js';
import { cauldronPoolContract, cauldronBuyQuote, cauldronSellQuote, encodeVaultState } from '../src/index.js';

// Demo 1: transaction-scoped liquidity composed with the *unmodified production Cauldron pool script*.
// A FlashVault shard funds an atomic arbitrage between two Cauldron pools (mock UTXOs, real bytecode).
function setupArb() {
  const f = setupBchVault({ feeBps: 9n, minFee: 1_000n, maxExposure: 100_000_000n }, 60_000_000n);
  const token = randomHex32();
  const ownerA = testKey().pkh, ownerB = testKey().pkh;
  const poolA = cauldronPoolContract(ownerA, f.provider);
  const poolB = cauldronPoolContract(ownerB, f.provider);
  const a = addSpendable(f.provider, poolA.tokenAddress, randomUtxo({ satoshis: 1_000_000_000n, token: { category: token, amount: 1_000_000n } }));
  const b = addSpendable(f.provider, poolB.tokenAddress, randomUtxo({ satoshis: 1_200_000_000n, token: { category: token, amount: 1_000_000n } }));
  return { ...f, token, poolA, poolB, a, b };
}

describe('Atomic flash arbitrage across two real Cauldron pool scripts', () => {
  it('borrows from vault, buys on A, sells on B, repays principal+fee, keeps profit — single tx', async () => {
    const s = setupArb();
    const X = 40_000n;
    const buy = cauldronBuyQuote(s.a.satoshis, s.a.token!.amount, X);
    const sell = cauldronSellQuote(s.b.satoshis, s.b.token!.amount, X);
    const profit = sell.satsOut - buy.satsIn - s.fee;
    expect(profit).toBeGreaterThan(0n);
    expect(buy.satsIn).toBeLessThanOrEqual(s.shard.satoshis);
    const minerFee = 3_000n;
    const tx = builder(s.provider)
      .addInput(s.shard, s.vault.unlock.flash())
      .addInput(s.a, s.poolA.unlock.swap())
      .addInput(s.b, s.poolB.unlock.swap())
      .addInput(s.funding, s.borrower.sig.unlockP2PKH())
      .addOutput({ to: s.vault.tokenAddress, amount: s.shard.satoshis + s.fee, token: { category: s.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: s.fee, paused: false }) } } })
      .addOutput({ to: s.poolA.tokenAddress, amount: buy.newSats, token: { category: s.token, amount: buy.newTokens } })
      .addOutput({ to: s.poolB.tokenAddress, amount: sell.newSats, token: { category: s.token, amount: sell.newTokens } })
      .addOutput({ to: s.borrower.address, amount: s.funding.satoshis + profit - minerFee });
    const res = await tx.send();
    expect(res.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('malicious variant: same route but vault repaid 1 sat short → BCH VM rejects', async () => {
    const s = setupArb();
    const X = 40_000n;
    const buy = cauldronBuyQuote(s.a.satoshis, s.a.token!.amount, X);
    const sell = cauldronSellQuote(s.b.satoshis, s.b.token!.amount, X);
    const profit = sell.satsOut - buy.satsIn - s.fee;
    const tx = builder(s.provider)
      .addInput(s.shard, s.vault.unlock.flash())
      .addInput(s.a, s.poolA.unlock.swap())
      .addInput(s.b, s.poolB.unlock.swap())
      .addInput(s.funding, s.borrower.sig.unlockP2PKH())
      .addOutput({ to: s.vault.tokenAddress, amount: s.shard.satoshis + s.fee - 1n, token: { category: s.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: s.fee - 1n, paused: false }) } } })
      .addOutput({ to: s.poolA.tokenAddress, amount: buy.newSats, token: { category: s.token, amount: buy.newTokens } })
      .addOutput({ to: s.poolB.tokenAddress, amount: sell.newSats, token: { category: s.token, amount: sell.newTokens } })
      .addOutput({ to: s.borrower.address, amount: s.funding.satoshis + profit + 1n - 3_000n });
    await expect(tx.send()).rejects.toThrow(/FlashVaultBCH\.cash:\d+ Require statement failed/);
  });

  it('pool constant-product violation is rejected by the real Cauldron script (proves it executes)', async () => {
    const s = setupArb();
    const X = 40_000n;
    const buy = cauldronBuyQuote(s.a.satoshis, s.a.token!.amount, X);
    const sell = cauldronSellQuote(s.b.satoshis, s.b.token!.amount, X);
    const tx = builder(s.provider)
      .addInput(s.shard, s.vault.unlock.flash())
      .addInput(s.a, s.poolA.unlock.swap())
      .addInput(s.b, s.poolB.unlock.swap())
      .addInput(s.funding, s.borrower.sig.unlockP2PKH())
      .addOutput({ to: s.vault.tokenAddress, amount: s.shard.satoshis + s.fee, token: { category: s.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: s.fee, paused: false }) } } })
      .addOutput({ to: s.poolA.tokenAddress, amount: buy.newSats - 5_000n, token: { category: s.token, amount: buy.newTokens } })
      .addOutput({ to: s.poolB.tokenAddress, amount: sell.newSats, token: { category: s.token, amount: sell.newTokens } })
      .addOutput({ to: s.borrower.address, amount: s.funding.satoshis + sell.satsOut - buy.satsIn - s.fee + 5_000n - 3_000n });
    await expect(tx.send()).rejects.toThrow();
  });
});
