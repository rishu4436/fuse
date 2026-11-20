import { describe, it, expect } from 'vitest';
import { createLocalMarket } from '@fuse/simulation';
import { signInputs, finalize, contractUnlocks, verifyTemplateAndRaw, txidOfRaw, type TxTemplate } from '@fuse/transaction-composer';
import { flashFee, encodeVaultState, decodeVaultState, nextVaultState } from '@fuse/contracts';
import { ShardManager, planLayout, buildDeposit, buildWithdraw, buildMerge, buildSplit, buildPause, allocateFees, vaultHealth, type ShardRef } from '../src/index.js';

const shardRefs = async (m: ReturnType<typeof createLocalMarket>): Promise<ShardRef[]> =>
  (await m.provider.getUtxos(m.vault.tokenAddress)).filter((u) => u.token?.nft && u.token.category === m.vaultParams.vaultCategory).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));
const lpCtx = (m: ReturnType<typeof createLocalMarket>) => ({ params: m.vaultParams, vaultLockingBytecode: m.vault.lockingBytecode, lpLockingBytecode: m.lp.lockingBytecode });
async function submit(m: ReturnType<typeof createLocalMarket>, t: TxTemplate, signer: 'lp' | string, priv: Uint8Array) {
  const raw = finalize(t, contractUnlocks(t), signInputs(t, signer, priv));
  const v = verifyTemplateAndRaw(t, raw, { requireStrongSighash: true });
  if (!v.ok) throw new Error(JSON.stringify(v.checks.filter((c) => !c.ok)));
  await m.provider.sendRawTransaction(raw);
  return txidOfRaw(raw);
}
const coin = (u: { txid: string; vout: number; satoshis: bigint; token?: unknown }) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, token: u.token as never });

describe('LP operations in the BCH VM (owner path, 0x61)', () => {
  it('deposit → partial withdraw → pause blocks flash → unpause → merge → split (with baton) → full exit', async () => {
    const m = createLocalMarket(); const c = lpCtx(m);
    let [s1] = (await shardRefs(m)).sort((a, b) => (a.satoshis > b.satoshis ? -1 : 1));
    let tx = await submit(m, buildDeposit(c, s1, coin(m.lpCoin), 10_000_000n), 'lp', m.lp.priv);
    s1 = { ...s1, txid: tx, vout: 0, satoshis: s1.satoshis + 10_000_000n };
    expect((await shardRefs(m)).find((s) => s.txid === tx)!.satoshis).toBe(60_000_000n);
    tx = await submit(m, buildWithdraw(c, s1, 5_000_000n), 'lp', m.lp.priv);
    s1 = { ...s1, txid: tx, vout: 0, satoshis: 55_000_000n };
    // pause, then a flash on the paused shard must fail in the VM
    const fund = (await m.provider.getUtxos(m.lp.address)).find((u) => !u.token && u.satoshis > 100_000n)!;
    tx = await submit(m, buildPause(c, s1, true, coin(fund)), 'lp', m.lp.priv);
    s1 = { ...s1, txid: tx, vout: 0, commitment: encodeVaultState({ ...decodeVaultState(s1.commitment), paused: true }) };
    const sc = (await m.provider.getUtxos(m.solvers.flash.address))[0];
    expect(() => flashTemplate(m, s1, sc)).toThrow(/paused/); // off-chain guard
    const flashT = flashTemplate(m, s1, sc, true); // force it anyway: the covenant itself must refuse
    const rep = verifyTemplateAndRaw(flashT, finalize(flashT, contractUnlocks(flashT), signInputs(flashT, 'solver', m.solvers.flash.priv)));
    expect(rep.ok).toBe(false);
    const fund2 = (await m.provider.getUtxos(m.lp.address)).find((u) => !u.token && u.satoshis > 100_000n)!;
    tx = await submit(m, buildPause(c, s1, false, coin(fund2)), 'lp', m.lp.priv);
    // merge all shards
    const all = await shardRefs(m);
    expect(all).toHaveLength(3);
    tx = await submit(m, buildMerge(c, all), 'lp', m.lp.priv);
    const [merged] = await shardRefs(m);
    expect(merged.satoshis).toBe(all.reduce((a, s) => a + s.satoshis, 0n) - 2_000n);
    // split into 4 parts using the minting baton
    const baton = (await m.provider.getUtxos(m.lp.address)).find((u) => u.token?.nft?.capability === 'minting')!;
    const parts = [40_000_000n, 20_000_000n, 10_000_000n, merged.satoshis - 70_000_000n - 2_000n];
    await submit(m, buildSplit(c, merged, coin(baton), parts), 'lp', m.lp.priv);
    const after = await shardRefs(m);
    expect(after.map((s) => s.satoshis).sort()).toEqual([...parts].sort());
    // full exit of one shard: identity NFT returns to LP
    const small = after.find((s) => s.satoshis === 10_000_000n)!;
    await submit(m, buildWithdraw(c, small, small.satoshis), 'lp', m.lp.priv);
    expect(await shardRefs(m)).toHaveLength(3);
  });
  it('a solver key cannot use the owner path; exposure caps enforced', () => {
    const m = createLocalMarket(); const c = lpCtx(m);
    const s = { txid: m.shards[0].txid, vout: 0, satoshis: m.shards[0].satoshis, commitment: m.shards[0].token!.nft!.commitment };
    const t = buildWithdraw(c, s, 1_000_000n);
    expect(() => signInputs(t, 'lp', m.solvers.rogue.priv)).toThrow(/not the vault owner/);
    expect(() => buildDeposit(c, s, coin(m.lpCoin), 200_000_000n)).toThrow(/maxExposure/);
  });
  it('fee allocation is exact (Σ = fees) and pro-rata', () => {
    const a = allocateFees(1_000_003n, { alice: 600n, bob: 300n, carol: 100n });
    expect(a.alice + a.bob + a.carol).toBe(1_000_003n);
    expect(a.bob).toBe(300_000n); expect(a.carol).toBe(100_000n); expect(a.alice).toBe(600_003n);
  });
});

function flashTemplate(m: ReturnType<typeof createLocalMarket>, s: ShardRef, solverCoin: { txid: string; vout: number; satoshis: bigint }, forcePaused = false): TxTemplate {
  const fee = flashFee(s.satoshis, m.vaultParams.feeBps, m.vaultParams.minFee);
  const st = decodeVaultState(s.commitment);
  const next = forcePaused ? encodeVaultState({ flashCount: st.flashCount + 1n, cumulativeFees: st.cumulativeFees + fee, paused: true }) : encodeVaultState(nextVaultState(st, fee));
  return { version: 2, locktime: 0, inputs: [
    { txid: s.txid, vout: s.vout, satoshis: s.satoshis, token: { category: m.vaultParams.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: s.commitment } }, lockingBytecode: m.vault.lockingBytecode, role: 'vault', unlock: { kind: 'flashvault-bch', params: m.vaultParams, fn: 'flash' } },
    { txid: solverCoin.txid, vout: solverCoin.vout, satoshis: solverCoin.satoshis, lockingBytecode: m.solvers.flash.lockingBytecode, role: 'solver', unlock: { kind: 'p2pkh', signer: 'solver' } },
  ], outputs: [
    { lockingBytecode: m.vault.lockingBytecode, satoshis: s.satoshis + fee, token: { category: m.vaultParams.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: next } }, role: 'vault-continuation' },
    { lockingBytecode: m.solvers.flash.lockingBytecode, satoshis: solverCoin.satoshis - fee - 2_000n, role: 'change' },
  ] };
}

describe('shard manager concurrency (F30/F36)', () => {
  it('100 interleaved async reservations never double-lease a shard', async () => {
    const m = createLocalMarket();
    const mgr = new ShardManager(m.vaultParams, await shardRefs(m), { maxLeasesPerHolder: 1 });
    const results = await Promise.allSettled(Array.from({ length: 100 }, async (_, i) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); return mgr.reserve(BigInt(1 + (i % 3)) * 1_000_000n, `solver-${i}`); }));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ outpoint: string }>).value);
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((l) => l.outpoint)).size).toBe(3);
    expect(results.filter((r) => r.status === 'rejected').every((r) => /NO_SHARD|no free shard/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
  });
  it('leased shards settle concurrently in the VM; an unmanaged double-use fails', async () => {
    const m = createLocalMarket();
    const mgr = new ShardManager(m.vaultParams, await shardRefs(m));
    const kinds = ['direct', 'routing', 'flash'] as const;
    const leases = kinds.map((k) => mgr.reserve(1_000_000n, k));
    const shards = await shardRefs(m);
    const txs = await Promise.all(kinds.map(async (k, i) => {
      const s = shards.find((x) => `${x.txid}:${x.vout}` === leases[i].outpoint)!;
      const sc = (await m.provider.getUtxos(m.solvers[k].address)).find((u) => !u.token)!;
      const t = flashTemplate(m, s, sc);
      t.inputs[1].lockingBytecode = m.solvers[k].lockingBytecode; t.outputs[1].lockingBytecode = m.solvers[k].lockingBytecode;
      const raw = finalize(t, contractUnlocks(t), signInputs(t, 'solver', m.solvers[k].priv));
      expect(verifyTemplateAndRaw(t, raw).ok).toBe(true);
      await m.provider.sendRawTransaction(raw);
      mgr.commit(leases[i], { txid: txidOfRaw(raw), vout: 0, satoshis: s.satoshis + leases[i].fee, commitment: t.outputs[0].token!.nft!.commitment });
      return txidOfRaw(raw);
    }));
    expect(new Set(txs).size).toBe(3);
    expect(mgr.leased()).toHaveLength(0);
    expect((await shardRefs(m)).every((s) => decodeVaultState(s.commitment).flashCount === 1n)).toBe(true);
    // double use of the same (now spent) shard without the manager is rejected by the chain
    const s0 = shards[0];
    const rogueCoin = (await m.provider.getUtxos(m.solvers.rogue.address)).find((u) => !u.token)!;
    const t2 = flashTemplate(m, s0, rogueCoin); t2.inputs[1].lockingBytecode = m.solvers.rogue.lockingBytecode; t2.outputs[1].lockingBytecode = m.solvers.rogue.lockingBytecode;
    await expect(m.provider.sendRawTransaction(finalize(t2, contractUnlocks(t2), signInputs(t2, 'solver', m.solvers.rogue.priv)))).rejects.toThrow();
  });
  it('leases expire (TTL) and per-holder exposure caps apply', () => {
    let t = 0;
    const m = createLocalMarket();
    const refs = m.shards.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));
    const mgr = new ShardManager(m.vaultParams, refs, { leaseTtlMs: 100, now: () => t, maxHolderExposure: 30_000_000n, maxLeasesPerHolder: 3 });
    mgr.reserve(10_000_000n, 'a');
    expect(() => mgr.reserve(30_000_000n, 'a')).toThrow(/exposure/);
    expect(mgr.available()).toHaveLength(2);
    t = 200;
    expect(mgr.available()).toHaveLength(3);
  });
  it('adaptive layout follows demand quantiles and conserves liquidity', () => {
    const m = createLocalMarket();
    const refs = m.shards.map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));
    const demand = [...Array(50).fill(2_000_000n), ...Array(30).fill(8_000_000n), ...Array(15).fill(15_000_000n), 30_000_000n];
    const p = planLayout(refs, demand, m.vaultParams.maxExposure);
    expect(p.target.reduce((a, x) => a + x, 0n)).toBe(75_000_000n);
    expect(p.target.some((x) => x >= 33_000_000n)).toBe(true);
    expect(p.target.some((x) => x <= 2_200_000n * 2n)).toBe(true);
    expect(vaultHealth(refs, [`${refs[0].txid}:0`], m.vaultParams.maxExposure).utilizationBps).toBe(6_666n);
  });
});
