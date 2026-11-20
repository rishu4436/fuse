# @fuse/sdk

Typed client for the FUSE API. Amounts are `bigint`. Certificates are verified **client-side** with
`@fuse/proof-verifier` (raw transactions are re-hashed, so the data source cannot forge a pass). The SDK has no
broadcast call and never holds user keys.

```ts
import { FuseClient } from '@fuse/sdk';
const fuse = new FuseClient('http://127.0.0.1:8787');
const plan = await fuse.compile(await fuse.draftSwap({ minOut: 30_000n }));
const a = await fuse.waitForAuction((await fuse.openSwap({ minOut: 30_000n, maxIn: 40_000_000n, maxFee: 20_000n })).auctionId);
const v = await fuse.verifyLocally(await fuse.certificate(a.certificateId!));
```

Status: workspace package, **not published to npm** (publishing needs the owner's npm account). See
`examples/sdk-quickstart` for a standalone app.
