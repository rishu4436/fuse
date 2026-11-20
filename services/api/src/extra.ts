// Studio endpoints: compiler, parallel worlds, netting, Guardian (READ-ONLY mainnet), notifications,
// liquidity (LOCAL simulation, fixture LP key), explorer, contracts, replay. No endpoint broadcasts to
// mainnet or chipnet; LOCAL "submit" goes only to the in-process MockNetworkProvider.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUtxo } from 'cashscript';
import { binToHex, hexToBin, decodeTransactionUnsafe, createVirtualMachineBch2026 } from '@bitauth/libauth';
import { compileIntent, parallelWorlds, netSwapIntents, executeStaged, DEFAULT_WORLDS, COMPILED_TYPES, PARYON_BLOCKED, type CompileContext, type StageDef, type ChainPort } from '@fuse/compiler';
import { liveMarketView, utxosOf, solverIdentity, fixtureKey } from '@fuse/simulation';
import { radar, parseLoan, readiness, evaluateRules, sentinel, assessLoan, rateAdvice, redemptionArbitrage, type GuardianPolicy } from '@fuse/risk-engine';
import { signRecipe, verifyRecipe, PRESETS, LEGS, type Recipe, type Leg } from '@fuse/recipes';
import { recomputeOutcome } from '@fuse/auction';
import { NotificationCenter, adaptersFromEnv, channelStatus, dispatch, type ChannelId, type Notification } from '@fuse/notifications';
import { vaultHealth, lpRiskHistory, type VaultSnapshot, buildDeposit, buildWithdraw, buildMerge, buildSplit, buildPause, type ShardRef } from '@fuse/flash-liquidity';
import { artifactManifest, artifacts } from '@fuse/contracts';
import { contractUnlocks, signInputs, finalize, verifyTemplateAndRaw, inspectRaw, txidOfRaw, sourceOutputsOf, type TxTemplate } from '@fuse/transaction-composer';
import { PARYON_OPERATION_STATUS } from '@fuse/protocol-adapters';
import { scanArbitrage, routingStrategy, type SwapIntentView } from '@fuse/solver-sdk';
import { officialTemplates, inspectTemplate, xoP2pkhPayout, XO_ENGINE_STATUS } from '@fuse/xo';
import { fetchMainnetTx } from './mainnet-explorer.js';
import type { FuseState } from './state.js';

export function draftIntent(state: FuseState, over: { minOut?: bigint; maxIn?: bigint; maxFee?: bigint } = {}) {
  const m = state.market; const now = Math.floor(Date.now() / 1000);
  return { version: 1, id: `intent_${now.toString(36)}_draft`, network: 'local', type: 'TOKEN_SWAP', owner: { lockingBytecode: m.user.lockingBytecode, authorization: 'WALLET_SIGNATURE' }, inputs: [{ asset: 'BCH', amount: String(over.maxIn ?? 40_000_000n) }], allowedAssets: ['BCH', m.token], operation: { kind: 'TOKEN_SWAP', params: {} }, minOutput: { asset: m.token, amount: String(over.minOut ?? 30_000n) }, maxInput: { asset: 'BCH', amount: String(over.maxIn ?? 40_000_000n) }, maxFee: { asset: 'BCH', amount: String(over.maxFee ?? 20_000n) }, maxSlippageBps: 100, deadline: now + 600, protocols: ['cauldron', 'fuse-flashvault'], authorizationMode: 'PER_TX_SIGNATURE', nonce: binToHex(crypto.getRandomValues(new Uint8Array(8))), replayDomain: 'fuse-local', atomicity: 'ATOMIC_SINGLE_TX', requiredEvidence: ['TX_CONFIRMED', 'OUTPUT_TO_OWNER', 'CERTIFICATE'] };
}

export function registerExtra(app: FastifyInstance, state: FuseState) {
  const store = state.store;
  const adapters = adaptersFromEnv(process.env);
  const policies = new Map<string, GuardianPolicy>(store.listPolicies<GuardianPolicy>().map((p) => [p.id, p]));
  const channelsFor = (n: Notification): ChannelId[] => { const p = policies.get(n.key.split(':')[0]); return (p?.channels ?? ['in-app']) as ChannelId[]; };
  const notes = new NotificationCenter({
    cooldownMs: 10 * 60_000,
    onPush: (n) => {
      store.putAlert(n);
      // External delivery only when configured AND FUSE_NOTIFY_EXTERNAL=1 (see packages/notifications). Async, recorded.
      void dispatch(n, adapters, channelsFor(n)).then((ds) => { for (const d of ds) store.putDelivery({ alertId: n.id, channel: d.channel, status: d.status, detail: d.detail }); });
    },
    onRead: (id) => store.markAlertsRead(id),
  });
  notes.restore(store.listAlerts<Notification>());
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
    policies.set(p.id, p); store.putPolicy(p); state.emit('GUARDIAN_POLICY', `${p.name} watches ${p.loan.slice(0, 12)}…`);
    return { policy: p, proposals: evaluate() };
  });
  app.delete('/api/guardian/policies/:id', async (req) => { const id = (req.params as { id: string }).id; store.deletePolicy(id); return { deleted: policies.delete(id) }; });
  app.get('/api/guardian/readiness', async (req) => { const { loan } = z.object({ loan: z.string() }).parse(req.query); const p = [...policies.values()].find((x) => x.loan === loan); return readiness(p, loans().find((x) => x.outpoint === loan), { snapshotAgeSec: ageSec() }); });
  app.get('/api/guardian/proposals', async () => evaluate());
  app.get('/api/notifications', async () => ({ unread: notes.unread, channels: channelStatus(process.env), externalOptIn: process.env.FUSE_NOTIFY_EXTERNAL === '1', items: notes.list() }));
  app.get('/api/notifications/deliveries', async () => store.listDeliveries());
  // ---- persistence + solver performance ledger (F32) ----
  app.get('/api/store', async () => ({ engine: 'sqlite (node:sqlite)', path: store.path === ':memory:' ? ':memory:' : store.path.replace(state.root, '.'), session: store.session, migrations: store.migrations(), counts: { intents: store.listIntents(10_000).length, auctions: store.listAuctions(10_000).length, certificates: store.listCertificates().length, policies: policies.size, alerts: store.listAlerts(10_000).length, ledger: store.ledger(undefined, 100_000).length, recipes: store.listRecipes().length } }));
  app.get('/api/solvers/performance', async () => { const known = new Map(store.listSolvers().map((s) => [s.solverId, s])); return store.performance().map((p) => ({ ...p, name: known.get(p.solverId)?.name ?? state.engine.solvers.get(p.solverId)?.name ?? p.solverId, strategy: known.get(p.solverId)?.strategy ?? state.engine.solvers.get(p.solverId)?.strategy })).sort((a, b) => b.wins - a.wins); });
  app.get('/api/solvers/ledger', async (req) => { const q = z.object({ solverId: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(100) }).parse(req.query); return store.ledger(q.solverId, q.limit); });
  app.get('/api/intents/history', async () => ({ intents: store.listIntents(50), auctions: store.listAuctions(50) }));
  app.post('/api/notifications/read', async (req) => { notes.markRead(z.object({ id: z.string().optional() }).parse(req.body ?? {}).id); return { unread: notes.unread }; });

  // ---- liquidity (LOCAL, fixture LP key signs; SIMULATED) ----
  const shardRefs = async (): Promise<ShardRef[]> => (await m().provider.getUtxos(m().vault.tokenAddress)).filter((u) => u.token?.nft && u.token.category === m().vaultParams.vaultCategory).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis, commitment: u.token!.nft!.commitment }));
  const mgr = async () => state.syncShards();
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
  app.get('/api/replay/mainnet/moria', async () => state.evidence('moria-replay') ?? { results: [], note: 'run scripts/verification/replay-moria-history.ts' });
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

  // ---- compiler: more intent types ----
  app.get('/api/compile/types', async () => ({ compiled: COMPILED_TYPES, blocked: PARYON_BLOCKED.map((t) => ({ type: t, reason: 'Paryon V1 builders (@paryonusd/library) not published' })) }));
  app.post('/api/compile/typed', async (req) => {
    const b = z.object({ type: z.enum(['TOKEN_SWAP', 'ATOMIC_ARBITRAGE', 'LIQUIDITY_DEPOSIT', 'LIQUIDITY_WITHDRAWAL', 'LOAN_REPAYMENT', 'COLLATERAL_TOP_UP']), amount: z.coerce.bigint().positive().optional(), minProfit: z.coerce.bigint().min(0n).optional(), atomicity: z.enum(['ATOMIC_SINGLE_TX', 'STAGED_RECOVERABLE']).default('ATOMIC_SINGLE_TX') }).parse(req.body ?? {});
    const d = draftIntent(state, {}) as Record<string, unknown>;
    const lp = b.type.startsWith('LIQUIDITY');
    const intent = { ...d, type: b.type, operation: { kind: b.type, params: {} }, atomicity: b.atomicity,
      ...(b.type === 'TOKEN_SWAP' ? {} : { minOutput: b.type === 'ATOMIC_ARBITRAGE' ? { asset: 'BCH', amount: String(b.minProfit ?? 1_000n) } : undefined, maxInput: undefined }),
      ...(lp ? { owner: { lockingBytecode: m().lp.lockingBytecode, authorization: 'WALLET_SIGNATURE' }, inputs: [{ asset: 'BCH', amount: String(b.amount ?? 5_000_000n) }] } : {}),
      ...(b.type.startsWith('LOAN') || b.type.startsWith('COLLATERAL') ? { protocols: ['paryon-v1'] } : {}) };
    const c = await ctx();
    c.liquidity = { lpLockingBytecode: m().lp.lockingBytecode, lpCoins: (await lpCoins()) as never, shards: await state.shardRefs() };
    return { intent, plan: strip(compileIntent(intent, c)) };
  });

  // ---- F11 staged recoverable execution on the LOCAL chain ----
  app.post('/api/staged/run', async (req) => {
    const b = z.object({ minOut: z.coerce.bigint().positive().default(20_000n), competitor: z.boolean().default(false), timeoutAfterAccept: z.boolean().default(false) }).parse(req.body ?? {});
    const mk = m(); let calls = 0; let injected = false;
    const chain: ChainPort = {
      async broadcast(raw) {
        calls++;
        if (b.competitor && calls === 2 && !injected) { injected = true; await competitor(); }
        const id = await mk.provider.sendRawTransaction(raw);
        if (b.timeoutAfterAccept && calls === 1) throw new Error('request timed out after 30000 ms (simulated)');
        return id;
      },
      async hasTx(txid) { return !!(await mk.provider.getRawTransaction(txid)); },
      async isUnspent(op) { const [t, v] = op.split(':'); return (await mk.provider.getUtxosForLockingBytecode(mk.user.lockingBytecode)).some((u) => u.txid === t && u.vout === Number(v)); },
    };
    async function competitor() {
      const comp = solverIdentity(mk, 'direct'); const view = await liveMarketView(mk);
      const coins = (await utxosOf(mk, mk.solvers.direct.address)).filter((c) => !c.token);
      const it: SwapIntentView = { auctionId: 'x', intentId: 'competitor', intentCommitment: '00'.repeat(32), type: 'TOKEN_SWAP', owner: { lockingBytecode: comp.lockingBytecode, coins }, buyToken: mk.token, minOut: 1_500n, maxIn: 1_000_000_000n, maxFee: 20_000n, deadline: 2e9 };
      const p = routingStrategy(view, it, solverIdentity(mk, 'flash'));
      await mk.provider.sendRawTransaction(finalize(p.template, contractUnlocks(p.template), signInputs(p.template, 'user', comp.priv)));
      state.emit('COMPETITOR_TX', 'SIMULATION: a competing trader moved the pool between stages');
    }
    const stages: StageDef[] = [
      { id: 'prepare', description: 'owner → owner: one exact funding output', owner: mk.user.lockingBytecode, signers: { user: mk.user.priv }, async build() {
        const c = (await utxosOf(mk, mk.user.address)).filter((x) => !x.token).sort((a, b2) => (b2.satoshis > a.satoshis ? 1 : -1))[0];
        return { version: 2, locktime: 0, inputs: [{ ...c, lockingBytecode: mk.user.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } }], outputs: [{ lockingBytecode: mk.user.lockingBytecode, satoshis: c.satoshis - 1_000n, role: 'change', label: 'funding output' }] } as TxTemplate;
      } },
      { id: 'swap', description: 'best Cauldron route from the funding output (rebuilt from fresh state on conflict)', owner: mk.user.lockingBytecode, signers: { user: mk.user.priv }, async build(c) {
        const [txid, vout] = c.completed[0].ownerOutputs[0].split(':');
        const coin = (await utxosOf(mk, mk.user.address)).find((u) => u.txid === txid && u.vout === Number(vout));
        if (!coin) throw new Error('funding output not found (spent?)');
        const it: SwapIntentView = { auctionId: 'staged', intentId: 'staged', intentCommitment: '00'.repeat(32), type: 'TOKEN_SWAP', owner: { lockingBytecode: mk.user.lockingBytecode, coins: [coin] }, buyToken: mk.token, minOut: b.minOut, maxIn: 1_000_000_000n, maxFee: 20_000n, deadline: 2e9 };
        const p = routingStrategy(await liveMarketView(mk), it, solverIdentity(mk, 'routing'));
        const o = recomputeOutcome(p.template, mk.user.lockingBytecode, mk.token);
        if (o.userReceivesTokens < b.minOut) throw new Error(`delivers ${o.userReceivesTokens} < minOut ${b.minOut}`);
        return p.template;
      } },
    ];
    const r = await executeStaged(stages, chain);
    await state.syncShards();
    state.emit(r.status === 'COMPLETED' ? 'STAGED_COMPLETED' : 'STAGED_RECOVERABLE', r.status === 'COMPLETED' ? `${r.stages.length} stages accepted on the LOCAL chain` : `stopped at ${r.recovery?.failedStage}: ${r.recovery?.reason}`);
    return { network: 'local', simulated: true, ...r, stages: r.stages.map(({ raw: _raw, ...x }) => x) };
  });

  // ---- F16 rate advice + F27 redemption arbitrage search (READ-ONLY, real snapshots) ----
  app.get('/api/guardian/rates', async (req) => {
    const q = z.object({ loan: z.string().optional(), multiple: z.coerce.number().min(0.5).max(20).default(2), demandCents: z.coerce.bigint().min(0n).optional() }).parse(req.query);
    const ls = loans();
    const loan = q.loan ?? ls.filter((l) => l.status === 'mature' && l.debtCents > 0n && l.periodsBehind <= 1n).sort((a, b) => (b.debtCents > a.debtCents ? 1 : -1))[0]?.outpoint;
    if (!loan) return { status: 'READ-ONLY', error: 'no active mature loans in snapshot' };
    return { status: 'READ-ONLY', checkedAt: snap()?.checkedAt, priceCents: price(), ...rateAdvice(ls, loan, price(), { targetMultiple: q.multiple, demandCents: q.demandCents }) };
  });
  app.get('/api/opportunities/redemption', async () => {
    const c = state.evidence('cauldron');
    const pools = ((c?.checked ?? []) as Array<{ pool_id: string; sats: string; tokens: string }>).map((p) => ({ id: p.pool_id.slice(0, 10), sats: BigInt(p.sats), tokens: BigInt(p.tokens) }));
    const r = redemptionArbitrage(pools, price(), loans());
    return { status: 'READ-ONLY', poolsCheckedAt: c?.checkedAt, oracleCheckedAt: snap()?.checkedAt, pools: pools.length, oraclePriceCents: price(), ...r, curve: r.curve.filter((_, i) => i % 3 === 0).slice(0, 80) };
  });

  // ---- F47 recipe marketplace (LOCAL; listing never executes anything) ----
  const probe = (strategy: string, r: Recipe) => {
    try {
      const intent = draftIntent(state, { minOut: BigInt(r.bounds.minOutTokens), maxIn: BigInt(r.bounds.maxInSats) });
      const cc = compileCtxSync(strategy);
      const p = compileIntent(intent, cc);
      const mine = p.candidates.find((c) => c.strategy === strategy);
      return { ok: !!mine?.ok, strategy, selected: p.selected?.strategy, userNetSpendSats: mine?.outcome?.userNetSpendSats, reasons: mine ? mine.reasons : [p.error?.reason ?? 'not compiled'] };
    } catch (e) { return { ok: false, strategy, reasons: [(e as Error).message] }; }
  };
  let marketCache: CompileContext | null = null;
  const compileCtxSync = (strategy: string): CompileContext => ({ ...marketCache!, solvers: marketCache!.solvers.filter((s) => s.strategy === strategy) });
  const listRecipe = async (signed: unknown) => {
    marketCache = await ctx();
    const v = verifyRecipe(signed, probe);
    if (v.recipe && v.hash && !store.getRecipe(v.hash)) store.putRecipe({ id: 'rcp_' + v.hash.slice(0, 12), hash: v.hash, authorPubkey: v.recipe.author.pubkey, signature: (signed as { signature: string }).signature, body: v.recipe, verdict: { listed: v.listed, checks: v.checks, strategy: v.strategy, probe: v.probe, autoExecute: false } });
    if (v.recipe) state.emit(v.listed ? 'RECIPE_LISTED' : 'RECIPE_REJECTED', `${v.recipe.name}: ${v.checks.filter((c) => !c.ok).map((c) => c.name).join(', ') || 'all checks passed'}`);
    return v;
  };
  const fixtureAuthor = (label: string) => { const k = fixtureKey(`recipe-author:${label}`); return { priv: k.priv, pubkey: binToHex(k.pub) }; };
  const seed = async () => {
    if (store.listRecipes().length) return;
    const mk = (name: string, legs: Leg[], author: string, description: string, minOut = '30000', tags: string[] = []) => { const a = fixtureAuthor(author); return signRecipe({ schema: 'fuse.recipe/v1', name, description, legs, bounds: { minOutTokens: minOut, maxInSats: '40000000' }, author: { pubkey: a.pubkey, label: author }, createdAt: 1_795_000_000, tags }, a.priv); };
    for (const r of [
      mk('Flash back-run rebate', PRESETS.FLASH_LIQUIDITY, 'volt-labs', 'Buy for the user, back-run the pool gap with a FlashVault shard, rebate half the profit.', '30000', ['flash', 'rebate']),
      mk('Plain best-pool route', PRESETS.ROUTING, 'route-co', 'Route the whole order through the cheapest single pool. 10 bps solver fee.', '30000', ['routing']),
      mk('Inventory fill', PRESETS.DIRECT_LIQUIDITY, 'mm-desk', 'Fill from a market maker inventory at the pool reference price + 150 bps.', '30000', ['inventory']),
      mk('Free money (unrepaid borrow)', ['BORROW', 'BUY_CHEAP', 'PAY_USER'], 'anon', 'Borrows a shard and never repays it. The marketplace must reject this.', '30000', ['adversarial']),
    ]) await listRecipe(r);
  };
  // Verdicts are recomputed against the CURRENT local market on every read: a recipe that compiled yesterday may not
  // compile now (e.g. the pool gap a flash back-run needs has closed). The first verdict is kept for audit.
  app.get('/api/marketplace/recipes', async () => {
    await seed(); marketCache = await ctx();
    const recipes = store.listRecipes().map((r) => {
      const v = verifyRecipe({ recipe: r.body, hash: r.hash, signature: r.signature }, probe);
      return { ...r, verdict: { listed: v.listed, checks: v.checks, strategy: v.strategy, probe: v.probe, autoExecute: false, verifiedAt: Date.now(), firstListed: (r.verdict as { listed?: boolean }).listed } };
    }).sort((a, b) => Number(b.verdict.listed) - Number(a.verdict.listed));
    return { mode: 'LOCAL', autoExecute: false, legs: LEGS, verifiedAgainst: 'current LOCAL market state', recipes };
  });
  app.post('/api/marketplace/recipes', async (req) => listRecipe(req.body));
  app.post('/api/marketplace/publish-local', async (req) => {
    const b = z.object({ name: z.string().min(3).max(60), description: z.string().max(400).default(''), legs: z.array(z.string()).min(1).max(8), minOutTokens: z.string().default('30000') }).parse(req.body);
    const a = fixtureAuthor('studio-user');
    const signed = signRecipe({ schema: 'fuse.recipe/v1', name: b.name, description: b.description, legs: b.legs as Leg[], bounds: { minOutTokens: b.minOutTokens, maxInSats: '40000000' }, author: { pubkey: a.pubkey, label: 'studio (fixture key)' }, createdAt: Math.floor(Date.now() / 1000), tags: ['studio'] }, a.priv);
    return { ...(await listRecipe(signed)), signedWith: 'LOCAL fixture author key (SIMULATION; holds nothing)' };
  });
  // ---- F48 XO Stack: template validation + payout script compiled by the XO compiler (public keys only) ----
  app.get('/api/xo/templates', async () => ({ engine: XO_ENGINE_STATUS, templates: officialTemplates() }));
  app.post('/api/xo/templates/inspect', async (req, reply) => { try { return { ok: true, template: inspectTemplate(req.body) }; } catch (e) { return reply.status(400).send({ ok: false, error: 'TEMPLATE_INVALID', message: (e as Error).message }); } });
  app.post('/api/xo/payout', async (req, reply) => {
    const b = z.object({ publicKey: z.string(), network: z.enum(['mainnet', 'chipnet']).default('chipnet') }).parse(req.body ?? {});
    try { return { ...xoP2pkhPayout(b.publicKey, b.network), note: 'Use as the intent owner/payout locking bytecode. FUSE never needs the XO mnemonic.' }; } catch (e) { return reply.status(400).send({ error: 'BAD_KEY', message: (e as Error).message }); }
  });
  // ---- F50 READ-ONLY mainnet explorer (raw re-hashed locally) ----
  app.get('/api/explorer/mainnet/:txid', async (req, reply) => {
    try { return await fetchMainnetTx((req.params as { txid: string }).txid); } catch (e) { const code = (e as { code?: string }).code ?? 'ERROR'; return reply.status(code === 'BAD_TXID' ? 400 : code === 'HASH_MISMATCH' ? 502 : 404).send({ error: code, message: (e as Error).message }); }
  });
  // ---- F40 LP risk history: vault health snapshot persisted on every accepted tx / LP op / reset ----
  const snapVault = async (event: string) => { const sh = await mgr(); const h = vaultHealth(sh.all(), sh.leased().map((l) => l.outpoint), m().vaultParams.maxExposure); store.putVaultSnapshot(event, h); };
  const SNAP_EVENTS = new Set(['TX_ACCEPTED', 'LP_OPERATION', 'WORLD_RESET']);
  state.listeners.add((e) => { if (SNAP_EVENTS.has(e.type)) void snapVault(e.type).catch(() => undefined); });
  void snapVault('BOOT').catch(() => undefined);
  app.get('/api/liquidity/history', async () => {
    const rows = store.listVaultSnapshots<VaultSnapshot>();
    const flows = new Map<number, bigint>();
    rows.forEach((r, i) => { if (i && (r.event === 'LP_OPERATION' || r.event === 'WORLD_RESET')) { const p = rows[i - 1].body; flows.set(i, (r.body.totalSats - p.totalSats) - (r.body.cumulativeFees - p.cumulativeFees)); } });
    return { network: 'local', simulated: true, metrics: lpRiskHistory(rows.map((r) => r.body), flows), series: rows.map((r) => ({ at: r.at, event: r.event, totalSats: r.body.totalSats, utilizationBps: r.body.utilizationBps, cumulativeFees: r.body.cumulativeFees, flashCount: r.body.flashCount })), note: 'Drawdown is measured on vault sats net of LP deposits/withdrawals; persisted per API session (the LOCAL chain resets on restart).' };
  });
}
