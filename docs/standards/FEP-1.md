# FEP-1: FUSE Portable Execution Policy (X04)

Status: draft 1. Reference implementation: `packages/policy-engine`. Conformance vectors: [`fep-1-vectors.json`](fep-1-vectors.json).

An FEP-1 policy states what a delegate (a Guardian, a solver, a wallet automation) may do on the owner's behalf.
Wallets, dApps and services can check one without trusting a FUSE server. It is plain JSON, canonically hashed and
signed by the owner key.

## Document

| Field | Type | Rule |
|---|---|---|
| `standard` | `"FEP-1"` | literal |
| `version` | int ≥ 1 | |
| `policyId` | `[A-Za-z0-9_-]{6,64}` | |
| `network` | `local` \| `chipnet` \| `mainnet` | must equal the verifier's network |
| `domain` | string 3–64 | application/replay domain; must equal the verifier's domain |
| `owner.pubkey` | 33-byte compressed secp256k1, lowercase hex | signs the policy |
| `delegate` | `{pubkey, label}` optional | without it, only the owner may act |
| `assets[]` | `{asset, maxPerAction, maxPerPeriod, periodSeconds}` | `asset` = `"BCH"` or a 32-byte token category; amounts are base-unit decimal strings |
| `allowedActions[]` | enum | LOAN_REPAYMENT, COLLATERAL_TOP_UP, INTEREST_RATE_ADJUSTMENT, POSITION_DELEVERAGE, POSITION_EXIT, TOKEN_SWAP, FLASH_LIQUIDITY, RESCUE_BOUNTY, LIQUIDITY_DEPOSIT, LIQUIDITY_WITHDRAWAL |
| `allowedProtocols[]` | string | |
| `approvedRecipients[]` | locking bytecode hex | empty = no recipient restriction |
| `approvedSourceVaults[]` | string | |
| `minHealthImprovementBps` | int | 0 disables |
| `maxFeeSats` | decimal string | |
| `minOutputs[]` | `{asset, amount}` | |
| `validFrom`, `expiresAt` | unix seconds | action allowed only in `[validFrom, expiresAt)` |
| `revocationNonce` | int | a verifier holding a revoked nonce rejects the policy |
| `mode` | DISABLED \| MONITORING \| APPROVAL_REQUIRED \| AUTONOMOUS_LIMITED \| PAUSED \| REVOKED | only AUTONOMOUS_LIMITED allows acting without per-action owner approval |

## Hash and signature

1. Parse and validate. Amounts become integers.
2. Canonical form of the *parsed* policy (defaults applied): object keys sorted by UTF-16 code unit order, no
   whitespace, arrays kept in order, integers in decimal, amounts as JSON decimal strings, `undefined` omitted.
3. `hash = SHA-256( "FUSE:policy/FEP-1\n" || canonical )`, as lowercase hex.
4. `signature = BCH Schnorr(ownerPrivateKey, hash)`: 64 bytes, as hex.

**Verification** (`verifySignedPolicy`) MUST check the schema, that the recomputed hash equals the provided hash, the
Schnorr signature by `owner.pubkey`, and that `network` and `domain` equal the verifier's own.

**Evaluation** of a proposed action (`evaluatePolicy`) checks the mode, the revoked nonces, the time window
`[validFrom, expiresAt)`, the action, protocol, asset, per-action and per-period limits, recipient, source vault, fee,
minimum outputs and health improvement. It returns **every** failing rule, and `requiresApproval` unless the mode is
AUTONOMOUS_LIMITED.

## Conformance

`fep-1-vectors.json` contains a policy, its canonical form, its preimage, hash and signature (from a public test-only
key derived as `sha256("FEP-1 test vector owner key: PUBLIC, NEVER FUND")`), and negative vectors: an amount changed
after signing, a swapped network, and a flipped signature bit. `packages/policy-engine/test/fep1-vectors.test.ts`
checks the vectors with an independent implementation (node:crypto and its own canonicalizer).

Regenerate the vectors: `npx tsx scripts/fep1-vectors.ts`.
