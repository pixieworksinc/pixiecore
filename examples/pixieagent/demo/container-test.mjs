/** Six existing fixtures through the compiled harness and durable web ledger. */
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createBoundedTransport,transportPolicyFor,executeTriageGoal} from '../harness.js';
import {Ledger} from './live/ledger.mjs';
const read=name=>JSON.parse(readFileSync(new URL(`../evaluation/${name}.json`,import.meta.url),'utf8'));
const cases=read('cases').cases,fixtures=read('fixtures').responses;
const directory=mkdtempSync(join(tmpdir(),'pixieagent-container-'));
try {
  const ledger=new Ledger(directory,cases.map(c=>c.id),new Date(Date.now()+600000).toISOString());
  for(const c of cases){
    ledger.begin(c.id);let index=0;
    const bounded=createBoundedTransport(transportPolicyFor('luna'),async()=>{
      ledger.settle({prompt_tokens:256,completion_tokens:128,total_tokens:384});
      return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(fixtures[c.id][index++])}}]});
    },{reserve:async(_request,tokens)=>ledger.reserve(tokens),snapshot:()=>ledger.snapshot()});
    const trace=[];
    const result=await executeTriageGoal(bounded.fetch,'fixture-not-a-credential','luna',trace,c.goal);
    assert.equal(result.result.category,c.expected.category);assert.equal(result.result.severity,c.expected.severity);
    assert.equal(result.decisions,2);assert.equal(index,3);assert.equal(trace.length,3);
    ledger.finish(c.id,result.result);
  }
  assert.equal(ledger.snapshot().requests,18);
  console.log('Compiled PixieAgent/PixieCore: 6/6 fixtures, 18 simulated requests, zero provider calls.');
}finally{rmSync(directory,{recursive:true,force:true});}
