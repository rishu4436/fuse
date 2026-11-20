import { lockingBytecodeToCashAddress, hexToBin } from '@bitauth/libauth';
import { readFileSync } from 'node:fs';
for (const lb of readFileSync('/tmp/lbs.txt','utf8').trim().split('\n')) { const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(lb), prefix: 'bitcoincash', tokenSupport: true } as never); console.log(typeof r === 'string' ? r : (r as {address:string}).address); }
