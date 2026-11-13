import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Ledger} from './ledger.mjs';
import {createTrialServer} from './server.mjs';
const config=JSON.parse(readFileSync(process.env.TRIAL_CONFIG,'utf8'));
if(config.enabled!==true||config.model!=='gpt-6-luna'||config.maxCostUsd!==1||config.maxRequests!==30)throw Error('Trial is not enabled');
const root=resolve(config.runtimeRoot);
const manifest=JSON.parse(readFileSync(resolve(root,'bundle-manifest.json'),'utf8'));
for(const [file,hash] of Object.entries(manifest.files)){
 if(file.startsWith('/')||file.split('/').includes('..'))throw Error('Invalid manifest path');
 if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==hash)throw Error('Runtime changed');
}
const data=JSON.parse(readFileSync(resolve(root,'examples/pixieagent/evaluation/cases.json'),'utf8')).cases;
if(data.length!==6)throw Error('Unexpected corpus');
// A crash retains this lock. An operator must investigate rather than auto-reset it.
mkdirSync(resolve(config.stateDirectory,'process.lock'),{mode:0o700});
const ledger=new Ledger(config.stateDirectory,data.map(c=>c.id),config.expiresAt);
const accessCode=readFileSync(config.accessCodeFile,'utf8').trim();
const harness=await import(pathToFileURL(resolve(root,'examples/pixieagent/harness.js')));
const runCase=async(entry,spending,signal)=>{
 const credential=readFileSync(config.credentialFile,'utf8').trim();
 if(!credential||/[\r\n]/.test(credential))throw Error('Credential unavailable');
 const bounded=harness.createBoundedTransport(harness.transportPolicyFor('luna'),async(url,init)=>{
   signal.throwIfAborted();
   const response=await fetch(url,{...init,signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]),redirect:'error'});
   if(!response.ok||response.redirected||response.url!=='https://api.openai.com/v1/chat/completions')throw Error('Provider failed');
   const reader=response.body.getReader();const chunks=[];let bytes=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)throw Error('Response too large');chunks.push(value);}}finally{await reader.cancel();}
   const body=Buffer.concat(chunks);spending.settle(JSON.parse(body.toString()).usage);
   return new Response(body,{status:200,headers:{'Content-Type':'application/json'}});
 },{reserve:async(_request,tokens,s)=>{s?.throwIfAborted();return spending.reserve(tokens);},snapshot:()=>spending.snapshot()});
 const trace=[];const agent=await harness.executeTriageGoal(bounded.fetch,credential,'luna',trace,entry.goal,signal);
 const result=agent.result,obs=agent.observations[0];
 if(agent.decisions!==2||agent.observations.length!==1||obs.action_id!=='classify-issue'||obs.input.issue_text!==entry.goal||result.category!==entry.expected.category||result.severity!==entry.expected.severity||result.category!==obs.output.category||result.severity!==obs.output.severity||typeof result.reason!=='string'||!result.reason.trim()||trace.length!==3)throw Error('Result validation failed');
 return {category:result.category,severity:result.severity,reason:result.reason,requests:bounded.requestCount(),model:'gpt-6-luna'};
};
const server=createTrialServer({ledger,cases:data,accessCode,origin:config.origin,runCase});
server.requestTimeout=100_000;server.headersTimeout=5000;server.keepAliveTimeout=5000;
server.listen(config.port,'0.0.0.0');
