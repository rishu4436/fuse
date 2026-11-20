import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, type Utxo, type SpendableUtxo } from 'cashscript';
import { secp256k1, hash160, binToHex, encodeCashAddress, generatePrivateKey } from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';
import { bchVaultContract, tokenVaultContract, encodeVaultState, flashFee, type BchVaultParams, type TokenVaultParams } from '../src/index.js';

/** Ephemeral in-memory test key. Never persisted, never funded with real coins. */
export function testKey() {
  const priv = generatePrivateKey(() => new Uint8Array(randomBytes(32)));
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pub);
  const address = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkhWithTokens', payload: pkh }).address;
  return { priv, pub, pkh: binToHex(pkh), address, sig: new SignatureTemplate(priv) };
}

export const randomHex32 = () => randomBytes(32).toString('hex');

export function setupBchVault(over: Partial<BchVaultParams> = {}, shardValue = 1_000_000n) {
  const provider = new MockNetworkProvider();
  const owner = testKey();
  const borrower = testKey();
  const params: BchVaultParams = {
    vaultCategory: randomHex32(),
    feeBps: 30n,
    minFee: 1_000n,
    maxExposure: 50_000_000n,
    ownerPkh: owner.pkh,
    ...over,
  };
  const vault = bchVaultContract(params, provider);
  const state = encodeVaultState({ flashCount: 0n, cumulativeFees: 0n, paused: false });
  const shard: SpendableUtxo = addSpendable(provider, vault.tokenAddress, randomUtxo({
    satoshis: shardValue,
    token: { category: params.vaultCategory, amount: 0n, nft: { capability: 'mutable', commitment: state } },
  }));
  const funding: SpendableUtxo = addSpendable(provider, borrower.address, randomUtxo({ satoshis: 200_000n }));
  const fee = flashFee(shardValue, params.feeBps, params.minFee);
  return { provider, owner, borrower, params, vault, shard, funding, fee };
}

export function setupTokenVault(over: Partial<TokenVaultParams> = {}, shardTokens = 1_000_000n) {
  const provider = new MockNetworkProvider();
  const owner = testKey();
  const borrower = testKey();
  const params: TokenVaultParams = {
    assetCategory: randomHex32(),
    feeBps: 30n,
    minFee: 10n,
    maxExposure: 100_000_000n,
    ownerPkh: owner.pkh,
    ...over,
  };
  const vault = tokenVaultContract(params, provider);
  const shard: SpendableUtxo = addSpendable(provider, vault.tokenAddress, randomUtxo({ satoshis: 2_000n, token: { category: params.assetCategory, amount: shardTokens } }));
  const funding: SpendableUtxo = addSpendable(provider, borrower.address, randomUtxo({ satoshis: 200_000n }));
  const borrowerTokens: SpendableUtxo = addSpendable(provider, borrower.address, randomUtxo({ satoshis: 1_000n, token: { category: params.assetCategory, amount: 50_000n } }));
  const fee = flashFee(shardTokens, params.feeBps, params.minFee);
  return { provider, owner, borrower, params, vault, shard, funding, borrowerTokens, fee };
}

export const builder = (provider: MockNetworkProvider) => new TransactionBuilder({ provider });

/** MockNetworkProvider.addUtxo sets lockingBytecode at runtime but is typed as Utxo; narrow it. */
export function addSpendable(provider: MockNetworkProvider, address: string, utxo: Utxo): SpendableUtxo {
  const u = provider.addUtxo(address, utxo);
  if (!u.lockingBytecode) throw new Error('mock provider did not attach lockingBytecode');
  return u as SpendableUtxo;
}
export async function spendableUtxos(provider: MockNetworkProvider, address: string): Promise<SpendableUtxo[]> {
  return (await provider.getUtxos(address)) as SpendableUtxo[];
}
