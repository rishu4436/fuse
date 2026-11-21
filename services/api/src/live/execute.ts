// LIVE execute path: compose an UNSIGNED mainnet transaction against live chain state, simulate the covenant
// inputs in the BCH 2026 VM, run the Guardian pre-flight risk check, and hand the user's wallet a signing request.
// The server never sees a private key: user inputs are left unsigned (P2PKH for the user's address); covenant
// inputs (FlashVault flash, Cauldron swap) carry their key-less unlocking bytecode.
import { binToHex, hexToBin, hash160, encodeTransaction, createVirtualMachineBch2026, decodeCashAddress, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { encodeVaultState, decodeVaultState, type BchVaultParams } from '@fuse/contracts';
import { contractUnlocks, toUnsignedTransaction, sourceOutputsOf, templateHash, type TxTemplate, type TemplateInput, type TemplateOutput } from '@fuse/transaction-composer';
import { addressUtxos, type LiveUtxo } from './chain.js';
import { trackVault, paramsOfConfig, vaultLb, type VaultConfig } from './vault.js';
import { livePools, bestRoundTrip, roundTripVia, assertPoolsUnspent, PUSD } from './cauldron.js';

export const LIVE_CAPS = { maxMinerFee: 5_000n, feeRate: 2n, minPrincipal: 10_000n, maxPrincipal: 50_000n, dust: 546n };
export type Action = 'flash' | 'flash-cauldron' | 'deposit' | 'withdraw' | 'deploy-vault' | 'consolidate';
const ZERO = encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: false });
const fail = (msg: string, code = 400): never => { throw Object.assign(new Error(msg), { statusCode: code }); };
export const flashFee = (p: BchVaultParams, v: bigint) => { const f = (v * p.feeBps + 9_999n) / 10_000n; return f > p.minFee ? f : p.minFee; };

export function userLockingBytecode(address: string) {
  const d = decodeCashAddress(address);
  if (typeof d === 'string') fail(`invalid cashaddr: ${d}`);
  const dd = d as Exclude<typeof d, string>;
  if (dd.prefix !== 'bitcoincash') fail('mainnet cashaddr (bitcoincash:) required');
  if (!['p2pkh', 'p2pkhWithTokens'].includes(dd.type)) fail('only P2PKH wallet addresses can sign in this flow');
  const r = cashAddressToLockingBytecode(address); if (typeof r === 'string') fail(r);
  return { lb: binToHex((r as { bytecode: Uint8Array }).bytecode), pkh: binToHex(dd.payload) };
}

const userIn = (c: LiveUtxo, lb: string): TemplateInput => ({ txid: c.txid, vout: c.vout, satoshis: c.satoshis, lockingBytecode: lb, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } });
const nft = (p: BchVaultParams, commitment: string) => ({ category: p.vaultCategory, amount: 0n, nft: { capability: 'mutable' as const, commitment } });
const vaultIn = (v: { txid: string; vout: number; satoshis: bigint; commitment: string }, p: BchVaultParams, owner: boolean): TemplateInput => ({ txid: v.txid, vout: v.vout, satoshis: v.satoshis, lockingBytecode: vaultLb(p), token: nft(p, v.commitment), role: 'vault', unlock: owner ? { kind: 'flashvault-bch-owner', params: p, signer: 'user' } : { kind: 'flashvault-bch', params: p, fn: 'flash' } });

/** Placeholder-signed size: covenant unlocks exact, P2PKH 100 B (Schnorr sig + pubkey), owner path flash-unlock + 100 B. */
export function estimateSignedSize(t: TxTemplate): number {
  const tx = toUnsignedTransaction(t); const cu = contractUnlocks(t);
  const flashLen = (() => { const i = t.inputs.findIndex((x) => x.unlock.kind === 'flashvault-bch-owner'); if (i < 0) return 0; const alt: TxTemplate = { ...t, inputs: t.inputs.map((x, n) => (n === i && x.unlock.kind === 'flashvault-bch-owner' ? { ...x, unlock: { kind: 'flashvault-bch', params: x.unlock.params, fn: 'flash' } } : x)) as TemplateInput[] }; return contractUnlocks(alt).get(i)!.length / 2; })();
  tx.inputs.forEach((inp, i) => { const u = cu.get(i); inp.unlockingBytecode = u ? hexToBin(u) : new Uint8Array(t.inputs[i].unlock.kind === 'flashvault-bch-owner' ? flashLen + 100 : 100); });
  return encodeTransaction(tx).length;
}
/** VM simulation of every covenant input BEFORE signing (P2PKH inputs get placeholders and are verified after signing). */
export function simulate(t: TxTemplate) {
  const vm = createVirtualMachineBch2026();
  const tx = toUnsignedTransaction(t); const cu = contractUnlocks(t); const src = sourceOutputsOf(t);
  tx.inputs.forEach((inp, i) => { const u = cu.get(i); inp.unlockingBytecode = u ? hexToBin(u) : new Uint8Array(100); });
  return t.inputs.map((inp, inputIndex) => {
    if (!cu.has(inputIndex)) return { inputIndex, kind: inp.unlock.kind, evaluated: false, ok: true, detail: inp.unlock.kind === 'p2pkh' ? 'your signature — verified by the VM after signing' : 'owner signature — verified by the VM after signing' };
    const state = vm.evaluate({ inputIndex, sourceOutputs: src, transaction: tx });
    const r = vm.stateSuccess(state);
    return { inputIndex, kind: inp.unlock.kind, evaluated: true, ok: r === true, detail: r === true ? 'covenant accepts this transaction (BCH 2026 VM)' : String(r) };
  });
}

function sized(build: (fee: bigint) => TxTemplate) {
  let fee = 600n, t = build(fee);
  for (let i = 0; i < 3; i++) { const want = BigInt(estimateSignedSize(t)) * LIVE_CAPS.feeRate + 4n; if (want === fee) break; fee = want; t = build(fee); }
  if (fee > LIVE_CAPS.maxMinerFee) fail(`miner fee ${fee} exceeds the cap ${LIVE_CAPS.maxMinerFee}`);
  return { template: t, fee, sizeBytes: estimateSignedSize(t) };
}
function pickCoins(coins: LiveUtxo[], need: bigint) {
  const plain = coins.filter((c) => !c.token); const out: LiveUtxo[] = []; let total = 0n;
  for (const c of plain) { out.push(c); total += c.satoshis; if (total >= need + 2_500n) break; }
  if (total < need) fail(`wallet has ${total} spendable sats in plain coins; ${need} + fee needed`, 422);
  return { coins: out, total };
}

export interface PrepareInput { action: Action; address: string; vaultId?: string; amount?: bigint; principal?: bigint; units?: bigint; maxUserCost?: bigint; /** solver-auction winner: compose exactly this pool pair */ route?: { buyOutpoint: string; sellOutpoint: string } }
export async function prepare(configs: VaultConfig[], req: PrepareInput) {
  const user = userLockingBytecode(req.address);
  const coins = await addressUtxos(req.address);
  const notes: string[] = [];
  let built: ReturnType<typeof sized>; let vaultInfo: Awaited<ReturnType<typeof trackVault>> | null = null; let route: Record<string, unknown> | null = null;
  let p: BchVaultParams | null = null; let requiredReturn: bigint | null = null; let expectedUserCost = 0n; let capital = 0n;
  if (req.action === 'consolidate') {
    // sweep every plain coin of the wallet into ONE coin at output 0 of the same wallet (no contract involved)
    const plain = coins.filter((c) => !c.token).slice(0, 20);
    if (plain.length < 2) fail('nothing to consolidate: the wallet has fewer than 2 plain coins', 422);
    const total = plain.reduce((a, c) => a + c.satoshis, 0n);
    built = sized((fee) => ({ version: 2, locktime: 0, inputs: plain.map((c) => userIn(c, user.lb)), outputs: [{ lockingBytecode: user.lb, satoshis: total - fee, role: 'change', label: `all ${plain.length} coins → one coin back to your wallet` }] }));
    expectedUserCost = built.fee; notes.push('Self-consolidation: every output pays your own address.');
  } else if (req.action === 'deploy-vault') {
    const principal = req.principal ?? 20_000n;
    if (principal < LIVE_CAPS.minPrincipal || principal > LIVE_CAPS.maxPrincipal) fail(`principal must be ${LIVE_CAPS.minPrincipal}–${LIVE_CAPS.maxPrincipal} sats`);
    const c0 = coins.find((c) => !c.token && c.vout === 0 && c.satoshis >= principal + 3_000n) ?? fail('a plain coin at output index 0 with principal + 3,000 sats is needed for the vault identity genesis (send yourself one payment first)', 422);
    p = { vaultCategory: c0.txid, feeBps: 9n, minFee: 100n, maxExposure: LIVE_CAPS.maxPrincipal * 2n, ownerPkh: user.pkh };
    const pp = p;
    built = sized((fee) => ({ version: 2, locktime: 0, inputs: [userIn(c0, user.lb)], outputs: [
      { lockingBytecode: vaultLb(pp), satoshis: principal, token: nft(pp, ZERO), role: 'vault-continuation', label: 'new FlashVault (identity NFT minted here)' },
      { lockingBytecode: user.lb, satoshis: c0.satoshis - principal - fee, role: 'change' }] }));
    expectedUserCost = built.fee; capital = principal; notes.push(`You become the vault owner (owner PKH ${user.pkh}). Only your key can withdraw.`);
  } else {
    const cfg = configs.find((c) => c.id === req.vaultId) ?? configs.find((c) => c.status === 'active') ?? fail('no live vault configured', 503);
    vaultInfo = await trackVault(cfg); p = paramsOfConfig(cfg);
    const v = vaultInfo.current ?? fail(`vault ${cfg.id} is closed`, 409);
    const pp = p;
    if (req.action === 'flash' || req.action === 'flash-cauldron') {
      const f = flashFee(pp, v.satoshis); requiredReturn = v.satoshis + f;
      const st = decodeVaultState(v.commitment);
      const nextState = encodeVaultState({ flashCount: st.flashCount + 1n, cumulativeFees: st.cumulativeFees + f, paused: false });
      if (st.paused) fail('vault is paused by its owner', 409);
      if (req.action === 'flash') {
        const { coins: cs, total } = pickCoins(coins, f + 1_500n);
        built = sized((fee) => ({ version: 2, locktime: 0, inputs: [vaultIn(v, pp, false), ...cs.map((c) => userIn(c, user.lb))], outputs: [
          { lockingBytecode: vaultLb(pp), satoshis: v.satoshis + f, token: nft(pp, nextState), role: 'vault-continuation', label: `principal ${v.satoshis} + flash fee ${f}` },
          { lockingBytecode: user.lb, satoshis: total - f - fee, role: 'change' }] }));
        expectedUserCost = f + built.fee;
      } else {
        const units = req.units ?? 1n;
        const { pools } = await livePools();
        const byOp = (o: string) => pools.find((x) => `${x.txid}:${x.vout}` === o) ?? fail(`pool ${o} is not a verified, live Cauldron PUSD pool right now`, 409);
        const rt = req.route ? (roundTripVia(byOp(req.route.buyOutpoint), byOp(req.route.sellOutpoint), units) ?? fail('the quoted route is out of range for the current pool state', 409))
          : (bestRoundTrip(pools, units) ?? fail('no two verified live Cauldron pools available for a round trip', 503));
        await assertPoolsUnspent([rt.a, rt.b]);
        if (rt.satsIn > v.satoshis) fail(`the buy leg (${rt.satsIn} sats) exceeds the vault principal (${v.satoshis}); choose fewer units`, 422);
        const loss = rt.loss;
        const { coins: cs, total } = pickCoins(coins, f + (loss > 0n ? loss : 0n) + 2_000n);
        const poolIn = (x: typeof rt.a): TemplateInput => ({ txid: x.txid, vout: x.vout, satoshis: x.satoshis, lockingBytecode: x.lockingBytecode, token: x.token, role: 'pool', unlock: { kind: 'cauldron-pool', ownerPkh: x.ownerPkh } });
        const poolOut = (x: typeof rt.a, sats: bigint, tokens: bigint, label: string): TemplateOutput => ({ lockingBytecode: x.lockingBytecode, satoshis: sats, token: { category: PUSD, amount: tokens }, role: 'pool', label });
        built = sized((fee) => ({ version: 2, locktime: 0, inputs: [vaultIn(v, pp, false), poolIn(rt.a), poolIn(rt.b), ...cs.map((c) => userIn(c, user.lb))], outputs: [
          { lockingBytecode: vaultLb(pp), satoshis: v.satoshis + f, token: nft(pp, nextState), role: 'vault-continuation', label: `principal ${v.satoshis} + flash fee ${f}` },
          poolOut(rt.a, rt.buy.newSats, rt.buy.newTokens, `Cauldron ${rt.a.poolId.slice(0, 8)}: +${rt.satsIn} sats (paid from the borrowed principal), −${units} PUSD units`),
          poolOut(rt.b, rt.sell.newSats, rt.sell.newTokens, `Cauldron ${rt.b.poolId.slice(0, 8)}: +${units} PUSD units, −${rt.satsOut} sats (repays the vault)`),
          { lockingBytecode: user.lb, satoshis: total - f - loss - fee, role: 'change' }] }));
        expectedUserCost = f + loss + built.fee;
        route = { units: units.toString(), buyPool: rt.a.poolId, sellPool: rt.b.poolId, buyOutpoint: `${rt.a.txid}:${rt.a.vout}`, sellOutpoint: `${rt.b.txid}:${rt.b.vout}`, satsIn: rt.satsIn, satsOut: rt.satsOut, roundTripLoss: loss, financedByFlash: true, note: 'The borrowed principal pays the buy on pool A; the sell on pool B returns sats that repay the vault in the same transaction. The PUSD never leaves the two pools. This proves atomic routing; it is not a profitable arbitrage unless the pools diverge by more than 2×0.3% + fees.' };
      }
    } else {
      if (pp.ownerPkh !== user.pkh) fail('LP deposit/withdraw use the vault owner path: connect the vault owner wallet (deposits into a FUSE vault are owner-only in FlashVaultBCH v1)', 403);
      const amount = req.amount ?? 10_000n;
      if (req.action === 'deposit') {
        if (v.satoshis + amount > pp.maxExposure) fail(`deposit would exceed maxExposure ${pp.maxExposure}`, 422);
        const { coins: cs, total } = pickCoins(coins, amount + 1_500n);
        built = sized((fee) => ({ version: 2, locktime: 0, inputs: [vaultIn(v, pp, true), ...cs.map((c) => userIn(c, user.lb))], outputs: [
          { lockingBytecode: vaultLb(pp), satoshis: v.satoshis + amount, token: nft(pp, v.commitment), role: 'vault-continuation', label: `vault + LP deposit ${amount}` },
          { lockingBytecode: user.lb, satoshis: total - amount - fee, role: 'change' }] }));
        expectedUserCost = built.fee; capital = amount; requiredReturn = v.satoshis + amount;
      } else {
        if (v.satoshis - amount < LIVE_CAPS.minPrincipal) fail(`the vault must keep ≥ ${LIVE_CAPS.minPrincipal} sats`, 422);
        built = sized((fee) => ({ version: 2, locktime: 0, inputs: [vaultIn(v, pp, true)], outputs: [
          { lockingBytecode: vaultLb(pp), satoshis: v.satoshis - amount, token: nft(pp, v.commitment), role: 'vault-continuation', label: `vault after LP withdraw ${amount}` },
          { lockingBytecode: user.lb, satoshis: amount - fee, role: 'change', label: 'withdrawn to your wallet' }] }));
        expectedUserCost = built.fee; requiredReturn = v.satoshis - amount;
      }
    }
  }
  const t = built.template;
  const sim = simulate(t);
  const risk = guardianPreflight(t, { userLb: user.lb, vaultLb: p ? vaultLb(p) : null, fee: built.fee, expectedUserCost, capital, maxUserCost: req.maxUserCost, sim, requiredReturn, coins });
  const tx = toUnsignedTransaction(t); const cu = contractUnlocks(t); const src = sourceOutputsOf(t);
  tx.inputs.forEach((inp, i) => { const u = cu.get(i); if (u) inp.unlockingBytecode = hexToBin(u); });
  const transactionHex = binToHex(encodeTransaction(tx));
  const tok = (x: TemplateInput) => (x.token ? { token: { category: x.token.category, amount: x.token.amount.toString(), ...(x.token.nft ? { nft: { capability: x.token.nft.capability, commitment: x.token.nft.commitment } } : {}) } } : {});
  const sourceOutputs = t.inputs.map((x, i) => ({ outpointIndex: x.vout, outpointTransactionHash: x.txid, sequenceNumber: 0xffffffff, unlockingBytecode: cu.get(i) ?? '', lockingBytecode: x.lockingBytecode, valueSatoshis: src[i].valueSatoshis.toString(), ...tok(x) }));
  const userInputs = t.inputs.map((x, i) => [x, i] as const).filter(([x]) => x.unlock.kind === 'p2pkh' || x.unlock.kind === 'flashvault-bch-owner').map(([, i]) => i);
  return {
    network: 'mainnet' as const, action: req.action, address: req.address, templateHash: templateHash(t), template: t, minerFee: built.fee, estimatedSizeBytes: built.sizeBytes, expectedUserCost,
    vault: vaultInfo ? { id: vaultInfo.id, address: vaultInfo.address, current: vaultInfo.current } : p ? { id: 'new', category: p.vaultCategory, ownerPkh: p.ownerPkh, lockingBytecode: vaultLb(p) } : null,
    route, simulation: sim, risk, notes,
    constraints: {
      userLockingBytecode: user.lb, maxMinerFee: LIVE_CAPS.maxMinerFee, expectedUserCost, capital, maxUserCost: req.maxUserCost ?? expectedUserCost,
      allowedRecipients: [...new Set(t.outputs.map((o) => o.lockingBytecode))],
      vault: p ? { id: vaultInfo?.id ?? 'new', lockingBytecode: vaultLb(p), category: p.vaultCategory, feeBps: p.feeBps, minFee: p.minFee, maxExposure: p.maxExposure, ownerPkh: p.ownerPkh, requiredReturn } : null,
      route: route ? { units: route.units, buyOutpoint: route.buyOutpoint, sellOutpoint: route.sellOutpoint, satsIn: route.satsIn, minSatsOut: route.satsOut, slippageBps: 0 } : null,
    },
    sign: { transactionHex, sourceOutputs, userPrompt: `FUSE ${req.action} on BCH mainnet — you pay ≈ ${expectedUserCost} sats`, broadcast: false, userInputs, inputPaths: userInputs.map((i) => [i, 'receive', 0] as [number, string, number]) },
  };
}

export function guardianPreflight(t: TxTemplate, x: { userLb: string; vaultLb: string | null; fee: bigint; expectedUserCost: bigint; capital: bigint; maxUserCost?: bigint; sim: ReturnType<typeof simulate>; requiredReturn: bigint | null; coins: LiveUtxo[] }) {
  const checks: Array<{ name: string; ok: boolean; level: 'block' | 'warn'; detail: string }> = [];
  const add = (name: string, ok: boolean, detail: string, level: 'block' | 'warn' = 'block') => checks.push({ name, ok, level, detail });
  const userIn = t.inputs.filter((i) => i.lockingBytecode === x.userLb).reduce((a, i) => a + i.satoshis, 0n);
  const userOut = t.outputs.filter((o) => o.lockingBytecode === x.userLb).reduce((a, o) => a + o.satoshis, 0n);
  const net = userIn - userOut;
  add('covenant simulation', x.sim.every((s) => s.ok), x.sim.filter((s) => s.evaluated).map((s) => `input ${s.inputIndex} ${s.kind}: ${s.ok ? 'ok' : s.detail}`).join('; ') || 'no covenant inputs');
  const poolLbs = new Set(t.inputs.filter((i) => i.role === 'pool').map((i) => i.lockingBytecode));
  const unknown = t.outputs.filter((o) => o.lockingBytecode !== x.userLb && o.lockingBytecode !== x.vaultLb && !poolLbs.has(o.lockingBytecode));
  add('no hidden transfers', unknown.length === 0, unknown.length ? `${unknown.length} output(s) pay an unexpected script` : 'every output pays you, the vault, or a pool that is also spent here (same-index covenant continuation)');
  add('miner fee within cap', x.fee <= LIVE_CAPS.maxMinerFee, `${x.fee} sats (cap ${LIVE_CAPS.maxMinerFee}, ${LIVE_CAPS.feeRate} sat/B)`);
  const cost = net - x.capital;
  add('your net cost', cost <= x.expectedUserCost + 1n, `${cost} sats spent (expected ${x.expectedUserCost})${x.capital ? `; plus ${x.capital} sats of your capital placed in your own vault, withdrawable by your key only` : ''}${net < 0n ? `; you receive ${-net} sats` : ''}`);
  if (x.maxUserCost !== undefined) add('within your spend limit', cost <= x.maxUserCost, `${cost} ≤ ${x.maxUserCost}`);
  if (x.requiredReturn !== null && x.vaultLb) { const back = t.outputs.find((o) => o.lockingBytecode === x.vaultLb)?.satoshis ?? 0n; add('vault repaid in the same tx', back >= x.requiredReturn, `vault receives ${back} ≥ ${x.requiredReturn}`); }
  const tokenLeak = t.outputs.some((o) => o.lockingBytecode === x.userLb && o.token);
  add('no token side effects on your wallet', !tokenLeak, tokenLeak ? 'an output sends tokens to your wallet' : 'no tokens move to or from your wallet');
  add('your coins are confirmed', t.inputs.filter((i) => i.lockingBytecode === x.userLb).every((i) => x.coins.find((c) => c.txid === i.txid && c.vout === i.vout)?.confirmed), 'unconfirmed inputs work on BCH but are re-checked at broadcast', 'warn');
  const blocking = checks.filter((c) => !c.ok && c.level === 'block');
  return { ok: blocking.length === 0, level: blocking.length ? 'BLOCK' : checks.some((c) => !c.ok) ? 'WARN' : 'PASS', checks, netUserCost: cost, capitalToOwnVault: x.capital };
}
export const pkhOf = (pubHex: string) => binToHex(hash160(hexToBin(pubHex)));
