// F43 historical execution replay: re-evaluate every input of a raw transaction in a fresh BCH 2026 VM
// using the parent transactions' outputs. All raw transactions must be re-hashed by the caller's reader.
import { createVirtualMachineBch2026, decodeTransactionUnsafe, hexToBin, binToHex, hash256, type Output } from '@bitauth/libauth';

export interface ReplayStep { input: number; spends: string; ok: boolean; detail: string; lockingBytecodeBytes: number; token: boolean }
export interface ReplayResult { txid: string; inputs: number; outputs: number; allValid: boolean; steps: ReplayStep[]; tokenOutputs: number; categories: string[] }
const txidOf = (raw: string) => binToHex(hash256(hexToBin(raw)).reverse());

export async function replayRaw(raw: string, getParentRaw: (txid: string) => Promise<string>): Promise<ReplayResult> {
  const tx = decodeTransactionUnsafe(hexToBin(raw));
  const sourceOutputs: Output[] = [];
  for (const i of tx.inputs) {
    const ptxid = binToHex(i.outpointTransactionHash);
    const praw = await getParentRaw(ptxid);
    if (txidOf(praw) !== ptxid) throw new Error(`parent ${ptxid} failed re-hash`);
    sourceOutputs.push(decodeTransactionUnsafe(hexToBin(praw)).outputs[i.outpointIndex]);
  }
  const vm = createVirtualMachineBch2026();
  const steps = tx.inputs.map((inp, k) => {
    const r = vm.stateSuccess(vm.evaluate({ inputIndex: k, sourceOutputs, transaction: tx }));
    return { input: k, spends: `${binToHex(inp.outpointTransactionHash)}:${inp.outpointIndex}`, ok: r === true, detail: r === true ? 'valid' : String(r), lockingBytecodeBytes: sourceOutputs[k].lockingBytecode.length, token: Boolean(sourceOutputs[k].token) };
  });
  const cats = new Set(tx.outputs.filter((o) => o.token).map((o) => binToHex(o.token!.category)));
  return { txid: txidOf(raw), inputs: tx.inputs.length, outputs: tx.outputs.length, allValid: steps.every((s) => s.ok), steps, tokenOutputs: tx.outputs.filter((o) => o.token).length, categories: [...cats] };
}
