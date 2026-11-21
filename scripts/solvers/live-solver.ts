// A mainnet FUSE solver as its own OS process (review issue D). It holds its own quote-signing key (box-only, controls
// no funds), discovers Cauldron PUSD pools itself (public indexer + raw txs re-verified from the explorer), and answers
// RFQs with a signed quote for its strategy:
//   direct    — Cauldron-direct: the cheapest round trip over every verified pool pair
//   deep-pair — alternative-pool: only the two deepest pools (lowest price impact, may cost more)
// Usage: npx tsx scripts/solvers/live-solver.ts --strategy direct|deep-pair [--port 4701] [--print-pubkey]
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { binToHex, hexToBin, secp256k1 } from '@bitauth/libauth';
import { toJson, fromJson } from '@fuse/solver-sdk';
import { livePools, bestRoundTrip, roundTripVia } from '../../services/api/src/live/cauldron.js';
import { rfqHash, signQuote, solverIdOfPub, QUOTE_TTL, type Rfq } from '../../services/api/src/live/auction.js';

const args = process.argv.slice(2); const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const strategy = flag('strategy') ?? 'direct'; if (!['direct', 'deep-pair'].includes(strategy)) throw new Error('strategy must be direct|deep-pair');
const port = Number(flag('port') ?? (strategy === 'direct' ? 4701 : 4702));
const KEY = `/home/box/secrets/fuse-solver-${strategy}.key`;
if (!existsSync(KEY)) { mkdirSync('/home/box/secrets', { recursive: true }); writeFileSync(KEY, binToHex(randomBytes(32)), { mode: 0o600 }); }
const priv = hexToBin(readFileSync(KEY, 'utf8').trim());
const pub = binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array);
if (args.includes('--print-pubkey')) { console.log(JSON.stringify({ solverId: solverIdOfPub(pub), pubkey: pub, strategy })); process.exit(0); }

async function quote(body: { rfq: Rfq; rfqSig: string; attestationPubkey: string }) {
  const { rfq } = body; const h = rfqHash(rfq);
  if (!secp256k1.verifySignatureSchnorr(hexToBin(body.rfqSig), hexToBin(body.attestationPubkey), hexToBin(h))) throw new Error('RFQ signature invalid');
  if (rfq.expiresAt < Date.now() / 1000) throw new Error('RFQ expired');
  const units = BigInt(rfq.units);
  const { pools } = await livePools();
  let rt;
  if (strategy === 'direct') rt = bestRoundTrip(pools, units);
  else { const [x, y] = [...pools].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1)); const c = [x && y && roundTripVia(x, y, units), x && y && roundTripVia(y, x, units)].filter(Boolean) as NonNullable<ReturnType<typeof roundTripVia>>[]; rt = c.sort((a, b) => (a.loss < b.loss ? -1 : 1))[0]; }
  if (!rt) throw new Error('no route');
  const now = Math.floor(Date.now() / 1000);
  return signQuote({ auctionId: rfq.auctionId, rfqHash: h, solverPubkey: pub, strategy, route: { units: rfq.units, buyOutpoint: `${rt.a.txid}:${rt.a.vout}`, sellOutpoint: `${rt.b.txid}:${rt.b.vout}`, satsIn: String(rt.satsIn), satsOut: String(rt.satsOut), loss: String(rt.loss) }, quotedAt: now, expiresAt: now + QUOTE_TTL }, priv);
}

createServer((req, res) => {
  let data = ''; req.on('data', (c) => (data += c));
  req.on('end', async () => {
    try {
      if (req.method === 'GET' && req.url === '/health') { res.end(toJson({ ok: true, strategy, solverId: solverIdOfPub(pub), pid: process.pid })); return; }
      if (req.method !== 'POST' || req.url !== '/quote') { res.statusCode = 404; res.end('{}'); return; }
      const q = await quote(fromJson(data)); console.log(`[${strategy} pid ${process.pid}] quoted ${q.quote.auctionId}: ${q.quote.route.buyOutpoint.slice(0, 10)}→${q.quote.route.sellOutpoint.slice(0, 10)} loss ${q.quote.route.loss}`);
      res.setHeader('content-type', 'application/json'); res.end(toJson(q));
    } catch (e) { res.statusCode = 422; res.end(toJson({ error: (e as Error).message })); }
  });
}).listen(port, '127.0.0.1', () => console.log(`solver ${strategy} (${solverIdOfPub(pub)}, pid ${process.pid}) on 127.0.0.1:${port}`));
