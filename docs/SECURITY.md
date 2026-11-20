# Security

* **No private keys or seeds are handled or committed.** LOCAL demo keys are derived deterministically from public
  labels (`sha256("fuse-local-fixture:<label>")`). They are test-only, hold only simulated coins and must never be
  funded. Contract tests use ephemeral random keys.
* **No mainnet broadcast.** Nothing in this repository sends value-moving mainnet transactions. Mainnet data is
  READ-ONLY. No chipnet transaction was performed and no chipnet key exists.
* `.gitignore` covers `.env*`, `secrets/`, `*.key` and `.local-keys/`.
* Signing is restricted to SIGHASH_ALL|FORKID|UTXOS (0x61). Signers refuse to sign inputs not locked to their own key.
* API inputs are validated with zod. Body limit is 512 KB. Bids are rate limited, nonces cannot be replayed, and
  bids are Schnorr-authenticated.
* Web: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy` headers.

Report issues privately to the repository owner.

## Threat model (summary)

| Threat | Mitigation | Tested |
|---|---|---|
| Solver underpays the vault | Covenant: value ≥ principal + fee at the same-index continuation | flashvault-*.test.ts, properties |
| Fake continuation or look-alike vault | Locking bytecode equality, identity NFT category and capability | flashvault-bch.test.ts |
| Category substitution (worthless token) | Exact category check | both vault tests |
| Solver lies about the user outcome | Outcome recomputed from the template; claim mismatch rejected | auction.test.ts |
| Transaction modified after review | `matches-reviewed-template` check on the exact raw transaction | composer.test.ts |
| Weak sighash (ANYONECANPAY, NONE, SINGLE) | Owner path and verifier accept 0x61 only | flashvault-bch.test.ts, composer.test.ts |
| Bid replay or forgery | Nonce set and Schnorr signature over the template hash | auction.test.ts |
| Stale UTXOs | Inputs checked against the current market view | auction.test.ts |
| Backend fabricates a certificate | Independent verifier re-fetches and re-hashes the transaction and recomputes the outcome | auction.test.ts, Playwright |
| Winner never signs | Fallback promotes the next valid bid | auction.test.ts |
