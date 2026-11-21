# Continuous integration

[Core CI](../.github/workflows/ci.yml) installs pinned dependencies, reproduces contract artifacts, checks types, runs the offline tests, builds the hosted application and exercises desktop and mobile browsers against integrity-checked recordings. Run `bash scripts/ci/local-ci.sh` with ports 3000 and 18788 free to repeat the workflow.

[Read-only mainnet smoke](../.github/workflows) probes current external services and the public deployment separately. A red smoke result records a real reachability, data or deployment discrepancy. See the failed step for the affected endpoint.
