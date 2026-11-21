// LIVE FlashVaultBCH tracking on mainnet. A vault is identified by its identity-NFT category; starting from the
// genesis outpoint the tracker follows each spend to the output that carries the NFT (the covenant always keeps it
// at the same index), until it finds the unspent tip or the NFT is burned (vault closed by its owner).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { binToHex, hexToBin, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { decodeVaultState, type BchVaultParams } from '@fuse/contracts';
import { contractLockingBytecode } from '@fuse/transaction-composer';
import { outspend, decoded, outputAt, tokenOf } from './chain.js';

export interface VaultConfig { id: string; label: string; status: 'active' | 'closed'; genesisTxid: string; category: string; owner: string; params: { feeBps: string; minFee: string; maxExposure: string; ownerPkh: string } }
export interface VaultHop { txid: string; vout: number; satoshis: bigint; commitment: string | null; kind: 'genesis' | 'flash' | 'flash+cauldron' | 'deposit' | 'withdraw' | 'closed' | 'other'; flashCount?: bigint; cumulativeFees?: bigint }
const PUSD = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';

export function loadVaultConfigs(root: string): VaultConfig[] {
  const env = process.env.FUSE_LIVE_VAULTS;
  if (env) return JSON.parse(env) as VaultConfig[];
  for (const f of [resolve(root, 'evidence/mainnet/live-vaults.json'), resolve(root, 'evidence/live-vaults.json')]) if (existsSync(f)) return (JSON.parse(readFileSync(f, 'utf8')) as { vaults: VaultConfig[] }).vaults;
  return [];
}
export const paramsOfConfig = (c: VaultConfig): BchVaultParams => ({ vaultCategory: c.category, feeBps: BigInt(c.params.feeBps), minFee: BigInt(c.params.minFee), maxExposure: BigInt(c.params.maxExposure), ownerPkh: c.params.ownerPkh });
export const vaultLb = (p: BchVaultParams) => contractLockingBytecode({ kind: 'flashvault-bch', params: p, fn: 'flash' })!;
export const cashaddr = (lb: string, tokenSupport = false) => { const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(lb), prefix: 'bitcoincash', tokenSupport } as never); return typeof r === 'string' ? r : (r as { address: string }).address; };

const next = new Map<string, { at: number; hop: VaultHop }>(); // outpoint → hop that spent it (immutable once seen)
export interface TrackedVault { checkedAt: string; id: string; label: string; configuredStatus: string; category: string; owner: string; address: string; lockingBytecode: string; params: { feeBps: bigint; minFee: bigint; maxExposure: bigint; ownerPkh: string }; open: boolean; current: { txid: string; vout: number; satoshis: bigint; commitment: string; state: ReturnType<typeof decodeVaultState> } | null; history: VaultHop[] }
const cache = new Map<string, { at: number; value: TrackedVault }>();

export async function trackVault(c: VaultConfig): Promise<TrackedVault> {
  const hit = cache.get(c.id); if (hit && Date.now() - hit.at < 12_000) return hit.value;
  const p = paramsOfConfig(c); const lb = vaultLb(p);
  const g = await outputAt(c.genesisTxid, 0);
  const deadline = Date.now() + 25_000;
  const hops: VaultHop[] = [{ txid: c.genesisTxid, vout: 0, satoshis: g.satoshis, commitment: g.token?.nft?.commitment ?? null, kind: 'genesis', ...(g.token?.nft ? decodeVaultState(g.token.nft.commitment) : {}) }];
  if (g.lockingBytecode !== lb || g.token?.category !== c.category) throw new Error(`genesis output does not match vault ${c.id} (script or category)`);
  for (let i = 0; i < 500; i++) {
    const cur = hops[hops.length - 1];
    if (cur.kind === 'closed') break;
    const key = `${cur.txid}:${cur.vout}`;
    if (Date.now() > deadline || i === 499) throw Object.assign(new Error('Vault history read exceeded its budget. Retry shortly.'), {statusCode: 503});
    const cached = next.get(key);
    let n: VaultHop | 'unspent' | undefined = cached && Date.now() - cached.at < 30_000 ? cached.hop : undefined;
    if (!n) {
      const sp = await outspend(cur.txid, cur.vout);
      if (!sp.spent || !sp.txid) { n = 'unspent'; }
      else {
        const tx = await decoded(sp.txid);
        if (!tx.inputs.some(input => binToHex(input.outpointTransactionHash) === cur.txid && input.outpointIndex === cur.vout)) throw new Error('Vault history has an unrelated spend');
        const idx = tx.outputs.findIndex((o) => o.token?.nft && binToHex(o.token.category) === c.category);
        if (idx < 0) n = { txid: sp.txid, vout: -1, satoshis: 0n, commitment: null, kind: 'closed' };
        else {
          const o = tx.outputs[idx]; const t = tokenOf(o)!; const s = decodeVaultState(t.nft!.commitment); const prev = cur.commitment ? decodeVaultState(cur.commitment) : null;
          const viaPools = tx.outputs.some((x) => x.token && !x.token.nft && binToHex(x.token.category) === PUSD);
          const kind: VaultHop['kind'] = binToHex(o.lockingBytecode) !== lb ? 'other' : prev && s.flashCount > prev.flashCount ? (viaPools ? 'flash+cauldron' : 'flash') : o.valueSatoshis > cur.satoshis ? 'deposit' : o.valueSatoshis < cur.satoshis ? 'withdraw' : 'other';
          n = { txid: sp.txid, vout: idx, satoshis: o.valueSatoshis, commitment: t.nft!.commitment, kind, ...s };
        }
        next.set(key, { at: Date.now(), hop: n });
      }
      if (n === 'unspent') { /* never cache the tip */ }
    }
    if (n === 'unspent') break;
    hops.push(n);
  }
  const last = hops[hops.length - 1];
  const value: TrackedVault = {
    checkedAt: new Date().toISOString(), id: c.id, label: c.label, configuredStatus: c.status, category: c.category, owner: c.owner, address: cashaddr(lb, true), lockingBytecode: lb,
    params: { feeBps: p.feeBps, minFee: p.minFee, maxExposure: p.maxExposure, ownerPkh: p.ownerPkh },
    open: last.kind !== 'closed',
    current: last.kind === 'closed' ? null : { txid: last.txid, vout: last.vout, satoshis: last.satoshis, commitment: last.commitment!, state: decodeVaultState(last.commitment!) },
    history: hops,
  };
  cache.set(c.id, { at: Date.now(), value });
  return value;
}
