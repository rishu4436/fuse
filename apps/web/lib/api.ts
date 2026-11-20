// Client for the FUSE API (proxied at /api by next.config rewrites). bigint values arrive as "123n".
export const fromJson = <T,>(s: string): T => JSON.parse(s, (_k, x) => (typeof x === 'string' && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));
export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, body: init?.json !== undefined ? toJson(init.json) : init?.body, cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) { let m = text; try { m = JSON.parse(text).message ?? text; } catch { /* plain text */ } throw new ApiError(res.status, m); }
  return fromJson<T>(text);
}
export const sats = (v: bigint | number | string | undefined | null) => (v === undefined || v === null ? '—' : BigInt(v).toLocaleString('en-US'));
export const bch = (v: bigint | number | string) => { const b = BigInt(v); const neg = b < 0n; const a = neg ? -b : b; return `${neg ? '−' : ''}${a / 100_000_000n}.${(a % 100_000_000n).toString().padStart(8, '0')}`; };
export const short = (h?: string, n = 6) => (!h ? '—' : h.length <= n * 2 + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`);
export const usd = (cents: bigint | string | number) => { const c = BigInt(cents); return `$${(c / 100n).toLocaleString('en-US')}.${(c % 100n).toString().padStart(2, '0')}`; };
/** BCH amount with trailing zeros trimmed (min 2 decimals), exact bigint formatting. */
export const bchTrim = (v: bigint | number | string) => { const s = bch(v); const [i, d = ''] = s.split('.'); const t = d.replace(/0+$/, ''); return `${i}.${t.length < 2 ? t.padEnd(2, '0') : t}`; };
