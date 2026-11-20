# Feature matrix

> **About the IDs.** The master spec numbers features F01–F51 and X01–X04. This build environment did not keep a
> verbatim copy of that list, so the table below is organised by capability. Spec IDs are filled in only where they
> are certain (F31 = fallback execution; X01 = cross-intent netting, X02 = health sentinel, X03 = rescue bounties).
> Any other ID is left blank and **must be mapped against the spec**. Nothing here has been relabelled to look
> complete.

Labels follow [INTEGRATION-FEASIBILITY.md](INTEGRATION-FEASIBILITY.md). "Not built" means there is no code yet.

| Spec ID | Capability | Status | Evidence |
|---|---|---|---|
| | FlashVault BCH covenant (repay, fee, state, identity NFT, owner path) | TESTED | flashvault-bch.test.ts (27) |
| | FlashVault CashToken covenant | TESTED | flashvault-token.test.ts (9) |
| | Property-based invariants (VM in the loop) | TESTED | properties.test.ts (4) |
| | Multi-shard funding / adaptive sharding (parallel shards) | TESTED | two-shard test. The shard allocator is not built |
| | Atomic composition with Cauldron pools | TESTED | composition.test.ts (3) |
| | Cauldron pool verification on mainnet | VERIFIED | evidence/cauldron-pool-verification.json |
| | Intent schema (16 types, execution classes, refinements) | IMPLEMENTED | packages/intent/src/schema.ts. Compiler pipeline not built |
| | Intent commitment / canonical encoding | IMPLEMENTED | @fuse/core |
| | Transaction composer | TESTED | composer.test.ts |
| | Independent pre-sign verifier (conservation, sighash, continuation, VM) | TESTED | composer.test.ts, auction.test.ts |
| | FEP-1 signed policies and evaluation | TESTED | policy.test.ts |
| | Solver SDK (bid signing, strategies, HTTP client) | TESTED | auction.test.ts, network.e2e.test.ts |
| | Independent solver worker processes (3 honest + 1 adversarial) | TESTED | network.e2e.test.ts |
| | Intent auction (ranking by verified net cost) | TESTED | auction.test.ts |
| | Adversarial bid rejection | TESTED | auction.test.ts, Playwright |
| | Anti-replay / rate limit / unregistered-solver refusal | TESTED | auction.test.ts |
| F31 | Fallback execution (next valid bid) | TESTED | auction.test.ts |
| | Stale-UTXO detection | TESTED | auction.test.ts |
| | Execution certificates | TESTED | auction.test.ts |
| | Independent certificate verifier (rejects fabricated or tampered) | TESTED | auction.test.ts, Playwright |
| | API (REST + SSE) | TESTED | network.e2e.test.ts, Playwright |
| | Paryon V1 deployment verification | VERIFIED | evidence/paryon-deployment-verification.json |
| | Paryon loan discovery / health / oracle | READ-ONLY | /guardian |
| | Guardian price-shock analysis | IMPLEMENTED | /guardian (computed locally from the snapshot). No unit test |
| | Paryon manage / interest / liquidation | BLOCKED | @paryonusd/library unpublished. Owner-approved tests needed |
| | Paryon V2 | UNSUPPORTED | not deployed |
| | Moria V1 live | UNSUPPORTED | disabled 23 Apr 2026 |
| | Moria historical replay | Not built | |
| | Studio UI (11 routes, honest labels) | TESTED | Playwright 25/25 |
| | Animated transaction graph | TESTED | Playwright (rendered) |
| | WizardConnect wallet pairing | IMPLEMENTED | QR and relay tested in Playwright. Real-wallet pairing untested |
| | WizardConnect transaction signing | Not built | |
| | XO integration | Not built | |
| | Mainnet transaction feature | BLOCKED | Owner authorization required |
| | Chipnet deployment | BLOCKED | No network path from the box. No faucet key |
| | Shard manager (allocation, reservations, split/consolidate) | Not built | |
| | Risk engine / liquidation radar beyond Paryon reads | Not built | |
| | Parallel Worlds simulation / historical replay | Not built | |
| | Notifications | Not built | |
| | Explanation engine | Not built | Bids carry plain-language explanations only |
| X01 | Cross-intent netting | Not built | |
| X02 | Health sentinel | Not built | |
| X03 | Rescue bounties | Not built | |
| X04 | (see spec) | Not built | |

Summary by status: VERIFIED 2 · TESTED 20 · READ-ONLY 1 · IMPLEMENTED 4 · BLOCKED 3 · UNSUPPORTED 2 · Not built 12.
