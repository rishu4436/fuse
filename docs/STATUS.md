# Status: 20 Nov 2026 (IST)

**Real and working (LOCAL BCH VM):** FlashVault BCH and token covenants. Atomic flash arbitrage through the real
Cauldron script. Composer with an independent verifier. FEP-1 policies. Auction with 3 honest solver processes and
1 adversarial one. Certificates and an independent verifier. API with SSE. Intent compiler (10 stages, fee accounting, explanation), parallel worlds, cross-intent netting (X01).
Shard manager (leases, concurrency) and LP deposit/withdraw/merge/split/pause in the VM. Rescue bounties (X03, never
executable). FEP-1 conformance vectors (X04). WizardConnect signing request plus mainnet preflight (`broadcast:false`; no
broadcast route). Studio UI on 31 routes (all spec §16 routes under /app/*).

**Real and working (mainnet, READ-ONLY):** Cauldron pools verified against the published script (10/10). Paryon V1
deployment verified against npm artifacts. 360 loans decoded, live PriceContractGuarded oracle. Guardian radar, readiness, policies and sentinel on that snapshot
(snapshot 13:21 UTC; the refresh failed with a Chaingraph error). Moria V1 history: 12/12 MUSD transactions replayed valid.

**Tests:** vitest 102/102 (20 files), Playwright 68 passed (8 skipped by design), tsc 0 errors, eslint 0 problems, next build OK.
See [TEST-REPORT.md](TEST-REPORT.md).

**Live transactions:** **none.** No mainnet or chipnet transaction has been broadcast. No contract is deployed.

**Blockers**
1. Mainnet transaction feature (required for the Mainnet track): needs explicit owner authorization, a funded wallet
   held by the owner, and a real wallet. Pairing and signing requests are IMPLEMENTED. Neither is tested with a real
   wallet. FUSE deliberately has no broadcast route.
2. Electrum ports blocked from the build box. Chipnet is unreachable from here.
3. Paryon write paths: `@paryonusd/library` builders are not published.
4. Owner-only actions: DoraHacks registration, roll call, Telegram confirmation, EMBER2026 donation address
   (`NEXT_PUBLIC_DONATION_ADDRESS`), presentation link (`NEXT_PUBLIC_PRESENTATION_URL`), XO feedback (must be written personally).
5. Production deployment of the demo (live link): not done. It needs owner approval to deploy.

**Next:** see [ROADMAP.md](ROADMAP.md). Real-wallet signing test (unbroadcast). Leases wired into auctions. Persistence.
Hosting for the demo after owner approval.
