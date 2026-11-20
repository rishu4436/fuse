# Demo runbook (LOCAL, no real funds)

```bash
pnpm install
pnpm compile:contracts
pnpm dev:api                      # http://127.0.0.1:8787  (FUSE_AUCTION_WINDOW=4 seconds by default)
pnpm solvers                      # starts direct, routing, flash and rogue solver processes
pnpm --filter @fuse/web build && pnpm --filter @fuse/web start   # http://127.0.0.1:3000
```

1. **/app** (overview): local world stats (SIMULATION) next to mainnet snapshot stats (READ-ONLY).
2. **/app/execute/new** → Run auction (30k FUSD, ≤ 0.4 BCH). Watch 4 bids arrive. The adversarial fixture is
   rejected ("delivers 29700 < minOut 30000"). The flash back-run wins because it returns part of the arbitrage
   profit to the user. The animated graph shows the FlashVault shard borrowed and repaid in one transaction. The
   compiler preview below it shows all 10 stages, fee accounting and the explanation.
3. **Open certificate → Verify**: VERIFIED. **Try a tampered copy**: FAILED. **/app/replay**: the settlement
   re-runs in a fresh VM. The Moria V1 panel shows 12/12 historical mainnet transactions replayed (READ-ONLY).
4. **/app/parallel-worlds**: the same intent under gap-closed, thin-liquidity, paused-vault and routing-only worlds.
5. **/app/liquidity**: shard health and leases. Deposit to a vault, then see the transaction in **/app/explorer**.
6. **/app/guardian**: the Paryon V1 radar with the price-shock slider and the sentinel. **/app/guardian/policies**:
   create a rule, which gives a non-executable proposal plus readiness. The alert appears in **/app/guardian/alerts**.
7. **/app/opportunities**: Cauldron pools verified (10/10) and the arbitrage scanner (it reports the real best gap,
   even when it is unprofitable).
8. **/app/strategies/builder**: drag steps. A borrow without a repay is rejected. Compile the flash recipe.
9. **/app/settings**: the broadcast switch is locked off. **/app/portfolio** (or /app/execute/new): pair WizardConnect to
   see the mainnet preflight and the `broadcast:false` signing request. Not tested with a real wallet.
10. **/status**: what is real, simulated or blocked.

Click "Reset local world" in the Studio to replay.
