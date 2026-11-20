import type { TxTemplate, TokenSpec } from '@fuse/transaction-composer';
import type { BchVaultParams } from '@fuse/contracts';

export interface UtxoView { txid: string; vout: number; satoshis: bigint; token?: TokenSpec }
export interface PoolView { id: string; ownerPkh: string; lockingBytecode: string; utxo: UtxoView }
export interface ShardView extends UtxoView { shardId: string }
export interface MarketView {
  network: 'local' | 'chipnet' | 'mainnet';
  simulated: boolean;
  token: string;
  vault: { params: BchVaultParams; lockingBytecode: string; shards: ShardView[] };
  pools: PoolView[];
}

export interface SwapIntentView {
  auctionId: string;
  intentId: string;
  intentCommitment: string;
  type: 'TOKEN_SWAP';
  owner: { lockingBytecode: string; coins: UtxoView[] };
  buyToken: string;
  minOut: bigint;
  maxIn: bigint;
  maxFee: bigint;
  deadline: number;
}

export interface Bid {
  auctionId: string;
  solverId: string;
  solverPubkey: string;
  strategy: 'DIRECT_LIQUIDITY' | 'ROUTING' | 'FLASH_LIQUIDITY' | 'ADVERSARIAL_FIXTURE';
  executionClass: 'ATOMIC_SINGLE_TX';
  template: TxTemplate;
  claims: { userReceivesTokens: bigint; userPaysSats: bigint; solverFeeSats: bigint; liquidityFeeSats: bigint; minerFeeSats: bigint };
  explanation: string;
  expiresAt: number;
  nonce: string;
  templateHash: string;
  signature: string;
}
