# FUSE SDK quickstart (standalone app)

A separate package that depends only on `@fuse/sdk`. It compiles a swap intent, compiles an owner flash-arbitrage
intent, reads Guardian data (READ-ONLY mainnet snapshots), lists marketplace recipes, then runs one LOCAL auction
and verifies its certificate **client-side**.

```bash
pnpm dev:api & pnpm solvers &
FUSE_API=http://127.0.0.1:8787 pnpm --filter fuse-sdk-quickstart start
```
