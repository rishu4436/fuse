# Architecture

```
            ┌──────────────────────── apps/web (Next.js Studio) ─────────────────────────┐
            │  Intent Studio · Auctions · Solvers · FlashVault · Certificates · Verify   │
            │  Mainnet (Cauldron) · Guardian (Paryon) · Status · Activity                │
            └──────────────┬──────────────────────────────────────────────────────────────┘
                           │ /api (rewrite)            SSE /api/events
            ┌──────────────▼──────────────── services/api (Fastify) ──────────────────────┐
            │ FuseState: LOCAL world (MockNetworkProvider + BCH 2026 VM)                  │
            │            AuctionEngine (@fuse/auction)        mainnet evidence (READ-ONLY)│
            └──────▲───────────────▲───────────────▲───────────────▲──────────────────────┘
       HTTP bids   │               │               │               │   (separate OS processes)
     ┌─────────────┴──┐ ┌──────────┴───┐ ┌─────────┴────┐ ┌────────┴──────────┐
     │ solver: direct │ │solver:routing│ │ solver: flash│ │ solver: rogue (test│
     └────────────────┘ └──────────────┘ └──────────────┘ │ adversary)        │
                                                          └───────────────────┘
```

## Packages

| Package | Role |
|---|---|
| `@fuse/contracts` | FlashVaultBCH / FlashVaultToken CashScript sources and artifacts, vault state codec, fee math, the vendored Cauldron V0 artifact, and BigInt Cauldron quotes |
| `@fuse/transaction-composer` | Transaction templates (inputs, outputs, unlock specs), signing (0x61 only, own inputs only), finalization, and an **independent verifier**: value and token conservation, owner min-receive / max-spend, vault continuation, sighash, contract identity, reviewed-template match, BCH-2026 VM |
| `@fuse/intent` | zod intent schema (16 intent types, execution classes) and the intent commitment |
| `@fuse/policy-engine` | FEP-1 signed spending policies and evaluation |
| `@fuse/solver-sdk` | Bid types, Schnorr bid signing over `solver-bid/v1` commitments, reference strategies, and an HTTP client |
| `@fuse/auction` | Auction lifecycle: authenticated bids, nonce anti-replay, rate limit, a per-bid VM dry run of covenant inputs, outcome recomputed from the template, ranking, fallback, signature collection, final verification, broadcast, certificate |
| `@fuse/proof-verifier` | Certificate schema and commitment, and `verifyCertificate()`, which re-fetches the transaction, re-hashes it and checks every claim |
| `@fuse/protocol-adapters` | Paryon V1: script reconstruction from npm, loan and price decoders, collateral math, operation status |
| `@fuse/indexer-client` | Chaingraph client (raw transactions re-hashed locally) |
| `@fuse/simulation` | Deterministic LOCAL market fixture (test keys only) and a live market view |
| `@fuse/core`, `@fuse/math` | Canonical encoding and commitments. BigInt math |

## Trust boundaries

1. **Solver claims are never trusted.** The coordinator recomputes the user's tokens received, net spend and miner fee
   from the template's outputs and inputs, then runs every covenant input in the VM before ranking.
2. **The coordinator is not trusted by the user.** After signing, the exact raw transaction is verified again
   (`verifyTemplateAndRaw`), and the certificate can be checked independently against chain data.
3. **The vault does not trust anyone.** Repayment, state and identity are enforced by the covenant.

## Execution flow (ATOMIC_SINGLE_TX)

intent → auction opens (market view snapshot) → solvers bid signed templates → close → per-bid verification and
ranking → winner (fallback if it fails to sign) → user signs own inputs (0x61) → winning solver signs own inputs →
final verification of the exact raw transaction → broadcast (LOCAL mock chain) → certificate sealed → verify.
