# Test report

Environment: Linux build box, Node v24.22.1, pnpm 9.15.4, cashc/cashscript 0.14.0, libauth 3.1.0-next.8,
Next.js 15.5.29, Playwright 1.65.1 (Chrome). Latest run: 21 Nov 2026 (IST), round 6 (real third-party wallet), branch `feat/phase-0-1-foundation`.
Every number below comes from an actual run. Nothing is estimated.

| # | Command | Result |
|---|---|---|
| 1 | `npx tsc --noEmit -p .` and `apps/web: npx tsc --noEmit -p .` | **0 errors** |
| 2 | `npx eslint .` | **0 problems** |
| 3 | `npx vitest run` | **40 files, 187 tests passed, 0 failed** (round 6 new: tests/wiz-wire.test.ts (3), services/api/test/relay-fanout.test.ts (3); round 5 new: authz.test.ts (15), verifier-levels.test.ts (12), live-auction.test.ts (3), embedded.test.ts (+2)) |
| 4 | `pnpm --filter @fuse/web build` and `FUSE_HOSTED=1 vercel build --prod` | **Compiled successfully** |
| 5 | `FUSE_WEB=https://fusebch.vercel.app npx playwright test --workers=1` (against the **deployed** app) | **81 passed, 0 failed, 13 skipped (94), 5.3 min**, round 6 run after the final deploy, about 03:28–03:33 UTC (8:58–9:03 AM IST). Round 5: 81 / 0 / 13 |
| 5b | `bash scripts/ci/local-ci.sh` (same steps as the staged GitHub workflow: install, contract reproducibility, lint, typecheck, vitest, hosted build, Playwright vs local `next start`) | **exit 0**: vitest 181/181, Playwright **81 passed, 0 failed, 13 skipped** (log: `evidence/ci/local-ci.log`, 02:04–02:07 UTC = 7:34–7:37 AM IST). No GitHub Actions run: the token lacks the `workflow` scope |
| 6 | Hosted mainnet e2e (`scripts/mainnet/hosted-e2e.ts`, box-only signer, deployed `/api/broadcast`) | Round 4: 6 txs. Round 5: 2 intent-bound txs (flash f78074a7…, auction cb003c56…). `scripts/mainnet/reverify-certificates.ts`: 6 vault certificates VERIFIED; levels: 4 OUTCOME_VERIFIED, 2 INTENT_BOUND (`evidence/mainnet/reverification.json`) |
| 7 | Round 6 real-wallet e2e: `scripts/wallet/cashonize-wizardconnect-e2e.mjs` (Cashonize on cashonize.com in headless Chrome, fresh seed, paired with the deployed app) | Flash [`9df5dced…`](https://bchexplorer.cash/tx/9df5dcede4a6e3a7d14f738a0a340d9f806c2317bedb33238d081a21d6bee8d0): Cashonize dialog −1,186 sats = FUSE quote; server VM check valid; `/api/broadcast` 200 `intentBound: true`, Guardian PASS at broadcast, 6/6 constraints; certificate VERIFIED · INTENT_BOUND (16/16 checks). `check-wizard-signed.ts`: inputPaths `[[1,'receive',0]]`, input 0 covenant unlock unchanged, token source output (mutable NFT) passed, input 1 Schnorr 65 B `0x61`, pubkey = m/44'/145'/0'/0/0, outputs and outpoints unchanged, local VM valid. First attempt failed with `Do not know how to serialize a BigInt` (fixed, then redeployed). bchexplorer.cash accepted the tx without propagating it; it was re-sent from the box to cashnode.bch.ninja and confirmed in the next block (relay fan-out added). Fund 5584a8b0… (box-only script), sweep 18a327a3… (Cashonize Send → max) |

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
| services/api/test/authz.test.ts | 15 | Review issue A. Valid authorization + wallet signature relays. Refused: no authorization, forged/tampered/other-key signature, expired, replayed (409 used / 409 spent), six VM-valid variants (different output script, changed amount, extra output, extra input, swapped recipients, different input) → 403, Guardian BLOCK authorization, moved chain state (422), non-owner wallet signature, relay disabled (503) |
| services/api/test/verifier-levels.test.ts | 12 | Review issue B, on real mainnet txs (fixture `services/api/test/fixtures/mainnet-txs.json`). Real Cauldron flash → OUTCOME_VERIFIED, without rederiver → STRUCTURE_VERIFIED. Forged pool drain (claim `cauldron-invariant` ok:true) → FAILED; forged vault short-change with lowered minReturn → FAILED; under-reported liquidity fee → FAILED; declared ok:false claim → FAILED; unknown custom claim → stays STRUCTURE_VERIFIED; tampered commitment → FAILED. INTENT_BOUND: real f78074a7 + authorization + wallet sig → INTENT_BOUND; other attestation key, authorization for another tx, forged wallet signature → FAILED |
| services/api/test/live-auction.test.ts | 3 | Review issue D. Two signed quotes recomputed, lowest user cost wins, transcript hash commits to everything; forged quote signature, unregistered solver, quote for another RFQ, misquote, non-composable route all rejected; RFQ not signed by the deployment or expired refused |
| tests/wiz-wire.test.ts | 3 | The WizardConnect sign request is JSON-serializable and uses the reference wire encoding Cashonize validates (hex bytes, `<bigint: Xn>` values, hex tx, token NFT kept); non-hex fields are refused |
| services/api/test/relay-fanout.test.ts | 3 | Second broadcast path (Fulcrum WSS): returns the node txid for the exact hex, surfaces a node rejection, times out instead of hanging |
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
* WizardConnect with wallets other than Cashonize (Selene, Paytaca), and live actions other than the flash, were not
  tried with a real wallet. The hosted relay fan-out to the second node is unit-tested; no hosted broadcast has used it yet.
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
* **Playwright against https://fusebch.vercel.app with `--workers=1`: 78 passed, 12 skipped.**
  * A first run with parallel workers gave 77 passed and 1 failed (the replay pick).
  * The cause was parallel clients landing on different serverless instances, which do not share state. This is a
    documented hosted-mode limitation.

### Mainnet (owner-authorized, small value)

* Five txs were sent and confirmed in block 978191; see `evidence/mainnet/run.json`.
* The flash certificate is VERIFIED against chain data.
* The underpay case was rejected locally and never sent.

## Round 4 (21 Nov 2026 IST): live mainnet execution through the hosted app

Path: `POST https://fusebch.vercel.app/api/live/prepare` (compose from live UTXOs, VM simulation, Guardian) →
`scripts/mainnet/test-signer.ts` on the build box (checks template hash, Guardian, byte-for-byte unsigned hex, own
inputs, cost caps; signs; VM-verifies locally) → `POST https://fusebch.vercel.app/api/broadcast` (re-derives
source outputs from chain, full VM verify, relays) → `GET /api/live/tx/:txid` → `POST /api/live/certificate`.

| Action | txid | Block | Fee | Certificate |
|---|---|---|---|---|
| deploy-vault | 5463522e639a4c06cc6b03bb5891cf700a5041f91156074c0c3577925025ceef | 978214 | 566 | (genesis: tracked by /api/live/vaults) |
| flash | 7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79 | 978214 | 1,086 | FLASH_USE VERIFIED |
| flash-cauldron | 994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f | 978214 | 1,858 | FLASH_VIA_CAULDRON VERIFIED (k-invariant holds on both pool legs) |
| deposit 10,000 | 2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e | 978214 | 1,290 | LP_DEPOSIT VERIFIED |
| withdraw 10,000 | 1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930 | 978214 | 1,008 | LP_WITHDRAW VERIFIED |
| consolidate | 603bcd3abc2451587039ea88ddf1366e3e798ff9a5e3e9eaeef074f74472c494 | 978215 | 656 | (wallet-only, no contract) |

Negative result: a flash-cauldron composed from a stale vault view (Vercel fetch cache) was rejected by the node
(`-26`, double-spend); nothing was spent. Fixed (`cache: 'no-store'` on chain reads) and re-run as the tx above.
Bugs found by the live screenshots and fixed: a bigint `JSON.stringify` crash on the flash → Cauldron route panel, and a
Guardian crash on the live Paryon shape (collateral-ratio stats missing). Both now have Playwright coverage.
