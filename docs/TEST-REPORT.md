# Test report

Environment: Linux build box, Node v24.22.1, pnpm 9.15.4, cashc/cashscript 0.14.0, libauth 3.1.0-next.8,
Next.js 15.5.29, Playwright 1.65.1 (Chrome). Run on 20 Nov 2026 (IST), branch `feat/phase-0-1-foundation`,
round 3 re-run at commit `3df3bcf` (plus this docs commit). Every number below comes from an actual run.
Nothing is estimated.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm compile:contracts` | FlashVaultBCH 145 ops, FlashVaultToken 96 ops. Artifacts byte-identical to the committed ones |
| 2 | `npx tsc --noEmit -p .` | **0 errors** (packages, services, tests) |
| 3 | `npx eslint .` | **0 problems** (all workspaces, including apps/web) |
| 4 | `npx vitest run` | **32 files, 140 tests passed, 0 failed** |
| 5 | `pnpm --filter @fuse/web build` (`next build`) | **Compiled successfully** (34 Studio routes) |
| 6 | `npx playwright test` (API + 4 solver processes + `next start` running) | **78 passed, 0 failed, 12 skipped** (feature flows run on desktop only, by design) |

## Unit / integration tests (vitest) per file

| File | Tests | What it proves |
|---|---|---|
| packages/contracts/test/flashvault-bch.test.ts | 27 | A valid repay passes. Underpayment of principal or fee (by 1 sat) fails. minFee is enforced. Fake continuation, look-alike vault, wrong index, stale or under-reported state, malformed commitment, solver pausing, paused shard, exposure cap, a vault-address UTXO without the identity NFT, category substitution, capability downgrade and double spend all fail. Two-shard funding works. The owner can withdraw and pause with 0x61. A non-owner fails. Hashtypes ALL, NONE\|UTXOS, SINGLE\|UTXOS and ALL\|ANYONECANPAY are rejected |
| packages/contracts/test/flashvault-token.test.ts | 9 | Token principal or fee underpayment, category substitution (worthless token), fake continuation, look-alike vault, BCH extraction and exposure cap all fail. Owner withdraw works and a non-owner fails |
| packages/contracts/test/composition.test.ts | 3 | An atomic flash arbitrage across **two unmodified Cauldron pool scripts** succeeds. The same route with the vault 1 sat short is rejected. A constant-product violation is rejected by the Cauldron script |
| packages/contracts/test/properties.test.ts | 4 | fast-check with the VM in the loop (30 runs each): a transaction is valid ⇔ returned ≥ principal + fee, for both the BCH and token vaults |
| packages/math/test/math.test.ts | 4 | Exact unit parse/format, round-trip property, ceil/floor mulDiv bracketing, ratio and bps |
| packages/transaction-composer/test/composer.test.ts | 7 | Compose, sign (0x61), finalize, verify in the BCH-2026 VM and broadcast locally. Deterministic template hash. Rejects underpayment, edits after review (redirected output) and weak sighash. Refuses to sign foreign inputs. Detects UTXO conflicts |
| packages/policy-engine/test/policy.test.ts | 4 | FEP-1: sign and verify, catching tampering, wrong network and wrong domain. APPROVAL_REQUIRED mode. Per-action, per-period, fee, action, protocol, expiry and health rules. A property test that limits are never exceeded |
| packages/auction/test/auction.test.ts | 5 | Demo 3: three honest strategies plus an adversary. The adversary is rejected for "delivers 29700 < minOut 30000", the flash back-run wins, the transaction settles in the VM, and the certificate is VERIFIED. Inflated, fabricated-txid, unsealed-edit and wrong-intent certificates are all FAILED. Replayed nonces, tampered signatures, unregistered solvers, fallback and stale UTXOs are handled |
| packages/wallet/test/wallet.test.ts | 8 | Self-consolidation excludes token coins. The preflight lists chain, wallet, inputs, outputs, fee, sighash and authorization, and always reports broadcast DISABLED. Foreign outputs and fee overpayment are flagged. The WizardConnect request carries `broadcast:false`. A valid 0x61 wallet signature is accepted. Changed outputs, ALL\|FORKID without UTXOS, and garbage are rejected |
| services/api/test/wallet-api.test.ts | 1 | Preflight → wallet signs → independent verification over HTTP. A tampered response is rejected. **No route containing "broadcast" exists** |
| packages/compiler/test/compiler.test.ts | 4 | All 10 stages run. The adversarial template is rejected, and the cheapest verified route (flash) is selected. Fee accounting conserves value exactly for every candidate and detects a leaking template. Precise stops: unsupported type (RESOLVE), Moria V1 (RESOLVE), monitor-only (AUTHORIZE), impossible bounds (CONSTRAIN), past deadline (PARSE) |
| packages/compiler/test/netting.test.ts | 1 | X01: a buy and a sell intent are netted in one transaction that is valid in the BCH VM, with both signers, conservation, and the buyer better off than the pool |
| packages/compiler/test/worlds.test.ts | 1 | F42: the flash route wins only while a gap exists. A paused vault and the routing-only world fall back correctly |
| packages/flash-liquidity/test/lp-shards.test.ts | 7 | In the VM: deposit → partial withdraw → pause (a forced flash on a paused shard fails in the covenant) → unpause → merge → split with the minting baton → full exit. A solver key cannot use the owner path. Exposure caps hold. Fee allocation is exact. **100 interleaved async reservations never double-lease a shard.** Three leased shards settle concurrently, and an unmanaged double-use is rejected by the chain. TTL expiry and per-holder caps work. The adaptive layout follows demand quantiles and conserves liquidity |
| packages/risk-engine/test/risk.test.ts | 6 | On the **real Paryon V1 mainnet snapshot**: 360 loans tiered, the stale count matches, the minimum CR matches the snapshot. Price shock is monotonic. Exact liquidation-price boundary. Rules give non-executable proposals with exact top-up math. Readiness is honest. The sentinel reports Moria disabled and Paryon V2 not deployed. Notifications dedupe |
| packages/risk-engine/test/bounty.test.ts | 2 | X03: valid rescue claims are capped. Tampered offers, insufficient improvement, expiry and debt increase are rejected. Never executable |
| packages/policy-engine/test/fep1-vectors.test.ts | 3 | X04: the published FEP-1 vectors reproduce byte-for-byte. An **independent implementation** (node:crypto plus its own canonicalizer) reaches the same hash and accepts the signature. Negative vectors are rejected |
| packages/solver-sdk/test/scanner.test.ts | 1 | F28: finds the profitable size on a 15% gap and reports none when the gap is below two pool fees |
| services/api/test/extra-api.test.ts | 4 | Compile and parallel worlds over HTTP. Netting is verified in the VM and not submitted. Guardian radar, policy → in-app notification, readiness and sentinel. LP deposit on the local chain, explorer decode, contracts listing |
| services/api/test/network.e2e.test.ts | 2 | A real HTTP API plus **4 separate OS solver processes** with distinct keys. Two consecutive auctions settle, the adversary is rejected, and the certificate verifies over HTTP. **F45: the standalone `examples/sdk-quickstart` app runs against it and verifies its certificate client-side (VERIFIED)** |
| packages/auction/test/leases.test.ts | 2 | F30: two bids needing the same shard → the second is invalid with "F30 shard lease conflict"; leases are released on settle and on fallback |
| packages/compiler/test/staged.test.ts | 6 | F11: error classification; clean two-stage run; competitor between stages → REBUILD → completed; impossible bound → RECOVERABLE with owner outputs unspent; change to a non-owner script refused; reorg → REBROADCAST / CONFLICTED |
| packages/compiler/test/intent-types.test.ts | 3 | Typed intents: ATOMIC_ARBITRAGE and LIQUIDITY_DEPOSIT/WITHDRAWAL compile; Paryon types stop with a BLOCKED reason; unsupported types stop at RESOLVE |
| packages/store/test/store.test.ts | 2 | SQLite migrations (versioned, transactional), round-trips of intents/auctions/certificates/policies/alerts/solvers; ledger performance math |
| packages/notifications/test/adapters.test.ts | 4 | Webhook HMAC signature, Telegram and email payloads (mocked HTTP); nothing sent unless FUSE_NOTIFY_EXTERNAL=1; secrets redacted |
| packages/risk-engine/test/rates-redemption.test.ts | 4 | F16 on the real snapshot: interest formula, recommended rate is the cheapest that covers demand × multiple, never executable. F27: redemptionPrice = oracle × 1.005, exact Cauldron fills, best size reported, never executable |
| packages/recipes/test/recipes.test.ts | 3 | F47: structural rules, signature and content-hash tamper detection, compile-probe failure blocks listing, schema/envelope rejection |
| packages/xo/test/xo.test.ts | 3 | F48: 5 official XO templates validated and pinned by identifier; malformed template rejected by the XO validator; XO-compiled P2PKH payout equals an independent libauth encoding |
| packages/flash-liquidity/test/lp-history.test.ts | 1 | F40: exact drawdown net of LP flows, utilization, fee growth |
| services/api/test/persistence.test.ts | 1 | Full auction with F30 lease, API restart on the same SQLite file restores intents/auctions/certificates/ledger/policies/alerts; Telegram delivery logged SKIPPED (not opted in) |
| services/api/test/round3-api.test.ts | 6 | Typed compile, staged run (rebuild / recoverable), rates + redemption READ-ONLY, marketplace (adversarial rejected, tamper caught, publish), XO API, LP history |
| services/api/test/mainnet-explorer.test.ts | 2 | F50: decodes a **real mainnet Paryon oracle tx** (fixture fetched from bchexplorer.cash, txid re-derived), labels PriceContract and decodes priceRaw 19911; a lying indexer (hash mismatch) is rejected |

## Browser tests (Playwright, tests/browser/routes.spec.ts)

* 29 routes × 2 viewports (desktop 1440×960, Pixel 7): HTTP 200, a visible h1, no page errors, no console errors, no
  4xx/5xx responses, and no "API unreachable" banner. The routes are every spec §16 route plus /verify.
* Labels: /app/opportunities and /app/guardian show READ-ONLY. /app/liquidity shows SIMULATION. The old route /studio
  redirects to /app/execute/new.
* Demo flow (desktop): reset the world, then Run auction → Settled, adversary "Rejected" with a minOut reason, flash
  back-run "Winner", transaction graph rendered, open certificate → **VERIFIED**, tampered copy → **FAILED**,
  then /app/replay re-runs the settlement in a fresh VM → all inputs valid.
* Feature flows (desktop): compile preview (10 stages ok, explanation "Receive 30,000 FUSD"). Parallel worlds (base
  = flash, paused vault ≠ flash). Guardian policy → non-executable proposal → readiness → in-app alert. LP deposit
  accepted on the local chain and decoded in the explorer. Strategy builder rejects an unrepaid borrow and compiles a
  valid flash recipe. The settings broadcast switch is disabled and off.
* Round 3 flows (desktop): staged recovery (competitor → REBUILD, impossible bound → RECOVERABLE with "Unspent, yours"), recipe marketplace (adversarial recipe REJECTED; composer submission without repay rejected with "must be repaid"), rate optimizer + redemption search (READ-ONLY, "not published" blocker shown), XO payout compile (76a914…), LP history panel after a deposit. 34 routes × 2 viewports.
* WizardConnect (desktop): the pairing QR (PNG data URI) is generated from `initiateDappRelay().qrUri`.

## Mainnet READ-ONLY evidence runs

* `scripts/verification/replay-moria-history.ts` (20 Nov 2026): 18 MUSD transactions found and 12 replayed. **12/12
  valid** in a fresh BCH 2026 VM (blocks 897957–898378). See evidence/moria-historical-replay.json.
* Paryon live refresh (round 3): Chaingraph unspent queries still time out (~60 s, "database query error"), so
  `scripts/verification/refresh-paryon-esplora.ts` refreshed via bchexplorer.cash (esplora API; raw txs re-hashed
  locally): **191 loans decoded (137 active) at tip 978179, 15:03 UTC 20 Nov 2026**, oracle 199.11 USD. The endpoint
  caps unspent lists at 200; loans were also traced forward from the previous snapshot. 141 outpoints from the previous
  snapshot were unconfirmed transactions later dropped (absent on bchexplorer, no block inclusion on Chaingraph).
* Screenshots (1440×900, `scripts/demo/screenshots.ts`): evidence/screenshots/01-landing … 08-recipe-marketplace.png.

## Reproduce

```bash
pnpm install
pnpm compile:contracts && npx tsc --noEmit -p . && npx eslint . && npx vitest run
pnpm dev:api &            # LOCAL world on :8787
pnpm solvers &            # 4 solver processes
pnpm --filter @fuse/web build && pnpm --filter @fuse/web start &   # Studio on :3000
npx playwright test
```

## Not tested (and why)

* No chipnet or mainnet transaction was sent. Broadcast is not authorized, Electrum ports are blocked, and no funds were used.
* WizardConnect: pairing and signing with a real wallet were not tested (no wallet available). The signing request,
  preflight and verification are unit-tested with a local key standing in for the wallet.
* Fulcrum WSS coin listing for the preflight runs in the user's browser and could not be reached from the build box
  (non-443 ports blocked).
* Paryon write paths: BLOCKED (see INTEGRATION-FEASIBILITY.md).
* External notifications: adapters are tested with mocked HTTP only; nothing was sent to a real webhook, Telegram chat or mailbox.
* XO Engine sessions: Electrum WSS is not reachable from the build box.

## Round 4 (20 Nov 2026): hosting and mainnet

### Counts

* **Vitest: 143/143 across 34 files.** The new files are:
  * `tests/mainnet-plan.test.ts` (2). It rehearses the whole mainnet plan offline in the BCH 2026 VM:
    genesis → flash → underpay (VM-rejected) → deposit → withdraw → certificate (VERIFIED, including the template
    rebuilt purely from chain raws) → sweep. It also checks the cap refusals.
  * `services/api/test/embedded.test.ts` (1). Hosted mode labels itself, settles an auction lazily through the
    in-process solvers, and offers no broadcasting.
* **Playwright against https://fuse-rust-eight.vercel.app with `--workers=1`: 78 passed, 12 skipped.**
  * A first run with parallel workers gave 77 passed and 1 failed (the replay pick).
  * The cause was parallel clients landing on different serverless instances, which do not share state. This is a
    documented hosted-mode limitation.

### Mainnet (owner-authorized, small value)

* Five txs were sent and confirmed in block 978191; see `evidence/mainnet/run.json`.
* The flash certificate is VERIFIED against chain data.
* The underpay case was rejected locally and never sent.
