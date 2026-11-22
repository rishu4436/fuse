// Mainnet receipt verification uses the same contract rederiver as the SDK.
import { binToHex, sha256 } from '@bitauth/libauth';
import type { IntentBinder } from '@fuse/proof-verifier';
import { liveReceiptRederiver } from '@fuse/sdk';
import { paramsOfConfig, type VaultConfig } from './vault.js';
import { openAuthorization, structureDiff, structureHashOfTemplate, strippedStructure, verifyUserSignature, type Authorization } from './authz.js';

export function liveRederiver(configs: VaultConfig[]) {
  return liveReceiptRederiver(configs.map(c => ({ id: c.id, category: c.category, params: paramsOfConfig(c) })));
}

/** INTENT_BOUND: the on-chain tx (scriptSigs stripped) equals an authorization signed by the deployment's published key. */
export function intentBinder(a: { authorization?: Authorization | null; userSignature?: { pubkey: string; sig: string } | null; trustedPubkey: string | null }): IntentBinder {
  return async (cert, txs) => {
    if (!a.authorization) return { present: false, ok: false, detail: 'no execution authorization for this transaction (it predates intent binding, or none was supplied)' };
    if (!a.trustedPubkey) return { present: true, ok: false, detail: 'no trusted attestation key to verify the authorization' };
    const p = openAuthorization(a.authorization, a.trustedPubkey, { ignoreExpiry: true });
    const tx = txs.get(cert.transactions[0].txid)!;
    const diff = structureDiff(p.template, tx);
    if (diff) return { present: true, ok: false, detail: `on-chain tx differs from the authorization: ${diff}` };
    const h = binToHex(sha256.hash(strippedStructure(tx)));
    if (h !== p.structureHash || h !== structureHashOfTemplate(p.template)) return { present: true, ok: false, detail: 'structure hash mismatch' };
    if (p.auction && p.auction.transcriptHash !== cert.quoteCommitment) return { present: true, ok: false, detail: `certificate quote commitment does not match the authorized auction transcript ${p.auction.transcriptHash.slice(0, 12)}…` };
    const us = verifyUserSignature(a.authorization.authHash, a.userSignature ?? undefined, p.constraints.userLockingBytecode);
    if (us.present && !us.ok) return { present: true, ok: false, detail: us.detail };
    return { present: true, ok: true, detail: `tx matches authorization ${p.intentId} (attestation key ${a.trustedPubkey.slice(0, 10)}…, Guardian ${p.guardian.level})${us.present ? `; ${us.detail}` : '; no user wallet signature over the auth hash'}${p.auction ? `; auction ${p.auction.auctionId} winner ${p.auction.winner}` : ''}` };
  };
}
