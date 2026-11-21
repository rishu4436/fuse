# FUSE mainnet evidence

In block **978214**, one BCH transaction consumed the FlashVault, bought one base unit of PUSD from one Cauldron pool, sold it into another and continued all three contracts. The wallet spent **1,991 sats**. Both pool continuations satisfy their invariant. Recorded buy and sell values were 5,306 and 5,273 sats. The 33-sat trading loss, 100-sat vault fee and 1,858-sat miner fee account for the entire cost.

## Independently reconstructed chain record

On 21 November 2026, the read-only audit fetched raw transactions and their parents from cashnode.bch.ninja. It double-hashed the bytes, decoded parent outputs, recomputed miner fees, and checked the Merkle path of each listed transaction against the root in its BCH block header. Chain height at observation was **978281**. Block headers and heights ultimately depend on the selected node's view of the best chain. All 19 raw transactions, 16 inclusion proofs, block headers and outpoints are included in the [audit data](../evidence/mainnet/submission/chain-audit.json).

The original explorer paired correct block hashes with incorrect heights on seven submitted receipts. Each original fails the new block-metadata check. The linked replacements retain the original transaction IDs and authorizations, correct the inclusion metadata and recompute the certificate commitment. Preserve the originals for provenance. Use the receipts below when judging. Confirmations in recorded evidence are observations at the stated tip.

| Event | Transaction ID and explorer | Block | Miner fee, sats | Wallet change, sats | Evidence |
|---|---|---:|---:|---:|---|
| Original vault deployment | [481c0949a0908ed9c763e6544a7a18a76902687a0c36402fa7dc892f89fc6fc4](https://bchexplorer.cash/tx/481c0949a0908ed9c763e6544a7a18a76902687a0c36402fa7dc892f89fc6fc4) | 978191 | 564 | — | Inclusion and recomputed miner fee |
| Original flash | [d50fed30913d4f11912bed073d623eaf1f7e07b9571197fa40d4bc6d073566fe](https://bchexplorer.cash/tx/d50fed30913d4f11912bed073d623eaf1f7e07b9571197fa40d4bc6d073566fe) | 978191 | 1084 | — | Inclusion and recomputed miner fee |
| Original deposit | [234b1e1db49e79072dc5a470057b9ebed4bebdcdaae523c1ef47b24e9e431037](https://bchexplorer.cash/tx/234b1e1db49e79072dc5a470057b9ebed4bebdcdaae523c1ef47b24e9e431037) | 978191 | 1288 | — | Inclusion and recomputed miner fee |
| Original withdrawal | [84a4a223cf5d298b975c632dde682dd0a59d167f119d5cdd4d39cd436ddbac7a](https://bchexplorer.cash/tx/84a4a223cf5d298b975c632dde682dd0a59d167f119d5cdd4d39cd436ddbac7a) | 978191 | 1006 | — | Inclusion and recomputed miner fee |
| Original vault closure / sweep | [fa0c5163b8490a12d995f09ebc6c5cc32ebe3b3fc104951819b7cfee5d74549b](https://bchexplorer.cash/tx/fa0c5163b8490a12d995f09ebc6c5cc32ebe3b3fc104951819b7cfee5d74549b) | 978191 | 1378 | — | Inclusion and recomputed miner fee |
| Hosted vault deployment | [5463522e639a4c06cc6b03bb5891cf700a5041f91156074c0c3577925025ceef](https://bchexplorer.cash/tx/5463522e639a4c06cc6b03bb5891cf700a5041f91156074c0c3577925025ceef) | 978214 | 566 | — | Inclusion and recomputed miner fee |
| Hosted flash | [7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79](https://bchexplorer.cash/tx/7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79) | 978214 | 1086 | -1186 | [OUTCOME_VERIFIED](../evidence/mainnet/submission/7d5a261e800dd11f55f56e0756c5f82648d62e79cd4a01d248f222c8d59ebb79.json) |
| Atomic two-pool route | [994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f](https://bchexplorer.cash/tx/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f) | 978214 | 1858 | -1991 | [OUTCOME_VERIFIED](../evidence/mainnet/submission/994b63ba75533bb36506a406ac09737fb96812c45e9224ba089f0f3e66a3dd3f.json) |
| Owner deposit | [2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e](https://bchexplorer.cash/tx/2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e) | 978214 | 1290 | -11290 | [OUTCOME_VERIFIED](../evidence/mainnet/submission/2f8503c88a3a65d2b6cc3e6dd71794a096acb67d78a7918d700696e6fd1c763e.json) |
| Owner withdrawal | [1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930](https://bchexplorer.cash/tx/1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930) | 978214 | 1008 | 8992 | [OUTCOME_VERIFIED](../evidence/mainnet/submission/1cb032299e5009c96195ecd3615d6a814c7670e9a437fc15b18d0912d03d5930.json) |
| Coin consolidation | [603bcd3abc2451587039ea88ddf1366e3e798ff9a5e3e9eaeef074f74472c494](https://bchexplorer.cash/tx/603bcd3abc2451587039ea88ddf1366e3e798ff9a5e3e9eaeef074f74472c494) | 978215 | 656 | — | Inclusion and recomputed miner fee |
| Intent-authorized flash | [f78074a7addca74462f3d2dc8e08eb66ca14370cf5dfed1a52ed8e37d0003518](https://bchexplorer.cash/tx/f78074a7addca74462f3d2dc8e08eb66ca14370cf5dfed1a52ed8e37d0003518) | 978232 | 1086 | -1186 | [INTENT_BOUND](../evidence/mainnet/submission/f78074a7addca74462f3d2dc8e08eb66ca14370cf5dfed1a52ed8e37d0003518.json) |
| Operator auction settlement | [cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c](https://bchexplorer.cash/tx/cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c) | 978237 | 1858 | -1991 | [INTENT_BOUND](../evidence/mainnet/submission/cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c.json) |
| Cashonize funding | [5584a8b0aabba5c7d250c70a6f72a5323cba6cf2d55cf283073aa93cb87af5e0](https://bchexplorer.cash/tx/5584a8b0aabba5c7d250c70a6f72a5323cba6cf2d55cf283073aa93cb87af5e0) | 978243 | 221 | — | Inclusion and recomputed miner fee |
| Cashonize-signed flash | [9df5dcede4a6e3a7d14f738a0a340d9f806c2317bedb33238d081a21d6bee8d0](https://bchexplorer.cash/tx/9df5dcede4a6e3a7d14f738a0a340d9f806c2317bedb33238d081a21d6bee8d0) | 978246 | 1086 | -1186 | [INTENT_BOUND](../evidence/mainnet/submission/9df5dcede4a6e3a7d14f738a0a340d9f806c2317bedb33238d081a21d6bee8d0.json) |
| Cashonize sweep | [18a327a3f530092f4fa269372a0e17a6f4918556a36ac6e2e2c0c895e2bc79c4](https://bchexplorer.cash/tx/18a327a3f530092f4fa269372a0e17a6f4918556a36ac6e2e2c0c895e2bc79c4) | 978247 | 196 | — | Inclusion and recomputed miner fee |

Wallet change compares BCH at the receipt's wallet script before and after. A deposit moves 10,000 sats of capital into the owner's vault plus its 1,290-sat fee. A withdrawal returns 10,000 sats less its 1,008-sat fee. A dash means no wallet outcome was asserted by this audit.

## Reading the receipts

- **Inclusion** establishes the location of specific bytes in a block. Funding, closure and consolidation rows without a reissued contract receipt have this level of chain evidence.
- **Structure** compares the certificate's input outpoints, output scripts, BCH values, token category, fungible amount and NFT fields to decoded chain data.
- **Outcome** adds recomputation of the relevant contract transitions, fees, repayment and wallet outputs. Mainnet settlement alone establishes neither intent nor profitability.
- **Intent binding** verifies that the exact transaction structure matches an authorization signed by the pinned deployment attestation key. The wallet signs its spending input. A separate signature over the authorization digest is optional and is recorded separately.
- **Auction provenance** includes the signed RFQ, two registered operator-run solver keys, quotes, tie-break and settlement. Both quotes scored 1,991 sats. The transcript commitment is bound into the winning authorization. This establishes a two-process demonstration under one operator. [Signed transcript](../evidence/mainnet/auctions/cb003c5645ec52aea77b896e7f29fba22a751ad937a8a44f4d1649f954733c3c.json)
- **Cashonize provenance** comes from the captured wallet prompts, request and response, unchanged covenant unlock and recorded 0x61 wallet signature. The chain cannot identify a wallet UI by itself. The demonstrated case is Cashonize v0.16.0 signing one flash. [Session and screenshots](../evidence/mainnet/wizardconnect-cashonize/)
- **Underpayment** has local BCH VM rejection evidence. The candidate identifier in the transcript refers to unbroadcast bytes. [Underpayment transcript](../evidence/mainnet/underpay-local-rejection.txt)

## Recheck

Paste a linked replacement receipt into the [public verifier](https://fusebch.vercel.app/verify). Use the archived files for offline inspection. To repeat the independent network audit in a disposable checkout, run `pnpm install --frozen-lockfile` and `pnpm exec tsx scripts/verification/audit-submission.ts`. It refreshes the submission observation files. The [SHA-256 manifest](../evidence/submission-manifest.json) identifies the submitted artifact bytes.
