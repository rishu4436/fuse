# Status: 21 Nov 2026 (IST), round 4

**Product:** FUSE is a **live BCH DeFi execution platform** with an integrated simulation and risk-analysis engine.
The hosted app (https://fuse-rust-eight.vercel.app) opens in **LIVE mainnet** mode. The local BCH-VM sandbox is an
explicit opt-in toggle (sidebar "Live mainnet / Sandbox", stored in `localStorage['fuse-mode']`, or `?mode=sandbox`).

## Live on BCH mainnet (real chain reads, real execution)

| Area | What is live | Route / endpoint |
|---|---|---|
| Execute | Compose from live UTXOs → BCH 2026 VM simulation of every covenant input → Guardian pre-flight (hidden transfers, fee cap, net cost, spend limit, vault repaid, token side effects, unconfirmed coins) → sign (WizardConnect, or exported raw-hex package + paste signed hex) → `/api/broadcast` → confirmation tracking → certificate | `/app/execute/live`, `POST /api/live/prepare`, `/api/live/verify-signed`, `/api/broadcast`, `GET /api/live/tx/:txid`, `POST /api/live/certificate` |
| Actions | `flash` (permissionless), `flash-cauldron` (flash loan routed through two live Cauldron PUSD pools, repaid in the same tx), `deposit` / `withdraw` (vault owner only, FlashVaultBCH v1 owner path), `deploy-vault` (anyone can deploy their own vault), `consolidate` (wallet sweep) | same |
| FlashVault | `fuse-live-1` tracked from its identity-NFT genesis through every spend (flash / flash+cauldron / deposit / withdraw) | `/app/liquidity`, `GET /api/live/vaults` |
| Cauldron | PUSD pools from the Cauldron indexer, each re-verified against the raw mainnet output (script, category, sats, tokens); best 1-unit round trip | `/app/opportunities`, `GET /api/live/cauldron` |
| Guardian | Paryon V1 oracle price read live from the price contracts; loan list read live (unchanged outpoints reuse the decoded snapshot, moved/new loans decoded now; coverage reported); sentinel | `/app/guardian`, `GET /api/live/paryon-view`, `/api/live/guardian/sentinel`, `/api/live/guardian/radar` |
| Certificates | Rebuilt from the confirmed mainnet tx and verified independently | `/app/certificates` (verify any txid) |

**The server holds no keys.** `/api/broadcast` accepts only signed hex. It re-derives every source output from chain
(raw parents re-hashed), runs `vm.verify` over the whole tx, refuses fees above 50,000 sats, rate-limits 12/min per
client, and is disabled (503) unless `FUSE_BROADCAST=1` is set. Live caps for composed txs: miner fee ≤ 5,000 sats at 2 sat/B,
vault principal 10,000–50,000 sats.

## Round 4 mainnet proof (hosted path, box-only test signer)

Authorized by the owner (pt29u). Signed by `scripts/mainnet/test-signer.ts`, which runs on the build box only and is
never deployed. It refuses to sign unless the template hash matches, Guardian passed, the unsigned hex re-derives
byte-for-byte, and the net cost is within its caps. Every tx was relayed by the **deployed** `/api/broadcast`.
Evidence: `evidence/mainnet/live-run.json`, `evidence/mainnet/certificates/*.json`, `evidence/mainnet/live-vaults.json`.

| # | Action | txid | Block | Miner fee | What it proves |
|---|---|---|---|---|---|
| 1 | deploy-vault | [`5463522e…`](https://bchexplorer.cash/tx/5463522e639a4c06cc6b03bb5891cf700a5041f91156074c0c3577925025ceef) | 978214 | 566 | New FlashVaultBCH `fuse-live-1` (identity category = txid of the funding coin fa0c5163…), 30,000 sats, owner = box wallet |
| 2 | flash | [`7d5a261e…`](https://bchexplorer.cash/tx/7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79) | 978214 | 1,086 | Permissionless flash: 30,000 borrowed, 30,100 returned in the same tx; commitment flashCount 0→1. Certificate FLASH_USE VERIFIED |
| 3 | flash-cauldron | [`994b63ba…`](https://bchexplorer.cash/tx/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f) | 978214 | 1,858 | Flash loan routed through live Cauldron pools fac5a4a6… (+5,306 sats, −1 PUSD unit) and a9a2d622… (+1 unit, −5,273 sats); vault repaid 30,200. Certificate FLASH_VIA_CAULDRON VERIFIED, k-invariant holds on both legs. Loss 33 sats = pool fees (routing proof, not arbitrage) |
| 4 | deposit 10,000 | [`2f8503c8…`](https://bchexplorer.cash/tx/2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e) | 978214 | 1,290 | LP deposit via the owner path. Certificate LP_DEPOSIT VERIFIED |
| 5 | withdraw 10,000 | [`1cb03229…`](https://bchexplorer.cash/tx/1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930) | 978214 | 1,008 | LP withdraw via the owner path (fee paid from the withdrawn amount). Certificate LP_WITHDRAW VERIFIED |
| 6 | consolidate | [`603bcd3a…`](https://bchexplorer.cash/tx/603bcd3abc2451587039ea88ddf1366e3e798ff9a5e3e9eaeef074f74472c494) | CONSOLIDATE_BLOCK | 656 | Sweep: both remaining wallet coins → one coin (709,697 sats) back to the same box wallet |

One more broadcast attempt (flash-cauldron `17847454…`) was **rejected by the node** (`-26`): it had been composed from
a stale vault view (a Vercel fetch cache), so it double-spent the vault. Nothing was spent. Fixed with `cache: 'no-store'`
on every chain read; the next attempt was tx 3.

**Sats accounting (box wallet `bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9`):** start 746,394. Miner fees
6,464, Cauldron round-trip loss 33, so 6,497 sats left the owner's control (cap 150,000). The 200 sats of flash fees
went into the owner's own vault. Now: wallet **709,697** + vault `fuse-live-1` **30,200** = 739,897.
**The vault is deliberately kept funded** so judges can flash-borrow from it in the app. Only the box key can withdraw
it (`withdraw` action, or `pnpm mainnet sweep`-style owner close).

## Sandbox only (local BCH 2026 VM, simulated coins, labelled SANDBOX)

Intent compiler and auctions with 4 solver processes (3 honest + 1 adversarial), Parallel Worlds, Replay, the strategy
builder, recipe marketplace, staged recovery, shard leases, SQLite persistence, notifications (OFF unless opted in),
`@fuse/sdk`. All run the real compiled contracts in the VM; none of them move mainnet value.

## Tests

vitest 151/151 (35 files), tsc 0 errors (root + web), eslint 0 problems, next build OK, Playwright PLAYWRIGHT_RESULT against
the hosted URL (`--workers=1`). Screenshots: `evidence/screenshots/live-*.png` (LIVE) and the round-3 sandbox set. See [TEST-REPORT.md](TEST-REPORT.md).

## Open problems / blockers

1. **Real-wallet signing untested.** WizardConnect signing is wired (token-aware source outputs) but no WizardConnect
   wallet was available on the build box. The live path was proven with the box-only test signer and the raw-hex package.
2. **WalletConnect v2 (Paytaca / Cashonize)** is not wired: it needs a Reown project ID from an owner account.
3. **Indexer lag.** bchexplorer.cash backends sometimes lag the mempool by tens of seconds. Composing right after a
   broadcast can use a stale outpoint; the node rejects that (no loss). The UI says to wait for the previous tx to show.
4. **Live Paryon coverage** is partial on a cold serverless instance (it decodes up to 160 moved loans per request;
   coverage is reported in the response). The oracle price is always live.
5. **Deposit/withdraw are owner-only** (FlashVaultBCH v1 has one owner key). Users can deploy their own vault.
6. Paryon write paths (F17–F20, F29) blocked: `@paryonusd/library` builders are unpublished. Moria V1 is disabled
   (history only). Paryon V2 is not deployed.
7. Owner-only: DoraHacks registration, roll call, Telegram confirmation, EMBER2026 donation address and presentation
   link env vars, XO feedback (must be written personally), npm publishing of @fuse/sdk.
