# Status: 20 Nov 2026 (IST)

**Real and working (LOCAL BCH VM):** FlashVault BCH and token covenants. Atomic flash arbitrage through the real
Cauldron script. Composer with an independent verifier. FEP-1 policies. Auction with 3 honest solver processes and
1 adversarial one. Certificates and an independent verifier. API with SSE. Studio UI on 11 routes.

**Real and working (mainnet, READ-ONLY):** Cauldron pools verified against the published script (10/10). Paryon V1
deployment verified against npm artifacts. 360 loans decoded, live PriceContractGuarded oracle, Guardian radar.

**Tests:** vitest 64/64, Playwright 26 passed (2 skipped by design), tsc 0 errors, eslint 0 problems, next build OK.
See [TEST-REPORT.md](TEST-REPORT.md).

**Live transactions:** **none.** No mainnet or chipnet transaction has been broadcast. No contract is deployed.

**Blockers**
1. Mainnet transaction feature (required for the Mainnet track): needs explicit owner authorization, a funded wallet
   held by the owner, and WizardConnect signing. Pairing is IMPLEMENTED, signing is not built yet.
2. Electrum ports blocked from the build box. Chipnet is unreachable from here.
3. Paryon write paths: `@paryonusd/library` builders are not published.
4. Owner-only actions: DoraHacks registration, roll call, Telegram confirmation, EMBER2026 donation address
   (`NEXT_PUBLIC_DONATION_ADDRESS`), presentation link (`NEXT_PUBLIC_PRESENTATION_URL`), XO feedback (must be written personally).
5. Production deployment of the demo (live link): not done. It needs owner approval to deploy.

**Next:** WizardConnect connect and sign in the Studio. Shard manager. Intent compiler pipeline. Moria historical
replay. Netting, sentinel and bounties (X01–X03). Hosting for the demo after owner approval.
