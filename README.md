# FUSE: intent execution for Bitcoin Cash

FUSE runs intent auctions on Bitcoin Cash. A user states what they want and the most they will spend. Independent
solvers bid **complete, atomic transactions** that combine Cauldron pools, their own inventory and **FlashVault**
covenant liquidity, which is borrowed and repaid inside the same transaction. FUSE accepts a bid only after it passes
the BCH 2026 VM and the user's outcome has been recomputed from the transaction itself. Every settlement produces a
**certificate** that anyone can verify independently against chain data.

> **Honesty first.** The demo runs on a local BCH VM (cashscript `MockNetworkProvider`, real compiled bytecode) with
> simulated coins. Mainnet panels are **READ-ONLY**. **No mainnet or chipnet transaction has been broadcast and no
> contract is deployed.** See [docs/STATUS.md](docs/STATUS.md).

## What is real

* **FlashVault** covenants (BCH and CashToken) in CashScript 0.14, with 43 VM tests including fast-check properties.
* **Atomic flash arbitrage** through the *unmodified* Cauldron V0 pool script in the VM.
* **Cauldron mainnet verification:** 10/10 checked live PUSD pools match the published script.
* **ParyonUSD V1 mainnet verification:** every contract rebuilt from `@paryonusd/contracts@1.1.0` and matched on
  chain. 360 loans decoded, live oracle read from `PriceContractGuarded`.
* **Auction** with 4 independent solver processes (3 honest + 1 adversarial). The adversary is always rejected.
* **Studio** (Next.js 15): live auctions, animated transaction graph, certificates, Guardian radar, and WizardConnect
  wallet pairing (read-only; signing not built).

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
[Security & threat model](docs/SECURITY.md) · [Demo runbook](docs/DEMO-RUNBOOK.md) · [Hackathon checklist](docs/HACKATHON-SUBMISSION.md)

## Layout

`packages/` contracts, transaction-composer, intent, policy-engine, solver-sdk, auction, proof-verifier,
protocol-adapters, indexer-client, simulation, core, math · `services/` api, solver-reference · `apps/web` Studio ·
`scripts/verification` mainnet verification scripts · `evidence/` their outputs.

Third-party: the Cauldron pool artifact is from `@mr-zwets/cauldron-swap-sdk` (ISC). See `packages/contracts/src/third-party/`.
