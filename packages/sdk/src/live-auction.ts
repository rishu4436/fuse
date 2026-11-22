import { binToHex, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import type { LiveAuctionInput, LiveAuctionResult, LiveExecutionPolicy, LiveRfqEnvelope, LiveRfqInput, LiveSolver } from './live.js';
import { requireLive, verifyHashSignature, verifyPreflight } from './live-verification.js';
import { toJson } from './wire.js';

export function liveAuctionHash(tag: 'fuse-rfq/v1' | 'fuse-quote/v1' | 'fuse-transcript/v1', payload: unknown) {
  return binToHex(sha256.hash(utf8ToBin(`${tag}:${toJson(payload)}`)));
}

export function checkLiveRfq(envelope: LiveRfqEnvelope, input: LiveRfqInput, pinnedKey: string, now = Math.floor(Date.now() / 1000)) {
  const { rfq, rfqSig } = envelope;
  const digest = liveAuctionHash('fuse-rfq/v1', rfq);
  requireLive(rfq?.v === 1 && rfq.kind === 'fuse.rfq/v1' && rfq.network === 'mainnet' && rfq.action === 'flash-cauldron' &&
    rfq.address === input.address && rfq.units === String(input.units ?? 1n) && rfq.vaultId === (input.vaultId ?? null) &&
    digest === envelope.rfqHash && envelope.attestationPubkey === pinnedKey && verifyHashSignature(rfqSig, pinnedKey, digest),
  'RFQ does not match the request or pinned deployment signature.', 'RFQ_SIGNATURE', 403);
  requireLive(Number.isSafeInteger(rfq.issuedAt) && Number.isSafeInteger(rfq.expiresAt) &&
    rfq.issuedAt <= now + 10 && rfq.expiresAt > now && rfq.expiresAt > rfq.issuedAt && rfq.expiresAt - rfq.issuedAt <= 180,
  'RFQ expired or has an invalid validity window. Request a fresh RFQ.', 'RFQ_EXPIRED', 410);
}

export function checkLiveQuotes(input: LiveAuctionInput, trustedSolvers: readonly LiveSolver[], now = Math.floor(Date.now() / 1000)) {
  const { rfq, quotes } = input;
  const digest = liveAuctionHash('fuse-rfq/v1', rfq);
  const seen = new Set<string>();
  return quotes.map(({ quote, sig }) => {
    const solver = trustedSolvers.find(s => s.pubkey === quote.solverPubkey);
    const hash = liveAuctionHash('fuse-quote/v1', quote);
    requireLive(solver && !seen.has(solver.pubkey) && quote.v === 1 && quote.kind === 'fuse.solver-quote/v1' &&
      quote.rfqHash === digest && quote.auctionId === rfq.auctionId && quote.route?.units === rfq.units &&
      verifyHashSignature(sig, solver.pubkey, hash),
    'Quote signature, solver identity, or RFQ binding is invalid.', 'QUOTE_SIGNATURE', 403);
    const route = quote.route;
    const outpoint = /^[0-9a-f]{64}:(0|[1-9]\d{0,9})$/;
    requireLive(solver.solverId === 'lsol_' + binToHex(sha256.hash(hexToBin(solver.pubkey))).slice(0, 16) &&
      outpoint.test(route.buyOutpoint) && outpoint.test(route.sellOutpoint) && route.buyOutpoint !== route.sellOutpoint &&
      /^[1-9]\d{0,15}$/.test(route.satsIn) && /^[1-9]\d{0,15}$/.test(route.satsOut) &&
      /^-?\d{1,16}$/.test(route.loss) && BigInt(route.satsIn) - BigInt(route.satsOut) === BigInt(route.loss),
    'Quote pool outpoints, solver identity, or quoted trade arithmetic are invalid.', 'INVALID_QUOTE');
    requireLive(Number.isSafeInteger(quote.quotedAt) && Number.isSafeInteger(quote.expiresAt) &&
      quote.quotedAt >= rfq.issuedAt - 10 && quote.quotedAt <= now + 10 && quote.expiresAt > now &&
      quote.expiresAt > quote.quotedAt && quote.expiresAt - quote.quotedAt <= 120,
    'Solver quote expired or has an invalid validity window. Request a fresh quote.', 'QUOTE_EXPIRED', 410);
    seen.add(solver.pubkey);
    return { solver, hash, quote };
  });
}

export function verifyLiveAuction(result: LiveAuctionResult, input: LiveAuctionInput, policy: LiveExecutionPolicy, solvers: readonly LiveSolver[], now = Math.floor(Date.now() / 1000)) {
  const rfq = input.rfq;
  const request = { action: rfq.action, address: rfq.address, units: BigInt(rfq.units), vaultId: rfq.vaultId ?? undefined };
  const rfqHash = liveAuctionHash('fuse-rfq/v1', rfq);
  checkLiveRfq({ rfq, rfqHash, rfqSig: input.rfqSig, attestationPubkey: policy.attestationPubkey, solvers: [] }, request, policy.attestationPubkey, now);
  const checked = checkLiveQuotes(input, solvers, now);
  const p = verifyPreflight(result, request, policy, now);
  const { transcript, transcriptHash, winner } = result.auction;
  requireLive(transcript?.v === 1 && transcript.kind === 'fuse.auction-transcript/v1' &&
    transcript.rfqHash === rfqHash && liveAuctionHash('fuse-rfq/v1', transcript.rfq) === rfqHash &&
    transcript.rfqSig === input.rfqSig && toJson(transcript.quotes) === toJson(input.quotes) &&
    liveAuctionHash('fuse-transcript/v1', transcript) === transcriptHash &&
    p.auction?.transcriptHash === transcriptHash && p.auction.auctionId === rfq.auctionId &&
    p.auction.winner === winner.solverId && transcript.winner === winner.solverId,
  'Auction transcript does not match the authorized settlement.', 'AUCTION_COMMITMENT');
  requireLive(transcript.verdicts.length === checked.length && transcript.verdicts.every((v, i) =>
    v.quoteHash === checked[i].hash && v.solverId === checked[i].solver.solverId), 'Auction verdicts do not cover the submitted quotes.', 'AUCTION_COMMITMENT');
  const ranked = transcript.verdicts.filter(v => v.valid).sort((a, b) => {
    const delta = BigInt(a.recomputed!.expectedUserCost) - BigInt(b.recomputed!.expectedUserCost);
    return delta === 0n ? a.quoteHash.localeCompare(b.quoteHash) : delta < 0n ? -1 : 1;
  });
  requireLive(ranked[0] && toJson(ranked[0]) === toJson(winner) &&
    ranked.every((v, i) => v.rank === i + 1 && v.score === v.recomputed?.expectedUserCost),
  'Auction winner or ranking differs from the transcript costs.', 'AUCTION_RANKING');
  const winning = checked.find(q => q.hash === winner.quoteHash)!.quote;
  requireLive(p.constraints.route && result.route && p.constraints.route.buyOutpoint === winning.route.buyOutpoint &&
    p.constraints.route.sellOutpoint === winning.route.sellOutpoint &&
    result.route.roundTripLoss === result.route.satsIn - result.route.satsOut &&
    result.route.roundTripLoss <= BigInt(winning.route.loss) && winner.score === String(result.expectedUserCost) &&
    winner.recomputed?.minerFee === String(result.minerFee),
  'Winner quote does not match the authorized pool route or cost.', 'AUCTION_RANKING');
}
