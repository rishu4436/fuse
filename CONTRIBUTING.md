# Contributing to FUSE

## Ground rules

* **Never commit keys or seeds.** Test keys are derived from public labels (`fixtureKey(label)`) or generated in
  memory, and hold only simulated value. A throwaway chipnet key, if one is ever needed, goes in a gitignored local file.
* **No value-moving mainnet transactions** without explicit owner authorization. There is no broadcast endpoint, and
  wallet requests always carry `broadcast:false`. Keep it that way.
* **Never fabricate** addresses, txids, balances, quotes or results. Mainnet data comes from scripts in
  `scripts/verification/`, and every raw transaction is re-hashed locally. Snapshots are written to `evidence/` with
  their capture time.
* Moria V1 is history only. Paryon V2 is not deployed. Neither may appear as an active venue.
* Label every surface: **SIMULATION** (local mock chain, real BCH VM), **READ-ONLY** (mainnet data) or **BLOCKED**.
* BigInt for all amounts. No floats in value paths.

## Setup

```bash
pnpm install
pnpm compile:contracts          # cashc 0.14.0; artifacts and manifest must not drift
pnpm dev:api                    # LOCAL world on :8787
pnpm solvers                    # 4 independent solver processes
pnpm dev:web                    # Studio on :3000
```

## Before you push

```bash
npx tsc --noEmit -p . && npx eslint . && npx vitest run
pnpm --filter @fuse/web build && npx playwright test   # with API + solvers + next start running
```

All of these must be green. Update `docs/FEATURE-MATRIX.md` (truthful status per spec ID) and `docs/TEST-REPORT.md`
(real numbers only) in the same PR.

## Layout

`packages/*` libraries (contracts, composer, compiler, auction, solver-sdk, flash-liquidity, risk-engine,
policy-engine, proof-verifier, wallet, simulation, ...), `services/api` (Fastify + SSE), `services/solver-reference`
(worker processes), `apps/web` (Next.js Studio), `tests/browser` (Playwright), `scripts/verification` (mainnet
read-only evidence), `docs/`.

## Commits and PRs

Conventional commits (`feat(scope): ...`, `fix(...)`, `docs: ...`). Work on feature branches and open PRs. Never
force-push shared branches and never merge to `main` without the owner's approval.
