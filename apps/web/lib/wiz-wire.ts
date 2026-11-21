// WizardConnect wire encoding for a sign request (mirrors @wizardconnect/core hdwalletv1-serialize): the relay
// carries JSON, so bytes travel as hex, bigints as "<bigint: Xn>" and the unsigned tx as hex. Passing native
// BigInt/Uint8Array makes JSON.stringify throw ("Do not know how to serialize a BigInt"); found pairing Cashonize.
type Tok = { category: string; amount: string | number | bigint; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
export const wireBig = (v: unknown) => `<bigint: ${BigInt(String(v).replace(/n$/, '')).toString()}n>`;
const hex = (v: unknown) => { const s = String(v ?? ''); if (!/^(?:[0-9a-fA-F]{2})*$/.test(s)) throw new Error(`not hex: ${s.slice(0, 20)}`); return s; };
export function wizSignPayload(req: { transactionHex: string; sourceOutputs: Array<Record<string, unknown>>; userPrompt?: string }) {
  const token = (t: unknown) => { if (!t) return {}; const k = t as Tok; return { token: { category: hex(k.category), amount: wireBig(k.amount), ...(k.nft ? { nft: { capability: k.nft.capability, commitment: hex(k.nft.commitment) } } : {}) } }; };
  const sourceOutputs = req.sourceOutputs.map((s) => ({ outpointIndex: Number(s.outpointIndex), outpointTransactionHash: hex(s.outpointTransactionHash), sequenceNumber: Number(s.sequenceNumber), unlockingBytecode: hex(s.unlockingBytecode), lockingBytecode: hex(s.lockingBytecode), valueSatoshis: wireBig(s.valueSatoshis), ...token(s.token) }));
  return { transaction: hex(req.transactionHex), sourceOutputs, broadcast: false as const, userPrompt: req.userPrompt };
}
