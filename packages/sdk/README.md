# @fuse/sdk

Typed client for the FUSE sandbox and BCH mainnet API. Transaction amounts are `bigint`. The wallet signing
package and signed auction messages preserve the decimal strings defined by their wire formats. Signing and relay are
handled separately from the SDK. Recipe publishers can use `signRecipe` from `@fuse/recipes` in their own signing
environment and submit the signed recipe through `FuseClient.submitRecipe`.

## Mainnet

The [mainnet example](../../examples/sdk-quickstart/live.ts) takes a wallet adapter and an execution policy.
The wallet adapter accepts a signing request and returns signed transaction hex after user approval.

1. Pin the deployment's attestation public key and FlashVault identity from a trusted configuration channel.
   The vault identity includes its ID, CashToken category, owner PKH, fee parameters, and exposure limit.
   [Example vault configuration](../../evidence/mainnet/live-vaults.json)
2. Connect an independent BCH mainnet reader that returns raw transaction hex, block metadata, and the current tip.
   Configure the maximum miner fee and total wallet cost in sats.
3. Use `liveVaults` and `prepareLive` to discover liquidity and obtain an unsigned transaction. Display the operation
   and constraints to the user. Pass the original request, draft, and pinned policy to `checkLiveAuthorization`.
4. Prompt the user in their wallet with the returned `prepared.sign`. The request calls for
   `SIGHASH_ALL | FORKID | UTXOS`. Pass the wallet's response and the approved preflight to `verifyLiveSigned`.
5. After approval, send the signed hex and authorization through your relay integration. The FUSE relay accepts
   `{ rawHex, authorization, userSignature? }` at `POST /api/broadcast` when enabled. Keep the receipt context
   alongside the transaction ID. Use `liveTransaction` for status, then fetch a receipt and verify it locally.

For auctions, pass the pinned key to `openLiveRfq`. Send that server-signed request to solvers, then pass their
signed quotes, the execution policy, and a trusted solver registry to `settleLiveAuction`.
The SDK checks quote signatures and RFQ binding, the transcript commitment, ranking from reported costs,
and the winning transaction. The deployment re-prices all candidates against live state. The SDK can independently
check the winner's values and constraints. Reproducing every candidate verdict requires the settlement-time inputs
and chain snapshot.

### Verification levels

| Level | Evidence |
| --- | --- |
| INCLUDED | Transaction bytes re-hash to the claimed ID and meet the reader's confirmation requirement. |
| STRUCTURE_VERIFIED | Inputs, outputs, token fields and listed continuations match the decoded transaction. |
| OUTCOME_VERIFIED | Contract transitions and fees are recomputed from the transaction and its parents using pinned vault parameters. |
| INTENT_BOUND | The transaction structure matches a signed authorization from the pinned deployment. A separate authorization-digest signature from the user's wallet is optional and reported separately. |

Use `verifyLiveReceiptLocally` with your independent reader and pinned configuration. The reader supplies confirmation
metadata. Use `verifyLiveReceipt` when you specifically want this deployment's verification result.
The existing `verifyLocally` method defaults to the sandbox explorer.

### Error handling

SDK failures surface as `FuseApiError` with HTTP status, code, and detail. A `STALE_UTXO` or
`AUTHORIZATION_EXPIRED` requires fresh preflight. On `CHAIN_UNAVAILABLE` or `NETWORK_UNAVAILABLE`,
retry after the source recovers. For signature, template, commitment, or cost failures, discard the package and check
the deployment, vault, and solver pins before retrying. If a FUSE instance reports that a reader failed for one
vault, `liveVaults` returns that vault's ID and reason alongside the available vaults.

## Sandbox

```ts
import { FuseClient } from '@fuse/sdk';
const fuse = new FuseClient('http://127.0.0.1:8787');
const plan = await fuse.compile(await fuse.draftSwap({ minOut: 30_000n }));
const a = await fuse.waitForAuction((await fuse.openSwap({ minOut: 30_000n, maxIn: 40_000_000n, maxFee: 20_000n })).auctionId);
const v = await fuse.verifyLocally(await fuse.certificate(a.certificateId!));
```

The SDK is available as a workspace package. See `examples/sdk-quickstart` for a runnable sandbox example.
