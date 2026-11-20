// The full mainnet test plan, run offline: same builders and caps as scripts/mainnet, a fixture key, fake funding
// coin, every tx VM-verified, chained by real txids. Nothing touches a network.
import { describe, it, expect } from 'vitest';
import { hexToBin } from '@bitauth/libauth';
import { verifyCertificate, type ChainReader } from '@fuse/proof-verifier';
import * as P from '../scripts/mainnet/plan.js';

const priv = new Uint8Array(32).fill(0x2a);
const op = P.operatorOf(P.pubOf(priv));
const fund: P.Coin = { txid: 'ab'.repeat(32), vout: 1, satoshis: 60_000n };

describe('mainnet plan (offline rehearsal)', () => {
  it('prep → genesis → flash → underpay(rejected) → deposit → withdraw → certificate → sweep, within caps', async () => {
    const raws = new Map<string, string>(); let fees = 0n;
    const step = (b: (fee: bigint) => Parameters<typeof P.verifyLocal>[0], vaultLb: string | null | (() => string)) => { const s = P.sized(b, priv); const r = P.verifyLocal(s.template, s.raw, op, typeof vaultLb === 'function' ? vaultLb() : vaultLb); expect(r.ok, JSON.stringify(r.checks.filter((c) => !c.ok))).toBe(true); expect(s.fee).toBeLessThanOrEqual(P.CAPS.maxFeePerTx); raws.set(s.txid, s.raw); fees += s.fee; console.log(`fee ${s.fee} size ${s.raw.length / 2}`); return s; };
    const prep = step((f) => P.buildPrep([fund], op, f), null);
    let params!: ReturnType<typeof P.vaultParams>;
    const gen = step((f) => { const g = P.buildGenesis({ txid: prep.txid, vout: 0, satoshis: prep.template.outputs[0].satoshis }, op, P.DEFAULTS.principal, f); params = g.params; return g.template; }, () => P.vaultLockingBytecode(params));
    expect(params.vaultCategory).toBe(prep.txid);
    expect(P.vaultAddress(params)).toMatch(/^bitcoincash:r/);
    const lb = P.vaultLockingBytecode(params);
    const vaultAt = (s: { txid: string; template: { outputs: Array<{ satoshis: bigint; token?: { nft?: { commitment: string } } }> } }) => ({ txid: s.txid, vout: 0, satoshis: s.template.outputs[0].satoshis, commitment: s.template.outputs[0].token!.nft!.commitment });
    const changeAt = (s: { txid: string; template: { outputs: Array<{ satoshis: bigint }> } }, vout = 1) => ({ txid: s.txid, vout, satoshis: s.template.outputs[vout].satoshis });
    const flash = step((f) => P.buildFlash(vaultAt(gen), params, changeAt(gen), op, f), lb);
    expect(flash.template.outputs[0].satoshis).toBe(P.DEFAULTS.principal + P.flashFee(params, P.DEFAULTS.principal));
    // underpaying by 1 sat must fail in the VM
    const bad = P.sized((f) => P.buildFlash(vaultAt(flash), params, changeAt(flash), op, f, 1n), priv);
    expect(P.verifyLocal(bad.template, bad.raw, op, lb).ok).toBe(false);
    const dep = step((f) => P.buildDeposit(vaultAt(flash), params, changeAt(flash), op, P.DEFAULTS.deposit, f), lb);
    const wd = step((f) => P.buildWithdraw(vaultAt(dep), params, op, P.DEFAULTS.withdraw, f), lb);
    // certificate of the flash, verified against a reader that only knows raw txs (as an indexer would)
    const reader: ChainReader = { network: 'mainnet', getRawTransaction: async (t) => (raws.has(t) ? { rawHex: raws.get(t)!, blockHeight: 978_200, blockHash: '00'.repeat(32) } : null), tipHeight: async () => 978_205 };
    const cert = P.flashCertificate(flash.template, flash.txid, op, params, { minerFee: flash.fee, blockHeight: 978_200, blockHash: '00'.repeat(32), issuedAt: 1_795_200_000 });
    expect((await verifyCertificate(cert, reader)).status).toBe('VERIFIED');
    // the CLI path: rebuild the template purely from chain raws, re-seal, verify
    const fromChain = await P.templateFromChain(raws.get(flash.txid)!, async (t) => raws.get(t)!, op);
    expect(fromChain.outputs.map((o) => [o.lockingBytecode, o.satoshis, o.token?.category])).toEqual(flash.template.outputs.map((o) => [o.lockingBytecode, o.satoshis, o.token?.category]));
    const cert2 = P.flashCertificate(fromChain, flash.txid, op, params, { minerFee: flash.fee, blockHeight: 978_200, blockHash: '00'.repeat(32), issuedAt: 1_795_200_000 });
    expect((await verifyCertificate(cert2, reader)).status).toBe('VERIFIED');
    const forged = { ...cert, outputs: cert.outputs.map((o, i) => (i === 0 ? { ...o, satoshis: o.satoshis + 1n } : o)) };
    expect((await verifyCertificate(forged, reader)).status).toBe('FAILED');
    const sweep = step((f) => P.buildSweep(vaultAt(wd), params, [changeAt(dep), changeAt(wd)], op, f), null);
    // everything returns to the wallet except miner fees
    const back = sweep.template.outputs[0].satoshis;
    expect(fund.satoshis - back).toBe(fees);
    expect(fees).toBeLessThan(10_000n);
    expect(hexToBin(sweep.raw).length).toBeGreaterThan(0);
  });
  it('refuses out-of-range principals and fees above the cap', () => {
    expect(() => P.buildGenesis({ ...fund, vout: 0 }, op, 60_000n, 500n)).toThrow(/principal/);
    expect(() => P.buildGenesis({ ...fund, vout: 1 }, op, 20_000n, 500n)).toThrow(/index 0/);
    expect(() => P.sized((f) => P.buildPrep([fund], op, f), priv, 100n)).toThrow(/cap/);
  });
});
