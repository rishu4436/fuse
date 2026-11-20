// Deterministic LOCAL-network market fixture (MockNetworkProvider + real contract bytecode).
// Everything here is SIMULATED: UTXOs are fabricated test fixtures, never mainnet data.
import { MockNetworkProvider, randomUtxo, type Utxo } from 'cashscript';
import { secp256k1, hash160, binToHex, encodeCashAddress, sha256, utf8ToBin } from '@bitauth/libauth';
import { bchVaultContract, cauldronPoolContract, encodeVaultState, type BchVaultParams } from '@fuse/contracts';
import type { TemplateInput, TokenSpec } from '@fuse/transaction-composer';

/** Deterministic test key derived from a label. TEST ONLY — never fund with real coins. */
export function fixtureKey(label: string) {
  const priv = sha256.hash(utf8ToBin(`fuse-local-fixture:${label}`));
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = binToHex(hash160(pub));
  return { label, priv, pub, pkh, lockingBytecode: `76a914${pkh}88ac`, address: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkhWithTokens', payload: hash160(pub) }).address };
}

const fixedTxid = (label: string) => binToHex(sha256.hash(utf8ToBin(`fuse-fixture-utxo:${label}`)));

export const TOKEN = binToHex(sha256.hash(utf8ToBin('fuse-local-fixture-token:FUSD')));

export function createLocalMarket() {
  const provider = new MockNetworkProvider();
  const lp = fixtureKey('lp');
  const user = fixtureKey('user');
  const solvers = { direct: fixtureKey('solver-direct'), routing: fixtureKey('solver-routing'), flash: fixtureKey('solver-flash'), rogue: fixtureKey('solver-rogue') };
  const vaultParams: BchVaultParams = { vaultCategory: fixedTxid('vault-identity'), feeBps: 9n, minFee: 1_000n, maxExposure: 200_000_000n, ownerPkh: lp.pkh };
  const vault = bchVaultContract(vaultParams, provider);
  const poolOwnerA = fixtureKey('pool-owner-a'), poolOwnerB = fixtureKey('pool-owner-b');
  const poolA = cauldronPoolContract(poolOwnerA.pkh, provider);
  const poolB = cauldronPoolContract(poolOwnerB.pkh, provider);
  const add = (address: string, label: string, satoshis: bigint, token?: Utxo['token']) => provider.addUtxo(address, { ...randomUtxo({ satoshis, ...(token ? { token } : {}) }), txid: fixedTxid(label), vout: 0 });
  const shards = [
    add(vault.tokenAddress, 'shard-1', 50_000_000n, { category: vaultParams.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: false }) } }),
    add(vault.tokenAddress, 'shard-2', 20_000_000n, { category: vaultParams.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: false }) } }),
    add(vault.tokenAddress, 'shard-3', 5_000_000n, { category: vaultParams.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: false }) } }),
  ];
  const pools = {
    A: { contract: poolA, ownerPkh: poolOwnerA.pkh, utxo: add(poolA.tokenAddress, 'pool-a', 1_000_000_000n, { category: TOKEN, amount: 1_000_000n }) },
    B: { contract: poolB, ownerPkh: poolOwnerB.pkh, utxo: add(poolB.tokenAddress, 'pool-b', 1_150_000_000n, { category: TOKEN, amount: 1_000_000n }) },
  };
  const userCoin = add(user.address, 'user-coin', 1_000_000_000n);
  const solverCoins = Object.fromEntries(Object.entries(solvers).map(([k, s]) => [k, add(s.address, `solver-coin-${k}`, 5_000_000n)])) as Record<keyof typeof solvers, Utxo>;
  const directInventory = add(solvers.direct.address, 'direct-inventory', 1_000n, { category: TOKEN, amount: 200_000n });
  return { provider, lp, user, solvers, vault, vaultParams, shards, pools, userCoin, solverCoins, directInventory, token: TOKEN };
}

export type LocalMarket = ReturnType<typeof createLocalMarket>;

export function asTemplateInput(u: Utxo, lockingBytecode: string, role: TemplateInput['role'], unlock: TemplateInput['unlock']): TemplateInput {
  return { txid: u.txid, vout: u.vout, satoshis: u.satoshis, token: u.token as TokenSpec | undefined, lockingBytecode, role, unlock };
}
