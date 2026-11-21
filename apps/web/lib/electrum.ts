// Minimal Fulcrum/Electrum Cash JSON-RPC over WebSocket, run in the USER'S browser (READ-ONLY).
// Used only to list the connected wallet's own UTXOs for the mainnet preflight. No broadcast method is exposed.
export const ELECTRUM_SERVERS = (process.env.NEXT_PUBLIC_ELECTRUM_WSS ?? 'wss://cashnode.bch.ninja,wss://bch.imaginary.cash:50004,wss://electrum.imaginary.cash:50004').split(',');
export interface ElectrumUtxo { tx_hash: string; tx_pos: number; height: number; value: number; token_data?: unknown }

export async function listUnspent(address: string, servers = ELECTRUM_SERVERS, timeoutMs = 8000): Promise<{ server: string; utxos: ElectrumUtxo[] }> {
  let lastErr = 'no servers';
  for (const server of servers) {
    try {
      const utxos = await new Promise<ElectrumUtxo[]>((resolve, reject) => {
        const ws = new WebSocket(server);
        const t = setTimeout(() => { ws.close(); reject(new Error(`timeout ${server}`)); }, timeoutMs);
        ws.onopen = () => {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server.version', params: ['FUSE Studio', '1.5'] }));
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'blockchain.address.listunspent', params: [address, 'include_tokens'] }));
        };
        ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id === 2) { clearTimeout(t); ws.close(); if (d.error) reject(new Error(d.error.message ?? 'electrum error')); else resolve(d.result as ElectrumUtxo[]); } };
        ws.onerror = () => { clearTimeout(t); reject(new Error(`cannot reach ${server}`)); };
      });
      return { server, utxos };
    } catch (e) { lastErr = (e as Error).message; }
  }
  throw new Error(lastErr);
}
