// Shared primitives: canonical serialization, commitments, networks.
import { sha256, utf8ToBin, binToHex } from '@bitauth/libauth';

export type Network = 'local' | 'chipnet' | 'mainnet';
export const NETWORKS: readonly Network[] = ['local', 'chipnet', 'mainnet'];

/**
 * Canonical deterministic serialization: object keys sorted lexicographically, bigint -> decimal string,
 * undefined fields omitted, no whitespace. Arrays keep order. Throws on non-finite numbers and
 * non-integer numbers (financial values must be bigint or integer).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'bigint': return JSON.stringify(value.toString());
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value) || !Number.isInteger(value)) throw new TypeError('canonicalize: only integer numbers are allowed');
      return String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
    }
    default: throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }
}

/** Domain-separated SHA-256 commitment over the canonical form. */
export function commitment(domain: string, value: unknown): string {
  if (!/^[A-Za-z0-9/._-]+$/.test(domain)) throw new Error('invalid commitment domain');
  return binToHex(sha256.hash(utf8ToBin(`FUSE:${domain}\n${canonicalize(value)}`)));
}

export class FuseError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly details?: unknown) {
    super(message);
  }
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
