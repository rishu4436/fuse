export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
export const fromJson = <T>(s: string): T => JSON.parse(s, (_k, x) => (typeof x === 'string' && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));
