import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AIConnections} from '../lib/ai-connections.mjs';
import {ModelClient} from '../lib/model-client.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {WorkingMemory} from '../lib/working-memory.mjs';
import {HistoryReranking,historyRerankPool,HISTORY_RERANK_POLICY} from '../lib/history-reranking.mjs';
import {voyageRerank,rerankBody,RERANK_REQUEST_BYTES} from '../lib/voyage-rerank.mjs';
import {assertPrivate} from './private-file-assert.mjs';

const vector=hit=>[hit?1:0,hit?0:1,...Array(510).fill(0)];
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-history-rerank-')),task={id:randomUUID(),project:'/rerank-project'},calls=[];
  let fail=null;
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url,body});
    if(url.endsWith('/rerank')){
      if(fail==='timeout')throw Object.assign(Error('timeout secret'),{name:'TimeoutError'});
      if(fail==='service')return new Response('private-key provider echo',{status:429});
      return Response.json({model:'rerank-3',data:body.documents.map((text,index)=>({index:fail==='invalid'?0:index,relevance_score:text.includes('measured correction')?.99:.2})),usage:{total_tokens:91}});
    }
    return Response.json({model:'voyage-context-4',data:body.inputs.map((texts,index)=>({index,data:texts.map((text,index)=>({index,embedding:vector(!text.includes('measured correction'))}))})),usage:{total_tokens:44}});
  };
  const plane={root,data:{tasks:[],contextSettings:{revision:0,memoryEmbeddingConnectionId:'v',toolResultChars:12000},agentNotebooks:{}},save:async()=>{},work:{list:()=>[]},collaboration:{allowed:()=>true,data:{memory:[]}}};
  plane.ai=new AIConnections(plane,{client:new ModelClient({fetcher})});plane.data.aiConnections=[{id:'v',revision:1,kind:'voyage',model:'voyage-context-4',enabled:true}];plane.ai.secrets.v='private-key';plane.context=new ContextManager(plane);plane.notebooks=new WorkingMemory(plane);plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const record=(id,text,owner=task.id)=>({project:task.project,kind:'transcript',id,taskId:owner,body:{event:{text}}});
  await plane.history.captureRecords([record('correction','The measured correction: later peaks are unexplained; the proposed cause remains a hypothesis.'),...Array.from({length:4},(_,i)=>record('request-'+i,'Search for the strain correction. Search status '+i)),record('private','PEER SECRET measured correction','peer')]);
  t.after(async()=>{await plane.history.close();await rm(root,{recursive:true,force:true});});
  return {plane,task,root,calls,setFailure:value=>{fail=value;},query:{query:'Why was the strain explanation revised?',scope:'history',limit:3}};
}

test('History reranks beyond output limit, recovers a fifth-ranked correction, audits scores and caches the same candidate set',async t=>{
  const {plane,task,root,calls,query}=await fixture(t),result=await plane.notebooks.search(task,query);
  assert.equal(result.matches[0].source.recordId,'correction');assert.equal(result.matches.length,3);assert.equal(result.ranking.reranking.status,'ranked');assert.equal(result.ranking.reranking.candidates,5);assert.equal(result.ranking.reranking.usage.total_tokens,91);assert.equal(result.matches[0].rerankScore,.99);assert.equal(result.matches[0].similarity,0);
  assert.equal(calls.filter(c=>c.url.endsWith('/rerank')).length,1);assert(!JSON.stringify(calls).includes('PEER SECRET'));
  const source=result.matches[0].source.retrieve.input;assert.match((await plane.notebooks.readSource(task,source)).text,/measured correction/);
  const cached=await plane.notebooks.search(task,{...query,limit:1});assert.equal(cached.matches.length,1);assert(cached.ranking.cacheHit);assert(cached.ranking.reranking.cacheHit);assert.equal(cached.ranking.reranking.calls,0);assert.equal(cached.ranking.reranking.usage,null);assert.equal(calls.length,3);
  const dir=path.join(root,'.heloscrum/agents',task.id,'context-usage'),files=await readdir(dir),records=await Promise.all(files.map(async f=>{await assertPrivate(path.join(dir,f));return JSON.parse(await readFile(path.join(dir,f),'utf8'));}));
  const audit=records.find(r=>r.kind==='history-reranking');assert.equal(audit.requestedModel,'rerank-3');assert.equal(audit.model,'rerank-3');assert.equal(audit.usage.total_tokens,91);assert.equal(audit.evaluation.response.data.length,5);assert(!JSON.stringify(records).includes('private-key'));
  plane.data.aiConnections[0].revision++;await plane.notebooks.search(task,query);assert.equal(calls.filter(c=>c.url.endsWith('/rerank')).length,2);
});

test('reranker failures preserve embedding results, record unknown usage honestly and do not retry',async t=>{
  const {plane,task,calls,query,setFailure}=await fixture(t);setFailure('service');
  const result=await plane.notebooks.search(task,query);assert.equal(result.ranking.status,'embedded');assert.equal(result.ranking.reranking.status,'fallback');assert.equal(result.ranking.reranking.usage,null);assert.equal(result.matches.length,3);assert(!JSON.stringify(result).includes('private-key'));assert(result.matches.every(m=>m.source.recordId!=='correction'));
  const second=await plane.notebooks.search(task,query);assert.equal(second.ranking.reranking.reason,'service-cooldown');assert.equal(calls.filter(c=>c.url.endsWith('/rerank')).length,1);
});

test('malformed reranker response retains reported usage and raw scores; timeout remains distinct',async t=>{
  const {plane,task,root,query,setFailure}=await fixture(t);setFailure('invalid');
  const result=await plane.notebooks.search(task,query);assert.equal(result.ranking.reranking.reason,'invalid-response');assert.equal(result.ranking.reranking.usage.total_tokens,91);
  const dir=path.join(root,'.heloscrum/agents',task.id,'context-usage'),records=await Promise.all((await readdir(dir)).map(async f=>JSON.parse(await readFile(path.join(dir,f),'utf8'))));
  const audit=records.find(r=>r.kind==='history-reranking');assert.equal(audit.status,'failed');assert.equal(audit.usage.total_tokens,91);assert.equal(audit.evaluation.response.data.length,5);
  plane.data.aiConnections[0].revision++;setFailure('timeout');assert.equal((await plane.notebooks.search(task,query)).ranking.reranking.reason,'service-timeout');
});

test('local, exact references and non-History scopes bypass reranking; disabled credentials cannot use a cached result',async t=>{
  const {plane,task,calls,query}=await fixture(t);
  await plane.notebooks.search(task,{...query,ranking:'local'});await plane.notebooks.search(task,{...query,query:'correction'});assert.equal(calls.length,0);
  plane.collaboration.data.memory=[{project:task.project,key:'note',revision:1,text:'measured correction'}];
  await plane.notebooks.search(task,{...query,scope:'shared'});assert(!calls.some(c=>c.url.endsWith('/rerank')));
  await plane.notebooks.search(task,query);const count=calls.length;plane.data.aiConnections[0].enabled=false;
  const revoked=await plane.notebooks.search(task,query);assert.equal(revoked.ranking.status,'fallback');assert.equal(calls.length,count);assert(!revoked.ranking.reranking);
});

test('permission changes rebuild the shortlist before reranking and exclude previously shared cached text',async t=>{
  const {plane,task,calls,query}=await fixture(t);
  await plane.history.captureRecords([{project:task.project,kind:'memory',id:'shared',body:{key:'shared',text:'SHARED measured correction'}}]);
  await plane.notebooks.search(task,query);assert(calls.at(-1).body.documents.some(d=>d.includes('SHARED')));const firstCalls=calls.length;
  plane.collaboration.allowed=()=>false;const result=await plane.notebooks.search(task,query);
  assert(!JSON.stringify(result).includes('SHARED'));assert(!JSON.stringify(calls.slice(firstCalls)).includes('SHARED'));assert.equal(result.ranking.reranking.cacheHit,false);
});

test('shortlist gives sources breadth then alternative passages within exact serialized Unicode byte limits',()=>{
  const matches=Array.from({length:30},(_,i)=>[0,1,2].map(j=>({source:{kind:'history',recordId:String(i)},offset:j*950,end:(j+1)*950,text:('雪\\"🦋').repeat(150).slice(0,900),similarity:1-i*.01-j*.001}))).flat();
  const result=historyRerankPool('quoted \\" question',matches);assert(result.pool.length<=24);assert(result.limited);assert(Buffer.byteLength(rerankBody('quoted \\" question',result.pool.map(p=>p.text)))<=RERANK_REQUEST_BYTES);
  for(const row of result.pool)assert(result.pool.filter(r=>r.source.recordId===row.source.recordId).length<=2);
  const short=matches.map(r=>({...r,text:'short'})),pool=historyRerankPool('query',short).pool;assert.equal(new Set(pool.slice(0,16).map(r=>r.source.recordId)).size,16);assert.equal(pool.length,24);
});

test('alternative passage can win before source deduplication and rate budget preserves baseline',async()=>{
  const c={id:'v',revision:1},task={id:'agent',project:'project'},a={source:{kind:'history',recordId:'a'},sha256:'a',offset:0,end:5,text:'wrong',similarity:.9},b={...a,offset:5,end:10,text:'right',similarity:.8},other={...a,source:{kind:'history',recordId:'b'},sha256:'b',text:'other',similarity:.7},matches=[a,b,other],baseline={matches:[a,other],more:false};let calls=0;
  const plane={ai:{rerank:async(_id,_q,docs)=>{calls++;return {scores:docs.map(t=>t==='right'?.9:.1),model:'rerank-3',usage:{total_tokens:1}};}},context:{measuredCall:async(_t,_k,_c,fn)=>fn()}};
  const ranker=new HistoryReranking(plane),result=await ranker.rank(task,c,'query',matches,baseline,2);assert.equal(result.matches[0].text,'right');assert.equal(result.matches.length,2);
  await ranker.rank({...task,id:'other-agent'},c,'query',matches,baseline,2);assert.equal(calls,2,'agent identities never share rerank cache');
  ranker.calls=Array(HISTORY_RERANK_POLICY.minuteCalls).fill(Date.now());assert.equal((await ranker.rank(task,c,'new query',matches,baseline,2)).reranking.reason,'rate-budget');assert.equal(calls,2);
});

test('transport validates complete scores, rejects mismatched models and excessive bodies without disclosing provider error text',async()=>{
  const c={kind:'voyage'},body={model:'rerank-3',data:[{index:1,relevance_score:.7},{index:0,relevance_score:.2}],usage:{total_tokens:5}};
  const result=await voyageRerank(c,'private','query',['one','two'],{fetcher:async(url,options)=>{assert.equal(url,'https://api.voyageai.com/v1/rerank');assert.equal(options.redirect,'error');const sent=JSON.parse(options.body);assert.equal(sent.truncation,false);assert.equal(sent.return_documents,false);return Response.json(body);}});assert.deepEqual(result.scores,[.2,.7]);
  for(const mutate of [r=>r.data.pop(),r=>r.data[0].index=0,r=>r.data[0].relevance_score=2,r=>r.model='unexpected']){const bad=structuredClone(body);mutate(bad);await assert.rejects(voyageRerank(c,'private','query',['one','two'],{fetcher:async()=>Response.json(bad)}),e=>e.code==='RERANK_RESPONSE'&&e.usage.total_tokens===5);}
  await assert.rejects(voyageRerank(c,'private','query',Array(24).fill('雪'.repeat(950)),{fetcher:async()=>{throw Error('must not send');}}),/byte budget/);
  await assert.rejects(voyageRerank(c,'private','query',['one'],{fetcher:async()=>new Response('private echo',{status:401})}),e=>e.code==='RERANK_SERVICE'&&!e.message.includes('private'));
});
