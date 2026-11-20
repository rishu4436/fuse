import type { MarketView, SwapIntentView, SolverIdentity } from '@fuse/solver-sdk';
import { solverIdOf } from '@fuse/solver-sdk';
import { binToHex } from '@bitauth/libauth';
import type { LocalMarket } from './local-market.js';

export function marketViewOf(m: LocalMarket): MarketView {
  return {
    network: 'local', simulated: true, token: m.token,
    vault: { params: m.vaultParams, lockingBytecode: m.vault.lockingBytecode, shards: m.shards.map((s) => ({ txid: s.txid, vout: s.vout, satoshis: s.satoshis, token: s.token as never, shardId: `${s.txid}:${s.vout}` })) },
    pools: [
      { id: 'pool-A', ownerPkh: m.pools.A.ownerPkh, lockingBytecode: m.pools.A.contract.lockingBytecode, utxo: { ...m.pools.A.utxo, token: m.pools.A.utxo.token as never } },
      { id: 'pool-B', ownerPkh: m.pools.B.ownerPkh, lockingBytecode: m.pools.B.contract.lockingBytecode, utxo: { ...m.pools.B.utxo, token: m.pools.B.utxo.token as never } },
    ],
  };
}

export function swapIntentOf(m: LocalMarket, minOut = 30_000n, maxIn = 40_000_000n, now = Math.floor(Date.now() / 1000)): Omit<SwapIntentView, 'auctionId'> {
  return { intentId: 'intent_demo_swap_0001', intentCommitment: '00'.repeat(32), type: 'TOKEN_SWAP', owner: { lockingBytecode: m.user.lockingBytecode, coins: [{ txid: m.userCoin.txid, vout: m.userCoin.vout, satoshis: m.userCoin.satoshis }] }, buyToken: m.token, minOut, maxIn, maxFee: 20_000n, deadline: now + 600 };
}

export function solverIdentity(m: LocalMarket, k: keyof LocalMarket['solvers']): SolverIdentity & { priv: Uint8Array } {
  const s = m.solvers[k];
  const pubkey = binToHex(s.pub);
  return { id: solverIdOf(pubkey), pubkey, lockingBytecode: s.lockingBytecode, priv: s.priv, coins: [{ txid: m.solverCoins[k].txid, vout: m.solverCoins[k].vout, satoshis: m.solverCoins[k].satoshis }], inventory: k === 'direct' ? [{ txid: m.directInventory.txid, vout: m.directInventory.vout, satoshis: m.directInventory.satoshis, token: m.directInventory.token as never }] : [] };
}

/** Market view rebuilt from the CURRENT state of the local mock chain (after settlements). */
export async function liveMarketView(m: LocalMarket): Promise<MarketView> {
  const p = m.provider;
  const shards = (await p.getUtxos(m.vault.tokenAddress)).filter((u) => u.token?.category === m.vaultParams.vaultCategory && u.token.nft);
  const pool = async (id: string, k: 'A' | 'B') => {
    const u = (await p.getUtxos(m.pools[k].contract.tokenAddress)).find((x) => x.token?.category === m.token)!;
    return { id, ownerPkh: m.pools[k].ownerPkh, lockingBytecode: m.pools[k].contract.lockingBytecode, utxo: { txid: u.txid, vout: u.vout, satoshis: u.satoshis, token: u.token as never } };
  };
  return {
    network: 'local', simulated: true, token: m.token,
    vault: { params: m.vaultParams, lockingBytecode: m.vault.lockingBytecode, shards: shards.map((s) => ({ txid: s.txid, vout: s.vout, satoshis: s.satoshis, token: s.token as never, shardId: `${s.txid}:${s.vout}` })) },
    pools: [await pool('pool-A', 'A'), await pool('pool-B', 'B')],
  };
}

export async function utxosOf(m: LocalMarket, address: string) {
  return (await m.provider.getUtxos(address)).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, token: u.token as never }));
}
