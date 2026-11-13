/** Exercise the packaged entrypoint over loopback with the existing six fixtures. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const entry=fileURLToPath(new URL('live/start.mjs',import.meta.url));
const cases=JSON.parse(await readFile(new URL('../evaluation/cases.json',import.meta.url),'utf8')).cases;
const fixtures=JSON.parse(await readFile(new URL('../evaluation/fixtures.json',import.meta.url),'utf8')).responses;
const code='synthetic-container-access-code-123456789';
const origin='http://127.0.0.1:3098';
test('packaged startup, six HTTP cases, no replay, preserved state and lock', {timeout:90000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pixieagent-http-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const state=join(directory,'state');await mkdir(state);
  await writeFile(join(directory,'key'),'fixture-not-a-credential');
  await writeFile(join(directory,'code'),code);
  const config={enabled:true,model:'gpt-6-luna',maxCostUsd:1,maxRequests:30,runtimeRoot:root,stateDirectory:state,credentialFile:join(directory,'key'),accessCodeFile:join(directory,'code'),origin,port:3098,expiresAt:new Date(Date.now()+120000).toISOString()};
  const configPath=join(directory,'config.json');await writeFile(configPath,JSON.stringify(config));
  const preload=join(directory,'provider.mjs');
  await writeFile(preload,`const responses=${JSON.stringify(cases.flatMap(c=>fixtures[c.id]))};
    globalThis.fetch=async(url,init)=>{
      if(url!=='https://api.openai.com/v1/chat/completions'||init.method!=='POST'||!responses.length)throw Error('Unexpected fixture request');
      const response=Response.json({usage:{prompt_tokens:256,completion_tokens:128,total_tokens:384},choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(responses.shift())}}]});
      Object.defineProperty(response,'url',{value:url});return response;
    };`);
  const child=spawn(process.execPath,['--import',preload,entry],{env:{...process.env,TRIAL_CONFIG:configPath},stdio:'ignore'});
  const closed=once(child,'close');
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;});
  let ready=false;
  for(let i=0;i<400;i++){
    if(child.exitCode!==null)throw Error('Packaged service exited during startup');
    try{if((await fetch(origin+'/status')).status===401){ready=true;break;}}catch{}
    await delay(25);
  }
  assert(ready,'Service must start without contacting a provider');
  const headers={authorization:'Bearer '+code,'content-type':'application/json',origin};
  const initial=await (await fetch(origin+'/status',{headers})).json();
  assert.equal(initial.state.requests,0);assert.equal(initial.state.used,0);
  const denied=await fetch(origin+'/run',{method:'POST',headers:{...headers,origin:'http://untrusted.invalid'},body:JSON.stringify({caseId:cases[0].id})});
  assert.equal(denied.status,403);
  for(const c of cases){
    const response=await fetch(origin+'/run',{method:'POST',headers,body:JSON.stringify({caseId:c.id})});
    assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.result.category,c.expected.category);assert.equal(data.result.severity,c.expected.severity);
  }
  const replay=await fetch(origin+'/run',{method:'POST',headers,body:JSON.stringify({caseId:cases[0].id})});assert.equal(replay.status,409);
  const saved=JSON.parse(await readFile(join(state,'ledger.json'),'utf8'));assert.equal(saved.requests,18);assert.equal(saved.pending,0);
  child.kill();await closed;
  const restart=spawn(process.execPath,[entry],{env:{...process.env,TRIAL_CONFIG:configPath},stdio:'ignore'});
  const [status]=await once(restart,'close');assert.notEqual(status,0,'Retained lock must prevent automatic restart');
  assert.deepEqual(JSON.parse(await readFile(join(state,'ledger.json'),'utf8')),saved);
});
test('disabled configuration exits before reading credentials or creating state',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pixieagent-disabled-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'config.json');await writeFile(path,JSON.stringify({enabled:false}));
  const child=spawn(process.execPath,[entry],{env:{...process.env,TRIAL_CONFIG:path},stdio:'ignore'});
  const [status]=await once(child,'close');assert.notEqual(status,0);
});
