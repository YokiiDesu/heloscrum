import {createHash} from 'node:crypto';
import {memoryRankingRequest,relevanceAnswers} from './memory-ranking.mjs';
import {VoyageError} from './voyage-context.mjs';

export const RERANK_POLICY=Object.freeze({version:1,models:{jev:'jev-latest',voyage:'rerank-3'},maxCallsPerProvider:20,maxBytesPerProvider:350000,maxRequestBytes:24000,timeoutMs:30000,maxResponseBytes:1024*1024,results:3});
const hash=text=>createHash('sha256').update(text).digest('hex');
const fail=(code,message)=>{throw new VoyageError(code,message);};
export function freezeRerankCases(report,corpus){
  if(report.corpusSha256!==corpus.sha256)fail('snapshot','The source snapshot changed. Use the original documentation checkout.');
  return report.cases.map(record=>{
    const candidates=[],seen=new Set();
    // The pool is fixed before either model runs. No gold label influences selection.
    for(const row of [...record.semantic,...record.keyword]){
      const doc=corpus.documents.find(d=>d.path===row.path),id=row.sha256+':'+row.offset+':'+row.end;
      if(!doc||doc.sha256!==row.sha256||!Number.isInteger(row.offset)||!Number.isInteger(row.end)||row.offset<0||row.end<=row.offset||doc.text.slice(row.offset,row.end)!==row.text||row.text.length>950)fail('snapshot','A saved candidate no longer matches its exact source.');
      if(seen.has(id))continue;seen.add(id);
      candidates.push({id,path:row.path,sha256:row.sha256,offset:row.offset,end:row.end,text:row.text,exact:record.query.toLowerCase()===row.path.toLowerCase()});
    }
    if(candidates.length<1||candidates.length>6)fail('candidates','Expected one to six frozen candidates.');
    const {state,questions}=memoryRankingRequest(record.query,candidates.map(c=>({title:c.path,text:c.text,source:{path:c.path,sha256:c.sha256,offset:c.offset,end:c.end},status:'current snapshot',freshness:{state:'current'},confidence:'unspecified'})));
    // Voyage receives the exact candidate state serialized per document; neither
    // model receives the expected answer, expected source, or evidence anchor.
    const documents=state.candidates.map(c=>JSON.stringify(c));
    return {query:record.query,expected:record.expected,candidates,state,questions,documents,candidateSha256:hash(JSON.stringify({query:record.query,documents})),baseline:{keyword:record.keyword,semantic:record.semantic}};
  });
}
export class RerankClient {
  #key;
  constructor(provider,key,{fetchImpl=fetch,policy={}}={}){
    if(!['jev','voyage'].includes(provider))fail('provider','Unknown reranker.');
    if(typeof key!=='string'||!key.trim()||key.length>8192||/[\r\n\0]/.test(key))fail('key','Enter valid keys for both providers.');
    this.provider=provider;this.#key=key.trim();this.fetchImpl=fetchImpl;this.policy={...RERANK_POLICY,...policy};this.calls=[];this.bytes=0;
  }
  forget(){this.#key=null;}
  async rank(item){
    if(!this.#key)fail('key','The trial key was cleared.');
    const model=this.policy.models[this.provider],payload=this.provider==='jev'?{model,state:item.state,questions:item.questions}:{model,query:item.query,documents:item.documents,top_k:item.documents.length,return_documents:false,truncation:false};
    const body=JSON.stringify(payload),bytes=Buffer.byteLength(body);
    if(this.calls.length>=this.policy.maxCallsPerProvider||this.bytes+bytes>this.policy.maxBytesPerProvider||bytes>this.policy.maxRequestBytes)fail('budget','The reranker trial budget was reached; no request was sent.');
    const call={number:this.calls.length+1,provider:this.provider,model,candidateSha256:item.candidateSha256,requestSha256:hash(body),requestBytes:bytes,candidates:item.candidates.length,usage:null,status:'pending'};
    this.bytes+=bytes;this.calls.push(call);const start=performance.now();
    try{
      let response;try{response=await this.fetchImpl(this.provider==='jev'?'https://api.typesafe.ai/v1/systemone':'https://api.voyageai.com/v1/rerank',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.#key},body,signal:AbortSignal.timeout(this.policy.timeoutMs)});}catch(e){fail(['TimeoutError','AbortError'].includes(e.name)?'timeout':'transport',this.provider+' request failed; no automatic retry was made.');}
      call.httpStatus=response.status;
      if(!response.ok){if(response.status===429){const after=Number(response.headers.get('retry-after'));call.retryAfterSeconds=Number.isFinite(after)&&after>0?Math.min(after,3600):60;}await response.body?.cancel();fail(response.status===401||response.status===403?'authentication':response.status===429?'rate-limit':'service',this.provider+' returned HTTP '+response.status+'.');}
      const chunks=[];let size=0;try{for await(const part of response.body){size+=part.length;if(size>this.policy.maxResponseBytes)fail('response-limit','Reranker response exceeded its limit.');chunks.push(part);}}catch(e){if(e instanceof VoyageError)throw e;fail('transport','Reranker response was interrupted.');}
      call.responseBytes=size;let raw;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid-response','Reranker returned invalid JSON.');}
      if(this.provider==='jev'&&Number.isSafeInteger(raw.usage?.input_tokens)&&raw.usage.input_tokens>=0)call.usage={input_tokens:raw.usage.input_tokens,output_tokens:Number.isSafeInteger(raw.usage.output_tokens)&&raw.usage.output_tokens>=0?raw.usage.output_tokens:null};
      if(this.provider==='voyage'&&Number.isSafeInteger(raw.usage?.total_tokens)&&raw.usage.total_tokens>=0)call.usage={total_tokens:raw.usage.total_tokens};
      call.reportedModel=typeof raw.model==='string'?raw.model:null;
      // Only the defined score fields are retained. Never log provider error text.
      call.raw=this.provider==='jev'?{answers:raw.answers,model:raw.model,usage:raw.usage}:{data:raw.data,model:raw.model,usage:raw.usage};
      let scores;
      if(this.provider==='jev')scores=relevanceAnswers(raw,item.candidates.length);
      else if(Array.isArray(raw.data)&&raw.data.length===item.candidates.length){scores=new Array(item.candidates.length);const seen=new Set();for(const row of raw.data){if(!Number.isInteger(row.index)||row.index<0||row.index>=scores.length||seen.has(row.index)||!Number.isFinite(row.relevance_score)){scores=null;break;}seen.add(row.index);scores[row.index]=row.relevance_score;}}
      if(!scores)fail('invalid-response','Reranker returned invalid score indexes or values.');
      call.status='complete';return {scores,call};
    }catch(e){call.status='failed';call.errorCode=e.code||'local';throw e;}
    finally{call.elapsedMs=Math.round(performance.now()-start);}
  }
  usage(){return {calls:this.calls,requestBytes:this.bytes,knownInputTokens:this.calls.reduce((n,c)=>n+(c.usage?.input_tokens??c.usage?.total_tokens??0),0),knownOutputTokens:this.provider==='jev'?this.calls.reduce((n,c)=>n+(c.usage?.output_tokens||0),0):null,unknownUsageCalls:this.calls.filter(c=>!c.usage).length};}
}
function topResults(item,scores){
  const sorted=item.candidates.map((c,i)=>({...c,score:scores[i]})).sort((a,b)=>Number(b.exact)-Number(a.exact)||b.score-a.score);
  const seen=new Set();return sorted.filter(c=>{if(seen.has(c.path))return false;seen.add(c.path);return true;}).slice(0,3).map(c=>({...c,exposedBytes:Buffer.byteLength(c.text)}));
}
export function summarizeReranks(cases){
  const positives=cases.filter(c=>c.expected.kind!=='unanswerable'),evidence=positives.filter(c=>c.expected.anchor),out={answerable:positives.length,evidenceCases:evidence.length,unanswerable:cases.length-positives.length,candidateEvidenceCeiling:evidence.filter(c=>c.candidates.some(p=>p.path===c.expected.path&&p.text.includes(c.expected.anchor))).length};
  for(const arm of ['semantic','keyword','jev','voyage']){let first=0,top3=0,evidence3=0,bytes=0;for(const c of positives){const rows=c.results[arm];if(rows[0]?.path===c.expected.path)first++;if(rows.some(p=>p.path===c.expected.path))top3++;if(c.expected.anchor&&rows.some(p=>p.path===c.expected.path&&p.text.includes(c.expected.anchor)))evidence3++;bytes+=rows.reduce((n,p)=>n+Buffer.byteLength(p.text),0);}out[arm]={documentTop1:first,documentTop3:top3,evidenceTop3:evidence3,exposedBytes:bytes};}
  return out;
}
export class RerankTrial {
  constructor(cases,clients,{corpusSha256,sourceReportSha256}={}){this.cases=cases;this.clients=clients;this.identity={corpusSha256,sourceReportSha256};this.completed=new Map();this.startedAt=null;}
  async evaluate(progress=()=>{},checkpoint=async()=>{}){
    this.startedAt??=Date.now();
    for(const [i,item] of this.cases.entries()){
      progress(`Query ${i+1}/${this.cases.length}: ${item.query}`);
      if(item.expected.kind==='exact-reference')continue;
      const providers=i%2?['voyage','jev']:['jev','voyage'];
      const results=await Promise.allSettled(providers.map(async provider=>{const key=provider+':'+i;if(this.completed.has(key))return;const result=await this.clients[provider].rank(item);this.completed.set(key,result);}));
      await checkpoint({completed:[...this.completed],usage:Object.fromEntries(Object.entries(this.clients).map(([k,c])=>[k,c.usage()]))});
      const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
    }
    const cases=this.cases.map((item,i)=>{
      const exact=item.expected.kind==='exact-reference',results={...item.baseline};
      for(const provider of ['jev','voyage'])results[provider]=topResults(item,exact?item.candidates.map(c=>Number(c.exact)):this.completed.get(provider+':'+i).scores);
      return {query:item.query,expected:item.expected,candidates:item.candidates,candidateSha256:item.candidateSha256,requestState:item.state,questions:item.questions,documents:item.documents,exactLookupBypass:exact,results};
    });
    return {version:1,at:new Date().toISOString(),...this.identity,policy:RERANK_POLICY,summary:summarizeReranks(cases),usage:Object.fromEntries(Object.entries(this.clients).map(([k,c])=>[k,c.usage()])),elapsedMs:Date.now()-this.startedAt,cases,limitations:['Same fixed development queries as the embedding trial, not a held-out benchmark.','Candidate union is limited to saved semantic top-three and keyword top-three passages; absent evidence cannot be recovered by reranking.','Both models receive the same candidate fields, text and ordering; Jev additionally receives the unchanged HeloScrum Noul criteria.','Top three distinct documents, one passage each, at most 950 characters per passage; exact-reference query bypasses both models.','No admission threshold applied: scores and negative cases remain visible; relevance is not factual verification.','Model requests run as independent pairs; one timing sample per query, with cold connections included.','Embedding baseline latency/usage belongs to the earlier report and is excluded from reranking usage.','No live agent memory indexed, no production settings changed, no agent work dispatched.']};
  }
}
