/* eslint-disable @typescript-eslint/no-explicit-any -- test forges raw libauth structures */
// Review issue B: the verifier re-derives contract-specific claims from chain data; forged claims fail.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTransaction, encodeTransaction, hexToBin, binToHex, hash256 } from '@bitauth/libauth';
import { verifyCertificate, sealCertificate, CertificateSchema, type ChainReader } from '@fuse/proof-verifier';
import { liveRederiver } from '../src/live/verify.js';
import { loadVaultConfigs } from '../src/live/vault.js';

const root = join(__dirname, '../../..');
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures/mainnet-txs.json'), 'utf8'));
const configs = loadVaultConfigs(root);
const readerWith = (extra: Record<string, string> = {}): ChainReader => ({
  network: 'mainnet', tipHeight: async () => fx.tip,
  getRawTransaction: async (t) => (extra[t] ? { rawHex: extra[t], blockHeight: fx.tip - 5, blockHash: '00'.repeat(32) } : fx.txs[t] ?? null),
});
const evidence = (t: string) => JSON.parse(readFileSync(join(root, `evidence/mainnet/certificates/${t}.json`), 'utf8'));
const CAULDRON = '994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f';
const FLASH = '7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79';
const opts = () => ({ rederive: liveRederiver(configs) });
const unsigned = (c: unknown) => { const { commitment: _c, ...rest } = CertificateSchema.parse(c); return rest; };

/** Forge a different (VM-invalid but well-formed) transaction plus a certificate that faithfully describes its structure
 *  while CLAIMING every contract check passed. Structure verification passes; only rederivation can catch it. */
function forge(txid: string, edit: (outs: any[]) => void, editCert: (c: any) => void = () => {}) {
  const tx = decodeTransaction(hexToBin(fx.txs[txid].rawHex)) as any;
  edit(tx.outputs);
  const raw = binToHex(encodeTransaction(tx)); const id = binToHex(hash256(hexToBin(raw)).reverse());
  const c: any = unsigned(evidence(txid).certificate);
  c.transactions = [{ txid: id, blockHeight: fx.tip - 5, blockHash: '00'.repeat(32) }];
  c.inputs = c.inputs.map((i: any) => ({ ...i, txid: id }));
  c.outputs = c.outputs.map((o: any, v: number) => ({ ...o, txid: id, satoshis: tx.outputs[v].valueSatoshis }));
  c.vaultContinuations = c.vaultContinuations.map((v: any) => ({ ...v, txid: id }));
  c.outcome.ownerReceives = c.outputs.filter((o: any) => o.lockingBytecode === c.outcome.ownerLockingBytecode).slice(0, 1).map((o: any) => ({ asset: 'BCH', amount: o.satoshis }));
  editCert(c);
  return { cert: sealCertificate(c), reader: readerWith({ [id]: raw }) };
}

describe('certificate verification levels (issue B)', () => {
  it('real mainnet Cauldron flash re-derives to OUTCOME_VERIFIED (not INTENT_BOUND: no authorization)', async () => {
    const v = await verifyCertificate(evidence(CAULDRON).certificate, readerWith(), opts());
    expect(v.status).toBe('VERIFIED'); expect(v.level).toBe('OUTCOME_VERIFIED');
    expect(v.levels.INTENT_BOUND.ok).toBe(false);
    expect(v.checks.filter((c) => c.name.startsWith('rederived:cauldron-invariant')).length).toBeGreaterThan(0);
  });
  it('without a rederiver the same certificate stops at STRUCTURE_VERIFIED', async () => {
    const v = await verifyCertificate(evidence(CAULDRON).certificate, readerWith());
    expect(v.level).toBe('STRUCTURE_VERIFIED');
  });
  it('forged pool drain: claim cauldron-invariant ok:true but chain data violates k → FAILED', async () => {
    const { cert, reader } = forge(CAULDRON, (outs) => {
      const pool = outs.findIndex((o: any) => o.token && !o.token.nft && binToHex(o.token.category).startsWith('2469acc5'));
      const owner = outs.findIndex((o: any) => !o.token && binToHex(o.lockingBytecode).startsWith('76a914'));
      outs[pool].valueSatoshis -= 5000n; outs[owner].valueSatoshis += 5000n;
    });
    expect(cert.checks.find((c) => c.name.startsWith('cauldron-invariant'))!.ok).toBe(true); // the forged claim
    const v = await verifyCertificate(cert, reader, opts());
    expect(v.levels.STRUCTURE_VERIFIED.ok).toBe(true);
    expect(v.status).toBe('FAILED'); expect(v.levels.OUTCOME_VERIFIED.ok).toBe(false);
    expect(v.checks.find((c) => c.name.startsWith('rederived:cauldron-invariant'))!.ok).toBe(false);
  });
  it('forged vault repayment: vault short-changed, minReturn lowered, claim vault-repayment ok:true → FAILED', async () => {
    const { cert, reader } = forge(FLASH, (outs) => {
      const vault = outs.findIndex((o: any) => o.token?.nft); const owner = outs.findIndex((o: any) => !o.token && binToHex(o.lockingBytecode).startsWith('76a914'));
      outs[vault].valueSatoshis -= 100n; outs[owner].valueSatoshis += 100n;
    }, (c) => { c.vaultContinuations = c.vaultContinuations.map((v: any) => ({ ...v, minReturn: BigInt(v.minReturn) - 100n })); });
    const v = await verifyCertificate(cert, reader, opts());
    expect(v.levels.STRUCTURE_VERIFIED.ok).toBe(true);
    expect(v.status).toBe('FAILED');
    expect(v.checks.find((c) => c.name === 'rederived:vault-repayment')!.ok).toBe(false);
  });
  it('forged fee accounting: certificate under-reports the liquidity fee → FAILED', async () => {
    const c: any = unsigned(evidence(FLASH).certificate); c.fees.liquidityFee = 1n;
    const v = await verifyCertificate(sealCertificate(c), readerWith(), opts());
    expect(v.status).toBe('FAILED'); expect(v.checks.find((x) => x.name === 'rederived:fee-accounting')!.ok).toBe(false);
  });
  it('a declared claim with ok:false fails the certificate', async () => {
    const c: any = unsigned(evidence(FLASH).certificate); c.checks = [...c.checks, { name: 'slippage-bound', ok: false }];
    const v = await verifyCertificate(sealCertificate(c), readerWith(), opts());
    expect(v.status).toBe('FAILED'); expect(v.checks.some((x) => x.name === 'declared-failed:slippage-bound')).toBe(true);
  });
  it('an unknown custom claim (ok:true) is not trusted: blocks OUTCOME_VERIFIED', async () => {
    const c: any = unsigned(evidence(FLASH).certificate); c.checks = [...c.checks, { name: 'price-improvement-vs-best-pool', ok: true }];
    const v = await verifyCertificate(sealCertificate(c), readerWith(), opts());
    expect(v.level).toBe('STRUCTURE_VERIFIED');
    expect(v.levels.OUTCOME_VERIFIED.detail).toMatch(/price-improvement-vs-best-pool/);
  });
  it('a tampered certificate (commitment mismatch) is FAILED at structure', async () => {
    const c = evidence(FLASH).certificate; const t = { ...c, fees: { ...c.fees, minerFeeSats: '1' } };
    const v = await verifyCertificate(t, readerWith(), opts());
    expect(v.status).toBe('FAILED'); expect(v.levels.STRUCTURE_VERIFIED.ok).toBe(false);
  });
});

import { intentBinder } from '../src/live/verify.js';
const F7 = 'f78074a7addca74462f3d2dc8e08eb66ca14370cf5dfed1a52ed8e37d0003518';
const ATT = '037e044ab06145cc82956a836cb712f0f422a5bc05371e49eabd4936592419401f';
const authEv = JSON.parse(readFileSync(join(root, `evidence/mainnet/authorizations/${F7}.json`), 'utf8'));
describe('INTENT_BOUND (issue B + A)', () => {
  // the f78074a7 certificate is rebuilt from the fixture tx with the generic structure of the evidence certificate
  const certFor = () => { const c: any = unsigned(evidence(FLASH).certificate); return c; };
  const reader = () => readerWith({ [F7]: fx.txs[F7].rawHex });
  async function f7cert() {
    const tx = decodeTransaction(hexToBin(fx.txs[F7].rawHex)) as any;
    const c: any = certFor();
    const parents = tx.inputs.map((i: any) => ({ t: binToHex(i.outpointTransactionHash), v: i.outpointIndex }));
    c.transactions = [{ txid: F7, blockHeight: fx.tip - 5, blockHash: '00'.repeat(32) }];
    c.inputs = parents.map((p: any) => ({ txid: F7, outpoint: `${p.t}:${p.v}` }));
    c.outputs = tx.outputs.map((o: any, v: number) => ({ txid: F7, vout: v, lockingBytecode: binToHex(o.lockingBytecode), satoshis: o.valueSatoshis, ...(o.token ? { token: { category: binToHex(o.token.category), amount: o.token.amount, ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: binToHex(o.token.nft.commitment) } } : {}) } } : {}), role: 'other' }));
    const vault = tx.outputs.findIndex((o: any) => o.token?.nft);
    const fee = c.fees.liquidityFee;
    const vin = decodeTransaction(hexToBin(fx.txs[parents[vault].t].rawHex)) as any;
    c.vaultContinuations = [{ txid: F7, inputIndex: vault, minReturn: vin.outputs[parents[vault].v].valueSatoshis + fee, asset: 'BCH' }];
    const owner = tx.outputs.findIndex((o: any, i: number) => i !== vault && binToHex(o.lockingBytecode).startsWith('76a914'));
    c.outcome = { ownerLockingBytecode: binToHex(tx.outputs[owner].lockingBytecode), ownerReceives: [{ asset: 'BCH', amount: tx.outputs[owner].valueSatoshis }] };
    const ins = await Promise.all(parents.map(async (p: any) => (decodeTransaction(hexToBin(fx.txs[p.t].rawHex)) as any).outputs[p.v].valueSatoshis));
    c.fees = { ...c.fees, minerFeeSats: ins.reduce((a: bigint, b: bigint) => a + b, 0n) - tx.outputs.reduce((a: bigint, o: any) => a + o.valueSatoshis, 0n) };
    return sealCertificate(c);
  }
  it('real mainnet flash f78074a7 + its authorization + wallet signature → INTENT_BOUND', async () => {
    const v = await verifyCertificate(await f7cert(), reader(), { ...opts(), intent: intentBinder({ authorization: authEv.authorization, userSignature: authEv.userSignature, trustedPubkey: ATT }) });
    expect(v.status).toBe('VERIFIED'); expect(v.level).toBe('INTENT_BOUND');
    expect(v.levels.INTENT_BOUND.detail).toMatch(/user wallet signature|wallet/i);
  });
  it('authorization checked against a key other than the published attestation key → FAILED', async () => {
    const v = await verifyCertificate(await f7cert(), reader(), { ...opts(), intent: intentBinder({ authorization: authEv.authorization, userSignature: authEv.userSignature, trustedPubkey: '02' + '11'.repeat(32) }) });
    expect(v.status).toBe('FAILED'); expect(v.levels.INTENT_BOUND.ok).toBe(false);
  });
  it('an authorization for a DIFFERENT transaction does not bind this one → FAILED', async () => {
    const v = await verifyCertificate(evidence(FLASH).certificate, readerWith(), { ...opts(), intent: intentBinder({ authorization: authEv.authorization, userSignature: authEv.userSignature, trustedPubkey: ATT }) });
    expect(v.status).toBe('FAILED'); expect(v.levels.INTENT_BOUND.detail).toMatch(/differs/);
  });
  it('a forged user signature on a valid authorization → FAILED', async () => {
    const bad = { ...authEv.userSignature, sig: authEv.userSignature.sig.replace(/^../, (h: string) => (h === '00' ? '01' : '00')) };
    const v = await verifyCertificate(await f7cert(), reader(), { ...opts(), intent: intentBinder({ authorization: authEv.authorization, userSignature: bad, trustedPubkey: ATT }) });
    expect(v.status).toBe('FAILED');
  });
});
