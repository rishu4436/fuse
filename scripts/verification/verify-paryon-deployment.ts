// READ-ONLY verification of the ParyonUSD mainnet-v1 deployment against @paryonusd/contracts@1.1.0.
// 1) Reconstructs every contract locking bytecode from npm artifacts + deployment params.
// 2) Fetches the 5 genesis txs from Chaingraph, re-hashes raw hex locally, decodes with libauth and
//    reports which reconstructed scripts appear in genesis outputs (bytecode correspondence).
// 3) Discovers live loan UTXOs at the Loan contract and the current price-contract state.
// No keys, no signing, no broadcasting.
import { writeFileSync } from 'node:fs';
import { binToHex } from '@bitauth/libauth';
import { ChaingraphClient, decodeRawTx } from '../../packages/indexer-client/src/index.js';
import { PARYON_MAINNET_V1, paryonContracts, decodeLoanCommitment, decodePriceCommitment, collateralRatioBps, liquidationPriceCents } from '../../packages/protocol-adapters/src/paryon.js';

const cg = new ChaingraphClient(undefined, fetch, 240_000);
const dep = PARYON_MAINNET_V1;
const c = paryonContracts(dep);
const named: Record<string, string> = {
  Borrowing: c.borrowing, PriceContract: c.price, Loan: c.loan, LoanSidecar: c.loanSidecar,
  ...Object.fromEntries(Object.entries(c.loanFunctions).map(([k, v]) => [`loanFn.${k}`, v])),
  StabilityPool: c.stabilityPool, Collector: c.collector, Payout: c.payout,
  Redeemer: c.redeemer, Redemption: c.redemption, RedemptionSidecar: c.redemptionSidecar,
};
const byScript = new Map(Object.entries(named).map(([k, v]) => [v, k]));

const genesis: Record<string, unknown> = {};
const seenInGenesis = new Set<string>();
for (const [tokenKey, txid] of Object.entries(dep.genesisTxIds)) {
  const tx = await cg.getTransaction(txid);
  if (!tx) { genesis[tokenKey] = { txid, error: 'not found' }; continue; }
  const d = decodeRawTx(tx.rawHex);
  const tokenId = (dep.tokenIds as Record<string, string>)[tokenKey];
  const spendsCategoryOutpoint = d.inputs.some((i) => binToHex(i.outpointTransactionHash) === tokenId && i.outpointIndex === 0);
  const outputs = d.outputs.map((o, i) => {
    const s = binToHex(o.lockingBytecode);
    const name = byScript.get(s) ?? null;
    if (name) seenInGenesis.add(name);
    return { i, contract: name, category: o.token ? binToHex(o.token.category) : null, nft: o.token?.nft ? o.token.nft.capability : null, ft: o.token?.amount ? o.token.amount.toString() : '0' };
  });
  genesis[tokenKey] = { txid, blockHeight: tx.blockHeight, spendsCategoryOutpoint, outputs };
}

// Live state
const tip = await cg.tipHeight();
const priceUtxos = await cg.getUnspentByLockingBytecode(c.price);
const priceStates = priceUtxos.filter((u) => u.tokenCategory === dep.tokenIds.paryonTokenId && u.nftCommitment?.startsWith('00')).map((u) => ({ outpoint: u.outpoint, ...decodePriceCommitment(u.nftCommitment!) }));
const loanUtxos = await cg.getUnspentByLockingBytecode(c.loan, 500);
const price = priceStates[0]?.priceRaw ?? null;
const loans = loanUtxos.filter((u) => u.tokenCategory === dep.tokenIds.paryonTokenId && u.nftCapability === 'mutable' && u.nftCommitment?.length === 54).map((u) => {
  const s = decodeLoanCommitment(u.nftCommitment!);
  const ratio = price ? collateralRatioBps(u.valueSatoshis, price, s.borrowedTokenAmount) : null;
  return {
    outpoint: u.outpoint, collateralSats: u.valueSatoshis.toString(), debtCents: s.borrowedTokenAmount.toString(), beingRedeemed: s.amountBeingRedeemed.toString(),
    status: s.status, currentRateRaw: s.currentInterestRateRaw.toString(), nextRateRaw: s.nextInterestRateRaw.toString(), lastPeriodInterestPaid: s.lastPeriodInterestPaid.toString(),
    collateralRatioBps: ratio?.toString() ?? null,
    liquidationPriceCents: s.borrowedTokenAmount > 0n ? liquidationPriceCents(u.valueSatoshis, s.borrowedTokenAmount).toString() : null,
  };
});
const ratios = loans.map((l) => Number(l.collateralRatioBps ?? 0)).filter((x) => x > 0).sort((a, b) => a - b);
const report = {
  checkedAt: new Date().toISOString(), tipHeight: tip, deployment: dep.name, artifacts: '@paryonusd/contracts@1.1.0',
  reconstructedScriptsSeenInGenesis: [...seenInGenesis].sort(),
  reconstructedScriptsNotSeenInGenesis: Object.keys(named).filter((n) => !seenInGenesis.has(n)).sort(),
  genesis,
  live: {
    priceContractUtxosAtReconstructedScript: priceUtxos.length, priceStates,
    loanUtxosAtLoanContract: loanUtxos.length, decodedLoans: loans.length,
    collateralRatioBps: ratios.length ? { min: ratios[0], median: ratios[Math.floor(ratios.length / 2)], max: ratios[ratios.length - 1] } : null,
    loansSample: loans.slice(0, 15),
  },
};
console.log(JSON.stringify({ ...report, genesis: undefined, live: { ...report.live, loansSample: report.live.loansSample.slice(0, 3) } }, null, 2));
writeFileSync(new URL('../../evidence/paryon-deployment-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
