# BCH BLAZE 2026: submission checklist

| Requirement | State |
|---|---|
| Public repo | ✅ https://github.com/rishu4436/fuse |
| Live demo link | ✅ https://fuse-rust-eight.vercel.app. Opens in **LIVE mainnet** mode (real chain reads, real execute path); local sandbox is opt-in |
| ≥1 BCH mainnet transaction feature usable by judges | ✅ `/app/execute/live`: anyone can flash-borrow from the live vault `fuse-live-1` (or route a flash loan through two Cauldron pools) with their own wallet: compose → VM simulation → Guardian → sign (WizardConnect or exported raw-hex package) → broadcast → certificate. Proven through the hosted path in block 978214: genesis [`5463522e…`](https://bchexplorer.cash/tx/5463522e639a4c06cc6b03bb5891cf700a5041f91156074c0c3577925025ceef), flash [`7d5a261e…`](https://bchexplorer.cash/tx/7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79), flash via Cauldron [`994b63ba…`](https://bchexplorer.cash/tx/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f), LP deposit [`2f8503c8…`](https://bchexplorer.cash/tx/2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e), LP withdraw [`1cb03229…`](https://bchexplorer.cash/tx/1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930) (4 certificates VERIFIED), consolidation [`603bcd3a…`](https://bchexplorer.cash/tx/603bcd3abc2451587039ea88ddf1366e3e798ff9a5e3e9eaeef074f74472c494). Round 3 script run: block 978191 (see DEMO-RUNBOOK) |
| Top banner: presentation link, repo link, EMBER2026 CashTokens donation address | 🟡 banner built. The presentation URL and donation address must come from the owner (env vars). None are fabricated |
| WizardConnect and/or XO integration | 🟡 WizardConnect: pairing (QR/relay tested) and signing of FUSE-composed mainnet txs wired in `/app/execute/live`. Not yet tested with a real wallet app. XO: templates pinned and payouts compiled with the XO compiler (F48, PARTIAL); no XO Engine session (WSS blocked from the build box) |
| Roll call / Telegram confirmation / DoraHacks registration | Owner action |
| XO bounty feedback | Owner action. Must be written personally |
