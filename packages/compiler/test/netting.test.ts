import { describe, it, expect } from 'vitest';
import { createLocalMarket, marketViewOf, fixtureKey } from '@fuse/simulation';
import { signInputs, finalize, verifyTemplateAndRaw } from '@fuse/transaction-composer';
import { randomUtxo } from 'cashscript';
import { netSwapIntents, accountFees } from '../src/index.js';

describe('X01 cross-intent netting', () => {
  it('nets a buy and a sell intent in one VM-valid transaction, both sides better than the pool', async () => {
    const m = createLocalMarket();
    const seller = fixtureKey('netting-seller');
    const tok = m.provider.addUtxo(seller.address, { ...randomUtxo({ satoshis: 1_000n, token: { category: m.token, amount: 50_000n } }) });
    const view = marketViewOf(m);
    const r = netSwapIntents(view,
      { id: 'buy-1', lockingBytecode: m.user.lockingBytecode, coins: [{ txid: m.userCoin.txid, vout: 0, satoshis: m.userCoin.satoshis }], wantTokens: 30_000n, maxPaySats: 40_000_000n },
      { id: 'sell-1', lockingBytecode: seller.lockingBytecode, tokenCoins: [{ txid: tok.txid, vout: tok.vout, satoshis: tok.satoshis, token: tok.token as never }], sellTokens: 20_000n, minReceiveSats: 15_000_000n });
    expect(r.matched).toBe(20_000n);
    expect(r.residual).toEqual({ buy: 10_000n, sell: 0n });
    expect(r.savings.buyerSats).toBeGreaterThan(0n);
    const raw = finalize(r.template, signInputs(r.template, 'buyer', m.user.priv), signInputs(r.template, 'seller', seller.priv));
    const v = verifyTemplateAndRaw(r.template, raw, { requireStrongSighash: true });
    expect(v.ok).toBe(true);
    await m.provider.sendRawTransaction(raw);
    const acc = accountFees(r.template, { owner: m.user.lockingBytecode, solvers: { seller: seller.lockingBytecode } });
    expect(acc.conservation).toEqual({ sats: true, tokens: true });
    expect(acc.minerFee).toBe(r.minerFee);
  });
});
