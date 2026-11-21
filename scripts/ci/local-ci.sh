#!/usr/bin/env bash
# Runs the same steps as ci/github-actions-ci.yml on a local checkout (no GitHub needed).
set -euo pipefail
cd "$(dirname "$0")/../.."
step() { echo; echo "=== $* ($(date -u +%H:%M:%SZ))"; }
step install;            pnpm install --frozen-lockfile
step contracts;          pnpm compile:contracts && git diff --exit-code packages/contracts/artifacts
step lint;               pnpm lint
step typecheck;          pnpm typecheck && pnpm --filter @fuse/web exec tsc --noEmit -p .
step vitest;             pnpm test
step build;              node scripts/hosted/build-embedded.mjs && FUSE_HOSTED=1 pnpm build
step start;              (cd apps/web && FUSE_HOSTED=1 npx next start -p ${PORT:-3300} > /tmp/fuse-ci-next.log 2>&1 & echo $! > /tmp/fuse-ci-next.pid)
for i in $(seq 1 60); do curl -sf http://127.0.0.1:${PORT:-3300}/api/health >/dev/null && break; sleep 2; done
trap 'kill $(cat /tmp/fuse-ci-next.pid) 2>/dev/null || true' EXIT
step playwright;         FUSE_WEB=http://127.0.0.1:${PORT:-3300} npx playwright test --workers=1 --reporter=line
step done
