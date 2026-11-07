import {assert} from './adapters.mjs';

export const HISTORY_RERANK_MODEL='rerank-3';
export const RERANK_REQUEST_BYTES=24000;
export const rerankBody=(query,documents)=>JSON.stringify({model:HISTORY_RERANK_MODEL,query,documents,top_k:documents.length,return_documents:false,truncation:false});

export async function voyageRerank(connection,key,query,documents,{fetcher=fetch,signal,onResponse=()=>{}}={}){
  assert(connection.kind==='voyage'&&key,'Save a Voyage API key in Settings → AI & Context',409);
  assert(typeof query==='string'&&query.length>=2&&query.length<=200,'Use a bounded reranking query');
  assert(Array.isArray(documents)&&documents.length>0&&documents.length<=24&&documents.every(d=>typeof d==='string'&&d.length>0&&d.length<=950),'Use at most 24 bounded passages');
  const body=rerankBody(query,documents);assert(Buffer.byteLength(body)<=RERANK_REQUEST_BYTES,'Reranking request exceeds its byte budget');
  const response=await fetcher('https://api.voyageai.com/v1/rerank',{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body});
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error('Voyage reranking returned HTTP '+response.status),{code:'RERANK_SERVICE',status:response.status===429?429:502});}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;assert(size<=128*1024,'Reranking response exceeds 128 KiB',502);chunks.push(chunk);}
  let raw;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Voyage returned invalid reranking JSON'),{code:'RERANK_RESPONSE',status:502});}
  const usage=Number.isSafeInteger(raw?.usage?.total_tokens)&&raw.usage.total_tokens>=0?{total_tokens:raw.usage.total_tokens}:null;
  const received={model:typeof raw?.model==='string'?raw.model:null,usage,data:Array.isArray(raw?.data)?raw.data.map(r=>({index:r?.index,relevance_score:r?.relevance_score})):null};
  onResponse(received);
  const valid=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'RERANK_RESPONSE',status:502,usage});};
  valid(!raw?.model||raw.model===HISTORY_RERANK_MODEL,'Voyage returned a different reranking model');
  valid(Array.isArray(raw?.data)&&raw.data.length===documents.length,'Voyage returned incomplete reranking scores');
  const scores=Array(documents.length),seen=new Set();
  for(const row of raw.data){valid(Number.isInteger(row?.index)&&row.index>=0&&row.index<scores.length&&!seen.has(row.index)&&Number.isFinite(row.relevance_score)&&row.relevance_score>=0&&row.relevance_score<=1,'Voyage returned invalid reranking indexes or scores');seen.add(row.index);scores[row.index]=row.relevance_score;}
  return {scores,model:raw.model||HISTORY_RERANK_MODEL,usage};
}
