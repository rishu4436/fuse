// FUSE execution certificates + standalone verifier. The verifier trusts nothing in the certificate:
// it re-fetches every transaction from an independent chain reader, re-hashes it, decodes it locally and
// checks each claimed input, output, contract continuation and outcome. A backend that merely *claims*
// success cannot produce a VERIFIED result.
import { z } from 'zod';
import { decodeTransaction, hexToBin, binToHex, hash256 } from '@bitauth/libauth';
import { commitment } from '@fuse/core';

export interface ChainReader {
  readonly network: 'local' | 'chipnet' | 'mainnet';
  getRawTransaction(txid: string): Promise<{ rawHex: string; blockHeight: number | null; blockHash: string | null } | null>;
  tipHeight(): Promise<number>;
}

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const Big = z.union([z.string().regex(/^-?\d+$/), z.bigint()]).transform((v) => BigInt(v));
const Token = z.object({ category: hex32, amount: Big, nft: z.object({ capability: z.enum(['none', 'mutable', 'minting']), commitment: z.string().regex(/^([0-9a-f]{2})*$/) }).optional() });

export const CertificateSchema = z.object({
  schema: z.literal('fuse.certificate/v1'),
  certificateId: z.string().min(8),
  intentId: z.string(),
  intentCommitment: hex32,
  policyCommitment: hex32.nullable(),
  network: z.enum(['local', 'chipnet', 'mainnet']),
  executionClass: z.enum(['ATOMIC_SINGLE_TX', 'STAGED_RECOVERABLE', 'MONITOR_ONLY']),
  solverId: z.string(),
  quoteCommitment: hex32,
  contracts: z.array(z.object({ role: z.string(), name: z.string(), lockingBytecode: z.string() })),
  transactions: z.array(z.object({ txid: hex32, blockHeight: z.number().int().nullable(), blockHash: z.string().nullable() })).min(1),
  inputs: z.array(z.object({ txid: hex32, outpoint: z.string().regex(/^[0-9a-f]{64}:\d+$/) })),
  outputs: z.array(z.object({ txid: hex32, vout: z.number().int().nonnegative(), lockingBytecode: z.string(), satoshis: Big, token: Token.optional(), role: z.string() })),
  vaultContinuations: z.array(z.object({ txid: hex32, inputIndex: z.number().int(), minReturn: Big, asset: z.string() })).default([]),
  fees: z.object({ minerFeeSats: Big, liquidityFee: Big, solverFee: Big }),
  outcome: z.object({ ownerLockingBytecode: z.string(), ownerReceives: z.array(z.object({ asset: z.string(), amount: Big })) }),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })),
  confirmation: z.enum(['CONFIRMED', 'UNCONFIRMED', 'LOCAL_ACCEPTED']),
  simulated: z.boolean(),
  issuedAt: z.number().int(),
  issuer: z.string(),
  commitment: hex32,
});
export type Certificate = z.output<typeof CertificateSchema>;
export type UnsignedCertificate = Omit<Certificate, 'commitment'>;

export const certificateCommitment = (c: UnsignedCertificate) => commitment('certificate/v1', c);
export function sealCertificate(c: UnsignedCertificate): Certificate { return { ...c, commitment: certificateCommitment(c) }; }

export type VerificationStatus = 'VERIFIED' | 'FAILED' | 'INSUFFICIENT_EVIDENCE';
export interface CertificateVerification { status: VerificationStatus; checks: Array<{ name: string; ok: boolean; detail?: string }>; note: string }

export async function verifyCertificate(input: unknown, reader: ChainReader, ctx: { intentCommitment?: string; policyCommitment?: string | null; minConfirmations?: number } = {}): Promise<CertificateVerification> {
  const checks: CertificateVerification['checks'] = [];
  const fail = (note: string): CertificateVerification => ({ status: 'FAILED', checks, note });
  const parsed = CertificateSchema.safeParse(input);
  if (!parsed.success) { checks.push({ name: 'schema', ok: false, detail: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') }); return fail('malformed certificate'); }
  const cert = parsed.data;
  checks.push({ name: 'schema', ok: true });
  const { commitment: claimed, ...rest } = cert;
  const recomputed = certificateCommitment(rest);
  checks.push({ name: 'certificate-commitment', ok: recomputed === claimed, detail: recomputed === claimed ? undefined : `recomputed ${recomputed}` });
  if (cert.network !== reader.network) { checks.push({ name: 'network', ok: false, detail: `certificate=${cert.network} reader=${reader.network}` }); return fail('network mismatch'); }
  if (ctx.intentCommitment) checks.push({ name: 'intent-commitment', ok: ctx.intentCommitment === cert.intentCommitment });
  if (ctx.policyCommitment !== undefined) checks.push({ name: 'policy-commitment', ok: ctx.policyCommitment === cert.policyCommitment });

  const decoded = new Map<string, NonNullable<ReturnType<typeof decodeOk>>>();
  let insufficient = false;
  const tip = await reader.tipHeight().catch(() => null);
  for (const t of cert.transactions) {
    const got = await reader.getRawTransaction(t.txid);
    if (!got) { checks.push({ name: `tx-exists:${t.txid.slice(0, 12)}`, ok: false, detail: 'transaction not found by independent reader' }); continue; }
    const rehash = binToHex(hash256(hexToBin(got.rawHex)).reverse());
    checks.push({ name: `tx-hash:${t.txid.slice(0, 12)}`, ok: rehash === t.txid });
    const tx = decodeOk(got.rawHex);
    if (!tx) { checks.push({ name: `tx-decode:${t.txid.slice(0, 12)}`, ok: false }); continue; }
    decoded.set(t.txid, tx);
    if (reader.network !== 'local') {
      const conf = got.blockHeight != null && tip != null ? tip - got.blockHeight + 1 : 0;
      const need = ctx.minConfirmations ?? 1;
      if (conf < need) { insufficient = true; checks.push({ name: `confirmations:${t.txid.slice(0, 12)}`, ok: false, detail: `${conf} < ${need}` }); }
      else checks.push({ name: `confirmations:${t.txid.slice(0, 12)}`, ok: true, detail: `${conf}` });
      if (cert.confirmation === 'CONFIRMED' && got.blockHeight == null) checks.push({ name: 'claimed-confirmed', ok: false, detail: 'certificate claims CONFIRMED but tx is unconfirmed' });
    }
  }
  for (const i of cert.inputs) {
    const tx = decoded.get(i.txid);
    const [h, n] = i.outpoint.split(':');
    const ok = !!tx && tx.inputs.some((x) => binToHex(x.outpointTransactionHash) === h && x.outpointIndex === Number(n));
    checks.push({ name: `input:${i.outpoint.slice(0, 12)}`, ok });
  }
  for (const o of cert.outputs) {
    const tx = decoded.get(o.txid);
    const out = tx?.outputs[o.vout];
    const ok = !!out && binToHex(out.lockingBytecode) === o.lockingBytecode && out.valueSatoshis === o.satoshis &&
      (!o.token ? !out.token : !!out.token && binToHex(out.token.category) === o.token.category && out.token.amount === o.token.amount && (o.token.nft ? out.token.nft?.capability === o.token.nft.capability && binToHex(out.token.nft!.commitment) === o.token.nft.commitment : !out.token.nft));
    checks.push({ name: `output:${o.txid.slice(0, 8)}:${o.vout}`, ok, detail: ok ? o.role : 'claimed output does not match chain data' });
  }
  for (const v of cert.vaultContinuations) {
    const tx = decoded.get(v.txid);
    const out = tx?.outputs[v.inputIndex];
    const vaultContract = cert.contracts.find((c) => c.role === 'vault');
    const amount = !out ? 0n : v.asset === 'BCH' ? out.valueSatoshis : out.token && binToHex(out.token.category) === v.asset ? out.token.amount : 0n;
    const ok = !!out && !!vaultContract && binToHex(out.lockingBytecode) === vaultContract.lockingBytecode && amount >= v.minReturn;
    checks.push({ name: `vault-continuation:${v.inputIndex}`, ok, detail: `returned ${amount}, required ${v.minReturn}` });
  }
  // Outcome: recompute what the owner actually received from chain data, ignoring the claim.
  for (const r of cert.outcome.ownerReceives) {
    let got = 0n;
    for (const tx of decoded.values()) for (const o of tx.outputs) {
      if (binToHex(o.lockingBytecode) !== cert.outcome.ownerLockingBytecode) continue;
      got += r.asset === 'BCH' ? o.valueSatoshis : o.token && binToHex(o.token.category) === r.asset ? o.token.amount : 0n;
    }
    checks.push({ name: `owner-receives:${r.asset.slice(0, 8)}`, ok: got >= r.amount, detail: `chain shows ${got}, claimed ${r.amount}` });
  }
  const failed = checks.filter((c) => !c.ok && !c.name.startsWith('confirmations'));
  if (failed.length) return fail(`${failed.length} check(s) failed`);
  if (insufficient) return { status: 'INSUFFICIENT_EVIDENCE', checks, note: 'transactions not yet sufficiently confirmed' };
  return { status: 'VERIFIED', checks, note: cert.network === 'local' ? 'Verified against the LOCAL mock network (simulation) — not on-chain evidence.' : 'Verified against independent chain data. This is execution verification, not a security audit.' };
}

function decodeOk(raw: string) {
  const tx = decodeTransaction(hexToBin(raw));
  return typeof tx === 'string' ? null : tx;
}

/** Reader backed by a cashscript MockNetworkProvider (LOCAL simulation only). */
export function mockChainReader(provider: { getRawTransaction(txid: string): Promise<string> }): ChainReader {
  return {
    network: 'local',
    async getRawTransaction(txid) {
      try { const rawHex = await provider.getRawTransaction(txid); return rawHex ? { rawHex, blockHeight: null, blockHash: null } : null; } catch { return null; }
    },
    async tipHeight() { return 0; },
  };
}

/** Reader backed by any object exposing getTransaction/tipHeight (e.g. ChaingraphClient). */
export function indexerChainReader(network: 'chipnet' | 'mainnet', client: { getTransaction(txid: string): Promise<{ rawHex: string; blockHeight: number | null; blockHash: string | null } | null>; tipHeight(): Promise<number> }): ChainReader {
  return { network, getRawTransaction: (t) => client.getTransaction(t), tipHeight: () => client.tipHeight() };
}

export function certificateToHtml(c: Certificate, v?: CertificateVerification): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  return `<!doctype html><meta charset="utf-8"><title>FUSE certificate ${esc(c.certificateId)}</title>
<body style="font-family:system-ui;background:#0b1016;color:#e6f1f5;padding:24px"><h1>FUSE Execution Certificate</h1>
<p><b>${c.simulated ? 'SIMULATION (LOCAL network)' : esc(c.network.toUpperCase())}</b> · ${esc(c.executionClass)} · status: ${esc(v?.status ?? 'unverified')}</p>
<p>Intent ${esc(c.intentId)}<br>Intent commitment <code>${c.intentCommitment}</code><br>Certificate commitment <code>${c.commitment}</code></p>
<h2>Transactions</h2><ul>${c.transactions.map((t) => `<li><code>${t.txid}</code> ${t.blockHeight ?? 'unconfirmed'}</li>`).join('')}</ul>
<h2>Checks</h2><ul>${(v?.checks ?? c.checks).map((k) => `<li>${k.ok ? '✔' : '✘'} ${esc(k.name)} ${esc(k.detail ?? '')}</li>`).join('')}</ul></body>`;
}
export * from './replay.js';
