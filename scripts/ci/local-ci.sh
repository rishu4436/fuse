#!/usr/bin/env bash
# Runs the same steps as .github/workflows/ci.yml on a local checkout (no GitHub needed).
set -euo pipefail
cd "$(dirname "$0")/../.."
step() { echo; echo "=== $* ($(date -u +%H:%M:%SZ))"; }
step install;            pnpm install --frozen-lockfile
step contracts;          pnpm compile:contracts && git diff --exit-code packages/contracts/artifacts
step lint;               pnpm lint
step typecheck;          pnpm typecheck && pnpm --filter @fuse/web exec tsc --noEmit -p .
step vitest;             pnpm test
step build;              node scripts/hosted/build-embedded.mjs && NEXT_PUBLIC_FIXTURE_REPLAY=1 FUSE_HOSTED=1 pnpm build
step start
node scripts/hosted/start-ci.mjs &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
curl --retry 30 --retry-connrefused --retry-delay 1 -fsS http://127.0.0.1:3000/api/health
step playwright
FUSE_FIXTURE_TEST=1 FUSE_WEB=http://127.0.0.1:3000 pnpm exec playwright test --workers=1 --reporter=line
step done
