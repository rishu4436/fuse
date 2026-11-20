# Third-party artifacts

`cauldron-swap.artifact.json` — Cauldron DEX V0 pool contract (swap path), copied verbatim from
`@mr-zwets/cauldron-swap-sdk@0.2.0` (`dist/artifact/swap_artifact.json`, ISC license). It is the
production Cauldron pool script with a `<withdraw_pkh>` placeholder. FUSE substitutes the pool owner
PKH and checks the resulting P2SH32 locking bytecode against live mainnet pool UTXOs
(see `scripts/verification/verify-cauldron-pools.ts`). FUSE never modifies this contract.
