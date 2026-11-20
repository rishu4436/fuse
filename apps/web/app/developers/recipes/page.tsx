'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { usePoll } from '@/lib/hooks';
import { api, short } from '@/lib/api';
import { PageHeader, Panel, Badge, Button, Mono, ApiOffline, Empty } from '@/components/ui';
import { Code } from '@/components/code';

interface Check { name: string; ok: boolean; detail: string }
interface Entry { id: string; hash: string; authorPubkey: string; body: { name: string; description: string; legs: string[]; author: { label: string }; tags: string[] }; verdict: { listed: boolean; checks: Check[]; strategy?: string } }
interface Market { mode: string; autoExecute: false; legs: Record<string, string>; recipes: Entry[] }
const ORDER = ['BORROW', 'INVENTORY', 'BUY_CHEAP', 'SELL_RICH', 'REPAY', 'PAY_USER', 'SOLVER_FEE'];

function Composer({ legs, onPublished }: { legs: Record<string, string>; onPublished: () => void }) {
  const [name, setName] = useState('My flash route');
  const [picked, setPicked] = useState<string[]>(['BORROW', 'BUY_CHEAP', 'SELL_RICH', 'REPAY', 'PAY_USER']);
  const [res, setRes] = useState<{ listed: boolean; checks: Check[] }>(); const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const publish = async () => { setBusy(true); try { setRes(await api('/api/marketplace/publish-local', { method: 'POST', json: { name, legs: picked } })); onPublished(); } catch (e) { setRes({ listed: false, checks: [{ name: 'request', ok: false, detail: (e as Error).message }] }); } finally { setBusy(false); } };
  return (
    <Panel title="Compose and submit" kicker="Signed with a LOCAL fixture author key" mode="SIMULATION">
      <label className="block"><span className="text-[12px] text-fog-300">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-[10px] border hairline bg-ink-850 px-3 py-2 text-[13px] text-fog-100 outline-none focus:border-volt-400/60" /></label>
      <div className="mt-4 text-[12px] text-fog-300">Legs, in order <span className="text-fog-400">(click to add or remove)</span></div>
      <div className="mt-2 flex flex-wrap gap-2">
        {ORDER.map((k) => <button key={k} onClick={() => toggle(k)} aria-pressed={picked.includes(k)} className={clsx('rounded-full border px-3 py-1 text-[11.5px] transition-colors', picked.includes(k) ? 'border-volt-400/50 bg-volt-400/10 text-volt-300' : 'hairline text-fog-300 hover:border-ink-500')}>{legs[k]}</button>)}
      </div>
      <ol className="mt-4 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fog-300">{picked.map((k, i) => <li key={k} className="flex items-center gap-1.5">{i > 0 && <span className="text-fog-500" aria-hidden>→</span>}<span className="num rounded-md bg-ink-800 px-2 py-0.5">{k}</span></li>)}</ol>
      <div className="mt-4"><Button onClick={publish} disabled={busy || picked.length === 0} data-testid="publish-recipe">{busy ? 'Verifying…' : 'Submit for verification'}</Button></div>
      <AnimatePresence>{res && <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 grid gap-1.5" data-testid="publish-verdict">
        <li className={clsx('text-[12px] font-medium', res.listed ? 'text-volt-300' : 'text-rose-bad')}>{res.listed ? 'Listed' : 'Rejected'}</li>
        {res.checks.map((c) => <li key={c.name} className="flex gap-2 text-[11.5px]"><span className={c.ok ? 'text-volt-300' : 'text-rose-bad'}>{c.ok ? '✓' : '✕'}</span><span className="text-fog-200">{c.name}</span><span className="text-fog-400">{c.detail}</span></li>)}
      </motion.ul>}</AnimatePresence>
    </Panel>
  );
}

const INTENT = `{
  "version": 1, "id": "intent_example_0001", "network": "local", "type": "TOKEN_SWAP",
  "owner": { "lockingBytecode": "76a914…88ac", "authorization": "WALLET_SIGNATURE" },
  "inputs": [{ "asset": "BCH", "amount": "40000000" }],
  "allowedAssets": ["BCH", "<token category>"],
  "operation": { "kind": "TOKEN_SWAP", "params": {} },
  "minOutput": { "asset": "<token category>", "amount": "30000" },
  "maxInput": { "asset": "BCH", "amount": "40000000" },
  "maxFee": { "asset": "BCH", "amount": "20000" },
  "maxSlippageBps": 100, "deadline": 1795000000,
  "protocols": ["cauldron", "fuse-flashvault"],
  "authorizationMode": "PER_TX_SIGNATURE", "nonce": "00112233445566778899",
  "replayDomain": "fuse-local", "atomicity": "ATOMIC_SINGLE_TX",
  "requiredEvidence": ["TX_CONFIRMED", "OUTPUT_TO_OWNER", "CERTIFICATE"]
}`;
const POLICY = `POST /api/guardian/policies
{
  "name": "Keep my loan above 150%",
  "loan": "<paryon loan txid>:<vout>",
  "channels": ["in-app"],
  "rules": [
    { "id": "r1", "when": { "crBelowBps": 15000 }, "then": "PROPOSE_TOP_UP", "targetCrBps": 17500, "severity": "warning" },
    { "id": "r2", "when": { "redemptionActive": true }, "then": "ALERT", "severity": "critical" }
  ]
}`;

export default function Recipes() {
  const [nonce, setNonce] = useState(0);
  const m = usePoll<Market>(`/api/marketplace/recipes?n=${nonce}`, 0);
  const data = m.data;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Developers · Recipe marketplace" title="Strategy recipes, verified before they are listed"
        lede="A recipe is a signed, content-addressed description of a strategy. Listing requires a valid schema, a matching content hash, a valid Schnorr author signature, a structurally safe leg order (every borrow repaid) and a successful compile in the BCH VM. Verdicts are recomputed against the current local market on every view. Listing never executes anything."
        right={<Badge mode="SIMULATION" />} />
      <ApiOffline error={m.error} />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-4" data-testid="recipe-list">
          {!data?.recipes.length ? <Panel><Empty title="No recipes yet" /></Panel> : data.recipes.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 6) * 0.05 }}>
              <Panel title={r.body.name} kicker={<>by {r.body.author.label} · <Mono>{short(r.hash, 6)}</Mono></>} actions={<span className={clsx('num text-[10.5px] tracking-[0.08em]', r.verdict.listed ? 'text-volt-300' : 'text-rose-bad')}>{r.verdict.listed ? 'LISTED' : 'REJECTED'}</span>}>
                {r.body.description && <p className="mb-3 text-[12.5px] text-fog-300">{r.body.description}</p>}
                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">{r.body.legs.map((k, j) => <span key={j} className="flex items-center gap-1.5">{j > 0 && <span className="text-fog-500" aria-hidden>→</span>}<span className="num rounded-md bg-ink-800 px-2 py-0.5 text-fog-200">{k}</span></span>)}</div>
                <ul className="grid gap-1 sm:grid-cols-2">{r.verdict.checks.map((c) => <li key={c.name} className="flex gap-2 text-[11.5px]"><span className={c.ok ? 'text-volt-300' : 'text-rose-bad'}>{c.ok ? '✓' : '✕'}</span><span className="text-fog-300" title={c.detail}>{c.name}</span>{!c.ok && <span className="text-fog-400">{c.detail}</span>}</li>)}</ul>
              </Panel>
            </motion.div>
          ))}
        </div>
        <div className="grid content-start gap-5">
          {data && <Composer legs={data.legs} onPublished={() => setNonce((n) => n + 1)} />}
          <Panel title="Never auto-executes" kicker="by design"><p className="text-[12px] leading-relaxed text-fog-300">A listed recipe is a template. Running it means compiling it into your own intent in the Intent Studio, where your bounds and signature still apply.</p></Panel>
        </div>
      </div>
      <h2 className="mb-3 mt-10 text-[13px] font-medium text-fog-200">Document formats accepted today</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="Token swap intent" kicker="POST /api/compile · FEP intent schema"><Code lang="json">{INTENT}</Code></Panel>
        <Panel title="Guardian policy" kicker="Proposals only, never executed"><Code lang="json">{POLICY}</Code></Panel>
      </div>
    </div>
  );
}
