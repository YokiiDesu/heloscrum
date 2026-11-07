import {createHash} from 'node:crypto';
import {HISTORY_RERANK_MODEL,rerankBody,RERANK_REQUEST_BYTES} from './voyage-rerank.mjs';

export const HISTORY_RERANK_POLICY=Object.freeze({version:1,model:HISTORY_RERANK_MODEL,sources:16,passages:24,perSource:2,timeoutMs:5000,minuteCalls:10,cacheMs:60000,cacheEntries:64,cooldownMs:60000});
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=row=>JSON.stringify(row.source);

export function historyRerankPool(query,matches){
  const grouped=new Map();
  for(const row of matches){const key=identity(row),rows=grouped.get(key)||[];if(rows.length<HISTORY_RERANK_POLICY.perSource&&!rows.some(r=>r.offset===row.offset&&r.end===row.end))rows.push(row);grouped.set(key,rows);}
  const sources=[...grouped.values()].slice(0,HISTORY_RERANK_POLICY.sources),pool=[];
  // Give each source a first passage before spending budget on alternative
  // passages. Deduplicate sources only after reranking has selected their text.
  for(let i=0;i<HISTORY_RERANK_POLICY.perSource;i++)for(const rows of sources){
    const row=rows[i];if(!row||pool.length>=HISTORY_RERANK_POLICY.passages)continue;
    if(Buffer.byteLength(rerankBody(query,[...pool,row].map(p=>p.text)))>RERANK_REQUEST_BYTES)continue;
    pool.push(row);
  }
  return {pool,limited:pool.length<matches.length,sourceCount:grouped.size};
}

export class HistoryReranking {
  constructor(plane){this.plane=plane;this.cache=new Map();this.calls=[];this.cooldowns=new Map();}
  async rank(task,connection,query,matches,baseline,limit){
    const {pool,limited,sourceCount}=historyRerankPool(query,matches),policy=HISTORY_RERANK_POLICY;
    const metadata={model:policy.model,candidates:pool.length,sources:new Set(pool.map(identity)).size,totalSources:sourceCount,limited,calls:0,usage:null,cacheHit:false};
    const fallback=reason=>({...baseline,reranking:{...metadata,status:'fallback',reason}});
    if(pool.length<2)return {...baseline,reranking:{...metadata,status:'skipped',reason:'single-passage'}};
    const connectionVersion=connection.id+':'+connection.revision;
    // Authorization and connection checks happen before this stage on every
    // search. Bind scores to owner, revision and exact candidate identity/text.
    const key=hash(JSON.stringify({owner:[task.project,task.id],connection:connectionVersion,policy,query,candidates:pool.map(p=>({source:p.source,sha256:p.sha256,offset:p.offset,end:p.end,text:p.text}))}));
    let result=this.cache.get(key);
    if(result&&Date.now()-result.at>=policy.cacheMs){this.cache.delete(key);result=null;}
    if(result)metadata.cacheHit=true;
    else{
      if((this.cooldowns.get(connectionVersion)||0)>Date.now())return fallback('service-cooldown');
      this.calls=this.calls.filter(at=>Date.now()-at<60000);if(this.calls.length>=policy.minuteCalls)return fallback('rate-budget');
      this.calls.push(Date.now());metadata.calls=1;
      const evaluation={policy,requestedModel:policy.model,query,candidates:pool.map(p=>({source:p.source,sha256:p.sha256,offset:p.offset,end:p.end})),requestSha256:hash(rerankBody(query,pool.map(p=>p.text))),requestBytes:Buffer.byteLength(rerankBody(query,pool.map(p=>p.text)))};
      try{
        const response=await this.plane.context.measuredCall(task,'history-reranking',connection.id,()=>this.plane.ai.rerank(connection.id,query,pool.map(p=>p.text),{signal:AbortSignal.timeout(policy.timeoutMs),onResponse:raw=>{evaluation.response=raw;metadata.usage=raw.usage;}}),evaluation);
        result={at:Date.now(),scores:response.scores};metadata.usage=response.usage;
        this.cache.set(key,result);while(this.cache.size>policy.cacheEntries)this.cache.delete(this.cache.keys().next().value);
      }catch(error){
        this.cooldowns.set(connectionVersion,Date.now()+policy.cooldownMs);
        return fallback(error.code==='RERANK_RESPONSE'?'invalid-response':['AbortError','TimeoutError'].includes(error.name)?'service-timeout':['EACCES','ENOSPC','EROFS'].includes(error.code)?'audit-unavailable':'service-unavailable');
      }
    }
    const seen=new Set(),ranked=pool.map((row,i)=>({...row,rerankScore:result.scores[i]})).sort((a,b)=>b.rerankScore-a.rerankScore||b.similarity-a.similarity||a.offset-b.offset).filter(row=>{const id=identity(row);if(seen.has(id))return false;seen.add(id);return true;});
    // Never drop embedding results just because the paid shortlist was bounded.
    const overflow=baseline.matches.filter(row=>!seen.has(identity(row)));
    return {matches:[...ranked,...overflow].slice(0,limit),more:baseline.more||ranked.length>limit,reranking:{...metadata,status:'ranked',note:'Relevance scores rank the supplied passages; they are not probabilities, verification, or proof that a claim is current.'}};
  }
}
