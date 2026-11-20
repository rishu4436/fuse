// An independent solver process. Each worker holds its OWN key (a deterministic LOCAL fixture key — test
// only, never funded), discovers open auctions over HTTP, builds a template with its strategy, signs the
// bid, and signs its own inputs only if selected. Usage: tsx worker.ts <direct|routing|flash|rogue>
import { binToHex } from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';
import { SolverClient, STRATEGIES, signBid, solverIdOf } from '@fuse/solver-sdk';
import { signInputs } from '@fuse/transaction-composer';
import { fixtureKey } from '@fuse/simulation';

const kinds = { direct: 'DIRECT_LIQUIDITY', routing: 'ROUTING', flash: 'FLASH_LIQUIDITY', rogue: 'ADVERSARIAL_FIXTURE' } as const;
const kind = process.argv[2] as keyof typeof kinds;
if (!kinds[kind]) { console.error('usage: worker.ts <direct|routing|flash|rogue>'); process.exit(2); }
const strategy = kinds[kind];
const key = fixtureKey(`solver-${kind}`);
const pubkey = binToHex(key.pub);
const solverId = solverIdOf(pubkey);
const api = process.env.FUSE_API ?? 'http://127.0.0.1:8787';
const client = new SolverClient(api, solverId);
const seen = new Set<string>();
const log = (...a: unknown[]) => console.log(`[${kind}:${process.pid}]`, ...a);

async function myUtxos() {
  const r = await fetch(`${api}/api/chain/utxos?address=${encodeURIComponent(key.address)}`);
  const { fromJson } = await import('@fuse/solver-sdk');
  return fromJson<Array<{ txid: string; vout: number; satoshis: bigint; token?: never }>>(await r.text());
}

async function loop() {
  for (const a of await client.openAuctions()) {
    if (seen.has(a.auctionId)) continue;
    seen.add(a.auctionId);
    try {
      const utxos = await myUtxos();
      const identity = { id: solverId, pubkey, lockingBytecode: key.lockingBytecode, coins: utxos.filter((u) => !(u as { token?: unknown }).token), inventory: utxos.filter((u) => (u as { token?: unknown }).token) };
      const p = STRATEGIES[strategy](a.market, a.intent, identity);
      const bid = signBid({ auctionId: a.auctionId, solverId, solverPubkey: pubkey, strategy, executionClass: 'ATOMIC_SINGLE_TX', template: p.template, claims: p.claims, explanation: p.explanation, expiresAt: Math.floor(Date.now() / 1000) + 60, nonce: randomBytes(8).toString('hex') }, key.priv);
      const r = await client.submitBid(bid);
      log('bid', a.auctionId, r.accepted ? 'accepted' : `refused: ${r.reason}`);
    } catch (e) { log('no bid:', (e as Error).message); }
  }
  for (const req of await client.signRequests()) {
    const unlocks = signInputs(req.bid.template, 'solver', key.priv); // refuses inputs not locked to this key
    await client.submitSignatures(req.auctionId, Object.fromEntries(unlocks));
    log('signed', req.auctionId);
  }
}

await client.register(pubkey, strategy, `${kind}-solver`);
log('registered', solverId, 'strategy', strategy, 'api', api);
const tick = () => loop().catch((e) => log('error', (e as Error).message)).finally(() => setTimeout(tick, 500));
tick();
