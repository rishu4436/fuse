import { expect, test } from '@playwright/test';
import { FuseClient, type LivePrepareInput } from '@fuse/sdk';
import type { ChainReader } from '@fuse/proof-verifier';

test('the SDK discovers a vault, prepares unsigned mainnet execution and requests a signed RFQ', async ({ baseURL }, info) => {
  test.skip(info.project.name === 'mobile', 'API transport is the same across viewport sizes');
  test.skip(!process.env.FUSE_FIXTURE_TEST, 'requires the recorded chain and test attestation key');
  const fuse = new FuseClient(baseURL!);
  const address = process.env.FUSE_E2E_ADDRESS ?? 'bitcoincash:qqtvuzkypa5y75jl05hatzh8jlfsly2d6v28mh8ge9';
  const entries = await fuse.liveVaults();
  const vault = await fuse.liveVault('fuse-live-1');
  expect(entries).toContainEqual(expect.objectContaining({ id: vault.id, open: true }));
  expect(typeof vault.current?.satoshis).toBe('bigint');

  const request: LivePrepareInput = { action: 'flash', address, vaultId: vault.id, maxUserCost: 5_000n };
  const prepared = await fuse.prepareLive(request);
  expect(prepared.risk.ok).toBe(true);
  expect(typeof prepared.minerFee).toBe('bigint');
  expect(prepared.sign.sourceOutputs[0].valueSatoshis).toBe(String(vault.current?.satoshis));
  expect(prepared.sign.broadcast).toBe(false);
  expect(prepared.authorization).toBeTruthy();
  const status = await fuse.request<{ authorization: { attestationPubkey: string }; tipHeight: number }>('/api/live/status');
  const reader: ChainReader = {
    network: 'mainnet',
    tipHeight: async () => status.tipHeight,
    async getRawTransaction(txid) {
      const response = await fetch(`http://127.0.0.1:18788/tx/${txid}/hex`);
      return response.ok ? { rawHex: await response.text(), blockHeight: null, blockHash: null } : null;
    },
  };
  const policy = { attestationPubkey: status.authorization.attestationPubkey, maxMinerFee: 5_000n, maxUserCost: 5_000n, vault, reader };
  const originalClock = Date.now;
  const now = originalClock();
  const { issuedAt } = JSON.parse(Buffer.from(prepared.authorization!.payload, 'base64url').toString('utf8'));
  Date.now = () => issuedAt * 1000 + originalClock() - now;
  try {
    await expect(fuse.checkLiveAuthorization(prepared, request, policy)).resolves.toHaveProperty('intentId');
    const modified = structuredClone(prepared);
    modified.sign.sourceOutputs[0].valueSatoshis = '1';
    await expect(fuse.checkLiveAuthorization(modified, request, policy)).rejects.toMatchObject({ code: 'TEMPLATE_MISMATCH' });
    const badSignature = structuredClone(prepared);
    badSignature.authorization!.serverSig = '00'.repeat(64);
    await expect(fuse.checkLiveAuthorization(badSignature, request, policy)).rejects.toMatchObject({ code: 'AUTHORIZATION_SIGNATURE' });
    await expect(fuse.checkLiveAuthorization(prepared, request, { ...policy, maxUserCost: 1n })).rejects.toMatchObject({ code: 'COST_LIMIT' });
    await expect(fuse.checkLiveAuthorization(prepared, request, {
      ...policy, reader: { ...reader, getRawTransaction: async () => null },
    })).rejects.toMatchObject({ code: 'CHAIN_UNAVAILABLE' });
    const routeRequest = { ...request, action: 'flash-cauldron' as const, units: 1n };
    const route = await fuse.prepareLive(routeRequest);
    await expect(fuse.checkLiveAuthorization(route, routeRequest, policy)).resolves.toHaveProperty('prepared.route.units', '1');
    const { rfq, rfqSig, solvers } = await fuse.openLiveRfq({ address, vaultId: vault.id, units: 1n }, policy.attestationPubkey);
    expect(rfq.units).toBe('1');
    expect(rfqSig).toMatch(/^[0-9a-f]{128}$/);
    expect(solvers.length).toBeGreaterThan(0);
    await expect(fuse.settleLiveAuction({ rfq, rfqSig, quotes: [] }, policy, solvers)).rejects.toMatchObject({ status: 409 });
    await expect(fuse.settleLiveAuction({ rfq: { ...rfq, units: '2' }, rfqSig, quotes: [] }, policy, solvers)).rejects.toMatchObject({ code: 'RFQ_SIGNATURE' });
    Date.now = () => (issuedAt + 301) * 1000;
    await expect(fuse.checkLiveAuthorization(prepared, request, policy)).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED' });
  } finally {
    Date.now = originalClock;
  }
});
