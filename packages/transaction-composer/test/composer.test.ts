import { describe, it, expect } from 'vitest';
import { cauldronBuyQuote, cauldronSellQuote, flashFee, encodeVaultState } from '@fuse/contracts';
import { createLocalMarket, asTemplateInput } from '../../../tests/fixtures/local-market.js';
import { signInputs, contractUnlocks, finalize, verifyTemplateAndRaw, templateHash, findConflicts, selectCoins, inspectRaw, type TxTemplate } from '../src/index.js';
import { SignatureTemplate, SighashType } from 'cashscript';

function arbTemplate(m: ReturnType<typeof createLocalMarket>, opts: { underpay?: bigint; stealTo?: string } = {}): TxTemplate {
  const shard = m.shards[1];
  const fee = flashFee(shard.satoshis, m.vaultParams.feeBps, m.vaultParams.minFee);
  const X = 40_000n;
  const a = m.pools.A.utxo, b = m.pools.B.utxo;
  const buy = cauldronBuyQuote(a.satoshis, a.token!.amount, X);
  const sell = cauldronSellQuote(b.satoshis, b.token!.amount, X);
  const profit = sell.satsOut - buy.satsIn - fee;
  const solver = m.solvers.flash;
  const coin = m.solverCoins.flash;
  const underpay = opts.underpay ?? 0n;
  return {
    version: 2, locktime: 0,
    inputs: [
      asTemplateInput(shard, m.vault.lockingBytecode, 'vault', { kind: 'flashvault-bch', params: m.vaultParams, fn: 'flash' }),
      asTemplateInput(a, m.pools.A.contract.lockingBytecode, 'pool', { kind: 'cauldron-pool', ownerPkh: m.pools.A.ownerPkh }),
      asTemplateInput(b, m.pools.B.contract.lockingBytecode, 'pool', { kind: 'cauldron-pool', ownerPkh: m.pools.B.ownerPkh }),
      asTemplateInput(coin, solver.lockingBytecode, 'solver', { kind: 'p2pkh', signer: 'solver' }),
    ],
    outputs: [
      { lockingBytecode: m.vault.lockingBytecode, satoshis: shard.satoshis + fee - underpay, token: { category: m.vaultParams.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 1n, cumulativeFees: fee - underpay, paused: false }) } }, role: 'vault-continuation' },
      { lockingBytecode: m.pools.A.contract.lockingBytecode, satoshis: buy.newSats, token: { category: m.token, amount: buy.newTokens }, role: 'pool' },
      { lockingBytecode: m.pools.B.contract.lockingBytecode, satoshis: sell.newSats, token: { category: m.token, amount: sell.newTokens }, role: 'pool' },
      { lockingBytecode: opts.stealTo ?? solver.lockingBytecode, satoshis: coin.satoshis + profit + underpay - 4_000n, role: 'solver' },
    ],
  };
}

describe('transaction composer + independent verifier', () => {
  it('composes, signs (0x61), finalizes, verifies in BCH-2026 VM and broadcasts to the local mock network', async () => {
    const m = createLocalMarket();
    const t = arbTemplate(m);
    const raw = finalize(t, contractUnlocks(t), signInputs(t, 'solver', m.solvers.flash.priv));
    const report = verifyTemplateAndRaw(t, raw, { vaultInputs: [{ inputIndex: 0, minReturn: m.shards[1].satoshis + 18_000n, asset: 'BCH' }], requireStrongSighash: true, maxMinerFee: 10_000n });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    const txid = await m.provider.sendRawTransaction(raw);
    expect(txid).toBe(report.txid);
    expect(inspectRaw(raw).outputs).toHaveLength(4);
  });

  it('template hashing is deterministic and sensitive to every field', () => {
    const m = createLocalMarket();
    const t1 = arbTemplate(m), t2 = arbTemplate(m);
    expect(templateHash(t1)).toBe(templateHash(t2));
    t2.outputs[3].satoshis -= 1n;
    expect(templateHash(t1)).not.toBe(templateHash(t2));
  });

  it('verifier rejects an underpaying solver transaction before broadcast (VM + continuation check)', () => {
    const m = createLocalMarket();
    const t = arbTemplate(m, { underpay: 1n });
    const raw = finalize(t, contractUnlocks(t), signInputs(t, 'solver', m.solvers.flash.priv));
    const r = verifyTemplateAndRaw(t, raw, { vaultInputs: [{ inputIndex: 0, minReturn: m.shards[1].satoshis + 18_000n, asset: 'BCH' }] });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'bch-vm-2026')!.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'vault-continuation:0')!.ok).toBe(false);
  });

  it('verifier rejects a transaction modified after review (output redirected)', () => {
    const m = createLocalMarket();
    const reviewed = arbTemplate(m);
    const evil = arbTemplate(m, { stealTo: m.solvers.rogue.lockingBytecode });
    const raw = finalize(evil, contractUnlocks(evil), signInputs(evil, 'solver', m.solvers.flash.priv));
    const r = verifyTemplateAndRaw(reviewed, raw);
    expect(r.checks.find((c) => c.name === 'matches-reviewed-template')!.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('verifier flags weak sighash signatures', () => {
    const m = createLocalMarket();
    const t = arbTemplate(m);
    const weak = new SignatureTemplate(m.solvers.flash.priv, SighashType.SIGHASH_ALL);
    // sign input 3 with weak mode using cashscript directly
    const unlocks = contractUnlocks(t);
    const { toUnsignedTransaction, sourceOutputsOf } = require_();
    const u = weak.unlockP2PKH().generateUnlockingBytecode({ transaction: toUnsignedTransaction(t) as never, sourceOutputs: sourceOutputsOf(t), inputIndex: 3 });
    const raw = finalize(t, unlocks, new Map([[3, Buffer.from(u).toString('hex')]]));
    const r = verifyTemplateAndRaw(t, raw, { requireStrongSighash: true });
    expect(r.checks.find((c) => c.name === 'sighash:3')!.ok).toBe(false);
  });

  it('refuses to sign inputs that are not locked to the signer key', () => {
    const m = createLocalMarket();
    const t = arbTemplate(m);
    expect(() => signInputs(t, 'solver', m.solvers.rogue.priv)).toThrow(/not locked to signer/);
  });

  it('detects UTXO conflicts between competing plans and selects coins without touching tokens', () => {
    const m = createLocalMarket();
    expect(findConflicts([{ id: 'a', template: arbTemplate(m) }, { id: 'b', template: arbTemplate(m) }])[0].outpoints.length).toBe(4);
    const { selected } = selectCoins([{ txid: 'aa'.repeat(32), vout: 0, satoshis: 10n, lockingBytecode: '' }, { txid: 'bb'.repeat(32), vout: 0, satoshis: 10_000n, lockingBytecode: '' }, { txid: 'cc'.repeat(32), vout: 0, satoshis: 99_999n, lockingBytecode: '', token: { category: 'dd'.repeat(32), amount: 1n } }], 5_000n);
    expect(selected).toHaveLength(1);
    expect(() => selectCoins([], 1n)).toThrow(/INSUFFICIENT|need/);
  });
});

import * as composer from '../src/index.js';
function require_() { return composer; }
