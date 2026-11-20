# Integration feasibility

Status labels. Each one has a single meaning, and the categories are never merged:

| Label | Meaning |
|---|---|
| **VERIFIED** | Checked against live chain data or a primary source by a reproducible script (evidence in `evidence/`). |
| **IMPLEMENTED** | Code exists but has no automated test that proves its behaviour yet. |
| **TESTED** | Automated tests exercise it (BCH VM in the loop where relevant). |
| **READ-ONLY** | Uses real mainnet data. FUSE never writes or broadcasts. |
| **BLOCKED** | Cannot be done now. The blocker is named. |
| **UNSUPPORTED** | Not possible: the protocol or deployment does not exist or is disabled. |

| Area | Item | Status | Evidence / blocker |
|---|---|---|---|
| Contracts | FlashVaultBCH covenant | TESTED | 27 VM tests plus property tests |
| Contracts | FlashVaultToken covenant | TESTED | 9 VM tests plus a property test |
| Contracts | FlashVault deployment (chipnet/mainnet) | BLOCKED | Needs funded keys and owner authorization. Nothing has been deployed |
| Cauldron | Pool script = live mainnet pools | VERIFIED | 10/10 checked pools, `evidence/cauldron-pool-verification.json` |
| Cauldron | Atomic flash arbitrage through unmodified pool bytecode | TESTED | `composition.test.ts` |
| Cauldron | Mainnet swap broadcast | BLOCKED | Owner authorization for value-moving mainnet transactions |
| ParyonUSD | V1 deployment = `@paryonusd/contracts@1.1.0` | VERIFIED | `evidence/paryon-deployment-verification.json` |
| ParyonUSD | Loan discovery, health, oracle, redemption analysis | READ-ONLY | 360 loans decoded, PriceContractGuarded price |
| ParyonUSD | Manage / change interest / liquidate | BLOCKED | `@paryonusd/library` builders not published. Needs owner-approved live tests |
| ParyonUSD | V2 | UNSUPPORTED | Not deployed |
| Moria | V1 as a live venue | UNSUPPORTED | Disabled 23 Apr 2026 |
| Wallet | WizardConnect pairing (hdwalletv1) in the Studio | IMPLEMENTED | Pairing QR is generated and the relay reports `connected` from the browser (Playwright). Address derivation after `wallet_ready` is untested because no real wallet was paired. A signing request (`broadcast:false`) with a mainnet preflight is implemented and unit-tested with a local key, but has not been tried with a real wallet |
| Execution | Composer and independent verifier | TESTED | `composer.test.ts` |
| Execution | FEP-1 policy engine | TESTED | `policy.test.ts` |
| Execution | Auction, fallback, anti-replay, rate limit | TESTED | `auction.test.ts`, `network.e2e.test.ts` |
| Execution | Certificates and independent verifier | TESTED | Fabricated and tampered certificates are rejected |
| Infra | Chaingraph client | READ-ONLY | Raw transactions re-hashed locally |
| Infra | Electrum / Fulcrum | BLOCKED | Ports 50002/50004 blocked from the build box |
| Infra | Chipnet transactions | BLOCKED | No chipnet network path from the build box. None performed, and no chipnet key generated |

## Not built yet (no status claimed)

These items have been researched but have no code yet, so they carry no status label:

* **WizardConnect signing with a real wallet.** The code path exists (`signTransaction` with `broadcast:false`, preflight,
  independent 0x61 verification) and is unit-tested with a local key. It has not been tried with a real wallet.
* **XO** templates and invitations. Bounty feedback must be written by the developer personally.
* **Moria V1 historical replay** (READ-ONLY fixtures).
* Cross-intent netting, health sentinel and rescue bounties.
