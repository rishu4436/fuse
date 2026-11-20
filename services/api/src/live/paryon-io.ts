import { getJson, outputAt, pool, tip } from './chain.js';
export { outputAt, pool, tip };
export async function addressUtxosRaw(address: string) { return getJson<Array<{ txid: string; vout: number; value: number }>>(`/address/${encodeURIComponent(address)}/utxo`); }
