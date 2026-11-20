# Demo runbook (LOCAL, no real funds)

```bash
pnpm install
pnpm compile:contracts
pnpm dev:api                      # http://127.0.0.1:8787  (FUSE_AUCTION_WINDOW=4 seconds by default)
pnpm solvers                      # starts direct, routing, flash and rogue solver processes
pnpm --filter @fuse/web build && pnpm --filter @fuse/web start   # http://127.0.0.1:3000
```

1. **/app** (overview): local world stats (SIMULATION) next to mainnet snapshot stats (READ-ONLY).
2. **/app/execute/new** → Run auction (30k FUSD, ≤ 0.4 BCH). Watch 4 bids arrive. The adversarial fixture is
   rejected ("delivers 29700 < minOut 30000"). The flash back-run wins because it returns part of the arbitrage
   profit to the user. The animated graph shows the FlashVault shard borrowed and repaid in one transaction. The
   compiler preview below it shows all 10 stages, fee accounting and the explanation.
3. **Open certificate → Verify**: VERIFIED. **Try a tampered copy**: FAILED. **/app/replay**: the settlement
   re-runs in a fresh VM. The Moria V1 panel shows 12/12 historical mainnet transactions replayed (READ-ONLY).
4. **/app/parallel-worlds**: the same intent under gap-closed, thin-liquidity, paused-vault and routing-only worlds.
5. **/app/liquidity**: shard health and leases. Deposit to a vault, then see the transaction in **/app/explorer**.
6. **/app/guardian**: the Paryon V1 radar with the price-shock slider and the sentinel. **/app/guardian/policies**:
   create a rule, which gives a non-executable proposal plus readiness. The alert appears in **/app/guardian/alerts**.
7. **/app/opportunities**: Cauldron pools verified (10/10) and the arbitrage scanner (it reports the real best gap,
   even when it is unprofitable).
8. **/app/strategies/builder**: drag steps. A borrow without a repay is rejected. Compile the flash recipe.
9. **/app/settings**: the broadcast switch is locked off. **/app/portfolio** (or /app/execute/new): pair WizardConnect to
   see the mainnet preflight and the `broadcast:false` signing request. Not tested with a real wallet.
10. **/status**: what is real, simulated or blocked.

Click "Reset local world" in the Studio to replay.

## Hosted demo (Vercel)

**Live: https://fuse-rust-eight.vercel.app**. This is the same app, with the FUSE API running **in-process** in a
serverless route handler (`apps/web/app/api/[...path]/route.ts` → `services/api/src/embedded.ts`, bundled by
`scripts/hosted/build-embedded.mjs`).

* The world is the same LOCAL simulation: simulated coins in the BCH 2026 VM.
* State is **in memory, per function instance**, so a cold start resets it.
* The four reference solvers (3 honest + 1 adversarial, each with its own LOCAL fixture key) run one pass per request,
  so no background worker exists.
* `/api/events` sends recent events and closes, and the UI then polls.
* Mainnet panels are READ-ONLY (bchexplorer.cash). **The hosted site cannot broadcast anything.**

Redeploy from the repo root:
`node scripts/hosted/build-embedded.mjs && FUSE_HOSTED=1 vercel build --prod && vercel deploy --prebuilt --prod`.

## Mainnet test plan (box wallet, small value)

The owner funds a FUSE-only operator wallet that was generated on the build box with libauth secure randomness.

* **Key file:** `/home/box/secrets/fuse-mainnet-wallet.json` (mode 600). It is outside the repo, never committed and
  never printed.
* **Deposit address:** `bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9`

Every step works the same way:

* It builds the transaction, signs it, and verifies it in a local BCH 2026 VM (`verifyTemplateAndRaw`: fee cap,
  allowed outputs = wallet + vault only, strong sighash).
* It prints a preflight.
* It **only broadcasts with `--broadcast`**.

Hard caps in code (`scripts/mainnet/plan.ts`):

* ≤ 0.06 BCH used in total (fees paid + vault balance).
* ≤ 5,000 sats miner fee per transaction.
* Vault principal between 10,000 and 50,000 sats.

The chain endpoint is bchexplorer.cash's esplora API over HTTPS: `GET /api/...` for reads and `POST /api/tx` to
broadcast. Electrum TCP/WSS is blocked from the box. Local state (vault params, current vault outpoint, fees paid) is
kept in `/home/box/secrets/fuse-mainnet-state.json`. Public evidence is written to `evidence/mainnet/` only after a
broadcast.

| # | Command | What it does | Miner fee (2 sat/B) |
|---|---|---|---|
| 0 | `pnpm mainnet:rehearse` | Rehearses the whole chain offline in the VM, including the certificate check | 0 |
| 1 | `pnpm mainnet status` | Shows the wallet balance, chain tip and vault state | 0 |
| 2 | `pnpm mainnet deploy [--principal 20000] --broadcast` | (a) Consolidates to a vout-0 coin, but only if needed. (b) Creates the vault identity NFT (genesis) and funds a FlashVaultBCH with 20,000 sats. feeBps 9, minFee 100, owner = the operator key | 372 + 564 |
| 3 | `pnpm mainnet underpay` | Builds a flash that repays 1 sat short. The VM **must reject it**. It is never broadcastable, even with `--broadcast`, so it costs nothing | 0 |
| 4 | `pnpm mainnet flash --broadcast` | A real flash use: borrows the principal and repays principal + 100 sats fee to the vault in one transaction | 1,084 |
| 5 | `pnpm mainnet certificate` | Seals an execution certificate for the flash transaction from chain data, then verifies it against bchexplorer.cash. Output: `evidence/mainnet/flash-certificate.json` | 0 |
| 6 | `pnpm mainnet deposit [--amount 10000] --broadcast` | LP deposit (owner path) | 1,288 |
| 7 | `pnpm mainnet withdraw [--amount 10000] --broadcast` | LP withdraw (owner path) | 1,006 |
| 8 | `pnpm mainnet sweep --broadcast` | Owner-withdraws the whole vault and merges all wallet coins into one output back to the wallet address. The identity NFT is burned | 1,378 |

**Budget**

* The total miner fees for the full plan are **≈ 5,700 sats**. The 100-sat flash fee is paid to our own vault and comes
  back in the sweep.
* The minimum working balance is ≈ 35,000 sats: a 20,000 vault, a 10,000 deposit, and change for the fees.
  **Recommended funding: 40,000–60,000 sats.**
* The owner's ~$1.50 (≈ 781,800 sats at $191.87/BCH, CoinGecko, 20 Nov 2026) covers this many times over.
* Everything except the miner fees returns to the wallet address at the sweep.
* Run `deploy` again at step 2 if a step fails in the middle. The vault can always be swept: `sweep` uses the owner path.

## Mainnet results (20 Nov 2026)

* **Funding:** the owner sent 751,714 sats in [`9a7a2c67…ec21`](https://bchexplorer.cash/tx/9a7a2c67cd58129a33efcf47a91708f52991e0068e04f747133976d4ee17ec21) (vout 0), so no consolidation tx was needed.
* **Broadcasting:** every step was preflighted and verified in the local VM, then broadcast with `--broadcast` through bchexplorer.cash `POST /api/tx`.
* **Confirmation:** all five txs were confirmed in **block 978191**.
* **Independent checks:** raw bytes were re-hashed locally, and inclusion was checked again on Chaingraph.

| Step | txid | Miner fee |
|---|---|---|
| Genesis: FlashVaultBCH funded with 20,000 sats plus a mutable identity NFT (category `9a7a2c67…ec21`), vault `bitcoincash:rwt8qfmgcfuvuad7jxueq56v8dy5kld53202u6vgm2enc40c9u62vkr0ud034` | [`481c0949a090…`](https://bchexplorer.cash/tx/481c0949a0908ed9c763e6544a7a18a76902687a0c36402fa7dc892f89fc6fc4) | 564 |
| Flash use: borrowed 20,000 and repaid 20,000 + 100 fee to the same-index continuation in one tx (vault state: count 1, fees 100) | [`d50fed30913d…`](https://bchexplorer.cash/tx/d50fed30913d4f11912bed073d623eaf1f7e07b9571197fa40d4bc6d073566fe) | 1,084 |
| Underpay (repays 20,099 < 20,100): **rejected by the local BCH 2026 VM** (OP_VERIFY at input 0). Never broadcast; cost 0 | — (`evidence/mainnet/underpay-local-rejection.txt`) | 0 |
| LP deposit 10,000 (owner path, 0x61) | [`234b1e1db49e…`](https://bchexplorer.cash/tx/234b1e1db49e79072dc5a470057b9ebed4bebdcdaae523c1ef47b24e9e431037) | 1,288 |
| LP withdraw 10,000 (owner path) | [`84a4a223cf5d…`](https://bchexplorer.cash/tx/84a4a223cf5d298b975c632dde682dd0a59d167f119d5cdd4d39cd436ddbac7a) | 1,006 |
| Sweep: owner-withdrew the whole vault (20,100), merged the wallet coins into one output of 746,394 sats to the wallet, and burned the identity NFT | [`fa0c5163b849…`](https://bchexplorer.cash/tx/fa0c5163b8490a12d995f09ebc6c5cc32ebe3b3fc104951819b7cfee5d74549b) | 1,378 |

* **Certificate:** `cert_d50fed30913d4f11912bed07` was **VERIFIED** against chain data with 2 confirmations. Every
  check passed: tx hash re-derived, both inputs, both outputs, vault continuation returned 20,100 against 20,100
  required, and the owner receives 729,966 as recomputed from the chain. File: `evidence/mainnet/flash-certificate.json`.
  Anyone can paste the flash txid into the live app's Explorer (mainnet lookup).
* **Funds:** total miner fees were **5,320 sats** (≈ $0.01). The wallet now holds **746,394 sats** and stays under the
  owner's control.
* **Re-check the run:** `npx tsx scripts/mainnet/verify-run.ts` re-reads every tx and rewrites `evidence/mainnet/run.json`.
