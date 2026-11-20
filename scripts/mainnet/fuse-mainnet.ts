// FUSE mainnet test plan CLI. Operator wallet: /home/box/secrets/fuse-mainnet-wallet.json (never printed, never
// committed). Every step builds, signs and VM-verifies locally, prints a preflight, and broadcasts ONLY with
// --broadcast. Chain access: bchexplorer.cash esplora API over HTTPS (Electrum TCP is blocked from the box).
//   npx tsx scripts/mainnet/fuse-mainnet.ts <status|deploy|flash|underpay|deposit|withdraw|certificate|sweep> [--broadcast]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { decodePrivateKeyWif, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { verifyCertificate, type ChainReader } from '@fuse/proof-verifier';
import { decodeVaultState, type BchVaultParams } from '@fuse/contracts';
import * as P from './plan.js';

const run = promisify(execFile);
const ESPLORA = process.env.FUSE_ESPLORA ?? 'https://bchexplorer.cash/api';
const WALLET = process.env.FUSE_MAINNET_WALLET ?? '/home/box/secrets/fuse-mainnet-wallet.json';
const STATE = process.env.FUSE_MAINNET_STATE ?? '/home/box/secrets/fuse-mainnet-state.json';
const EVIDENCE = new URL('../../evidence/mainnet/', import.meta.url).pathname;
const [step = 'status', ...flags] = process.argv.slice(2);
const BROADCAST = flags.includes('--broadcast');
const arg = (k: string, d: bigint) => { const i = flags.indexOf(`--${k}`); return i >= 0 ? BigInt(flags[i + 1]) : d; };

interface State { params?: Omit<BchVaultParams, 'feeBps' | 'minFee' | 'maxExposure'> & { feeBps: string; minFee: string; maxExposure: string }; vault?: { txid: string; vout: number; satoshis: string; commitment: string } | null; feesPaid: string; txs: Array<{ step: string; txid: string; fee: string; at: string }>; lastFlash?: { txid: string; raw: string; fee: string }; spent?: string[] }
const loadState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { feesPaid: '0', txs: [] });
const saveState = (s: State) => writeFileSync(STATE, JSON.stringify(s, null, 1), { mode: 0o600 });
const paramsOf = (s: State): BchVaultParams | null => (s.params ? { ...s.params, feeBps: BigInt(s.params.feeBps), minFee: BigInt(s.params.minFee), maxExposure: BigInt(s.params.maxExposure) } : null);
const vaultOf = (s: State): P.VaultUtxo | null => (s.vault ? { ...s.vault, satoshis: BigInt(s.vault.satoshis) } : null);

async function http(path: string, body?: string): Promise<string> {
  const args = ['-sS', '--fail-with-body', '-m', '30', ...(body ? ['-X', 'POST', '-H', 'content-type: text/plain', '--data-binary', '@-'] : []), ESPLORA + path];
  for (let i = 0; ; i++) {
    try {
      const p = run('curl', args, { maxBuffer: 16 * 1024 * 1024 });
      if (body) { p.child.stdin?.write(body); p.child.stdin?.end(); }
      return (await p).stdout.trim();
    } catch (e) { const out = String((e as { stdout?: string }).stdout ?? '') || String((e as Error).message); if (body || i >= 6 || /RPC error|No such/.test(out)) throw new Error(out.slice(0, 300)); await new Promise((r) => setTimeout(r, 1500)); }
  }
}
const tip = async () => Number(await http('/blocks/tip/height'));
async function walletCoins(address: string, spent: string[] = []): Promise<P.Coin[]> {
  const list = JSON.parse(await http(`/address/${address}/utxo`)) as Array<{ txid: string; vout: number; value: number }>;
  const coins: P.Coin[] = [];
  for (const u of list) {
    // the address index can lag the mempool: drop coins an already-broadcast tx has spent
    const os = JSON.parse(await http(`/tx/${u.txid}/outspend/${u.vout}`)) as { spent: boolean };
    if (os.spent || spent.includes(`${u.txid}:${u.vout}`)) continue;
    const tx = decodeTransaction(hexToBin(await http(`/tx/${u.txid}/hex`)));
    if (typeof tx === 'string') throw new Error(tx);
    const out = tx.outputs[u.vout];
    if (out.token) { console.log(`skipping token-carrying coin ${u.txid}:${u.vout}`); continue; }
    coins.push({ txid: u.txid, vout: u.vout, satoshis: out.valueSatoshis });
  }
  return coins.sort((a, b) => (a.satoshis > b.satoshis ? -1 : 1));
}
async function vaultUnspent(v: P.VaultUtxo) { const o = JSON.parse(await http(`/tx/${v.txid}/outspend/${v.vout}`)) as { spent: boolean }; return !o.spent; }

function loadKey() {
  const w = JSON.parse(readFileSync(WALLET, 'utf8')) as { wif: string; publicKey: string; address: string };
  const d = decodePrivateKeyWif(w.wif); if (typeof d === 'string') throw new Error('bad wallet file');
  return { priv: d.privateKey, op: P.operatorOf(w.publicKey), address: w.address };
}

async function maybeBroadcast(name: string, s: ReturnType<typeof P.sized>, report: ReturnType<typeof P.verifyLocal>, st: State, after: (txid: string) => void, extra: Array<[string, string]> = []) {
  console.log(P.preflight(name, s.template, s, report, extra));
  if (!report.ok) { console.log('REFUSED: local VM verification failed. Nothing was sent.'); process.exitCode = 1; return false; }
  const vaultAfter = s.template.outputs.find((o) => o.role === 'vault-continuation')?.satoshis ?? 0n;
  const used = BigInt(st.feesPaid) + s.fee + vaultAfter;
  if (used > P.CAPS.totalUsedSats) { console.log(`REFUSED: plan would use ${used} sats > cap ${P.CAPS.totalUsedSats}.`); process.exitCode = 1; return false; }
  if (!BROADCAST) { console.log('DRY RUN: not broadcast. Re-run with --broadcast to send.'); return false; }
  const txid = await http('/tx', s.raw);
  if (txid !== s.txid) throw new Error(`endpoint returned ${txid}, expected ${s.txid}`);
  st.spent = [...(st.spent ?? []), ...s.template.inputs.map((i) => `${i.txid}:${i.vout}`)];
  st.feesPaid = String(BigInt(st.feesPaid) + s.fee); st.txs.push({ step: name, txid, fee: String(s.fee), at: new Date().toISOString() });
  after(txid); saveState(st);
  mkdirSync(EVIDENCE, { recursive: true });
  const prev = existsSync(`${EVIDENCE}run.json`) ? JSON.parse(readFileSync(`${EVIDENCE}run.json`, 'utf8')) : {};
  writeFileSync(`${EVIDENCE}run.json`, JSON.stringify({ ...prev, network: 'mainnet', explorer: 'https://bchexplorer.cash/tx/', vault: st.params ? { address: P.vaultAddress(paramsOf(st)!), category: st.params.vaultCategory } : (prev.vault ?? null), txs: st.txs }, null, 1));
  console.log(`BROADCAST OK ${txid}`);
  return true;
}
const vaultFrom = (s: ReturnType<typeof P.sized>, txid: string) => { const o = s.template.outputs[0]; return { txid, vout: 0, satoshis: String(o.satoshis), commitment: o.token!.nft!.commitment }; };

async function main() {
  const { priv, op, address } = loadKey();
  const st = loadState(); const params = paramsOf(st); const vault = vaultOf(st);
  const coins = step === 'certificate' ? [] : await walletCoins(address, st.spent ?? []);
  const bal = coins.reduce((a, c) => a + c.satoshis, 0n);
  const need = (c: P.Coin | undefined, msg: string) => { if (!c) throw new Error(msg); return c; };
  switch (step) {
    case 'status': {
      console.log(`wallet ${address}\nbalance ${bal} sats in ${coins.length} coin(s)\ntip ${await tip()}`);
      if (params && vault) console.log(`vault ${P.vaultAddress(params)}\n  utxo ${vault.txid}:${vault.vout} ${vault.satoshis} sats, state ${JSON.stringify(decodeVaultState(vault.commitment), (_k, v) => (typeof v === 'bigint' ? String(v) : v))}, unspent=${await vaultUnspent(vault)}`);
      console.log(`fees paid so far ${st.feesPaid} sats; txs ${st.txs.length}`);
      return;
    }
    case 'deploy': {
      if (vault) throw new Error('a vault is already deployed (state file); sweep first');
      const principal = arg('principal', P.DEFAULTS.principal);
      let c0 = coins.find((c) => c.vout === 0 && c.satoshis >= principal + 3_000n);
      if (!c0) {
        need(coins[0], `wallet ${address} is empty; fund it first`);
        const prep = P.sized((f) => P.buildPrep(coins, op, f), priv);
        const sent = await maybeBroadcast('deploy/1 prepare (vout-0 coin for genesis)', prep, P.verifyLocal(prep.template, prep.raw, op, null), st, () => undefined);
        c0 = { txid: prep.txid, vout: 0, satoshis: prep.template.outputs[0].satoshis };
        if (!sent) console.log('(genesis below is previewed on top of the unsent prepare tx)');
      }
      let params2!: BchVaultParams;
      const g = P.sized((f) => { const r = P.buildGenesis(c0!, op, principal, f); params2 = r.params; return r.template; }, priv);
      const lb = P.vaultLockingBytecode(params2);
      await maybeBroadcast('deploy/2 genesis + fund FlashVault', g, P.verifyLocal(g.template, g.raw, op, lb), st, (txid) => {
        st.params = { ...params2, feeBps: String(params2.feeBps), minFee: String(params2.minFee), maxExposure: String(params2.maxExposure) }; st.vault = vaultFrom(g, txid);
      }, [['vault address', P.vaultAddress(params2)], ['vault category', params2.vaultCategory], ['principal', `${principal} sats`], ['flash fee', `${P.flashFee(params2, principal)} sats (max(minFee ${params2.minFee}, ${params2.feeBps} bps))`]]);
      return;
    }
    case 'flash': case 'underpay': {
      if (!params || !vault) throw new Error('no vault deployed');
      const c = need(coins.find((x) => x.satoshis >= P.flashFee(params, vault.satoshis) + 3_000n), 'no wallet coin large enough');
      const under = step === 'underpay' ? 1n : 0n;
      const s = P.sized((f) => P.buildFlash(vault, params, c, op, f, under), priv);
      const r = P.verifyLocal(s.template, s.raw, op, P.vaultLockingBytecode(params));
      if (step === 'underpay') {
        console.log(P.preflight('underpay (must FAIL; never broadcast)', s.template, s, r));
        console.log(r.ok ? 'UNEXPECTED: underpaying tx passed local verification. Stopping.' : 'EXPECTED: the BCH VM rejects a repayment 1 sat short. Not broadcast; costs nothing.');
        process.exitCode = r.ok ? 1 : 0; return;
      }
      await maybeBroadcast('flash use (borrow + repay principal + fee, one tx)', s, r, st, (txid) => { st.vault = vaultFrom(s, txid); st.lastFlash = { txid, raw: s.raw, fee: String(s.fee) }; }, [['vault', P.vaultAddress(params)], ['repays', `${vault.satoshis} + ${P.flashFee(params, vault.satoshis)} sats`]]);
      return;
    }
    case 'deposit': case 'withdraw': {
      if (!params || !vault) throw new Error('no vault deployed');
      const amount = arg('amount', step === 'deposit' ? P.DEFAULTS.deposit : P.DEFAULTS.withdraw);
      const s = step === 'deposit'
        ? P.sized((f) => P.buildDeposit(vault, params, need(coins.find((x) => x.satoshis >= amount + 3_000n), 'no wallet coin large enough'), op, amount, f), priv)
        : P.sized((f) => P.buildWithdraw(vault, params, op, amount, f), priv);
      await maybeBroadcast(`LP ${step} ${amount} sats (owner path, 0x61)`, s, P.verifyLocal(s.template, s.raw, op, P.vaultLockingBytecode(params)), st, (txid) => { st.vault = vaultFrom(s, txid); });
      return;
    }
    case 'certificate': {
      if (!st.lastFlash) throw new Error('no broadcast flash tx yet');
      // after a sweep the live params are cleared; rebuild them deterministically from the recorded category
      const rec = existsSync(`${EVIDENCE}run.json`) ? (JSON.parse(readFileSync(`${EVIDENCE}run.json`, 'utf8')) as { vault?: { address: string; category: string } }).vault : undefined;
      const params = paramsOf(st) ?? (rec ? P.vaultParams(rec.category, op) : null);
      if (!params) throw new Error('vault params unknown');
      if (rec && P.vaultAddress(params) !== rec.address) throw new Error('rebuilt vault params do not match the recorded vault address');
      const txid = flags.find((f) => /^[0-9a-f]{64}$/.test(f)) ?? st.lastFlash.txid;
      const reader: ChainReader = { network: 'mainnet', tipHeight: tip, getRawTransaction: async (t) => { try { const raw = await http(`/tx/${t}/hex`); const s = JSON.parse(await http(`/tx/${t}/status`)) as { block_height?: number; block_hash?: string }; return { rawHex: raw, blockHeight: s.block_height ?? null, blockHash: s.block_hash ?? null }; } catch { return null; } } };
      const got = await reader.getRawTransaction(txid); if (!got) throw new Error('flash tx not found on chain');
      const t = await P.templateFromChain(got.rawHex, (h) => http(`/tx/${h}/hex`), op);
      const minerFee = t.inputs.reduce((a, i) => a + i.satoshis, 0n) - t.outputs.reduce((a, o) => a + o.satoshis, 0n);
      const cert = P.flashCertificate(t, txid, op, params, { minerFee, blockHeight: got.blockHeight, blockHash: got.blockHash, issuedAt: Math.floor(Date.now() / 1000) });
      const v = await verifyCertificate(cert, reader);
      mkdirSync(EVIDENCE, { recursive: true });
      writeFileSync(`${EVIDENCE}flash-certificate.json`, JSON.stringify({ certificate: cert, verification: v }, (_k, x) => (typeof x === 'bigint' ? String(x) : x), 1));
      console.log(`certificate ${cert.certificateId}: ${v.status} — ${v.note}`); for (const c of v.checks) console.log(`  ${c.ok ? '✓' : '✕'} ${c.name} ${c.detail ?? ''}`);
      console.log(`saved ${EVIDENCE}flash-certificate.json`);
      return;
    }
    case 'sweep': {
      const live = vault && (await vaultUnspent(vault)) ? vault : null;
      const s = P.sized((f) => P.buildSweep(live, params, coins, op, f), priv);
      await maybeBroadcast('sweep (vault owner path + wallet coins → wallet; identity NFT burned)', s, P.verifyLocal(s.template, s.raw, op, null), st, () => { st.vault = null; delete st.params; });
      return;
    }
    default: throw new Error(`unknown step ${step}`);
  }
}
main().catch((e) => { console.error('ERROR:', (e as Error).message); process.exit(1); });
