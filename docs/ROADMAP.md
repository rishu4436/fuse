# Roadmap

Status as of 20 Nov 2026. See [FEATURE-MATRIX.md](FEATURE-MATRIX.md) for every spec ID.

## Before the BCH BLAZE deadline (22 Nov 2026, 14:00 UTC)

1. Owner-run items (FUSE cannot do these): presentation link and EMBER2026 donation address for the banner
   (`NEXT_PUBLIC_PRESENTATION_URL`, `NEXT_PUBLIC_DONATION_ADDRESS`), roll-call and Telegram confirmation, and the
   decision on a public demo deployment.
2. Pair a real WizardConnect wallet. Run the mainnet preflight and sign with `broadcast:false`. Record the verified
   (unbroadcast) txid as evidence.
3. Refresh the Paryon snapshot when Chaingraph's category query recovers.

## Next

* Wire the shard manager's leases into the auction coordinator (F30). Add automatic rebalancing (F36).
* Persist policies, notifications and the solver ledger (F21, F22, F32). Add webhook delivery behind owner approval.
* STAGED_RECOVERABLE execution class and rebroadcast/reorg handling (F11).
* Compiler support for more intent types (LIQUIDITY_DEPOSIT/WITHDRAWAL first, then refinance).
* Chipnet deployment of the FlashVaults with a throwaway, gitignored test key and faucet coins (no real funds).

## Blocked on third parties

* Paryon V1 manage / changeInterest / liquidate / redemption transaction builders (F17–F20, F27, X03 payout). Needs
  the builders published, then owner-approved live tests.
* XO integration (F48). The engine is in early development. Bounty feedback must be written by the developer personally.
* Recipe marketplace (F47) and npm publication of the SDKs (F45, F51).
