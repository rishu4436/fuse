/* eslint-disable @typescript-eslint/no-explicit-any -- one-off round-6 operator script over untyped JSON */
// BOX-ONLY (never deployed): send 20,000 sats from the box test wallet to the Cashonize wallet (m/44'/145'/0'/0/0). authorized_by: pt32u
const E = 'https://bchexplorer.cash/api';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const get = (path: string) => execFileSync('curl', ['-sS', '--fail-with-body', '-m', '30', E + path], { encoding: 'utf8' }).trim();
import { decodePrivateKeyWif, decodeTransaction, hexToBin, binToHex, encodeTransaction, cashAddressToLockingBytecode, generateSigningSerializationBCH, sha256, secp256k1, hash256, SigningSerializationFlag, encodeDataPush, createVirtualMachineBch2025 } from '@bitauth/libauth';
const w = JSON.parse(readFileSync('/home/box/secrets/fuse-mainnet-wallet.json', 'utf8'));
const d = decodePrivateKeyWif(w.wif); if (typeof d === 'string') throw new Error('bad');
const priv = d.privateKey; const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
const myLock = hexToBin(`76a914${w.pkh}88ac`);
const to = cashAddressToLockingBytecode(process.argv[2]); if (typeof to === 'string') throw new Error(to);
const AMT = BigInt(process.argv[3] ?? '20000');
const utxos = JSON.parse(get(`/address/${w.address}/utxo`)) as any[];
const u = utxos.sort((a, b) => b.value - a.value)[0];
const prev = decodeTransaction(hexToBin(get(`/tx/${u.txid}/hex`)));
if (typeof prev === 'string') throw new Error(prev);
const so = prev.outputs[u.vout]; if (so.token) throw new Error('token utxo');
if (binToHex(so.lockingBytecode) !== binToHex(myLock)) throw new Error('lock mismatch');
const build = (fee: bigint) => {
  const tx = { version: 2, locktime: 0, inputs: [{ outpointTransactionHash: hexToBin(u.txid), outpointIndex: u.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }],
    outputs: [{ lockingBytecode: to.bytecode, valueSatoshis: AMT }, { lockingBytecode: myLock, valueSatoshis: so.valueSatoshis - AMT - fee }] };
  const flag = SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
  const ser = generateSigningSerializationBCH({ transaction: tx, sourceOutputs: [so], inputIndex: 0 } as any, { coveredBytecode: so.lockingBytecode, signingSerializationType: new Uint8Array([flag]) });
  const sig = secp256k1.signMessageHashSchnorr(priv, sha256.hash(sha256.hash(ser))) as Uint8Array;
  tx.inputs[0].unlockingBytecode = new Uint8Array([...encodeDataPush(new Uint8Array([...sig, flag])), ...encodeDataPush(pub)]);
  return encodeTransaction(tx);
};
let raw = build(300n); raw = build(BigInt(raw.length + 2));
const fee = BigInt(raw.length + 2);
const vmr = createVirtualMachineBch2025().verify({ transaction: decodeTransaction(raw) as any, sourceOutputs: [so] }); if (vmr !== true) throw new Error('VM: ' + vmr); console.log('VM ok');
const txid = binToHex(hash256(raw).reverse());
console.log(JSON.stringify({ txid, size: raw.length, fee: String(fee), amount: String(AMT) }));
if (process.argv.includes('--broadcast')) {
  const t = execFileSync('curl', ['-sS', '--fail-with-body', '-m', '30', '-X', 'POST', '-H', 'content-type: text/plain', '--data-binary', binToHex(raw), E + '/tx'], { encoding: 'utf8' }); console.log('broadcast', t);
  { const L = JSON.parse(readFileSync('/home/box/secrets/fuse-live-ledger.json', 'utf8')); L.txs.push({ action: 'r6-fund-cashonize', txid: t.trim(), minerFee: String(fee), cost: String(fee), at: new Date().toISOString(), authorized_by: 'pt32u' }); writeFileSync('/home/box/secrets/fuse-live-ledger.json', JSON.stringify(L, null, 1), { mode: 0o600 }); }
}
