// F11: STAGED_RECOVERABLE execution on the LOCAL BCH VM chain. Every intermediate state is owned by the user.
import { describe, it, expect } from 'vitest';
import { createLocalMarket, liveMarketView, solverIdentity, utxosOf } from '@fuse/simulation';
import { routingStrategy, type SwapIntentView } from '@fuse/solver-sdk';
import { recomputeOutcome } from '@fuse/auction';
import type { TxTemplate } from '@fuse/transaction-composer';
import { executeStaged, watchStaged, classifyBroadcastError, type ChainPort, type StageDef } from '../src/index.js';

type M = ReturnType<typeof createLocalMarket>;
const chainOf = (m: M, hooks: { beforeBroadcast?: (raw: string, n: number) => Promise<void>; failFirstAfterAccept?: boolean } = {}): ChainPort & { calls: number } => {
  const port = {
    calls: 0,
    async broadcast(raw: string) {
      port.calls++;
      await hooks.beforeBroadcast?.(raw, port.calls);
      const id = await m.provider.sendRawTransaction(raw);
      if (hooks.failFirstAfterAccept && port.calls === 1) throw new Error('request timed out after 30000 ms');
      return id;
    },
    async hasTx(txid: string) { return !!(await m.provider.getRawTransaction(txid)); },
    async isUnspent(op: string) { const [t, v] = op.split(':'); return (await m.provider.getUtxosForLockingBytecode(m.user.lockingBytecode)).some((u) => u.txid === t && u.vout === Number(v)); },
  };
  return port;
};

function plan(m: M, minOut = 30_000n): StageDef[] {
  const prepare: StageDef = {
    id: 'prepare', description: 'consolidate the owner coin into one exact funding output (owner → owner)', owner: m.user.lockingBytecode, signers: { user: m.user.priv },
    async build() {
      const c = (await utxosOf(m, m.user.address)).filter((x) => !x.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
      return { version: 2, locktime: 0, inputs: [{ ...c, lockingBytecode: m.user.lockingBytecode, role: 'wallet', unlock: { kind: 'p2pkh', signer: 'user' } }], outputs: [{ lockingBytecode: m.user.lockingBytecode, satoshis: c.satoshis - 1_000n, role: 'change', label: 'funding output' }] } satisfies TxTemplate;
    },
  };
  const swap: StageDef = {
    id: 'swap', description: 'buy tokens through the best Cauldron pool from the funding output', owner: m.user.lockingBytecode, signers: { user: m.user.priv },
    async build(ctx) {
      const fund = ctx.completed.find((x) => x.id === 'prepare')!.ownerOutputs[0];
      const [txid, vout] = fund.split(':');
      const coin = (await utxosOf(m, m.user.address)).find((u) => u.txid === txid && u.vout === Number(vout))!;
      const view = await liveMarketView(m); // FRESH state on every (re)build
      const intent: SwapIntentView = { auctionId: 'staged', intentId: 'staged-1', intentCommitment: '00'.repeat(32), type: 'TOKEN_SWAP', owner: { lockingBytecode: m.user.lockingBytecode, coins: [coin] }, buyToken: m.token, minOut, maxIn: 1_000_000_000n, maxFee: 20_000n, deadline: 2e9 };
      const p = routingStrategy(view, intent, solverIdentity(m, 'routing'));
      const out = recomputeOutcome(p.template, m.user.lockingBytecode, m.token);
      if (out.userReceivesTokens < minOut) throw new Error(`delivers ${out.userReceivesTokens} < minOut ${minOut}`);
      return p.template;
    },
  };
  return [prepare, swap];
}

/** A competing trader moves pool A/B first (spends the pool UTXO the stale stage-2 template references). */
async function competitorSwap(m: M) {
  const comp = solverIdentity(m, 'direct');
  const view = await liveMarketView(m);
  const intent: SwapIntentView = { auctionId: 'x', intentId: 'competitor', intentCommitment: '00'.repeat(32), type: 'TOKEN_SWAP', owner: { lockingBytecode: comp.lockingBytecode, coins: comp.coins }, buyToken: m.token, minOut: 1_500n, maxIn: 1_000_000_000n, maxFee: 20_000n, deadline: 2e9 };
  const p = routingStrategy(view, intent, solverIdentity(m, 'flash'));
  const { finalize, contractUnlocks, signInputs } = await import('@fuse/transaction-composer');
  await m.provider.sendRawTransaction(finalize(p.template, contractUnlocks(p.template), signInputs(p.template, 'user', comp.priv)));
}

describe('F11 staged recoverable execution', () => {
  it('classifies node errors', () => {
    expect(classifyBroadcastError('UTXO not found for input 0 of transaction ab')).toBe('CONFLICT');
    expect(classifyBroadcastError('request timed out')).toBe('TRANSIENT');
    expect(classifyBroadcastError('mandatory-script-verify-flag-failed')).toBe('REJECTED');
  });

  it('completes both stages; a timeout after acceptance is detected as ALREADY_KNOWN (no double send, no re-sign)', async () => {
    const m = createLocalMarket();
    const r = await executeStaged(plan(m), chainOf(m, { failFirstAfterAccept: true }));
    expect(r.status).toBe('COMPLETED');
    expect(r.stages[0].attempts.map((a) => a.kind)).toEqual(['ALREADY_KNOWN']);
    expect(r.stages[1].status).toBe('ACCEPTED');
    const toks = (await utxosOf(m, m.user.address)).filter((u) => (u.token as { category?: string } | undefined)?.category === m.token).reduce((s, u) => s + (u.token as { amount: bigint }).amount, 0n);
    expect(toks).toBe(30_000n);
  });

  it('a competitor spends the pool UTXO between stages: stage 2 is rebuilt from fresh state and settles', async () => {
    const m = createLocalMarket();
    let injected = false;
    const r = await executeStaged(plan(m), chainOf(m, { beforeBroadcast: async (_raw, n) => { if (n === 2 && !injected) { injected = true; await competitorSwap(m); } } }));
    expect(r.stages[1].error ?? '', JSON.stringify(r.stages[1].attempts)).toBe('');
    expect(r.status).toBe('COMPLETED');
    expect(r.stages[1].attempts.map((a) => a.kind)).toEqual(['REBUILD', 'BROADCAST']);
    expect(r.stages[1].attempts[0].detail).toMatch(/UTXO not found/);
  });

  it('stage 2 cannot meet minOut: stops RECOVERABLE with the owner funding output verified unspent', async () => {
    const m = createLocalMarket();
    const r = await executeStaged(plan(m, 10_000_000_000n), chainOf(m));
    expect(r.status).toBe('RECOVERABLE');
    expect(r.stages.map((s) => s.status)).toEqual(['ACCEPTED', 'FAILED']);
    expect(r.recovery!.failedStage).toBe('swap');
    expect(r.recovery!.reason).toMatch(/out of range|minOut/);
    expect(r.recovery!.position).toEqual([{ outpoint: r.stages[0].ownerOutputs[0], unspent: true }]);
  });

  it('a stage that would send change to a non-owner script is refused before signing', async () => {
    const m = createLocalMarket();
    const [p] = plan(m);
    const evil: StageDef = { ...p, async build(ctx) { const t = await p.build(ctx); t.outputs[0].lockingBytecode = solverIdentity(m, 'rogue').lockingBytecode; return t; } };
    const r = await executeStaged([evil], chainOf(m));
    expect(r.status).toBe('RECOVERABLE');
    expect(r.stages[0].error).toMatch(/non-owner/);
    expect(r.recovery!.next).toMatch(/never left/);
  });

  it('watch: a vanished stage tx (reorg / eviction) is rebroadcast unchanged; a double-spent one is CONFLICTED', async () => {
    const m = createLocalMarket();
    const r = await executeStaged(plan(m), chainOf(m));
    const forgetful: ChainPort = { ...chainOf(m), hasTx: async () => false };
    const w = await watchStaged(r, forgetful);
    expect(w.map((x) => x.action)).toEqual(['REBROADCAST', 'REBROADCAST']); // mock node recognises the identical raw tx
    const conflicted: ChainPort = { ...chainOf(m), hasTx: async () => false, broadcast: async () => { throw new Error('UTXO not found for input 0'); } };
    const w2 = await watchStaged(r, conflicted);
    expect(w2[0].action).toBe('CONFLICTED');
    expect(r.stages[0].status).toBe('CONFLICTED');
  });
});
