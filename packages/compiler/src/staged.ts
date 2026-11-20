// F11 Settlement recovery + the STAGED_RECOVERABLE execution class.
// A staged plan is a sequence of transactions where EVERY intermediate state is owned by the user (no stage
// leaves value in a contract the user cannot unilaterally spend). The executor:
//   * verifies each fully signed stage in the BCH 2026 VM before broadcast,
//   * classifies broadcast failures: TRANSIENT (timeout / network) → check whether the node already has the txid,
//     otherwise rebroadcast the SAME raw tx (idempotent, never re-signed); CONFLICT (an input was spent) → rebuild
//     the stage from fresh chain state (bounded); REJECTED (anything else) → stop,
//   * on stop, reports the RECOVERABLE position: the user-owned outputs of completed stages, each checked to be
//     unspent on chain, plus what the next attempt would need,
//   * `watchStaged` re-checks accepted stages (reorg / mempool eviction): a stage whose tx vanished is rebroadcast
//     from its raw hex; if its inputs were double-spent it is marked CONFLICTED with the recovery position.
import { contractUnlocks, finalize, signInputs, verifyTemplateAndRaw, type TxTemplate } from '@fuse/transaction-composer';

export interface ChainPort {
  broadcast(raw: string): Promise<string>;
  hasTx(txid: string): Promise<boolean>;
  isUnspent(outpoint: string): Promise<boolean>;
}
export interface StageCtx { completed: StageOutcome[] }
export interface StageDef {
  id: string;
  description: string;
  /** Build from CURRENT chain state (called again after a conflict). */
  build(ctx: StageCtx): Promise<TxTemplate>;
  signers: Record<string, Uint8Array>;
  /** Locking bytecode that must own every non-contract output change (the user). */
  owner: string;
}
export type StageStatus = 'ACCEPTED' | 'FAILED' | 'SKIPPED' | 'CONFLICTED';
export interface StageOutcome { id: string; status: StageStatus; txid?: string; raw?: string; attempts: Array<{ kind: 'BROADCAST' | 'REBROADCAST' | 'REBUILD' | 'VERIFY_FAILED' | 'ALREADY_KNOWN'; detail: string }>; ownerOutputs: string[]; error?: string }
export interface StagedResult { status: 'COMPLETED' | 'RECOVERABLE'; stages: StageOutcome[]; recovery?: { position: Array<{ outpoint: string; unspent: boolean }>; failedStage: string; reason: string; next: string } }

export const classifyBroadcastError = (msg: string): 'TRANSIENT' | 'CONFLICT' | 'REJECTED' =>
  /timeout|timed out|ECONN|ENOTFOUND|socket|network|503|502/i.test(msg) ? 'TRANSIENT'
    : /UTXO not found|missing inputs|missingorspent|already spent|conflict|txn-mempool-conflict|bad-txns-inputs/i.test(msg) ? 'CONFLICT' : 'REJECTED';

export async function executeStaged(stages: StageDef[], chain: ChainPort, o: { maxRebroadcasts?: number; maxRebuilds?: number } = {}): Promise<StagedResult> {
  const done: StageOutcome[] = [];
  for (const s of stages) {
    const out: StageOutcome = { id: s.id, status: 'FAILED', attempts: [], ownerOutputs: [] };
    done.push(out);
    let rebuilds = 0;
    build: for (;;) {
      let t: TxTemplate;
      try { t = await s.build({ completed: done.slice(0, -1) }); } catch (e) { out.error = `build: ${(e as Error).message}`; break; }
      if (t.outputs.some((x) => x.role === 'change' && x.lockingBytecode !== s.owner)) { out.error = 'stage sends change to a non-owner script: not recoverable by construction'; break; }
      const raw = finalize(t, contractUnlocks(t), ...Object.entries(s.signers).map(([k, p]) => signInputs(t, k, p)));
      const v = verifyTemplateAndRaw(t, raw, { requireStrongSighash: true });
      if (!v.ok) { out.attempts.push({ kind: 'VERIFY_FAILED', detail: v.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ') }); out.error = 'BCH VM verification failed'; break; }
      out.raw = raw; out.txid = v.txid;
      out.ownerOutputs = t.outputs.map((x, i) => [x, i] as const).filter(([x]) => x.lockingBytecode === s.owner).map(([, i]) => `${v.txid}:${i}`);
      let rebroadcasts = 0;
      for (;;) {
        try {
          const id = await chain.broadcast(raw);
          if (id !== v.txid) { out.error = `node returned a different txid ${id}`; break build; }
          out.attempts.push({ kind: rebroadcasts ? 'REBROADCAST' : 'BROADCAST', detail: `accepted ${id}` }); out.status = 'ACCEPTED'; break build;
        } catch (e) {
          const msg = (e as Error).message; const kind = classifyBroadcastError(msg);
          if (kind === 'TRANSIENT') {
            if (await chain.hasTx(v.txid)) { out.attempts.push({ kind: 'ALREADY_KNOWN', detail: `${msg} — node already has ${v.txid}` }); out.status = 'ACCEPTED'; break build; }
            if (rebroadcasts++ < (o.maxRebroadcasts ?? 3)) { out.attempts.push({ kind: 'REBROADCAST', detail: msg }); continue; }
            out.error = `transient failures exhausted: ${msg}`; break build;
          }
          if (kind === 'CONFLICT' && rebuilds++ < (o.maxRebuilds ?? 2)) { out.attempts.push({ kind: 'REBUILD', detail: msg }); continue build; }
          out.error = `${kind.toLowerCase()}: ${msg}`; break build;
        }
      }
    }
    if (out.status !== 'ACCEPTED') {
      for (const r of stages.slice(done.length)) done.push({ id: r.id, status: 'SKIPPED', attempts: [], ownerOutputs: [] });
      return { status: 'RECOVERABLE', stages: done, recovery: await recovery(done, chain, s.id, out.error ?? 'failed') };
    }
  }
  return { status: 'COMPLETED', stages: done };
}

async function recovery(done: StageOutcome[], chain: ChainPort, failedStage: string, reason: string) {
  const position = [];
  for (const st of done.filter((x) => x.status === 'ACCEPTED')) for (const op of st.ownerOutputs) position.push({ outpoint: op, unspent: await chain.isUnspent(op) });
  return { position, failedStage, reason, next: position.length ? 'Funds are in the owner\'s own outputs listed above; re-run the remaining stages from them or leave them in the wallet.' : 'No stage completed: funds never left the owner\'s coins.' };
}

/** Re-check accepted stages (reorg / eviction). Vanished txs are rebroadcast from raw; double-spent ones are CONFLICTED. */
export async function watchStaged(r: StagedResult, chain: ChainPort): Promise<{ stage: string; action: 'OK' | 'REBROADCAST' | 'CONFLICTED'; detail: string }[]> {
  const out = [];
  for (const st of r.stages.filter((x) => x.status === 'ACCEPTED' && x.txid && x.raw)) {
    if (await chain.hasTx(st.txid!)) { out.push({ stage: st.id, action: 'OK' as const, detail: 'still known to the node' }); continue; }
    try { await chain.broadcast(st.raw!); out.push({ stage: st.id, action: 'REBROADCAST' as const, detail: `tx ${st.txid} was missing and has been rebroadcast unchanged` }); }
    catch (e) { st.status = 'CONFLICTED'; out.push({ stage: st.id, action: 'CONFLICTED' as const, detail: (e as Error).message }); }
  }
  return out;
}
