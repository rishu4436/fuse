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

**Tests:** vitest 140/140 (32 files), Playwright 78 passed (12 skipped by design), tsc 0 errors, eslint 0 problems,
next build OK. See [TEST-REPORT.md](TEST-REPORT.md). Screenshots: `evidence/screenshots/*.png` (1440×900).

**Live transactions:** **none.** No mainnet or chipnet transaction has been broadcast. No contract is deployed.
No external notification has been sent.

**Blockers**
1. Mainnet transaction feature (Mainnet track): needs explicit owner authorization, an owner-held funded wallet and a
   real wallet. Pairing and signing requests are IMPLEMENTED, not tested with a real wallet. No broadcast route exists.
2. Electrum/Fulcrum WSS ports blocked from the build box: chipnet and XO Engine sessions are unreachable from here.
3. Paryon write paths (F17–F20, F29, F27 execution): `@paryonusd/library` builders are not published.
4. Owner-only actions: DoraHacks registration, roll call, Telegram confirmation, EMBER2026 donation address
   (`NEXT_PUBLIC_DONATION_ADDRESS`), presentation link (`NEXT_PUBLIC_PRESENTATION_URL`), XO feedback (must be written
   personally), npm publishing of @fuse/sdk.
5. Production deployment of the demo (live link): needs owner approval.

**Next:** see [ROADMAP.md](ROADMAP.md). Real-wallet signing test (unbroadcast), F02 token vault in the demo world,
F05 pluggable adapter registry, F13 portfolio discovery by address, F26 liquidation execution (blocked on Paryon),
hosting after owner approval.
