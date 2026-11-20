// Reference solver strategies. Each is a pure function of (market view, intent, solver identity) and
// returns a fully specified transaction template plus its economic claims. Claims are NOT trusted by the
// coordinator: it independently verifies every template in the BCH VM and recomputes the outcome.
import { cauldronBuyQuote, cauldronSellQuote, flashFee, encodeVaultState, decodeVaultState, nextVaultState } from '@fuse/contracts';
import type { TxTemplate } from '@fuse/transaction-composer';
import type { MarketView, SwapIntentView, UtxoView } from './types.js';

export interface SolverIdentity { id: string; pubkey: string; lockingBytecode: string; coins: UtxoView[]; inventory?: UtxoView[] }
export interface Proposal { template: TxTemplate; claims: { userReceivesTokens: bigint; userPaysSats: bigint; solverFeeSats: bigint; liquidityFeeSats: bigint; minerFeeSats: bigint }; explanation: string }

const MINER_FEE = 4_000n;
const TOKEN_DUST = 1_000n;
const userIn = (i: SwapIntentView, need: bigint) => {
  const c = [...i.owner.coins].filter((x) => !x.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  if (!c || c.satoshis < need) throw new Error('owner has insufficient BCH for this route');
  return c;
};
const bchCoin = (s: SolverIdentity) => { const c = s.coins.find((x) => !x.token); if (!c) throw new Error('solver has no BCH coin'); return c; };

/** Cheapest single pool for buying `x` tokens. */
function bestPool(m: MarketView, x: bigint) {
  return m.pools.map((p) => ({ p, q: cauldronBuyQuote(p.utxo.satoshis, p.utxo.token!.amount, x) })).sort((a, b) => (a.q.satsIn < b.q.satsIn ? -1 : 1))[0];
}

export function routingStrategy(m: MarketView, intent: SwapIntentView, s: SolverIdentity, solverFeeBps = 10n): Proposal {
  const x = intent.minOut;
  const { p, q } = bestPool(m, x);
  const solverFee = (q.satsIn * solverFeeBps + 9_999n) / 10_000n;
  const userPays = q.satsIn + solverFee + MINER_FEE + TOKEN_DUST;
  const coin = userIn(intent, userPays);
  return {
    template: {
      version: 2, locktime: 0,
      inputs: [
        { ...p.utxo, lockingBytecode: p.lockingBytecode, role: 'pool', unlock: { kind: 'cauldron-pool', ownerPkh: p.ownerPkh } },
        { ...coin, lockingBytecode: intent.owner.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } },
      ],
      outputs: [
        { lockingBytecode: p.lockingBytecode, satoshis: q.newSats, token: { category: m.token, amount: q.newTokens }, role: 'pool' },
        { lockingBytecode: intent.owner.lockingBytecode, satoshis: TOKEN_DUST, token: { category: m.token, amount: x }, role: 'user', label: 'tokens bought' },
        { lockingBytecode: s.lockingBytecode, satoshis: solverFee < 546n ? 546n : solverFee, role: 'solver', label: 'solver fee' },
        { lockingBytecode: intent.owner.lockingBytecode, satoshis: coin.satoshis - userPays - (solverFee < 546n ? 546n - solverFee : 0n), role: 'change' },
      ],
    },
    claims: { userReceivesTokens: x, userPaysSats: q.satsIn + (solverFee < 546n ? 546n : solverFee) + MINER_FEE, solverFeeSats: solverFee < 546n ? 546n : solverFee, liquidityFeeSats: 0n, minerFeeSats: MINER_FEE },
    explanation: `Routes the full order through Cauldron pool ${p.id} (best single-pool price); solver fee ${solverFeeBps} bps.`,
  };
}

export function directLiquidityStrategy(m: MarketView, intent: SwapIntentView, s: SolverIdentity, markupBps = 150n): Proposal {
  const inv = (s.inventory ?? []).find((u) => u.token?.category === m.token && u.token.amount >= intent.minOut);
  if (!inv) throw new Error('no inventory for this token');
  const ref = bestPool(m, intent.minOut).q.satsIn; // price reference: what the market would charge
  const price = ref + (ref * markupBps) / 10_000n;
  const userPays = price + MINER_FEE;
  const coin = userIn(intent, userPays + TOKEN_DUST);
  const change = inv.token!.amount - intent.minOut;
  const outputs: TxTemplate['outputs'] = [
    { lockingBytecode: intent.owner.lockingBytecode, satoshis: TOKEN_DUST, token: { category: m.token, amount: intent.minOut }, role: 'user', label: 'tokens from solver inventory' },
    { lockingBytecode: s.lockingBytecode, satoshis: price + (change > 0n ? 0n : inv.satoshis), role: 'solver', label: 'payment to solver' },
  ];
  if (change > 0n) outputs.push({ lockingBytecode: s.lockingBytecode, satoshis: inv.satoshis, token: { category: m.token, amount: change }, role: 'solver', label: 'inventory change' });
  outputs.push({ lockingBytecode: intent.owner.lockingBytecode, satoshis: coin.satoshis - userPays - TOKEN_DUST, role: 'change' });
  return {
    template: {
      version: 2, locktime: 0,
      inputs: [
        { ...coin, lockingBytecode: intent.owner.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } },
        { ...inv, lockingBytecode: s.lockingBytecode, role: 'solver', unlock: { kind: 'p2pkh', signer: 'solver' } },
      ],
      outputs,
    },
    claims: { userReceivesTokens: intent.minOut, userPaysSats: userPays, solverFeeSats: price - ref, liquidityFeeSats: 0n, minerFeeSats: MINER_FEE },
    explanation: `Fills from the solver's own token inventory at the Cauldron reference price + ${markupBps} bps.`,
  };
}

/** Buys the user's tokens AND back-runs the price gap between two pools with a FlashVault shard,
 *  sharing part of the arbitrage profit with the user as a price rebate — all in one transaction. */
export function flashLiquidityStrategy(m: MarketView, intent: SwapIntentView, s: SolverIdentity, rebateShareBps = 5_000n): Proposal {
  if (m.pools.length < 2) throw new Error('need two pools');
  const [cheap, rich] = [...m.pools].sort((a, b) => (a.utxo.satoshis * b.utxo.token!.amount < b.utxo.satoshis * a.utxo.token!.amount ? -1 : 1));
  // search arbitrage size that maximises profit (coarse grid, exact BigInt quotes)
  let best: { arb: bigint; profit: bigint; buy: ReturnType<typeof cauldronBuyQuote>; sell: ReturnType<typeof cauldronSellQuote>; shard: MarketView['vault']['shards'][number]; fee: bigint } | null = null;
  for (const shard of m.vault.shards) {
    const st = decodeVaultState(shard.token!.nft!.commitment);
    if (st.paused || shard.satoshis > m.vault.params.maxExposure) continue;
    const fee = flashFee(shard.satoshis, m.vault.params.feeBps, m.vault.params.minFee);
    for (let arb = 2_000n; arb <= 120_000n; arb += 2_000n) {
      const buy = cauldronBuyQuote(cheap.utxo.satoshis, cheap.utxo.token!.amount, intent.minOut + arb);
      const sell = cauldronSellQuote(rich.utxo.satoshis, rich.utxo.token!.amount, arb);
      const userCost = cauldronBuyQuote(cheap.utxo.satoshis, cheap.utxo.token!.amount, intent.minOut).satsIn;
      const arbCost = buy.satsIn - userCost; // marginal cost of the extra tokens
      if (arbCost > shard.satoshis) continue;
      const profit = sell.satsOut - arbCost - fee;
      if (!best || profit > best.profit) best = { arb, profit, buy, sell, shard, fee };
    }
  }
  if (!best || best.profit <= 0n) throw new Error('no profitable flash route');
  const { arb, buy, sell, shard, fee } = best;
  const userBase = buy.satsIn - (buy.satsIn - cauldronBuyQuote(cheap.utxo.satoshis, cheap.utxo.token!.amount, intent.minOut).satsIn);
  const rebate = (best.profit * rebateShareBps) / 10_000n;
  const solverKeep = best.profit - rebate;
  const userPays = userBase - rebate + MINER_FEE;
  const coin = userIn(intent, userPays + TOKEN_DUST);
  const sCoin = bchCoin(s);
  const st = decodeVaultState(shard.token!.nft!.commitment);
  // Pool inputs pay: cheap pool receives buy.satsIn total; user funds userBase, flash shard funds the rest.
  return {
    template: {
      version: 2, locktime: 0,
      inputs: [
        { txid: shard.txid, vout: shard.vout, satoshis: shard.satoshis, token: shard.token, lockingBytecode: m.vault.lockingBytecode, role: 'vault', unlock: { kind: 'flashvault-bch', params: m.vault.params, fn: 'flash' } },
        { ...cheap.utxo, lockingBytecode: cheap.lockingBytecode, role: 'pool', unlock: { kind: 'cauldron-pool', ownerPkh: cheap.ownerPkh } },
        { ...rich.utxo, lockingBytecode: rich.lockingBytecode, role: 'pool', unlock: { kind: 'cauldron-pool', ownerPkh: rich.ownerPkh } },
        { ...coin, lockingBytecode: intent.owner.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } },
        { ...sCoin, lockingBytecode: s.lockingBytecode, role: 'solver', unlock: { kind: 'p2pkh', signer: 'solver' } },
      ],
      outputs: [
        { lockingBytecode: m.vault.lockingBytecode, satoshis: shard.satoshis + fee, token: { category: m.vault.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState(nextVaultState(st, fee)) } }, role: 'vault-continuation' },
        { lockingBytecode: cheap.lockingBytecode, satoshis: buy.newSats, token: { category: m.token, amount: buy.newTokens }, role: 'pool' },
        { lockingBytecode: rich.lockingBytecode, satoshis: sell.newSats, token: { category: m.token, amount: sell.newTokens }, role: 'pool' },
        { lockingBytecode: intent.owner.lockingBytecode, satoshis: TOKEN_DUST, token: { category: m.token, amount: intent.minOut }, role: 'user', label: 'tokens bought' },
        { lockingBytecode: s.lockingBytecode, satoshis: sCoin.satoshis + solverKeep, role: 'solver', label: 'solver coin + arb share' },
        { lockingBytecode: intent.owner.lockingBytecode, satoshis: coin.satoshis - userPays - TOKEN_DUST, role: 'change' },
      ],
    },
    claims: { userReceivesTokens: intent.minOut, userPaysSats: userPays, solverFeeSats: solverKeep, liquidityFeeSats: fee, minerFeeSats: MINER_FEE },
    explanation: `Buys on ${cheap.id}, back-runs ${arb} tokens into ${rich.id} with a ${shard.satoshis}-sat FlashVault shard (fee ${fee}), rebates ${rebate} sats to the user.`,
  };
}

/** Deliberately malicious fixture used to prove the coordinator rejects bad solutions. */
export function adversarialStrategy(m: MarketView, intent: SwapIntentView, s: SolverIdentity): Proposal {
  const honest = routingStrategy(m, intent, s, 0n);
  const t = structuredClone(honest.template);
  // Claims the user receives minOut but actually delivers 1% fewer tokens and pockets the difference.
  const userOut = t.outputs.find((o) => o.role === 'user')!;
  const skim = intent.minOut / 100n || 1n;
  userOut.token!.amount -= skim;
  t.outputs.splice(2, 0, { lockingBytecode: s.lockingBytecode, satoshis: 1_000n, token: { category: m.token, amount: skim }, role: 'solver', label: 'skimmed' });
  const change = t.outputs.find((o) => o.role === 'change')!;
  change.satoshis -= 1_000n;
  return { template: t, claims: { ...honest.claims, userPaysSats: honest.claims.userPaysSats - 1_000n }, explanation: 'Looks cheapest (lies about delivered amount).' };
}

export const STRATEGIES = { DIRECT_LIQUIDITY: directLiquidityStrategy, ROUTING: routingStrategy, FLASH_LIQUIDITY: flashLiquidityStrategy, ADVERSARIAL_FIXTURE: adversarialStrategy } as const;

/** Pure flash arbitrage for an OWNER (no swap intent): borrow a FlashVault shard, buy on the cheaper pool,
 *  sell into the richer pool, repay principal + fee in the same transaction; profit goes to the owner.
 *  `feeCoin` only has to cover the miner fee. Throws if no size is profitable after vault + miner fees. */
export function flashArbitrageTemplate(m: MarketView, owner: { lockingBytecode: string; feeCoin: UtxoView }, opts: { minProfit?: bigint; maxTokens?: bigint } = {}): Proposal & { profit: bigint; tokens: bigint } {
  if (m.pools.length < 2) throw new Error('need two pools');
  const [cheap, rich] = [...m.pools].sort((a, b) => (a.utxo.satoshis * b.utxo.token!.amount < b.utxo.satoshis * a.utxo.token!.amount ? -1 : 1));
  let best: { x: bigint; profit: bigint; buy: ReturnType<typeof cauldronBuyQuote>; sell: ReturnType<typeof cauldronSellQuote>; shard: MarketView['vault']['shards'][number]; fee: bigint } | null = null;
  const cap = opts.maxTokens ?? 200_000n;
  for (const shard of m.vault.shards) {
    const st = decodeVaultState(shard.token!.nft!.commitment);
    if (st.paused || shard.satoshis > m.vault.params.maxExposure) continue;
    const fee = flashFee(shard.satoshis, m.vault.params.feeBps, m.vault.params.minFee);
    for (let x = 1_000n; x <= cap; x += 1_000n) {
      let buy, sell;
      try { buy = cauldronBuyQuote(cheap.utxo.satoshis, cheap.utxo.token!.amount, x); sell = cauldronSellQuote(rich.utxo.satoshis, rich.utxo.token!.amount, x); } catch { break; }
      if (buy.satsIn > shard.satoshis) break;
      const profit = sell.satsOut - buy.satsIn - fee - MINER_FEE;
      if (!best || profit > best.profit) best = { x, profit, buy, sell, shard, fee };
    }
  }
  if (!best || best.profit <= (opts.minProfit ?? 0n)) throw new Error(best ? `best flash arbitrage nets ${best.profit} sats after vault fee and miner fee (need > ${opts.minProfit ?? 0n})` : 'no usable vault shard');
  const { x, buy, sell, shard, fee, profit } = best;
  const st = decodeVaultState(shard.token!.nft!.commitment);
  const c = owner.feeCoin;
  if (c.token) throw new Error('fee coin must be a plain BCH coin');
  return {
    profit, tokens: x,
    template: {
      version: 2, locktime: 0,
      inputs: [
        { txid: shard.txid, vout: shard.vout, satoshis: shard.satoshis, token: shard.token, lockingBytecode: m.vault.lockingBytecode, role: 'vault', unlock: { kind: 'flashvault-bch', params: m.vault.params, fn: 'flash' } },
        { ...cheap.utxo, lockingBytecode: cheap.lockingBytecode, role: 'pool', unlock: { kind: 'cauldron-pool', ownerPkh: cheap.ownerPkh } },
        { ...rich.utxo, lockingBytecode: rich.lockingBytecode, role: 'pool', unlock: { kind: 'cauldron-pool', ownerPkh: rich.ownerPkh } },
        { ...c, lockingBytecode: owner.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } },
      ],
      outputs: [
        { lockingBytecode: m.vault.lockingBytecode, satoshis: shard.satoshis + fee, token: { category: m.vault.params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState(nextVaultState(st, fee)) } }, role: 'vault-continuation' },
        { lockingBytecode: cheap.lockingBytecode, satoshis: buy.newSats, token: { category: m.token, amount: buy.newTokens }, role: 'pool' },
        { lockingBytecode: rich.lockingBytecode, satoshis: sell.newSats, token: { category: m.token, amount: sell.newTokens }, role: 'pool' },
        { lockingBytecode: owner.lockingBytecode, satoshis: c.satoshis + profit, role: 'user', label: 'fee coin + arbitrage profit' },
      ],
    },
    claims: { userReceivesTokens: 0n, userPaysSats: -profit, solverFeeSats: 0n, liquidityFeeSats: fee, minerFeeSats: MINER_FEE },
    explanation: `Borrows a ${shard.satoshis}-sat FlashVault shard, buys ${x} tokens on ${cheap.id}, sells them into ${rich.id}, repays principal + ${fee} sats fee; owner nets ${profit} sats.`,
  };
}
