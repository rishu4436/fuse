# Feature matrix (spec §20)

Every spec ID F01–F51 and X01–X04 is listed below. The status is the most conservative one that is true today.

**Status vocabulary**

| Status | Meaning |
|---|---|
| VERIFIED | Checked against real BCH mainnet data, with evidence in `evidence/` |
| TESTED | Covered by automated tests (vitest and/or Playwright). Value moves only on the LOCAL mock chain, which runs the real BCH 2026 VM |
| IMPLEMENTED | Code and UI exist and are exercised by the browser tests, but are only partly unit-tested |
| PARTIAL | Part of the feature works, as described. The missing part is listed under limitations |
| BLOCKED | Cannot be completed without something outside this repository (protocol builder, owner authorization, network access) |
| NOT STARTED | No code yet |

Tests are written as `file (n)`. Paths are relative to the repo root. UI routes are under the Studio (`apps/web`).
Snapshot (2026-11-20, round 3): 32 vitest files / 140 tests, Playwright 78 passed (desktop + mobile).

## Core

| ID | Feature | Status | Implementation | Integration deps | Tests | UI entry | Evidence | Known limitations |
|---|---|---|---|---|---|---|---|---|
| F01 | Atomic FlashVault | TESTED | `packages/contracts/contracts/FlashVaultBCH.cash`, `FlashVaultToken.cash` | cashc 0.14.0, BCH 2026 VM | flashvault-bch.test.ts (27), flashvault-token.test.ts (9), properties.test.ts (4) | /app/liquidity, /app/contracts | artifacts/manifest.json (sha256 pinned) | Not deployed on chipnet or mainnet (BLOCKED: no funded key, no owner authorization) |
| F02 | Multi-asset Liquidity Vaults | PARTIAL | BCH vault + CashToken vault contracts | CashTokens | flashvault-token.test.ts (9) | /app/liquidity/vaults | — | The token vault is tested at contract level only. The demo world deploys only the BCH vault |
| F03 | Intent Execution Compiler | TESTED | `packages/compiler/src/index.ts` (PARSE → AUTHORIZE → POLICY → RESOLVE → PLAN → COMPOSE → SIMULATE → CONSTRAIN → RANK → EXPLAIN) | @fuse/intent, solver-sdk, auction (VM dry-run), policy-engine | compiler.test.ts (4), extra-api.test.ts, Playwright "compiler preview" | /app/execute/new → "Compile preview" | — | Compiles TOKEN_SWAP / ATOMIC_SINGLE_TX only. Other intent types stop at RESOLVE with UNSUPPORTED |
| F04 | UTXO Transaction Composer | TESTED | `packages/transaction-composer` | libauth, cashscript | composer.test.ts (7) | /app/explorer | — | — |
| F05 | Contract Adapter Registry | PARTIAL | Unlock-kind registry in transaction-composer (`flashvault-bch`, `flashvault-bch-owner`, `flashvault-token`, `cauldron-pool`); Paryon V1 read adapter in `packages/protocol-adapters` | Cauldron artifact, @paryonusd/contracts 1.1.0 | composer.test.ts, risk.test.ts | /app/contracts, /status | evidence/paryon-deployment-verification.json | A static map, not a pluggable runtime registry. The Paryon adapter is read-only |
| F06 | Policy Verifier | TESTED | `packages/policy-engine` (FEP-1 schema, canonical hash, Schnorr, evaluation) | — | policy.test.ts (4), fep1-vectors.test.ts (3) | /app/guardian/policies | docs/standards/fep-1-vectors.json | — |
| F07 | Financial Operation Graph | IMPLEMENTED | Role-tagged templates + `apps/web/components/tx-graph.tsx` (animated) | — | Playwright demo flow | /app/execute/:id | — | Visualization only. No separate graph data model |
| F08 | Accurate Fee Accounting | TESTED | `packages/compiler/src/fees.ts` (exact per-party BigInt deltas; Σ sats + miner fee = 0, Σ tokens = 0) | — | compiler.test.ts (conservation + tamper) | /app/execute/new → fee table | — | — |
| F09 | Flash-Swap Executor | TESTED | `flashLiquidityStrategy` in `packages/solver-sdk/src/strategies.ts` + auction settlement | FlashVault, Cauldron pool bytecode | composition.test.ts (3), auction.test.ts, network.e2e.test.ts | /app/execute/new | — | LOCAL only. Mainnet flash swaps are not broadcast |
| F10 | BCH VM Transaction Simulator | TESTED | `dryRunCovenants`, `verifyTemplateAndRaw`, `replayRaw` | libauth `createVirtualMachineBch2026` | composer.test.ts, auction.test.ts, lp-shards.test.ts | Compile pipeline "SIMULATE" stage | — | — |
| F11 | Settlement Recovery | TESTED | Auction fallback + `packages/compiler/src/staged.ts` (STAGED_RECOVERABLE: per-stage VM verify, `classifyBroadcastError` TRANSIENT/CONFLICT/REJECTED, rebroadcast, rebuild on conflict, refuses change to non-owner scripts, RECOVERABLE position of unspent owner outputs, `watchStaged` reorg handling) + `POST /api/staged/run` | — | staged.test.ts (6), auction.test.ts, round3-api.test.ts, Playwright (competitor → REBUILD; impossible bound → RECOVERABLE) | /app/execute/staged | — | LOCAL chain only. Two-stage demo (prepare + swap); reorgs are simulated |
| F12 | Execution Certificates | TESTED | `packages/proof-verifier` (schema, commitment, verify, HTML); certificates persisted in SQLite (`/api/certificates/history`) | Chain reader (local mock / Chaingraph) | auction.test.ts, network.e2e.test.ts (+ SDK client-side verification), persistence.test.ts, Playwright (VERIFIED + tamper FAILED) | /app/certificates/:id, /verify | — | Issued for LOCAL settlements only. Certificates restored from a previous session cannot be re-verified (the LOCAL chain resets) |

## Guardian

| ID | Feature | Status | Implementation | Integration deps | Tests | UI entry | Evidence | Known limitations |
|---|---|---|---|---|---|---|---|---|
| F13 | Portfolio Discovery | PARTIAL | /app/portfolio: local wallet UTXOs, WizardConnect address (read-only), watched Paryon loans | WizardConnect, Chaingraph | Playwright route test | /app/portfolio | — | Mainnet positions are not discovered automatically per owner. Paryon loans are not mapped to owner addresses |
| F14 | Liquidation Risk Radar | VERIFIED | `packages/risk-engine` `radar`, `assessLoan` (tiers, liquidation price, price shock) | Paryon V1 snapshot (Chaingraph) | risk.test.ts (6) on the real snapshot | /app/guardian | evidence/paryon-deployment-verification.json (360 loans decoded, 137 active) | Snapshot-based (refresh with scripts/verification/verify-paryon-deployment.ts). The last refresh attempt hit a Chaingraph "database query error" |
| F15 | Redemption Risk Radar | TESTED | `radar` → `redemption.active` (real `amountBeingRedeemed`) + `exposureRank` | Paryon V1 snapshot, @paryonusd/contracts 1.1.0 source | risk.test.ts, rates-redemption.test.ts | /app/guardian, /app/guardian/rates | evidence/paryon-*.json | Ordering is now grounded in contract source: `Redemption.swapTargetLoan` requires a strictly lower `currentInterestRate` and the same `lastPeriodInterestPaid`, and swap-in only accepts mature loans. Not cross-checked against an observed mainnet redemption |
| F16 | Interest Rate Optimizer | TESTED | `packages/risk-engine/src/rates.ts` `rateAdvice` (interest = rate × borrowed / 10,000,000 per 144-block period; queue shield ahead of the loan vs. redemption demand × safety multiple) + `GET /api/guardian/rates` | Paryon V1 snapshot | rates-redemption.test.ts, round3-api.test.ts, Playwright | /app/guardian/rates | evidence/paryon-deployment-verification.json | READ-ONLY advice, `executable:false`. Applying a rate needs `changeInterest` (F17, BLOCKED) |
| F17 | Delegated Interest Management | BLOCKED | — | Paryon `changeInterest` builder | — | — | PARYON_OPERATION_STATUS | The Paryon transaction builder is unpublished. Needs owner-approved live tests |
| F18 | Automated Debt Repayment | BLOCKED | Proposal math only: `evaluateRules` PROPOSE_REPAY | Paryon `manage` builder | risk.test.ts | /app/guardian/policies | — | Execution blocked (same reason as F17). Proposals are marked `executable:false` |
| F19 | Collateral Defense | BLOCKED | Proposal math only: PROPOSE_TOP_UP (exact sats to reach target CR) | Paryon `manage` builder | risk.test.ts, extra-api.test.ts, Playwright | /app/guardian/policies | — | Same as F18 |
| F20 | Emergency Position Exit | BLOCKED | PROPOSE_EXIT rule type only | Paryon builders | — | /app/guardian/policies | — | Same as F18 |
| F21 | Guardian Strategy Policies | TESTED | `GuardianPolicy` rules + `/api/guardian/policies`, persisted in SQLite | — | risk.test.ts, extra-api.test.ts, persistence.test.ts, Playwright | /app/guardian/policies | — | — |
| F22 | Multi-channel Notifications | TESTED | `packages/notifications`: in-app (dedupe, cooldown) + webhook (HMAC `x-fuse-signature`), Telegram Bot API and Resend-compatible email adapters, severity thresholds, secret redaction, delivery log persisted | — | adapters.test.ts (4, mocked HTTP), risk.test.ts, persistence.test.ts, Playwright | /app/guardian/alerts, /app/settings | — | External channels are OFF unless credentials are set AND `FUSE_NOTIFY_EXTERNAL=1`. No live delivery to a real endpoint has been made |
| F23 | Protection Readiness Monitor | TESTED | `readiness()`: position found, active, policy, channel, data freshness, funding, execution path | — | risk.test.ts, extra-api.test.ts | /app/guardian/policies (per policy) | — | Reports auto-protection UNAVAILABLE (truthful, because F17–F20 are blocked) |

## Solver network

| ID | Feature | Status | Implementation | Integration deps | Tests | UI entry | Evidence | Known limitations |
|---|---|---|---|---|---|---|---|---|
| F24 | Solver Registration | TESTED | `AuctionEngine.registerSolver`, `/api/solvers/register` | — | auction.test.ts, network.e2e.test.ts (4 processes, distinct keys) | /app/solvers | — | No bond or stake |
| F25 | Intent Auction | TESTED | `packages/auction` (signed bids, VM dry-run, recomputed outcome, ranking) | — | auction.test.ts (5), network.e2e.test.ts | /app/execute/new | — | LOCAL only |
| F26 | Liquidation Search | PARTIAL | The radar finds LIQUIDATABLE / CRITICAL loans, including under price shock | Paryon V1 snapshot | risk.test.ts | /app/guardian | evidence/paryon-*.json | Read-only search. Liquidation execution is BLOCKED |
| F27 | Redemption Arbitrage | PARTIAL | `packages/risk-engine/src/redemption.ts` `redemptionArbitrage` (exact greedy Cauldron fills vs. oracle × 1005/1000; target = lowest-rate mature loan; profit curve; risks) + `GET /api/opportunities/redemption` | Cauldron + Paryon snapshots | rates-redemption.test.ts, round3-api.test.ts, Playwright | /app/guardian/rates | evidence/*.json | Detection only, `executable:false`. Execution is non-atomic (12-block timelock, cancelled on a new period) and BLOCKED on the unpublished Paryon builders. On the current snapshot the best size is unprofitable |
| F28 | Arbitrage Scanner | TESTED | `scanArbitrage` (exact Cauldron quotes) + `/api/opportunities` | Cauldron mainnet snapshot | scanner.test.ts (1) | /app/opportunities | evidence/cauldron-pool-verification.json (10 verified pools scanned: best gap 11 bps, no profitable arbitrage at snapshot) | Snapshot analysis only. Nothing is executed on mainnet |
| F29 | Refinancing Solver | BLOCKED | Rate-only advice is covered by F16 | Paryon `changeInterest` / `manage` builders | — | /app/guardian/rates | — | Refinancing moves a live Paryon loan; the builders (@paryonusd/library) are unpublished and Moria V1 is disabled, so no honest refinance path exists |
| F30 | UTXO Reservation Coordinator | TESTED | `ShardManager` leases (exclusive, TTL, per-holder caps, `reserveExact`) wired into `AuctionEngine` (`leases` option): winner's FlashVault shards are leased at close, conflicting bids marked invalid, leases released on settle/fail/fallback; `/api/auctions/open` hides shards leased by others; `POST /api/solver/lease` | — | lp-shards.test.ts (100 interleaved reservations), leases.test.ts (2), persistence.test.ts | /app/liquidity (leases) | — | LOCAL only |
| F31 | Fallback Execution | TESTED | `AuctionEngine.fallback` (promote next valid bid) | — | auction.test.ts | /app/execute/:id | — | — |
| F32 | Solver Performance Ledger | TESTED | SQLite `solver_ledger` (WIN/LOSS/REJECTED/LEASE_CONFLICT/FALLBACK/SETTLE_FAILED rows with latency, revenue, improvement vs. next-best bid) + `performance()` (win rate, validity rate, avg latency, top rejection reasons) | — | store.test.ts (2), persistence.test.ts, Playwright | /app/solvers | — | LOCAL auctions only |

## Liquidity

| ID | Feature | Status | Implementation | Integration deps | Tests | UI entry | Evidence | Known limitations |
|---|---|---|---|---|---|---|---|---|
| F33 | Liquidity Deposits | TESTED | `buildDeposit` (owner path, 0x61) + `/api/liquidity/op` | FlashVault owner path | lp-shards.test.ts, extra-api.test.ts, Playwright | /app/liquidity | — | Single LP owner key per vault on-chain. The LP key is a LOCAL fixture |
| F34 | Liquidity Withdrawals | TESTED | `buildWithdraw` (partial, or full exit returning the identity NFT) | FlashVault owner path | lp-shards.test.ts | /app/liquidity | — | Same as F33 |
| F35 | Fee Allocation | TESTED | `allocateFees` (pro-rata, exact remainder handling) | — | lp-shards.test.ts | — | — | Off-chain accounting. On-chain fees accrue per shard state (`cumulativeFees`) |
| F36 | Adaptive Liquidity Sharding | TESTED | `planLayout` (demand quantiles) + `buildSplit` (minting baton) / `buildMerge` | Vault minting baton | lp-shards.test.ts | /app/liquidity (plan + split/merge) | — | Rebalancing runs on request, not automatically |
| F37 | Exposure Caps | TESTED | Contract `maxExposure`, plus manager per-holder cap and lease limit | — | flashvault-bch.test.ts, lp-shards.test.ts | /app/liquidity | — | — |
| F38 | Liquidity Health Monitoring | TESTED | `vaultHealth` (utilization, paused, fees, largest free shard) | — | lp-shards.test.ts, extra-api.test.ts | /app/liquidity | — | No time series |
| F39 | Emergency Controls | TESTED | `buildPause` (flag byte); `flash()` refuses paused shards in the VM | — | lp-shards.test.ts, flashvault-bch.test.ts | /app/liquidity (pause/unpause) | — | — |
| F40 | LP Risk Dashboard | TESTED | Liquidity page + `lpRiskHistory` (exact drawdown net of LP deposits/withdrawals, peak/avg utilization, fee growth) over vault snapshots persisted on every accepted tx / LP op (migration 3) + `GET /api/liquidity/history` | — | lp-history.test.ts (1), round3-api.test.ts, Playwright | /app/liquidity | — | Per API session (the LOCAL chain resets on restart) |

## Studio / developer

| ID | Feature | Status | Implementation | Integration deps | Tests | UI entry | Evidence | Known limitations |
|---|---|---|---|---|---|---|---|---|
| F41 | Visual Strategy Builder | IMPLEMENTED | `apps/web/app/app/strategies/builder` (drag to reorder, structural checks, real compile) | @fuse/compiler | Playwright "strategy builder" | /app/strategies/builder | — | Supports 3 recipe shapes. Other valid shapes are rejected rather than guessed |
| F42 | Parallel Worlds Simulation | TESTED | `packages/compiler/src/worlds.ts` (6 scenarios) | — | worlds.test.ts (1), Playwright | /app/parallel-worlds | — | Fixed scenario set |
| F43 | Historical Execution Replay | VERIFIED | `replayRaw` (proof-verifier) + `/api/replay/:certId` (LOCAL) + `scripts/verification/replay-moria-history.ts` (mainnet) | Chaingraph | Playwright demo (replay valid) | /app/replay | evidence/moria-historical-replay.json: 12/12 Moria V1-era MUSD transactions re-evaluated valid in a fresh BCH 2026 VM | FUSE does not decode Moria contract semantics. Moria V1 is history only, never a venue |
| F44 | Contract Inspector | IMPLEMENTED | `/api/contracts` + /app/contracts (hash, opcodes, ABI, source) | — | Playwright route test, extra-api.test.ts | /app/contracts | artifacts/manifest.json | Shows FUSE contracts only |
| F45 | Public TypeScript SDK | TESTED | `packages/sdk` (`@fuse/sdk` FuseClient: compile, typed intents, auctions, client-side certificate verification, Guardian, marketplace) + standalone app `examples/sdk-quickstart`; also `@fuse/solver-sdk`, `@fuse/proof-verifier`, `@fuse/policy-engine` | — | network.e2e.test.ts (quickstart runs end-to-end and verifies its certificate client-side) | /developers/sdk | — | Not published to npm (needs the owner's npm account) |
| F46 | REST and Real-Time APIs | TESTED | `services/api` (Fastify) + SSE `/api/events` | — | wallet-api, extra-api, network.e2e tests | /developers/api | — | No auth or rate limits on Studio endpoints (local demo) |
| F47 | Recipe Marketplace | TESTED | `packages/recipes` (`fuse.recipe/v1` schema, content hash, Schnorr author signature, structural rules, compile probe) + `/api/marketplace/*` (seeded incl. an adversarial unrepaid-borrow recipe; verdicts recomputed against the current market on each read) | — | recipes.test.ts (3), round3-api.test.ts, Playwright | /developers/recipes | — | LOCAL marketplace; studio submissions are signed with a fixture key. Never auto-executes |
| F48 | XO Integration | PARTIAL | `packages/xo`: official templates validated with `@xo-cash/utils` `parseTemplate` and pinned by `generateTemplateIdentifier`; intent payout script compiled from a public key by the XO CashAssembly compiler (cross-checked against libauth) + `/api/xo/*` | @xo-cash/utils 0.0.11, @xo-cash/templates 0.0.12 | xo.test.ts (3), round3-api.test.ts, Playwright | /developers/xo | — | XO Engine (accounts, invitations) BLOCKED: it needs Electrum WSS, which this build box cannot reach. XO bounty feedback must be written by the developer personally; FUSE does not generate it |
| F49 | Portable Policy Templates | TESTED | `POLICY_TEMPLATES` (conservativeRescue, swapGuard) on FEP-1 | — | policy.test.ts | /app/guardian/policies | — | Two templates |
| F50 | Transaction Explorer | TESTED | `/api/explorer` (LOCAL) + `/api/explorer/mainnet/:txid` (READ-ONLY: raw hex from bchexplorer.cash re-hashed locally, Paryon contract/state labelling) | bchexplorer.cash | mainnet-explorer.test.ts (2, real mainnet oracle tx fixture), Playwright (LP tx decoded) | /app/explorer | tests/fixtures/mainnet-paryon-oracle-tx.json | Labels only exact matches with rebuilt Paryon V1 scripts; Cauldron pools are not labelled yet |
| F51 | Proof Verification SDK | TESTED | `@fuse/proof-verifier` (`verifyCertificate`, chain readers, `replayRaw`) | Chaingraph reader | auction.test.ts, network.e2e.test.ts | /verify | — | Not published to npm |

## Innovations

| ID | Feature | Status | Implementation | Integration deps | Tests | UI entry | Evidence | Known limitations |
|---|---|---|---|---|---|---|---|---|
| X01 | Cross-Intent Netting | TESTED | `packages/compiler/src/netting.ts` (one tx, pool mid price, residual reported) | — | netting.test.ts (VM-valid, both signers, conservation), extra-api.test.ts | /app/strategies, `POST /api/netting/simulate` | — | Pairwise matching. The counter-intent in the API demo is a fixture |
| X02 | Protocol Health Sentinel | TESTED | `sentinel()` (oracle consistency, stale-loan share, freshness, Moria disabled, Paryon V2 not deployed) | Paryon snapshot | risk.test.ts | /app/guardian | evidence/paryon-*.json | Snapshot-based |
| X03 | Rescue Bounties | PARTIAL | `packages/risk-engine/src/bounty.ts` (signed offer, claim validation, cap) | Paryon `manage` builder | bounty.test.ts (2) | — | — | The payout must be atomic with a rescue, and the Paryon rescue path is BLOCKED, so nothing executes |
| X04 | Portable Execution Policy Standard | TESTED | FEP-1 (`packages/policy-engine`) + `docs/standards/FEP-1.md` + conformance vectors | — | fep1-vectors.test.ts (3, including an independent node:crypto verifier) | /developers/recipes | docs/standards/fep-1-vectors.json | Not yet reviewed by any third-party implementer |

## Wallet / mainnet gate (cross-cutting)

| Item | Status | Implementation | Tests | Limitations |
|---|---|---|---|---|
| WizardConnect pairing (QR, relay) | IMPLEMENTED | components/wallet-connect.tsx | Playwright QR test | Not tested with a real wallet app |
| WizardConnect sign request for a FUSE-built tx (SIGHASH_ALL\|FORKID\|UTXOS, `broadcast:false`) | IMPLEMENTED | packages/wallet `wcSignRequest`, components/preflight.tsx | wallet.test.ts (8), wallet-api.test.ts (1) | Real-wallet signing untested. Coins are read in the user's browser from Fulcrum WSS (blocked from the build box) |
| Independent verification of the wallet-signed tx | TESTED | `verifyWalletSigned` + `/api/wallet/verify-signed` | wallet.test.ts, wallet-api.test.ts | — |
| Mainnet preflight screen, never auto-broadcasts | TESTED | `preflight()` items/checks, `broadcast:'DISABLED'`; no broadcast route exists (asserted) | wallet-api.test.ts, Playwright (settings switch locked) | — |
