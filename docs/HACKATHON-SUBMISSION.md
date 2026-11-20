# BCH BLAZE 2026: submission checklist

| Requirement | State |
|---|---|
| Public repo | ✅ https://github.com/rishu4436/fuse |
| Live demo link | ✅ https://fuse-rust-eight.vercel.app (Vercel, owner-approved). Hosted LOCAL simulation with in-process API; ephemeral per-instance state; mainnet READ-ONLY; no broadcasting from the site |
| ≥1 BCH mainnet transaction feature usable by judges | ✅ DONE (owner-authorized, small value). 5 mainnet txs in block 978191: FlashVault genesis [`481c0949a090…`](https://bchexplorer.cash/tx/481c0949a0908ed9c763e6544a7a18a76902687a0c36402fa7dc892f89fc6fc4), flash use [`d50fed30913d…`](https://bchexplorer.cash/tx/d50fed30913d4f11912bed073d623eaf1f7e07b9571197fa40d4bc6d073566fe) (certificate VERIFIED, `evidence/mainnet/flash-certificate.json`), LP deposit [`234b1e1db49e…`](https://bchexplorer.cash/tx/234b1e1db49e79072dc5a470057b9ebed4bebdcdaae523c1ef47b24e9e431037), LP withdraw [`84a4a223cf5d…`](https://bchexplorer.cash/tx/84a4a223cf5d298b975c632dde682dd0a59d167f119d5cdd4d39cd436ddbac7a), sweep [`fa0c5163b849…`](https://bchexplorer.cash/tx/fa0c5163b8490a12d995f09ebc6c5cc32ebe3b3fc104951819b7cfee5d74549b). Judges can re-check any txid in the live app's Explorer (mainnet lookup). Previous plan: Owner-authorized box-wallet test plan (`pnpm mainnet …`, docs/DEMO-RUNBOOK.md): FlashVault deploy, real flash use, LP deposit/withdraw, certificate verified against mainnet, sweep. Rehearsed in the VM, then run on mainnet from the owner-funded wallet `bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9` |
| Top banner: presentation link, repo link, EMBER2026 CashTokens donation address | 🟡 banner built. Presentation URL and donation address must come from the owner (env vars). None are fabricated |
| WizardConnect and/or XO integration | 🟡 WizardConnect pairing in the Studio (QR and relay tested, real wallet untested). Signing not built. XO not built |
| Roll call / Telegram confirmation / DoraHacks registration | Owner action |
| XO bounty feedback | Owner action. Must be written personally |
