// X01 Cross-intent netting: a buy intent and an opposite sell intent for the same CashToken are matched
// peer-to-peer in ONE transaction at the best pool's mid price. Neither side pays AMM fees or price
// impact on the netted size; the unmatched residual is reported for normal routing.
import { cauldronBuyQuote, cauldronSellQuote } from '@fuse/contracts';
import { FuseError } from '@fuse/core';
import type { TxTemplate } from '@fuse/transaction-composer';
import type { MarketView, UtxoView } from '@fuse/solver-sdk';

export interface BuySide { id: string; lockingBytecode: string; coins: UtxoView[]; wantTokens: bigint; maxPaySats: bigint }
export interface SellSide { id: string; lockingBytecode: string; tokenCoins: UtxoView[]; sellTokens: bigint; minReceiveSats: bigint }
export interface NetResult { template: TxTemplate; matched: bigint; priceSatsPerToken: { num: bigint; den: bigint }; buyerPays: bigint; sellerReceives: bigint; residual: { buy: bigint; sell: bigint }; savings: { buyerSats: bigint; sellerSats: bigint }; minerFee: bigint }

const MINER_FEE = 1_500n, DUST = 1_000n;

export function netSwapIntents(m: MarketView, buy: BuySide, sell: SellSide): NetResult {
  const matched = buy.wantTokens < sell.sellTokens ? buy.wantTokens : sell.sellTokens;
  if (matched <= 0n) throw new FuseError('NO_MATCH', 'nothing to net', false);
  // reference mid price = best (lowest) pool spot sats/token among pools; exact rational, payment rounds up for the seller
  const ref = [...m.pools].sort((a, b) => (a.utxo.satoshis * b.utxo.token!.amount < b.utxo.satoshis * a.utxo.token!.amount ? -1 : 1))[0];
  const num = ref.utxo.satoshis, den = ref.utxo.token!.amount;
  const pay = (matched * num + den - 1n) / den;
  if (pay > buy.maxPaySats) throw new FuseError('PRICE', `netted price ${pay} > buyer max ${buy.maxPaySats}`, false);
  if (pay < sell.minReceiveSats * matched / sell.sellTokens) throw new FuseError('PRICE', 'netted price below seller minimum', false);
  const bc = [...buy.coins].filter((c) => !c.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  if (!bc || bc.satoshis < pay + DUST + MINER_FEE + 546n) throw new FuseError('INSUFFICIENT_FUNDS', 'buyer coin too small', false);
  const category = m.token;
  const sc = sell.tokenCoins.find((c) => c.token?.category === category && c.token.amount >= matched);
  if (!sc) throw new FuseError('INSUFFICIENT_FUNDS', 'seller has no token coin covering the match', false);
  const tokenChange = sc.token!.amount - matched;
  const outputs: TxTemplate['outputs'] = [
    { lockingBytecode: buy.lockingBytecode, satoshis: DUST, token: { category, amount: matched }, role: 'user', label: `${buy.id}: netted tokens` },
    { lockingBytecode: sell.lockingBytecode, satoshis: pay + (tokenChange > 0n ? sc.satoshis - DUST : sc.satoshis), role: 'counterparty', label: `${sell.id}: payment` },
  ];
  if (tokenChange > 0n) outputs.push({ lockingBytecode: sell.lockingBytecode, satoshis: DUST, token: { category, amount: tokenChange }, role: 'counterparty', label: `${sell.id}: token change` });
  outputs.push({ lockingBytecode: buy.lockingBytecode, satoshis: bc.satoshis - pay - DUST - MINER_FEE, role: 'change' });
  const template: TxTemplate = { version: 2, locktime: 0, inputs: [
    { ...bc, lockingBytecode: buy.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'buyer' } },
    { ...sc, lockingBytecode: sell.lockingBytecode, role: 'counterparty', unlock: { kind: 'p2pkh', signer: 'seller' } },
  ], outputs };
  // What each side would get via the pool for the same size (exact Cauldron quotes)
  const viaPoolBuy = cauldronBuyQuote(ref.utxo.satoshis, ref.utxo.token!.amount, matched).satsIn;
  const richest = [...m.pools].sort((a, b) => (a.utxo.satoshis * b.utxo.token!.amount > b.utxo.satoshis * a.utxo.token!.amount ? -1 : 1))[0];
  const viaPoolSell = cauldronSellQuote(richest.utxo.satoshis, richest.utxo.token!.amount, matched).satsOut;
  return { template, matched, priceSatsPerToken: { num, den }, buyerPays: pay, sellerReceives: pay, residual: { buy: buy.wantTokens - matched, sell: sell.sellTokens - matched }, savings: { buyerSats: viaPoolBuy - pay, sellerSats: pay - viaPoolSell }, minerFee: MINER_FEE };
}
