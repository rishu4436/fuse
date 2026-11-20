import { paryonContracts, PARYON_MAINNET_V1 } from '../packages/protocol-adapters/src/paryon.js';
const c = paryonContracts(PARYON_MAINNET_V1) as unknown as Record<string,string>;
console.log(c.loan); console.log(c.priceGuarded);
