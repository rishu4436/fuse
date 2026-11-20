// Studio endpoints: compiler, parallel worlds, netting, Guardian (READ-ONLY mainnet), notifications,
// liquidity (LOCAL simulation, fixture LP key), explorer, contracts, replay. No endpoint broadcasts to
// mainnet or chipnet; LOCAL "submit" goes only to the in-process MockNetworkProvider.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUtxo } from 'cashscript';
import { binToHex, hexToBin, decodeTransactionUnsafe, createVirtualMachineBch2026 } from '@bitauth/libauth';
import { compileIntent, parallelWorlds, netSwapIntents, DEFAULT_WORLDS, type CompileContext } from '@fuse/compiler';
import { liveMarketView, utxosOf, solverIdentity, fixtureKey } from '@fuse/simulation';
import { radar, parseLoan, readiness, evaluateRules, sentinel, assessLoan, type GuardianPolicy } from '@fuse/risk-engine';
import { NotificationCenter, CHANNELS } from '@fuse/notifications';
import { ShardManager, vaultHealth, buildDeposit, buildWithdraw, buildMerge, buildSplit, buildPause, type ShardRef } from '@fuse/flash-liquidity';
import { artifactManifest, artifacts } from '@fuse/contracts';
import { contractUnlocks, signInputs, finalize, verifyTemplateAndRaw, inspectRaw, txidOfRaw, sourceOutputsOf, type TxTemplate } from '@fuse/transaction-composer';
import { PARYON_OPERATION_STATUS } from '@fuse/protocol-adapters';
import { scanArbitrage } from '@fuse/solver-sdk';
import type { FuseState } from './state.js';

export function draftIntent(state: FuseState, over: { minOut?: bigint; maxIn?: bigint; maxFee?: bigint } = {}) {
  const m = state.market; const now = Math.floor(Date.now() / 1000);
  return { version: 1, id: `intent_${now.toString(36)}_draft`, network: 'local', type: 'TOKEN_SWAP', owner: { lockingBytecode: m.user.lockingBytecode, authorization: 'WALLET_SIGNATURE' }, inputs: [{ asset: 'BCH', amount: String(over.maxIn ?? 40_000_000n) }], allowedAssets: ['BCH', m.token], operation: { kind: 'TOKEN_SWAP', params: {} }, minOutput: { asset: m.token, amount: String(over.minOut ?? 30_000n) }, maxInput: { asset: 'BCH', amount: String(over.maxIn ?? 40_000_000n) }, maxFee: { asset: 'BCH', amount: String(over.maxFee ?? 20_000n) }, maxSlippageBps: 100, deadline: now + 600, protocols: ['cauldron', 'fuse-flashvault'], authorizationMode: 'PER_TX_SIGNATURE', nonce: binToHex(crypto.getRandomValues(new Uint8Array(8))), replayDomain: 'fuse-local', atomicity: 'ATOMIC_SINGLE_TX', requiredEvidence: ['TX_CONFIRMED', 'OUTPUT_TO_OWNER', 'CERTIFICATE'] };
}

export function registerExtra(app: FastifyInstance, state: FuseState) {
  const notes = new NotificationCenter({ cooldownMs: 10 * 60_000 });
  const policies = new Map<string, GuardianPolicy>();
  const leases = new Map<string, ShardManager>();
  const m = () => state.market;
  const ctx = async (): Promise<CompileContext> => ({
    market: await liveMarketView(m()),
    ownerCoins: (await utxosOf(m(), m().user.address)).filter((c) => !c.token),
    solvers: (['direct', 'routing', 'flash', 'rogue'] as const).map((k) => ({ strategy: ({ direct: 'DIRECT_LIQUIDITY', routing: 'ROUTING', flash: 'FLASH_LIQUIDITY', rogue: 'ADVERSARIAL_FIXTURE' } as const)[k], identity: solverIdentity(m(), k) })),
    tokenLabel: 'FUSD',
  });
  const strip = (p: ReturnType<typeof compileIntent>) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c, template: c.template })) });

  // ---- compiler (F03), explanation, fee accounting (F08) ----
  app.get('/api/compile/draft', async (req) => { const q = z.object({ minOut: z.coerce.bigint().optional(), maxIn: z.coerce.bigint().optional(), maxFee: z.coerce.bigint().optional() }).parse(req.query); return draftIntent(state, q); });
  app.post('/api/compile', async (req) => strip(compileIntent(req.body, await ctx())));
  // ---- parallel worlds (F42) ----
  app.post('/api/parallel-worlds', async (req) => { const r = parallelWorlds(req.body, await ctx(), DEFAULT_WORLDS); return r.map(({ plan, ...x }) => ({ ...x, stages: plan.stages, explanation: plan.explanation?.headline })); });
  // ---- X01 cross-intent netting: simulated counter-intent from a fixture seller, VM-verified, NOT submitted ----
  app.post('/api/netting/simulate', async (req) => {
    const b = z.object({ buyTokens: z.coerce.bigint().positive().default(30_000n), sellTokens: z.coerce.bigint().positive().default(20_000n) }).parse(req.body ?? {});
    const seller = fixtureKey('netting-seller');
    const tok = randomUtxo({ satoshis: 1_000n, token: { category: m().token, amount: b.sellTokens } });
    const view = await liveMarketView(m());
    const coins = (await utxosOf(m(), m().user.address)).filter((c) => !c.token);
    const r = netSwapIntents(view, { id: 'buy-intent', lockingBytecode: m().user.lockingBytecode, coins, wantTokens: b.buyTokens, maxPaySats: 1_000_000_000n }, { id: 'sell-intent (fixture)', lockingBytecode: seller.lockingBytecode, tokenCoins: [{ txid: tok.txid, vout: tok.vout, satoshis: tok.satoshis, token: tok.token as never }], sellTokens: b.sellTokens, minReceiveSats: 0n });
    const raw = finalize(r.template, signInputs(r.template, 'buyer', m().user.priv), signInputs(r.template, 'seller', seller.priv));
    const v = verifyTemplateAndRaw(r.template, raw, { requireStrongSighash: true });
    return { ...r, verification: v, submitted: false, note: 'SIMULATION: counter-intent is a fixture; transaction verified in the BCH VM and not submitted.' };
  });

  // ---- Guardian: READ-ONLY mainnet Paryon V1 snapshot ----
  const snap = () => state.evidence('paryon');
  const loans = () => ((snap()?.live?.loans ?? []) as Array<Record<string, string>>).map(parseLoan);
  const price = () => BigInt(snap()?.live?.latestPrice?.priceRaw ?? 0);
  const ageSec = () => (Date.now() - Date.parse(snap()?.checkedAt ?? 0)) / 1000;
  const evaluate = () => {
    const out = [];
    for (const p of policies.values()) {
      const l = loans().find((x) => x.outpoint === p.loan); if (!l) continue;
      for (const prop of evaluateRules(p, l, assessLoan(l, price()), price())) {
        out.push(prop);
        const n = notes.push({ severity: prop.severity, title: `${p.name}: ${prop.action.replace('PROPOSE_', '').replace('_', ' ')}`, body: `${prop.message}. Execution: ${prop.blockedBy}.`, key: `${p.id}:${prop.ruleId}`, source: 'guardian' });
        if (n) state.emit('GUARDIAN_ALERT', n.title);
      }
    }
    return out;
  };
  app.get('/api/guardian/radar', async (req) => {
    const { shockBps, limit } = z.object({ shockBps: z.coerce.bigint().min(0n).max(9_000n).default(0n), limit: z.coerce.number().int().min(1).max(400).default(60) }).parse(req.query);
    const r = radar(loans(), price(), shockBps);
    return { status: 'READ-ONLY', checkedAt: snap()?.checkedAt, tipHeight: snap()?.tipHeight, operations: PARYON_OPERATION_STATUS, ...r, risks: r.risks.slice(0, limit), total: r.risks.length, redemptionOrderingNote: 'exposureRank orders active loans by interest rate ascending: an ASSUMPTION (rate-ordered redemptions), not verified against Paryon Redeemer logic.' };
  });
  app.get('/api/guardian/sentinel', async () => { const s = snap(); return s ? { checkedAt: s.checkedAt, ...sentinel({ ...s.live, checkedAt: s.checkedAt }) } : { overall: 'NO_DATA', signals: [] }; });
  const RuleZ = z.object({ id: z.string().min(1).max(40), when: z.object({ crBelowBps: z.number().int().min(10_000).max(100_000).optional(), redemptionActive: z.boolean().optional(), dropToLiquidationBelowBps: z.number().int().min(1).max(9_000).optional() }), then: z.enum(['ALERT', 'PROPOSE_TOP_UP', 'PROPOSE_REPAY', 'PROPOSE_EXIT']), targetCrBps: z.number().int().min(11_000).max(100_000).optional(), severity: z.enum(['info', 'warning', 'critical']) });
  app.get('/api/guardian/policies', async () => [...policies.values()]);
  app.post('/api/guardian/policies', async (req) => {
    const b = z.object({ name: z.string().min(1).max(60), loan: z.string().regex(/^[0-9a-f]{64}:\d+$/), rules: z.array(RuleZ).min(1).max(10), channels: z.array(z.enum(['in-app', 'webhook', 'email', 'telegram'])).min(1) }).parse(req.body);
    const p: GuardianPolicy = { ...b, id: `gp_${Date.now().toString(36)}${policies.size}`, createdAt: Date.now() };
    policies.set(p.id, p); state.emit('GUARDIAN_POLICY', `${p.name} watches ${p.loan.slice(0, 12)}…`);
    return { policy: p, proposals: evaluate() };
  });
  app.delete('/api/guardian/policies/:id', async (req) => ({ deleted: policies.delete((req.params as { id: string }).id) }));
  app.get('/api/guardian/readiness', async (req) => { const { loan } = z.object({ loan: z.string() }).parse(req.query); const p = [...policies.values()].find((x) => x.loan === loan); return readiness(p, loans().find((x) => x.outpoint === loan), { snapshotAgeSec: ageSec() }); });
  app.get('/api/guardian/proposals', async () => evaluate());
  app.get('/api/notifications', async () => ({ unread: notes.unread, channels: CHANNELS, items: notes.list() }));
  app.post('/api/notifications/read', async (req) => { notes.markRead(z.object({ id: z.string().optional() }).parse(req.body ?? {}).id); return { unread: notes.unread }; });

  // ---- liquidity (LOCAL, fixture LP key signs; SIMULATED) ----
  const shardRefs = async (): Promise<ShardRef[]> => (await m().provider.getUtxos(m().vault.tokenAddress)).filter((u) => u.token?.nft && u.token.category === m().vaultParams.vaultCategory).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));
  const mgr = async () => { const k = m().vault.lockingBytecode; let s = leases.get(k); if (!s) { s = new ShardManager(m().vaultParams, await shardRefs()); leases.set(k, s); } else s.sync(await shardRefs()); return s; };
  app.get('/api/liquidity', async () => { const s = await mgr(); return { network: 'local', simulated: true, params: m().vaultParams, health: vaultHealth(s.all(), s.leased().map((l) => l.outpoint), m().vaultParams.maxExposure), leases: s.leased(), plan: s.plan(), lp: { address: m().lp.address } }; });
  const lpCoins = async () => (await m().provider.getUtxos(m().lp.address)).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, token: u.token as never }));
  const LpOp = z.discriminatedUnion('op', [
    z.object({ op: z.literal('deposit'), shard: z.string(), amount: z.coerce.bigint().positive() }),
    z.object({ op: z.literal('withdraw'), shard: z.string(), amount: z.coerce.bigint().positive() }),
    z.object({ op: z.literal('merge'), shards: z.array(z.string()).min(2) }),
    z.object({ op: z.literal('split'), shard: z.string(), parts: z.array(z.coerce.bigint().positive()).min(2).max(6) }),
    z.object({ op: z.literal('pause'), shard: z.string(), paused: z.boolean() }),
  ]);
  app.post('/api/liquidity/op', async (req) => {
    const b = LpOp.parse(req.body);
    const shards = await shardRefs(); const find = (o: string) => { const s = shards.find((x) => `${x.txid}:${x.vout}` === o); if (!s) throw Object.assign(new Error(`unknown shard ${o}`), { statusCode: 404 }); return s; };
    const c = { params: m().vaultParams, vaultLockingBytecode: m().vault.lockingBytecode, lpLockingBytecode: m().lp.lockingBytecode };
    const coins = await lpCoins(); const fund = coins.filter((x) => !x.token).sort((a, b2) => (b2.satoshis > a.satoshis ? 1 : -1))[0];
    let t: TxTemplate;
    switch (b.op) {
      case 'deposit': t = buildDeposit(c, find(b.shard), fund, b.amount); break;
      case 'withdraw': t = buildWithdraw(c, find(b.shard), b.amount); break;
      case 'merge': t = buildMerge(c, b.shards.map(find)); break;
      case 'split': { const baton = coins.find((x) => (x.token as { nft?: { capability: string } } | undefined)?.nft?.capability === 'minting'); if (!baton) throw new Error('LP minting baton not found'); t = buildSplit(c, find(b.shard), baton, b.parts); break; }
      case 'pause': t = buildPause(c, find(b.shard), b.paused, fund); break;
    }
    const raw = finalize(t, contractUnlocks(t), signInputs(t, 'lp', m().lp.priv));
    const v = verifyTemplateAndRaw(t, raw, { requireStrongSighash: true });
    if (!v.ok) return { ok: false, verification: v };
    await m().provider.sendRawTransaction(raw);
    state.emit('LP_OPERATION', `${b.op} → ${txidOfRaw(raw)} (LOCAL)`);
    return { ok: true, txid: txidOfRaw(raw), verification: v, template: t };
  });

  // ---- opportunities (F28): LOCAL pools + READ-ONLY mainnet Cauldron snapshot ----
  app.get('/api/opportunities', async () => {
    const v = await liveMarketView(m());
    const local = scanArbitrage(v.pools.map((p) => ({ id: p.id, sats: p.utxo.satoshis, tokens: p.utxo.token!.amount })));
    const c = state.evidence('cauldron');
    const pools = ((c?.checked ?? []) as Array<{ outpoint: string; sats: string; tokens: string; scriptMatchesPublishedCauldronArtifact: boolean }>).filter((p) => p.scriptMatchesPublishedCauldronArtifact).map((p) => ({ id: p.outpoint, sats: BigInt(p.sats), tokens: BigInt(p.tokens) }));
    const mainnet = scanArbitrage(pools);
    return { local: { network: 'local', simulated: true, opportunity: local }, mainnet: { network: 'mainnet', mode: 'READ-ONLY', checkedAt: c?.checkedAt ?? null, poolsScanned: pools.length, opportunity: mainnet, note: 'Gross profit before miner fee and before any competing transaction; snapshot analysis only, nothing executed.' }, excluded: [{ protocol: 'Moria V1', reason: 'disabled April 2026: never an active opportunity' }, { protocol: 'Paryon V2', reason: 'not deployed' }] };
  });

  // ---- explorer (F50), contracts (F44), replay (F43) over the LOCAL chain ----
  const txMap = () => (m().provider as unknown as { transactionMap: Record<string, string> }).transactionMap;
  app.get('/api/explorer', async () => Object.entries(txMap()).reverse().slice(0, 100).map(([txid, raw]) => { const i = inspectRaw(raw); return { txid, sizeBytes: i.sizeBytes, inputs: i.inputs.length, outputs: i.outputs.length }; }));
  app.get('/api/explorer/:txid', async (req, reply) => { const raw = txMap()[(req.params as { txid: string }).txid]; if (!raw) return reply.status(404).send({ error: 'NOT_FOUND', message: 'not on the LOCAL chain' }); return { network: 'local', simulated: true, raw, ...inspectRaw(raw) }; });
  app.get('/api/contracts', async () => Object.entries(artifactManifest).map(([name, x]) => { const a = (artifacts as Record<string, { abi: unknown; constructorInputs: unknown; source: string; compiler: unknown }>)[name]; return { name, ...x, abi: a?.abi, constructorInputs: a?.constructorInputs, source: a?.source, local: name === 'FlashVaultBCH' ? { lockingBytecode: m().vault.lockingBytecode, address: m().vault.tokenAddress } : null }; }));
  app.get('/api/replay/:certId', async (req, reply) => {
    const c = state.certificates.get((req.params as { certId: string }).certId);
    if (!c) return reply.status(404).send({ error: 'NOT_FOUND' });
    const ctxid = c.transactions[0].txid; const raw = txMap()[ctxid]; if (!raw) return reply.status(404).send({ error: 'NO_RAW', message: 'raw tx not on LOCAL chain (world reset?)' });
    // Re-evaluate every input in a fresh BCH 2026 VM using the source outputs recorded in the auction template.
    const auction = [...state.engine.auctions.values()].find((x) => x.txid === ctxid);
    if (!auction?.winner) return reply.status(404).send({ error: 'NO_TEMPLATE', message: 'auction record not found' });
    const t = auction.winner.bid.template;
    const tx = decodeTransactionUnsafe(hexToBin(raw));
    const vm = createVirtualMachineBch2026();
    const sourceOutputs = sourceOutputsOf(t);
    const steps = tx.inputs.map((_, i) => { const st = vm.evaluate({ inputIndex: i, sourceOutputs, transaction: tx }); const r = vm.stateSuccess(st); return { input: i, role: t.inputs[i].role, unlock: t.inputs[i].unlock.kind, ok: r === true, detail: r === true ? 'valid' : String(r) }; });
    return { certificateId: c.certificateId, txid: ctxid, network: 'local', simulated: true, replayed: true, allValid: steps.every((x) => x.ok), steps, template: t, note: 'Replayed in a fresh BCH 2026 VM from the recorded source outputs.' };
  });
}
