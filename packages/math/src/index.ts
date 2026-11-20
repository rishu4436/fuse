// Exact financial arithmetic. No JavaScript floating point is used for accounting anywhere in FUSE.
export const BPS = 10_000n;

export function assertNonNegative(v: bigint, label = 'value'): bigint {
  if (v < 0n) throw new RangeError(`${label} must be non-negative`);
  return v;
}

export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('denominator must be positive');
  if (a < 0n || b < 0n) throw new RangeError('mulDiv operands must be non-negative');
  return (a * b) / d;
}

export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('denominator must be positive');
  if (a < 0n || b < 0n) throw new RangeError('mulDiv operands must be non-negative');
  return (a * b + d - 1n) / d;
}

export const bpsOf = (amount: bigint, bps: bigint) => mulDivCeil(amount, bps, BPS);
export const minBig = (...xs: bigint[]) => xs.reduce((m, x) => (x < m ? x : m));
export const maxBig = (...xs: bigint[]) => xs.reduce((m, x) => (x > m ? x : m));

/** Parse a decimal string into base units with exactly `decimals` places; rejects excess precision. */
export function parseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('bad decimals');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new SyntaxError(`not a decimal amount: ${value}`);
  const frac = m[3] ?? '';
  if (frac.length > decimals) throw new RangeError(`too many decimal places for ${decimals}-decimal asset`);
  const units = BigInt(m[2] + frac.padEnd(decimals, '0'));
  return m[1] ? -units : units;
}

export function formatUnits(units: bigint, decimals: number, opts: { trim?: boolean } = {}): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const s = abs.toString().padStart(decimals + 1, '0');
  let whole = s.slice(0, s.length - decimals);
  let frac = decimals ? s.slice(s.length - decimals) : '';
  if (opts.trim) frac = frac.replace(/0+$/, '');
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

export const SATS_PER_BCH = 100_000_000n;
export const formatBch = (sats: bigint) => formatUnits(sats, 8, { trim: true });

/** Ratio in basis points (floor). */
export function ratioBps(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  return mulDivFloor(assertNonNegative(numerator), BPS, denominator);
}

/** JSON replacer/reviver that keeps bigint exact as decimal strings with an `n` suffix-free canonical form. */
export const bigintReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
