# FUSE: live BCH DeFi execution, with an integrated simulation and risk engine

**BCH BLAZE judging** · [Evidence and corrected receipts](docs/SUBMISSION-EVIDENCE.md) · [Presentation](https://fusebch.vercel.app/judging/FUSE.pdf) · [Four-minute demo](https://fusebch.vercel.app/judging/FUSE-demo.mp4) · [Final checklist](docs/BCH-BLAZE-FINAL-CHECKLIST.md)

**Live app: https://fusebch.vercel.app** (opens in **LIVE mainnet** mode; the local sandbox is an explicit opt-in toggle).

FUSE is a reusable execution layer for **Bitcoin Cash DeFi**. It combines FlashVault liquidity, transaction construction,
Guardian constraints, solver quotes, and verifiable receipts. The live Cauldron integration routes a flash loan through
two pools and repays it in the same transaction. FlashVault v1 deposits and withdrawals require the vault owner's signature.
[TypeScript SDK](packages/sdk/README.md)

The live execution pipeline:

**compose from live chain state → simulate every covenant in the BCH 2026 VM → Guardian risk pre-flight → sign in your
wallet → broadcast → confirmation tracking → certificate verified against mainnet.**

The server never holds a fund key. `/api/broadcast` only relays already-signed hex **that matches an execution
authorization issued by preflight**: a Schnorr-signed, 5-minute, single-use attestation of the exact transaction
structure the user reviewed, its constraints (fee cap, recipients, vault parameters, route minimum out) and the Guardian
verdict. The relay strips scriptSigs and compares the structure byte-for-byte, re-runs the constraints and Guardian on
fresh chain state, runs the full BCH 2026 VM, and only then relays (fee guard, rate limit, off unless `FUSE_BROADCAST=1`).
The attestation public key is published at `/api/live/status`, so anyone can check an authorization.

> **Round 5 (security review, 21 Nov 2026 IST).** Intent-bound mainnet executions through the hosted path:
> * flash [`f78074a7…`](https://bchexplorer.cash/tx/f78074a7addca74462f3d2dc8e08eb66ca14370cf5dfed1a52ed8e37d0003518): broadcast under an execution authorization + wallet signature over its hash. Certificate **INTENT_BOUND**
> * **mainnet solver auction** [`cb003c56…`](https://bchexplorer.cash/tx/cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c) (block 978237): two solver processes run by the same operator answered a signed RFQ with signed quotes. The hosted API recomputed both routes, composed the winner's transaction and bound the transcript hash into the authorization and certificate.
> * Certificates are graded **INCLUDED → STRUCTURE_VERIFIED → OUTCOME_VERIFIED → INTENT_BOUND**. Contract claims (vault repayment, state transition, LP math, Cauldron k-invariant, fees) are re-derived from chain data, never trusted. The four round-4 certificates re-verify as OUTCOME_VERIFIED and are **not** intent-bound (they predate authorizations)

> **Proof (round 4, 21 Nov 2026 IST).** Executed through the **hosted app's** live path (`/api/live/prepare` → a box-only
> test signer that plays the wallet → the deployed `/api/broadcast`), all in block 978214 unless noted:
> * vault genesis `fuse-live-1` [`5463522e…`](https://bchexplorer.cash/tx/5463522e639a4c06cc6b03bb5891cf700a5041f91156074c0c3577925025ceef) (30,000 sats principal)
> * flash loan [`7d5a261e…`](https://bchexplorer.cash/tx/7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79). Certificate FLASH_USE **VERIFIED**
> * **flash loan routed through two live Cauldron PUSD pools** [`994b63ba…`](https://bchexplorer.cash/tx/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f). The demo consumed a 30,100-sat vault input and repaid it atomically. The wallet spent 1,991 sats in total, comprising 1,858 sats in miner fees, a 100-sat vault fee, and a 33-sat pool round-trip loss. The economic milestone is a route that beats a comparable direct execution after all costs. [Receipt](evidence/mainnet/submission/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f.json)
> * LP deposit [`2f8503c8…`](https://bchexplorer.cash/tx/2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e) and LP withdraw [`1cb03229…`](https://bchexplorer.cash/tx/1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930). Certificates **VERIFIED**
> * wallet consolidation [`603bcd3a…`](https://bchexplorer.cash/tx/603bcd3abc2451587039ea88ddf1366e3e798ff9a5e3e9eaeef074f74472c494)
>
> The vault stays live with 30,200 sats, so anyone can flash-borrow from it in the app. Round 3's script-driven mainnet
> run (block 978191, vault `fuse-r4`, now closed) is in [docs/DEMO-RUNBOOK.md](docs/DEMO-RUNBOOK.md).
>
> **Still sandbox-only or blocked:** the full multi-strategy intent auction (4 solvers incl. an adversary), Parallel Worlds, Replay, the strategy builder
> and the recipe marketplace run on the local BCH VM with simulated coins (labelled SANDBOX); the mainnet auction covers the
> flash → Cauldron route only and is operator-driven. A real third-party wallet, **Cashonize**, has signed a FUSE-composed
> mainnet flash over WizardConnect (round 6, [`9df5dced…`](https://bchexplorer.cash/tx/9df5dcede4a6e3a7d14f738a0a340d9f806c2317bedb33238d081a21d6bee8d0), INTENT_BOUND); other wallets and actions are untried. WalletConnect v2 (Paytaca/Cashonize) needs a Reown project ID. Paryon
> write paths are blocked (builders are unpublished). Moria V1 is disabled and shown as history only. See [docs/STATUS.md](docs/STATUS.md).

## What is real

* **FlashVault** covenants (BCH and CashToken) in CashScript 0.14, with 43 VM tests including fast-check properties.
* **Atomic flash arbitrage** through the *unmodified* Cauldron V0 pool script in the VM.
* **Cauldron mainnet verification:** 10/10 checked live PUSD pools match the published script.
* **ParyonUSD V1 mainnet verification:** every contract rebuilt from `@paryonusd/contracts@1.1.0` and matched on
  chain. Live snapshot (refreshed 15:03 UTC 20 Nov 2026 via bchexplorer.cash): 191 loans decoded, 137 active, oracle
  read from `PriceContractGuarded`.
* **Auction** with 4 independent solver processes (3 honest + 1 adversarial). The adversary is always rejected.
* **Intent compiler**: 10 stages (parse → … → certify), exact fee accounting, a plain-language explanation, parallel
  worlds (F42), and cross-intent netting (X01). Each one is verified in the VM.
* **Flash liquidity**: a shard manager with leases, TTLs and exposure caps (tested with 100 concurrent reservations),
  an adaptive layout, and LP deposit, withdraw, merge, split and pause through the vault's owner path in the VM.
* **Guardian** (live reads, advice only): a liquidation and redemption radar on the real Paryon V1 snapshot, policies, readiness,
  sentinel, in-app alerts, and rescue bounties (X03). Proposals are never executable.
* **Round 3:** shard leases wired into auctions (F30); SQLite persistence with migrations; staged recovery with
  rebuild/rebroadcast/reorg handling (F11); typed intents; interest-rate optimizer (F16) and redemption-arbitrage
  search (F27), both advice only; recipe marketplace verified in the VM, never auto-executed (F47); webhook/Telegram/
  email adapters, OFF unless opted in (F22); `@fuse/sdk` + `examples/sdk-quickstart` (F45); XO template pinning and
  XO-compiled payouts (F48); READ-ONLY mainnet tx explorer (F50); LP risk history (F40). Screenshots in
  `evidence/screenshots/`.
* **Moria V1 historical replay**: 12/12 real MUSD mainnet transactions re-evaluated valid in a fresh VM.
* **FEP-1** portable policy standard with published conformance vectors ([docs/standards/FEP-1.md](docs/standards/FEP-1.md)).
* **Live execute path** (`/app/execute/live`, `services/api/src/live/`): live UTXO, vault, Cauldron and Paryon reads
  through public indexers (raw txs re-hashed); VM simulation and Guardian before signing; WizardConnect signing
  (token-aware source outputs) or an exported raw-hex signing package with paste-back; signed-hex relay; confirmation
  tracking; mainnet certificates.
* **WizardConnect**: pairing, plus signing requests with `broadcast:false` (FUSE relays the signed hex itself, only under
  an execution authorization). Signing with a real wallet app is not yet tested.
* **CI**: `scripts/ci/local-ci.sh` (install, contract reproducibility, lint, typecheck, vitest, hosted build, Playwright
  against `next start`). The GitHub Actions workflow is staged at `ci/github-actions-ci.yml` (see ci/README.md).
* **Studio** (Next.js 15): every spec §16 route under `/app/*`, with an animated transaction graph, certificates,
  replay, explorer, strategy builder and developer docs.

## Quick start

```bash
pnpm install && pnpm compile:contracts
pnpm dev:api & pnpm solvers &
pnpm --filter @fuse/web build && pnpm --filter @fuse/web start   # http://127.0.0.1:3000
pnpm test && npx playwright test
```

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Research](docs/RESEARCH.md) · [Integration feasibility](docs/INTEGRATION-FEASIBILITY.md) ·
[Feature matrix](docs/FEATURE-MATRIX.md) · [Status](docs/STATUS.md) · [Test report](docs/TEST-REPORT.md) ·
[Security & threat model](docs/SECURITY.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [FEP-1](docs/standards/FEP-1.md) · [Demo runbook](docs/DEMO-RUNBOOK.md) · [Hackathon checklist](docs/HACKATHON-SUBMISSION.md)

## Layout

`packages/` contracts, transaction-composer, compiler, intent, policy-engine, solver-sdk, auction, proof-verifier,
flash-liquidity, risk-engine, notifications, wallet, protocol-adapters, indexer-client, simulation, core, math, store, recipes, sdk, xo · `services/` api, solver-reference · `apps/web` Studio · `examples/sdk-quickstart` ·
`scripts/verification` mainnet verification scripts · `evidence/` their outputs (indexed with sha256 in `evidence/manifest.json`).

Third-party: the Cauldron pool artifact is from `@mr-zwets/cauldron-swap-sdk` (ISC). See `packages/contracts/src/third-party/`.
