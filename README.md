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
  chain. Live snapshot (refreshed 15:03 UTC 20 Nov 2026 via bchexplorer.cash): 191 loans decoded, 137 active, oracle
  read from `PriceContractGuarded`.
* **Auction** with 4 independent solver processes (3 honest + 1 adversarial). The adversary is always rejected.
* **Intent compiler**: 10 stages (parse → … → certify), exact fee accounting, a plain-language explanation, parallel
  worlds (F42), and cross-intent netting (X01). Each one is verified in the VM.
* **Flash liquidity**: a shard manager with leases, TTLs and exposure caps (tested with 100 concurrent reservations),
  an adaptive layout, and LP deposit, withdraw, merge, split and pause through the vault's owner path in the VM.
* **Guardian** (READ-ONLY): a liquidation and redemption radar on the real Paryon V1 snapshot, policies, readiness,
  sentinel, in-app alerts, and rescue bounties (X03). Proposals are never executable.
* **Round 3:** shard leases wired into auctions (F30); SQLite persistence with migrations; staged recovery with
  rebuild/rebroadcast/reorg handling (F11); typed intents; interest-rate optimizer (F16) and redemption-arbitrage
  search (F27), both advice only; recipe marketplace verified in the VM, never auto-executed (F47); webhook/Telegram/
  email adapters, OFF unless opted in (F22); `@fuse/sdk` + `examples/sdk-quickstart` (F45); XO template pinning and
  XO-compiled payouts (F48); READ-ONLY mainnet tx explorer (F50); LP risk history (F40). Screenshots in
  `evidence/screenshots/`.
* **Moria V1 historical replay**: 12/12 real MUSD mainnet transactions re-evaluated valid in a fresh VM.
* **FEP-1** portable policy standard with published conformance vectors ([docs/standards/FEP-1.md](docs/standards/FEP-1.md)).
* **WizardConnect**: pairing, and signing requests for FUSE-built transactions with a mainnet preflight. The request
  always carries `broadcast:false`. FUSE has **no broadcast route**. Signing with a real wallet is not yet tested.
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
