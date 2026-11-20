# Demo runbook (LOCAL, no real funds)

```bash
pnpm install
pnpm compile:contracts
pnpm dev:api                      # http://127.0.0.1:8787  (FUSE_AUCTION_WINDOW=4 seconds by default)
pnpm solvers                      # starts direct, routing, flash and rogue solver processes
pnpm --filter @fuse/web build && pnpm --filter @fuse/web start   # http://127.0.0.1:3000
```

1. **Home**: local world stats (SIMULATION) next to mainnet snapshot stats (READ-ONLY).
2. **Intent Studio** → Run auction (30k FUSD, ≤ 0.4 BCH). Watch 4 bids arrive. The adversarial fixture is
   rejected ("delivers 29700 < minOut 30000"). The flash back-run wins because it returns part of the arbitrage
   profit to the user, so the user pays less than plain routing. The pipeline goes Bidding → Verifying → Signing →
   Broadcast → Settled. The animated graph shows the FlashVault shard borrowed and repaid in one transaction.
3. **Open certificate → Verify**: VERIFIED. **Try a tampered copy**: FAILED.
4. **FlashVault**: the shard's flash count and fees went up (state commitment updated on chain).
5. **Mainnet → Cauldron pools**: 10/10 pools match the published script. **Guardian**: Paryon loans, oracle price,
   and the price-shock slider.
6. **Status**: what is real, simulated or blocked.

The flash route closes the price gap between the two pools. Click "Reset local world" in the Studio to replay.
