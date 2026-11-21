# FUSE judging release

Use the [pull request](https://github.com/rishu4436/fuse/pull/1) for the reviewed source and [production status](https://fusebch.vercel.app/api/live/status) for the deployed Git SHA, source diagnostics and broadcast configuration. Match the release SHA against the default branch. Vercel uses the existing FUSE project and the same two public aliases.

| Gate | How to inspect |
|---|---|
| Deterministic engineering | [GitHub Actions CI](https://github.com/rishu4436/fuse/actions/workflows/ci.yml). The workflow installs the frozen lockfile, reproduces contract artifacts, lints, checks types, runs Vitest, builds Next.js and runs the desktop/mobile browser projects. |
| Public service | [Actions runs](https://github.com/rishu4436/fuse/actions). The separate read-only workflow fetches the deployed chain tip, active vault, Cauldron pools, confirmed atomic transaction and independently hashed bytes. |
| Financial safety | Live composition and relay require current chain state. The released relay rechecks the exact signed authorization, BCH VM, signing flags, recipients, token data, fee and cost limits, pool transitions, expiry and unspent inputs. |
| Historical evidence | [Evidence index](SUBMISSION-EVIDENCE.md) links 16 included transactions and seven reissued receipts. Original issuance artifacts remain available for comparison. |
| Reproducibility | The [manifest](../evidence/submission-manifest.json) hashes Git blob bytes. For a listed path, compare its entry with the output of `git show HEAD:path/to/file | sha256sum` in a binary-safe shell. |
| Judging | [Runbook](DEMO-FINAL-RUNBOOK.md), [submission checklist](BCH-BLAZE-FINAL-CHECKLIST.md), [presentation](../apps/web/public/judging/FUSE.pdf) and [video](../apps/web/public/judging/FUSE-demo.mp4). |

The original Actions logs establish an upstream request timeout and repeated blocking reads. They do not identify whether DNS, rate limiting or packet loss caused the initial timeout. The old pool probe also used an unimplemented path. The release bounds concurrency and retries, uses independent source checks and reports unavailable data. CI replays integrity-checked synchronized source observations with relay disabled. Smoke reads current public data.

The server controls an attestation key. Wallet spending keys remain in the wallet. Replay reservation and rate limits operate per running instance. Network-wide conflicting spends depend on BCH consensus. An external wallet can retain unsigned bytes after export. A cached read, a successful simulation or a successful preflight cannot guarantee later inclusion. Cashonize v0.16.0 is the demonstrated wallet. Mainnet auctions recorded here used two processes under the same operator. Paryon remains read-only. The operator-owned LP flow does not implement permissionless multi-depositor custody.

A token-aware receiving address, participant eligibility and DoraHacks submission require owner confirmation. Use the checklist to complete those steps.
