import { setTimeout as delay } from 'node:timers/promises';

type Health = { active: number; failures: number; retryAt: number; checkedAt: string | null; lastError: string | null };
const sources = new Map<string, Health>();
export const sourceHealth = () => Object.fromEntries(sources);
export const unavailable = (message: string) => Object.assign(new Error(message), { code: 'CHAIN_UNAVAILABLE', statusCode: 503 });

/** Limit sockets per source across requests. Pressure is temporary and doesn't trip the outage breaker. */
export async function readSource<T>(url: string, read: () => Promise<T>): Promise<T> {
  const source = new URL(url).origin;
  const health = sources.get(source) ?? { active: 0, failures: 0, retryAt: 0, checkedAt: null, lastError: null };
  sources.set(source, health);
  const deadline = Date.now() + 4000;
  while (health.active >= 12 && Date.now() < deadline) await delay(40);
  if (health.active >= 12 || health.retryAt > Date.now()) throw unavailable(`Chain source ${source} is busy or temporarily unavailable. Retry shortly.`);
  health.active++;
  try {
    const result = await read();
    health.failures = 0;
    health.retryAt = 0;
    health.lastError = null;
    return result;
  } catch (error) {
    const status = (error as {status?: number}).status;
    if (status !== 404 && status !== 400) {
      health.lastError = status ? `HTTP ${status}` : 'network or invalid response';
      if (++health.failures >= 3) health.retryAt = Date.now() + 10_000;
    }
    throw error;
  } finally {
    health.checkedAt = new Date().toISOString();
    health.active--;
  }
}

export const fulcrumUrl = process.env.FUSE_FULCRUM_WSS ?? 'wss://cashnode.bch.ninja';
export function rpc<T>(url: string, method: string, params: unknown[], timeout = 4500): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const finish = () => { clearTimeout(timer); ws.onclose = null; ws.close(); };
    const timer = setTimeout(() => { finish(); reject(unavailable('Fulcrum timeout')); }, timeout);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    ws.onerror = ws.onclose = () => { finish(); reject(unavailable('Fulcrum connection failed')); };
    ws.onmessage = (event) => {
      try {
        const reply = JSON.parse(String(event.data));
        if (reply.id !== 1) return;
        if (reply.error || reply.result == null) throw unavailable(reply.error?.message ?? 'Missing Fulcrum result');
        finish(); resolve(reply.result as T);
      } catch (error) { finish(); reject(error); }
    };
  });
}
