# Status: 20 Nov 2026 (IST), round 3

**Real and working (LOCAL BCH VM):** FlashVault BCH and token covenants. Atomic flash arbitrage through the real
Cauldron script. Composer with an independent verifier. FEP-1 policies. Auction with 3 honest solver processes and
1 adversarial one, with **F30 shard leases wired into auction close** (conflicting bids invalidated, leases released on
settle/fail/fallback). Certificates and an independent verifier. Intent compiler (10 stages, fee accounting,
explanation) with typed intents (swap, atomic arbitrage, LP deposit/withdraw; Paryon types stop as BLOCKED), parallel
worlds, cross-intent netting (X01). **Staged recovery (F11)**: per-stage verify, conflict classification, rebuild,
rebroadcast, reorg watch, RECOVERABLE position. Shard manager and LP deposit/withdraw/merge/split/pause in the VM,
**LP risk history (F40)**. **SQLite persistence** (node:sqlite, versioned migrations 1–3) for intents, auctions,
certificates, policies, alerts, solver ledger (F32), recipes, notification deliveries and vault snapshots; restored
across API restarts. **Recipe marketplace (F47)**: signed, content-addressed recipes verified in the BCH VM, never
auto-executed. **Notifications (F22)**: webhook (HMAC), Telegram and email adapters, OFF unless configured and
opted in. **@fuse/sdk (F45)** plus a standalone quickstart app that runs end-to-end in CI. Studio UI on 34 routes.

**Real and working (mainnet, READ-ONLY):** Cauldron pools verified against the published script (10/10). Paryon V1
deployment verified against npm artifacts. **Live snapshot refreshed 15:03 UTC 20 Nov 2026 via bchexplorer.cash**
(Chaingraph unspent queries time out): 191 loans decoded, 137 active, tip 978179, oracle 199.11 USD. Guardian radar,
redemption ordering grounded in contract source (F15), **interest-rate optimizer (F16)** and **redemption-arbitrage
search (F27)**, both advice only. **Mainnet tx explorer (F50)**: raw tx re-hashed locally, Paryon contracts and
state labelled. **XO (F48)**: official templates validated and pinned with @xo-cash/utils, payout scripts compiled by
the XO compiler. Moria V1 history: 12/12 MUSD transactions replayed valid (history only; Moria V1 is disabled).

**Tests:** vitest 143/143 (34 files), Playwright 78 passed (12 skipped by design) locally and again against the hosted URL (`--workers=1`), tsc 0 errors, eslint 0 problems,
next build OK. See [TEST-REPORT.md](TEST-REPORT.md). Screenshots: `evidence/screenshots/*.png` (1440×900).

**Live transactions:** 5 owner-authorized, small-value BCH **mainnet** txs from the FUSE test wallet. All are in block 978191.
* FlashVaultBCH genesis [`481c0949a090…`](https://bchexplorer.cash/tx/481c0949a0908ed9c763e6544a7a18a76902687a0c36402fa7dc892f89fc6fc4)
* Flash use [`d50fed30913d…`](https://bchexplorer.cash/tx/d50fed30913d4f11912bed073d623eaf1f7e07b9571197fa40d4bc6d073566fe). Its certificate is VERIFIED.
* LP deposit [`234b1e1db49e…`](https://bchexplorer.cash/tx/234b1e1db49e79072dc5a470057b9ebed4bebdcdaae523c1ef47b24e9e431037)
* LP withdraw [`84a4a223cf5d…`](https://bchexplorer.cash/tx/84a4a223cf5d298b975c632dde682dd0a59d167f119d5cdd4d39cd436ddbac7a)
* Sweep back to the wallet [`fa0c5163b849…`](https://bchexplorer.cash/tx/fa0c5163b8490a12d995f09ebc6c5cc32ebe3b3fc104951819b7cfee5d74549b). The vault NFT is burned, so no contract remains funded.

Miner fees were 5,320 sats in total. No chipnet transaction was made, and no external notification has been sent.
**Hosted demo:** https://fuse-rust-eight.vercel.app. It is the LOCAL simulation with the API running in-process.
State is ephemeral and kept per instance, and the site has no broadcast path.

**Blockers**
1. A user-wallet mainnet flow (WizardConnect signing) is still untested with a real wallet. The Mainnet-track
   transactions were made from the owner-funded box wallet with `scripts/mainnet/` instead. The app has no broadcast
   route.
2. Electrum/Fulcrum WSS ports blocked from the build box: chipnet and XO Engine sessions are unreachable from here.
3. Paryon write paths (F17–F20, F29, F27 execution): `@paryonusd/library` builders are not published.
4. Owner-only actions: DoraHacks registration, roll call, Telegram confirmation, EMBER2026 donation address
   (`NEXT_PUBLIC_DONATION_ADDRESS`), presentation link (`NEXT_PUBLIC_PRESENTATION_URL`), XO feedback (must be written
   personally), npm publishing of @fuse/sdk.
5. Production deployment of the demo (live link): needs owner approval.

**Next:** see [ROADMAP.md](ROADMAP.md). Real-wallet signing test (unbroadcast), F02 token vault in the demo world,
F05 pluggable adapter registry, F13 portfolio discovery by address, F26 liquidation execution (blocked on Paryon),
hosting after owner approval.
