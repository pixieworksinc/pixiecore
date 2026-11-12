import { openSync, closeSync, fsyncSync, writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
export const LIMIT = 1_000_000_000;
export const HOLD = 210_384_000;
export class Ledger {
  constructor(directory, ids, expiresAt) {
    this.file = join(directory, 'ledger.json');
    if (!Number.isFinite(Date.parse(expiresAt))) throw Error('Invalid deadline');
    mkdirSync(directory, {recursive:true, mode:0o700});
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file,'utf8')) : {
      version:1, expiresAt, used:0, pending:0, requests:0, halted:false,
      cases:Object.fromEntries(ids.map(id=>[id,{status:'ready'}]))
    };
    const d=this.data;
    if(d.version!==1 || d.expiresAt!==expiresAt || JSON.stringify(Object.keys(d.cases).sort())!==JSON.stringify([...ids].sort()) || !['used','pending','requests'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0) || d.used+d.pending>LIMIT || d.requests>30 || ![0,HOLD].includes(d.pending) || typeof d.halted!=='boolean' || Object.values(d.cases).some(c=>!['ready','running','completed','failed'].includes(c.status))) throw Error('Invalid state');
    if(d.pending || Object.values(d.cases).some(c=>c.status==='running')) d.halted=true;
    this.persist();
  }
  persist() {
    const temp=this.file+'.tmp';
    try {
      const fd=openSync(temp,'w',0o600);
      try { writeFileSync(fd,JSON.stringify(this.data)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp,this.file);
      const dir=openSync(dirname(this.file),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
    } catch(error) {this.data.halted=true;throw error;}
  }
  available() {
    if(this.data.halted || Date.now()>=Date.parse(this.data.expiresAt)) throw Error('Trial stopped');
  }
  begin(id) {
    this.available();
    if(!Object.hasOwn(this.data.cases,id)||this.data.cases[id].status!=='ready'||Object.values(this.data.cases).some(c=>c.status==='running')) throw Error('Unavailable case');
    this.data.cases[id]={status:'running'};this.persist();
  }
  reserve(outputTokens) {
    this.available();
    const d=this.data;
    if(!Number.isInteger(outputTokens)||outputTokens<1||outputTokens>512||d.pending||d.requests>=30||d.used+HOLD>LIMIT) throw Error('Budget limit');
    d.pending=HOLD;d.requests++;this.persist();
    return {inputTokensReserved:1_050_000,outputTokenLimit:outputTokens,reservedNanoUsd:HOLD};
  }
  settle(usage) {
    const d=this.data;
    if(!d.pending||!usage) throw Error('Usage missing');
    const {prompt_tokens:i,completion_tokens:o,total_tokens:t}=usage;
    if(![i,o,t].every(Number.isSafeInteger)||i<1||i>1_050_000||o<0||o>512||t!==i+o) throw Error('Usage invalid');
    d.used+=i*200+o*750;d.pending=0;this.persist();
  }
  finish(id,result) {this.available();this.data.cases[id]={status:'completed',result};this.persist();}
  fail(id) {this.data.halted=true;this.data.cases[id]={status:'failed'};this.persist();}
  snapshot() {return structuredClone(this.data);}
}
