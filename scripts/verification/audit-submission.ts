// Read-only. Original receipts are retained byte-for-byte. Reissue only a receipt whose claimed block metadata changed.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { binToHex, decodeTransaction, hexToBin, hash256 } from '@bitauth/libauth';
import { verifyCertificate, CertificateSchema, sealCertificate, type ChainReader } from '@fuse/proof-verifier';
import { electrum, inclusion } from '../../services/api/src/live/fulcrum.js';
import { intentBinder, liveRederiver } from '../../services/api/src/live/verify.js';
import { loadVaultConfigs } from '../../services/api/src/live/vault.js';
import { pool } from '../../services/api/src/live/chain.js';

const read = (path:string) => JSON.parse(readFileSync(path,'utf8'), (_,v) => typeof v === 'string' && /^-?\d+n$/.test(v) ? v.slice(0,-1) : v);
const dir = 'evidence/mainnet';
const out = dir + '/submission';
mkdirSync(out, {recursive:true});
const save = (name:string, value:unknown) => writeFileSync(out+'/'+name+'.json', JSON.stringify(value, (_,v) => typeof v === 'bigint' ? v.toString() : v, 2)+'\n');
const key = read(dir+'/reverification.json').attestationPubkey;
const configs = loadVaultConfigs(process.cwd());
const observedAt = new Date().toISOString();
const { height } = await electrum<{height:number}>('blockchain.headers.subscribe', []);
const raws = new Map<string,Promise<string>>();
function raw(id:string) {
  if (!raws.has(id)) raws.set(id,electrum<string>('blockchain.transaction.get',[id,false]).then(hex => {
    if (binToHex(hash256(hexToBin(hex)).reverse()) !== id) throw Error('Independent raw hash differs: '+id);
    return hex;
  }));
  return raws.get(id)!;
}
const wallet = read(dir+'/wizardconnect-cashonize/run.json');
const ids = new Set<string>([...read(dir+'/run.json').txs, ...read(dir+'/live-run.json').txs].map(t=>t.txid));
Object.values(wallet.txs).forEach(t => ids.add(String(t)));
const receipts = new Map(readdirSync(dir+'/certificates').map(name=>[name.slice(0,-5),read(dir+'/certificates/'+name)]));
receipts.set(wallet.signedTxChecks.txid,wallet.exchanges['live/certificate'].response);
for(const id of receipts.keys()) ids.add(id);
const rows = await pool([...ids], 2, async txid => {
  const [hex, block] = await Promise.all([raw(txid),inclusion(txid)]);
  const tx=decodeTransaction(hexToBin(hex)); if(typeof tx==='string')throw Error(tx);
  const sources=await pool(tx.inputs,4,async i=>{
    const id=binToHex(i.outpointTransactionHash); const parent=decodeTransaction(hexToBin(await raw(id)));
    if(typeof parent==='string')throw Error(parent);
    const output=parent.outputs[i.outpointIndex]; if(!output)throw Error('Missing parent output');
    return {outpoint:id+':'+i.outpointIndex,output};
  });
  const fee=sources.reduce((n,s)=>n+s.output.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
  const receipt=receipts.get(txid);
  const owner=receipt?.certificate.outcome.ownerLockingBytecode;
  const delta=owner ? tx.outputs.filter(o=>binToHex(o.lockingBytecode)===owner).reduce((v,o)=>v+o.valueSatoshis,0n)-sources.filter(s=>binToHex(s.output.lockingBytecode)===owner).reduce((v,s)=>v+s.output.valueSatoshis,0n) : null;
  const reader: ChainReader={network:'mainnet',tipHeight:async()=>height,getRawTransaction:async id=>({rawHex:await raw(id),blockHash:id===txid?block.blockHash:null,blockHeight:id===txid?block.blockHeight:null})};
  let verified=null;
  if(receipt){
    const ctx={rederive:liveRederiver(configs),intent:intentBinder({trustedPubkey:key,authorization:receipt.authorization,userSignature:receipt.userSignature})};
    const original=await verifyCertificate(receipt.certificate,reader,ctx);
    const {commitment:_commitment,...body}=CertificateSchema.parse(receipt.certificate);
    const certificate=sealCertificate({...body,transactions:[{txid,blockHeight:block.blockHeight,blockHash:block.blockHash}]});
    const result=await verifyCertificate(certificate,reader,ctx);
    if(result.status!=='VERIFIED' || !result.levels.OUTCOME_VERIFIED.ok || (receipt.authorization && !result.levels.INTENT_BOUND.ok))throw Error(txid+' '+JSON.stringify(result));
    save(txid,{certificate,authorization:receipt.authorization,userSignature:receipt.userSignature,verification:result});
    verified={originalStatus:original.status,originalFailures:original.checks.filter(c=>!c.ok && c.name==='claimed-block').map(c=>c.name),originalBlock:body.transactions[0],level:result.level};
  }
  console.log(txid,block.blockHeight,String(fee),verified?.level??'INCLUDED');
  return {txid,...block,confirmations:height-block.blockHeight+1,fee,ownerNetSats:delta,inputs:sources.map(s=>s.outpoint),verified};
});
const transactions=Object.fromEntries(await Promise.all([...raws].sort(([a],[b])=>a.localeCompare(b)).map(async ([id,p])=>[id,await p])));
save('chain-audit',{observedAt,source:'cashnode.bch.ninja / Fulcrum',tip:height,transactions:rows,rawTransactions:transactions});
console.log('Audit rows',rows.length,'raw transactions',Object.keys(transactions).length,'key fingerprint',createHash('sha256').update(key).digest('hex').slice(0,12));
