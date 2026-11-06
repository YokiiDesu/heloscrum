import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {VoyageContext,VOYAGE_TRIAL_POLICY} from '../lib/voyage-context.mjs';
import {loadTrialCorpus,VoyageTrial,TRIAL_QUERIES} from '../lib/voyage-trial.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),corpus=await loadTrialCorpus(root);
const port=Number(process.env.HELOSCRUM_VOYAGE_TRIAL_PORT||4214);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid trial port');
const origin='http://127.0.0.1:'+port,token=randomBytes(32).toString('hex'),cookie=randomBytes(32).toString('hex');
let client=null,trial=null,report=null,busy=false,progress='Ready for a Voyage key.',error=null,retryAt=0;
const output=path.join(root,'output/voyage-trial');
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const send=(res,status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(body):body);};
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000)throw Error('Request too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
const safeError=e=>e.name==='VoyageError'?e.message:'Trial failed locally. Check the source files and retry explicitly.';
async function saveReport(){await mkdir(output,{recursive:true,mode:0o700});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
async function run(){
  try{report=await trial.evaluate(value=>{progress=value;});await saveReport();progress='Comparison complete. The key remains only in this trial process.';}
  catch(e){error=safeError(e);const last=client.calls.at(-1);retryAt=e.code==='rate-limit'?Date.now()+(last?.retryAfterSeconds||60)*1000:0;progress='Comparison stopped. Completed document embeddings are retained for an explicit continuation.';}
  finally{busy=false;}
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'This trial only accepts its own localhost page.'});
    const url=new URL(req.url,origin);
    if(req.method==='GET'&&url.pathname==='/favicon.ico')return send(res,204,'','image/x-icon');
    if(req.method==='GET'&&url.pathname==='/'){
      res.setHeader('Set-Cookie',`voyage_trial=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
      return send(res,200,await readFile(new URL('./voyage-trial-ui.html',import.meta.url),'utf8'),'text/html; charset=utf-8');
    }
    if(req.method==='GET'&&url.pathname==='/trial.js')return send(res,200,await readFile(new URL('./voyage-trial-ui.js',import.meta.url),'utf8'),'text/javascript; charset=utf-8');
    if(!req.headers.cookie?.split(';').some(v=>equal(v.trim(),'voyage_trial='+cookie)))return send(res,401,{error:'Open the trial page first.'});
    if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{token,busy,progress,error,retryAt,canResume:!!trial&&!report&&!busy,hasKey:!!client,ready:!!report,usage:client?.usage(),report,corpus:{sha256:corpus.sha256,bytes:corpus.bytes,documents:corpus.documents.map(d=>({path:d.path,sha256:d.sha256,chunks:d.chunks.length})),queries:TRIAL_QUERIES.length},policy:VOYAGE_TRIAL_POLICY});
    if(req.method==='GET'&&url.pathname==='/report.json'){if(!report)return send(res,404,{error:'Run the comparison first.'});res.setHeader('Content-Disposition','attachment; filename="voyage-retrieval-report.json"');return send(res,200,report);}
    if(req.method!=='POST'||req.headers.origin!==origin||!equal(req.headers['x-trial-token'],token)||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Invalid trial request.'});
    if(busy)return send(res,409,{error:'Wait for the current comparison to finish.'});
    if(url.pathname==='/api/run'){
      const input=await body(req);
      // Construct before discarding the previous connection; never serialize or log keys.
      const next=new VoyageContext(input.apiKey);client?.forget();client=next;input.apiKey='';trial=new VoyageTrial(corpus,client);report=null;error=null;retryAt=0;busy=true;progress='Starting bounded comparison…';
      send(res,202,{started:true});
      await run();
      return;
    }
    if(url.pathname==='/api/resume'){
      if(!trial||report)return send(res,409,{error:'No stopped comparison to continue.'});
      if(Date.now()<retryAt)return send(res,429,{error:'Wait until the displayed retry time.'});
      busy=true;error=null;progress='Continuing with retained document embeddings…';send(res,202,{started:true});await run();return;
    }
    if(url.pathname==='/api/search'){
      if(!report||!trial)return send(res,409,{error:'Run the fixed comparison with a key first.'});
      const {query}=await body(req);busy=true;
      try{const result=await trial.compare(query);return send(res,200,{result,usage:client.usage()});}catch(e){return send(res,400,{error:safeError(e)});}finally{busy=false;}
    }
    if(url.pathname==='/api/forget'){client?.forget();client=null;trial=null;progress='Key cleared. The completed report remains available.';return send(res,200,{cleared:true});}
    return send(res,404,{error:'Unknown trial route.'});
  }catch(e){return send(res,400,{error:safeError(e)});}
});
server.requestTimeout=40000;server.headersTimeout=10000;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log(JSON.stringify({url:origin,corpusBytes:corpus.bytes,documents:corpus.documents.length,queries:TRIAL_QUERIES.length,report:path.join(output,'report.json')}));
const stop=()=>{client?.forget();server.close();server.closeAllConnections();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
