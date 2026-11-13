import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest();
export function createTrialServer({ledger,cases,accessCode,origin,runCase}) {
  if(typeof accessCode!=='string'||accessCode.length<32) throw Error('Access code missing');
  const expected=digest('Bearer '+accessCode);
  let busy=false, attempts=0, windowStart=Date.now();
  return createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      if(Date.now()-windowStart>60_000){windowStart=Date.now();attempts=0;}
      if(++attempts>60) return send(429,{error:'少し待ってから操作してください。'});
      if(!timingSafeEqual(digest(req.headers.authorization??''),expected)) return send(401,{error:'アクセスコードを確認してください。'});
      if(req.method==='GET'&&req.url==='/status') return send(200,{model:'gpt-6-luna',budgetUsd:1,state:ledger.snapshot(),cases:cases.map(c=>({id:c.id,goal:c.goal}))});
      if(req.method!=='POST'||req.url!=='/run') return send(404,{error:'Not found'});
      if(req.headers.origin!==origin||req.headers['content-type']!=='application/json') return send(403,{error:'Request rejected'});
      if(busy) return send(409,{error:'別のケースを実行中です。'});
      let body='';req.setTimeout(3000,()=>req.destroy());
      for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024)return send(413,{error:'Request too large'});}
      req.setTimeout(0);
      const input=JSON.parse(body);
      if(!input||Object.keys(input).join(',')!=='caseId'||!cases.some(c=>c.id===input.caseId))return send(400,{error:'サンプルを選択してください。'});
      if(busy)return send(409,{error:'実行中です。'});
      try{ledger.begin(input.caseId);}catch{return send(409,{error:'このケースは実行済み、または試験が停止しています。'});}
      busy=true;
      const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),90_000);
      const disconnect=()=>{if(!res.writableEnded)abort.abort();};res.on('close',disconnect);
      try {
        const result=await runCase(cases.find(c=>c.id===input.caseId),ledger,abort.signal);
        abort.signal.throwIfAborted();ledger.finish(input.caseId,result);
        send(200,{result,state:ledger.snapshot()});
      }catch{ledger.fail(input.caseId);send(502,{error:'実行を停止しました。追加の自動呼び出しは行いません。',state:ledger.snapshot()});}
      finally{clearTimeout(timer);res.off('close',disconnect);busy=false;}
    }catch{if(!res.headersSent)send(400,{error:'Request rejected'});else res.destroy();}
  });
}
