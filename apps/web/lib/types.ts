export type Role = 'vault' | 'vault-continuation' | 'pool' | 'wallet' | 'user' | 'solver' | 'change' | string;
export interface TIn { txid: string; vout: number; satoshis: bigint; token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } }; lockingBytecode: string; role: Role; unlock: { kind: string; signer?: string } }
export interface TOut { lockingBytecode: string; satoshis: bigint; token?: { category: string; amount: bigint; nft?: { capability: string; commitment: string } }; role: Role; label?: string }
export interface Template { version: number; locktime: number; inputs: TIn[]; outputs: TOut[] }
export interface BidRow {
  solverId: string; strategy: string; valid: boolean | null; reasons?: string[]; rank?: number; winner?: boolean; explanation: string; templateHash: string; template?: Template;
  claims: { userReceivesTokens: bigint; userPaysSats: bigint; solverFeeSats: bigint; liquidityFeeSats: bigint; minerFeeSats: bigint };
  actual?: { userReceivesTokens: bigint; userNetSpendSats: bigint; minerFeeSats: bigint };
  verification?: { ok: boolean; txid: string; checks: Array<{ name: string; ok: boolean; detail: string }> };
}
export interface Auction { auctionId: string; status: string; openedAt: number; closesAt: number; intent: { intentId: string; minOut: bigint; maxIn: bigint; maxFee: bigint; deadline: number; buyToken: string }; error?: string; txid?: string; certificateId?: string; events: Array<{ at: number; type: string; detail: string }>; bids: BidRow[]; simulated: true; network: 'local' }
export interface Solver { solverId: string; pubkey: string; strategy: string; name: string; bids: number; wins: number; rejected: number; revenueSats: bigint; registeredAt: number }
export interface Vault { address: string; lockingBytecode: string; params: { feeBps: bigint; minFee: bigint; maxExposure: bigint; vaultCategory: string; ownerPkh: string }; shards: Array<{ outpoint: string; satoshis: bigint; state: { flashCount: bigint; cumulativeFees: bigint; paused: boolean } }>; totalSats: bigint; cumulativeFees: bigint; flashCount: bigint }
export interface FuseEvent { id: number; at: number; type: string; detail: string; auctionId?: string }
