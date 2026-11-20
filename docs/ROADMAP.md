# Roadmap

Status as of 20 Nov 2026. See [FEATURE-MATRIX.md](FEATURE-MATRIX.md) for every spec ID.

## Before the BCH BLAZE deadline (22 Nov 2026, 14:00 UTC)

1. Owner-run items (FUSE cannot do these): presentation link and EMBER2026 donation address for the banner
   (`NEXT_PUBLIC_PRESENTATION_URL`, `NEXT_PUBLIC_DONATION_ADDRESS`), roll-call and Telegram confirmation, and the
   decision on a public demo deployment.
2. Pair a real WizardConnect wallet. Run the mainnet preflight and sign with `broadcast:false`. Record the verified
   (unbroadcast) txid as evidence.
3. Paryon snapshot: refreshed via bchexplorer.cash (done, 15:03 UTC 20 Nov). Re-run before the demo.

## Next

* Done in round 3: leases in auctions (F30), SQLite persistence (F21, F22, F32), staged recovery (F11), typed
  intents (arbitrage, LP deposit/withdraw), F16 optimizer, F27 search, F47 marketplace, F45 SDK + quickstart,
  F48 XO templates/compiler, F50 mainnet explorer, F40 LP history.
* Automatic rebalancing (F36). Token vault in the demo world (F02). Pluggable adapter registry (F05).
* Portfolio discovery by address (F13): Paryon loan-key NFTs at an address.
* Chipnet deployment of the FlashVaults with a throwaway, gitignored test key and faucet coins (no real funds).

## Blocked on third parties

* Paryon V1 manage / changeInterest / liquidate / redemption transaction builders (F17–F20, F27, X03 payout). Needs
  the builders published, then owner-approved live tests.
* XO Engine sessions (F48): need Electrum WSS from a network that allows it. Bounty feedback must be written by the developer personally.
* npm publication of the SDKs (F45, F51): needs the owner's npm account.
