import http from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadTrialCorpus} from '../lib/voyage-trial.mjs';
import {RerankClient,RerankTrial,RERANK_POLICY,freezeRerankCases} from '../lib/rerank-trial.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=await readFile(process.env.HELOSCRUM_RERANK_REPORT||path.join(root,'output/voyage-trial/report.json'),'utf8');
const corpus=await loadTrialCorpus(root),cases=freezeRerankCases(JSON.parse(source),corpus),sourceReportSha256=createHash('sha256').update(source).digest('hex');
const port=Number(process.env.HELOSCRUM_RERANK_TRIAL_PORT||4215);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid trial port');
const origin='http://127.0.0.1:'+port,token=randomBytes(32).toString('hex'),cookie=randomBytes(32).toString('hex');
let clients=null,trial=null,report=null,busy=false,progress='Ready for the two API keys.',error=null,retryAt=0;
const output=path.join(root,'output/rerank-trial');
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const send=(res,status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(value):value);};
async function body(req){const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>20000)throw Error('Request too large');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
const safeError=e=>e.name==='VoyageError'?e.message:'Local trial error; no automatic retry was made.';
async function save(name,data){await mkdir(output,{recursive:true,mode:0o700});await writeFile(path.join(output,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});}
const forget=()=>{for(const client of Object.values(clients||{}))client.forget();clients=null;trial=null;};
async function run(){
  try{report=await trial.evaluate(value=>{progress=value;},data=>save('checkpoint.json',data));await save('report.json',report);progress='Comparison complete. Both keys remain only in this process.';}
  catch(e){error=safeError(e);retryAt=Math.max(0,...Object.values(clients).map(c=>{const last=c.calls.at(-1);return last?.errorCode==='rate-limit'?Date.now()+(last.retryAfterSeconds||60)*1000:0;}));progress='Stopped. Successful model calls are retained for an explicit continuation.';}
  finally{busy=false;}
}
const server=http.createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,{error:'Local same-origin requests only.'});
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&url.pathname==='/favicon.ico')return send(res,204,'','image/x-icon');
  if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Set-Cookie',`rerank_trial=${cookie}; HttpOnly; SameSite=Strict; Path=/`);return send(res,200,await readFile(new URL('./rerank-trial-ui.html',import.meta.url),'utf8'),'text/html; charset=utf-8');}
  if(req.method==='GET'&&url.pathname==='/trial.js')return send(res,200,await readFile(new URL('./rerank-trial-ui.js',import.meta.url),'utf8'),'text/javascript; charset=utf-8');
  if(!req.headers.cookie?.split(';').some(v=>equal(v.trim(),'rerank_trial='+cookie)))return send(res,401,{error:'Open the trial page first.'});
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{token,busy,progress,error,retryAt,hasKeys:!!clients,canResume:!!trial&&!report&&!busy,report,policy:RERANK_POLICY,caseCount:cases.length,candidateCounts:cases.map(c=>c.candidates.length),corpusSha256:corpus.sha256,sourceReportSha256,usage:clients?Object.fromEntries(Object.entries(clients).map(([key,c])=>[key,c.usage()])):null});
  if(req.method==='GET'&&url.pathname==='/report.json'){if(!report)return send(res,404,{error:'Run the comparison first.'});res.setHeader('Content-Disposition','attachment; filename="jev-vs-rerank-3-report.json"');return send(res,200,report);}
  if(req.method!=='POST'||req.headers.origin!==origin||!equal(req.headers['x-trial-token'],token)||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Invalid trial request.'});
  if(busy)return send(res,409,{error:'Wait for the current comparison.'});
  if(url.pathname==='/api/run'){
    const input=await body(req),next={jev:new RerankClient('jev',input.jevKey),voyage:new RerankClient('voyage',input.voyageKey)};input.jevKey='';input.voyageKey='';forget();clients=next;trial=new RerankTrial(cases,clients,{corpusSha256:corpus.sha256,sourceReportSha256});report=null;error=null;retryAt=0;busy=true;progress='Starting the same-candidate comparison…';send(res,202,{started:true});await run();return;
  }
  if(url.pathname==='/api/resume'){if(!trial||report)return send(res,409,{error:'No stopped comparison.'});if(Date.now()<retryAt)return send(res,429,{error:'Wait until the displayed retry time.'});busy=true;error=null;progress='Continuing retained requests…';send(res,202,{started:true});await run();return;}
  if(url.pathname==='/api/forget'){forget();progress='Both keys cleared; the completed report remains available.';return send(res,200,{cleared:true});}
  return send(res,404,{error:'Unknown route.'});
}catch(e){send(res,400,{error:safeError(e)});}});
server.requestTimeout=40000;server.headersTimeout=10000;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log(JSON.stringify({url:origin,cases:cases.length,sourceReportSha256,report:path.join(output,'report.json')}));
const stop=()=>{forget();server.close();server.closeAllConnections();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
