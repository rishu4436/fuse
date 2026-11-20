// BOX-ONLY test signer adapter (never deployed, never bundled into the web app). It plays the role of the user's
// wallet for the hosted execute path: it receives the hosted app's signing request, independently re-derives the
// unsigned transaction from the returned template, refuses anything that is not exactly what was reviewed, and
// signs only inputs locked to the test wallet's own key. The key file stays in /home/box/secrets (never printed).
import { readFileSync } from 'node:fs';
import { decodePrivateKeyWif, binToHex, encodeTransaction, hexToBin } from '@bitauth/libauth';
import { contractUnlocks, signInputs, finalize, toUnsignedTransaction, templateHash, verifyTemplateAndRaw, type TxTemplate } from '@fuse/transaction-composer';

export const WALLET_FILE = process.env.FUSE_MAINNET_WALLET ?? '/home/box/secrets/fuse-mainnet-wallet.json';
export function loadTestWallet() {
  const w = JSON.parse(readFileSync(WALLET_FILE, 'utf8')) as { wif: string; address: string; pkh: string };
  const d = decodePrivateKeyWif(w.wif); if (typeof d === 'string') throw new Error('bad wallet file');
  return { priv: d.privateKey, address: w.address, pkh: w.pkh, lockingBytecode: `76a914${w.pkh}88ac` };
}
export interface Prepared { templateHash: string; template: TxTemplate; sign: { transactionHex: string; userInputs: number[] }; minerFee: bigint; expectedUserCost: bigint; risk: { ok: boolean } }

/** Returns the signed raw hex, or throws if the request does not match what the box reviewed. */
export function signPrepared(p: Prepared, w: ReturnType<typeof loadTestWallet>, caps: { maxFee: bigint; maxUserCost: bigint }) {
  const t = p.template;
  if (templateHash(t) !== p.templateHash) throw new Error('template hash mismatch: refusing to sign');
  if (!p.risk.ok) throw new Error('Guardian pre-flight did not pass: refusing to sign');
  // re-derive the unsigned tx (with key-less covenant unlocks) and compare byte-for-byte with what the server asked us to sign
  const tx = toUnsignedTransaction(t); const cu = contractUnlocks(t);
  tx.inputs.forEach((inp, i) => { const u = cu.get(i); if (u) inp.unlockingBytecode = hexToBin(u); });
  if (binToHex(encodeTransaction(tx)) !== p.sign.transactionHex) throw new Error('server transactionHex differs from the template: refusing to sign');
  for (const i of p.sign.userInputs) { const inp = t.inputs[i]; if (inp.unlock.kind === 'p2pkh' && inp.lockingBytecode !== w.lockingBytecode) throw new Error(`input ${i} is not the test wallet's coin`); }
  const userIn = t.inputs.filter((i) => i.lockingBytecode === w.lockingBytecode).reduce((a, i) => a + i.satoshis, 0n);
  const userOut = t.outputs.filter((o) => o.lockingBytecode === w.lockingBytecode).reduce((a, o) => a + o.satoshis, 0n);
  const vaultOut = t.outputs.filter((o) => o.role === 'vault-continuation').reduce((a, o) => a + o.satoshis, 0n);
  const vaultIn = t.inputs.filter((i) => i.role === 'vault').reduce((a, i) => a + i.satoshis, 0n);
  // capital moved into the box wallet's own vault (genesis / deposit) is not a cost; everything else that leaves is
  const ownVault = t.inputs.some((i) => i.unlock.kind === 'flashvault-bch-owner') || t.outputs.some((o) => o.role === 'vault-continuation' && o.label?.startsWith('new FlashVault'));
  const cost = userIn - userOut - (ownVault ? vaultOut - vaultIn : 0n);
  if (cost > caps.maxUserCost) throw new Error(`net cost ${cost} sats exceeds the cap ${caps.maxUserCost}`);
  if (p.minerFee > caps.maxFee) throw new Error(`miner fee ${p.minerFee} exceeds the cap ${caps.maxFee}`);
  const raw = finalize(t, cu, signInputs(t, 'user', w.priv));
  const v = verifyTemplateAndRaw(t, raw, { requireStrongSighash: true, vm: true, maxMinerFee: caps.maxFee });
  if (!v.ok) throw new Error(`local VM check of the signed tx failed: ${JSON.stringify(v.checks.filter((c) => !c.ok))}`);
  return { raw, txid: v.txid, cost };
}
