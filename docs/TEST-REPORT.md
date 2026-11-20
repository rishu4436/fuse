# Test report

Environment: Linux build box, Node v24.22.1, pnpm 9.15.4, cashc/cashscript 0.14.0, libauth 3.1.0-next.8,
Next.js 15.5.29, Playwright 1.65.1 (Chrome). Run on 20 Nov 2026 (IST), branch `feat/phase-0-1-foundation`,
base commit `781b54c`. Every number below comes from an actual run. Nothing is estimated.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm compile:contracts` | FlashVaultBCH 145 ops, FlashVaultToken 96 ops. Artifacts byte-identical to the committed ones |
| 2 | `npx tsc --noEmit -p .` | **0 errors** (packages, services, tests) |
| 3 | `npx eslint .` | **0 problems** (all workspaces, including apps/web) |
| 4 | `npx vitest run` | **9 files, 64 tests passed, 0 failed** |
| 5 | `pnpm --filter @fuse/web build` (`next build`) | **Compiled successfully. 14 routes** (12 static, 2 dynamic) |
| 6 | `npx playwright test` (API + 4 solver processes + `next start` running) | **26 passed, 0 failed, 2 skipped** (the demo flow and the WizardConnect QR test run on desktop only, by design) |

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
| services/api/test/network.e2e.test.ts | 1 | A real HTTP API plus **4 separate OS solver processes** with distinct keys. Two consecutive auctions settle, the adversary is rejected, and the certificate verifies over HTTP |

## Browser tests (Playwright, tests/browser/routes.spec.ts)

* 11 routes × 2 viewports (desktop 1440×960, Pixel 7): HTTP 200, a visible h1, no page errors, no console errors, no
  4xx/5xx responses, and no "API unreachable" banner.
* Labels: /mainnet and /guardian show READ-ONLY. /vault shows SIMULATION.
* Demo flow (desktop): reset the world, then Run auction → Settled, adversary "Rejected" with a minOut reason, flash
  back-run "Winner", transaction graph rendered, open certificate → **VERIFIED**, tampered copy → **FAILED**.
* WizardConnect (desktop): the pairing QR (PNG data URI) is generated from `initiateDappRelay().qrUri`. In a manual probe the relay
  status reached `connected`. No wallet was paired.

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
* WizardConnect: pairing with a real wallet not tested (no wallet available). Signing not built yet.
* Paryon write paths: BLOCKED (see INTEGRATION-FEASIBILITY.md).
