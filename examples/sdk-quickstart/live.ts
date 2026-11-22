import { FuseClient, type LiveExecutionPolicy, type LivePrepareInput, type LiveSigningPackage } from '@fuse/sdk';

interface Wallet {
  address: string;
  /** Resolve after user approval with the signed transaction hex. */
  signTransaction(request: LiveSigningPackage): Promise<string>;
}

export async function prepareFlash(fuse: FuseClient, wallet: Wallet, policy: LiveExecutionPolicy) {
  const vault = policy.vault;
  if (!vault) throw new Error('Configure the trusted mainnet FlashVault identity first.');
  const discovered = (await fuse.liveVaults()).find(entry => entry.id === vault.id);
  if (!discovered || 'error' in discovered || !discovered.open || !discovered.current || discovered.current.state.paused) {
    throw new Error('The configured mainnet FlashVault is unavailable.');
  }

  const request: LivePrepareInput = {
    action: 'flash', address: wallet.address, vaultId: vault.id, maxUserCost: policy.maxUserCost,
  };
  const draft = await fuse.prepareLive(request);
  const { prepared } = await fuse.checkLiveAuthorization(draft, request, policy);
  const authorization = prepared.authorization;
  if (!authorization) throw new Error('Missing execution authorization.');

  // Present prepared.constraints and prepared.risk to the user before calling the wallet.
  // Keep this approved snapshot available for the post-signature check and the eventual receipt.
  return { prepared, authorization };
}

export async function signFlash(
  fuse: FuseClient, wallet: Wallet, approved: Awaited<ReturnType<typeof prepareFlash>>,
) {
  const rawHex = await wallet.signTransaction(structuredClone(approved.prepared.sign));
  const signed = await fuse.verifyLiveSigned(rawHex, approved.prepared);
  return { rawHex, txid: signed.txid, authorization: approved.authorization };
}

export async function verifyFlashSettlement(
  fuse: FuseClient, signed: Awaited<ReturnType<typeof signFlash>>, policy: LiveExecutionPolicy,
) {
  const status = await fuse.liveTransaction(signed.txid);
  if (!status.confirmed || status.confirmations < 1) throw new Error('Wait for a mainnet confirmation.');
  const receipt = await fuse.liveReceipt({ txid: signed.txid, authorization: signed.authorization });
  return fuse.verifyLiveReceiptLocally(receipt, policy.reader, {
    attestationPubkey: policy.attestationPubkey,
    vaults: policy.vault ? [policy.vault] : [],
  });
}
