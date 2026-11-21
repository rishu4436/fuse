/* eslint-disable @typescript-eslint/no-explicit-any -- one-off round-6 operator script over untyped JSON */
// Round 6: independent checks of the Cashonize-signed flash (paths, covenant unlock untouched, sighash, pubkey, VM).
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeTransaction, hexToBin, binToHex, decodeAuthenticationInstructions, createVirtualMachineBch2025 } from '@bitauth/libauth';
const r = JSON.parse(readFileSync('/workspace/r6/run.json', 'utf8'));
const prep = JSON.parse(r['live/prepare'].response); const raw = JSON.parse(r['live/verify-signed'].request).rawHex as string;
const bc = JSON.parse(r['broadcast'].response); const breq = JSON.parse(r['broadcast'].request);
const tx = decodeTransaction(hexToBin(raw)); if (typeof tx === 'string') throw new Error(tx);
const unsigned = decodeTransaction(hexToBin(prep.sign.transactionHex)); if (typeof unsigned === 'string') throw new Error(unsigned);
const addr = JSON.parse(readFileSync('/workspace/r6/address.json', 'utf8'));
const so = prep.sign.sourceOutputs.map((s: any) => ({ lockingBytecode: hexToBin(s.lockingBytecode), valueSatoshis: BigInt(s.valueSatoshis), ...(s.token ? { token: { category: hexToBin(s.token.category), amount: BigInt(s.token.amount), nft: { capability: s.token.nft.capability, commitment: hexToBin(s.token.nft.commitment) } } } : {}) }));
const ins = decodeAuthenticationInstructions(tx.inputs[1].unlockingBytecode) as any[];
const sig = ins[0].data as Uint8Array, pub = ins[1].data as Uint8Array;
const checks = {
  txid: bc.txid,
  inputPaths: prep.sign.inputPaths, userInputs: prep.sign.userInputs,
  input0_covenant_unlock_unchanged: binToHex(tx.inputs[0].unlockingBytecode) === binToHex(unsigned.inputs[0].unlockingBytecode),
  input0_source_token: prep.sign.sourceOutputs[0].token,
  input1_sig_len: sig.length, input1_sighash: '0x' + sig[sig.length - 1].toString(16),
  input1_pubkey: binToHex(pub), pubkey_is_m44_145_0_0_0: binToHex(pub) === addr.pubkey,
  outputs_unchanged: binToHex(hexToBin(raw)).length > 0 && JSON.stringify(tx.outputs.map((o) => [binToHex(o.lockingBytecode), String(o.valueSatoshis)])) === JSON.stringify(unsigned.outputs.map((o) => [binToHex(o.lockingBytecode), String(o.valueSatoshis)])),
  inputs_outpoints_unchanged: tx.inputs.every((i, k) => binToHex(i.outpointTransactionHash) === binToHex(unsigned.inputs[k].outpointTransactionHash) && i.outpointIndex === unsigned.inputs[k].outpointIndex),
  local_vm: createVirtualMachineBch2025().verify({ transaction: tx, sourceOutputs: so } as any),
  broadcast_request_has_userSignature: 'userSignature' in breq, broadcast_has_authorization: Boolean(breq.authorization),
  broadcast_response: bc,
};
console.log(JSON.stringify(checks, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 1));
writeFileSync('/workspace/r6/signed-checks.json', JSON.stringify(checks, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 1));
