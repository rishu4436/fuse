# FUSE: research notes

This file records what was checked against primary sources (npm tarballs, published contract source,
deployment configs, and live mainnet data read through Chaingraph) while building FUSE for BCH BLAZE
2026. The status labels have fixed meanings, listed in [INTEGRATION-FEASIBILITY.md](INTEGRATION-FEASIBILITY.md).
Research date: 20 Nov 2026 (snapshot timestamps are in `evidence/*.json`).

## 1. CashScript / BCH VM

| Fact | Source | How it was used |
|---|---|---|
| `cashc` / `cashscript` **0.14.0** compile and run the FlashVault contracts | npm | `pnpm compile:contracts` writes deterministic artifacts and a sha256 manifest |
| `MockNetworkProvider` checks every transaction in the BCH VM before it accepts it | cashscript source | All contract tests and the LOCAL world use it |
| libauth `3.1.0-next.8` provides `createVirtualMachineBch2026` | npm | The composer verifies again with its own VM instance, separate from cashscript |
| Default contract type is `p2sh32`. (`addressType` was renamed `contractType` in 0.14) | `cashscript/dist/Contract.js` | Contracts are P2SH32 |
| Inside a covenant, `this.activeBytecode` is the **redeem script**, not the locking bytecode | VM semantics | Continuation checks compare `tx.outputs[i].lockingBytecode == tx.inputs[i].lockingBytecode` |
| CashScript `tokenCategory` introspection returns the category in VM byte order with a capability byte appended (`0x01` mutable, `0x02` minting). libauth/cashscript UTXO objects use display order | VM + libauth | `categoryToVmOrder()` in `@fuse/contracts` |
| `cashc` rejects `bytes8(int)`. Use `toPaddedBytes(x, 8)` | cashc 0.14 | Vault state encoding |

## 2. Wallet signing: WizardConnect

* Packages checked: `@wizardconnect/core@0.2.11`, `@wizardconnect/dapp@0.2.8`, `@wizardconnect/react@0.2.7`.
* The `hdwalletv1` signing flow uses **SIGHASH_ALL | FORKID | UTXOS (0x61)**. FUSE's composer signs only
  with 0x61, the FlashVault owner path accepts only 0x61, and the verifier rejects any other hashtype.
* API surface: `DappConnectionManager.signTransaction({ transaction: WcSignTransactionRequest, inputPaths })`.
  `TransactionBuilder.generateWcTransactionObject()` in cashscript produces the transaction object.
* Status: the API was researched and the hashtype is aligned. A Studio connect and sign flow is **not built yet**
  (see STATUS.md).

## 3. Cauldron (V0 AMM pools)

* Pool contract: the published artifact in `@mr-zwets/cauldron-swap-sdk@0.2.0` (ISC licence), vendored
  unmodified at `packages/contracts/src/third-party/cauldron-swap.artifact.json`. The only substitution is
  the `<withdraw_pkh>` placeholder.
* Rules checked from the bytecode and SDK: the input and output are matched by index (`OP_INPUTINDEX`),
  the transaction must be **version 2**, constant product is enforced with fee = `|Δsats|·3/1000`, and one
  side of every pool is BCH.
* Indexer: `https://indexer.cauldron.quest/cauldron/pool/active?token=<category>` (chipnet: `indexer-chipnet.riften.net`).
* **VERIFIED, 20 Nov 2026:** for PUSD the indexer returned 58 active pools. 10 were checked by rebuilding the P2SH32
  locking bytecode from the artifact plus the owner pkh and fetching each UTXO from Chaingraph. **10/10 matched**
  script, satoshis, token amount and category. Evidence: `evidence/cauldron-pool-verification.json`
  (`scripts/verification/verify-cauldron-pools.ts`).
* The quote math in `@fuse/contracts` (`cauldronBuyQuote`, `cauldronSellQuote`) is BigInt, and its rounding is
  checked against the real pool script in the local VM (`composition.test.ts`).

## 4. ParyonUSD V1 (mainnet)

* Contracts: `@paryonusd/contracts@1.1.0`. Deployment parameters: `ParyonUSD/verify_contract_deployment/config.ts`.
* Token categories: PUSD / paryonTokenId `2469acc5…2544` (2 decimals), poolTokenId `7708645a…fa81`,
  redeemerTokenId `649b2d86…f930`, loanKeyFactoryTokenId `f07165f2…7405`, oracleMigrationKeyTokenId `7776202e…6d30`.
  Oracle pubkey `02d09db0…2818`. startBlockHeight 948406, period 144 blocks, redemption timelock 12. The minimum
  collateral ratio is 110%.
* Loan state is a 27-byte mutable-NFT commitment: id `0x01`, borrowed (6 bytes), beingRedeemed (6), status (1),
  lastPeriod (4), currentRate (2), nextRate (2), manager (1), minRate (2), maxRate (2).
* Price state: `0x00`, sequence (4 bytes), price (4 bytes) in **US cents per BCH**. A cross-check against CoinGecko
  ($196.45) and the on-chain value 19595 ($195.95) agreed within normal drift.
* **The live oracle has migrated to `PriceContractGuarded`.** The old `PriceContract` UTXO shows a stale price.
  FUSE rebuilds `PriceContractGuarded` from the npm artifacts and its script matches the live UTXOs.
* **VERIFIED, 20 Nov 2026, height 978170:** every V1 script rebuilt from npm plus the config appears in the genesis
  transactions (Borrowing, Collector, PriceContract, Redeemer, StabilityPool, and all 8 loan functions). Loan and
  PriceContractGuarded matched live UTXOs. Live counts: 405 unspent mutable Paryon NFTs and 360 loans at the Loan
  script, in period 206. 137 loans are active and 223 are stale. Collateral ratio over active loans: min 118.1%,
  median 141.0%, max 637.7%. Evidence: `evidence/paryon-deployment-verification.json`.
* Not available: the transaction builders (`@paryonusd/library`) are not published. Manage, change-interest and
  liquidate transactions therefore cannot be built and tested against a source of truth, so they are **BLOCKED**.
  **Paryon V2 is not deployed**, so it is **UNSUPPORTED**.

## 5. Moria

* Moria V1 was **disabled on 23 Apr 2026**. MUSD category `b38a33f7…f366` (2 decimals). Delphi v1 oracle retired.
* FUSE never treats Moria V1 as a live liquidation or redemption venue. A historical (READ-ONLY) replay is planned
  and not built.

## 6. XO

* `@xo-cash/engine@0.1.1-next.18029697917` provides templates, invitations and chipnet support. It is in early
  development.
* **Not integrated.** Bounty feedback for XO must be written by the developer personally. FUSE does not generate it.

## 7. Chain access from the build environment

* Outbound non-443 ports are blocked, so Electrum/Fulcrum on 50002 and 50004 cannot be reached (**BLOCKED**).
* Chaingraph GraphQL `https://gql.chaingraph.pat.mn/v1/graphql` works. Queries on locking-bytecode equality time out
  ("database query error"). Queries by `token_category` with an OP_RETURN exclusion work in about 28 s. Every raw
  transaction is re-hashed locally before use.

## 8. BCH BLAZE 2026 Mainnet track (requirements as understood)

* At least one BCH mainnet transaction feature that judges can use, plus a live demo link.
* A top banner with the presentation link, the repository link, and an EMBER2026 CashTokens donation address.
* WizardConnect and/or XO integration.
* Roll-call attendance and Telegram confirmation. These are **owner actions** and are not automatable.
* Judging criteria: innovation, design, technical strength, business potential.
