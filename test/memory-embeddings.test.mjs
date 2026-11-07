import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkingMemory} from '../lib/working-memory.mjs';
import {MemoryEmbeddings,memoryChunks,memoryHash} from '../lib/memory-embeddings.mjs';
import {AIConnections} from '../lib/ai-connections.mjs';
import {ModelClient} from '../lib/model-client.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {voyageEmbed,EMBEDDING_MODEL} from '../lib/voyage-embeddings.mjs';
import {assertPrivate} from './private-file-assert.mjs';

const vector=(hit=false)=>[hit?1:0,hit?0:1,...Array(510).fill(0)];
const reply=inputs=>({model:EMBEDDING_MODEL,data:inputs.map((doc,index)=>({index,data:doc.map((text,index)=>({index,embedding:vector(/reservation|give the material back/i.test(text))}))})),usage:{total_tokens:123}});
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-embeddings-')),calls=[],task={id:randomUUID(),project:'/test-project'};
  const plane={root,data:{tasks:[],contextSettings:{revision:0,memoryEmbeddingConnectionId:'voyage',toolResultChars:12000,budgetTokens:32000},agentNotebooks:{}},save:async()=>{},work:{list:()=>[]},collaboration:{allowed:()=>true,data:{memory:[]}}};
  plane.ai=new AIConnections(plane,{client:new ModelClient({fetcher:async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});if(url.endsWith('/rerank'))return Response.json({model:'rerank-3',data:body.documents.map((text,index)=>({index,relevance_score:/reservation/i.test(text)?.9:.1})),usage:{total_tokens:123}});return Response.json(reply(body.inputs));}})});
  plane.data.aiConnections=[{id:'voyage',kind:'voyage',model:EMBEDDING_MODEL,enabled:true}];plane.ai.secrets.voyage='test-key';plane.context=new ContextManager(plane);plane.notebooks=new WorkingMemory(plane);
  t.after(async()=>{await plane.history?.close();await rm(root,{recursive:true,force:true});});return {root,plane,task,calls};
}
test('contextual chunks preserve Unicode, exact ranges and paragraph boundaries without overlap',()=>{
  const body=('A paragraph with 雪 and 🧑🏽‍💻 and escaped \\"quotes\\".\n\n').repeat(60),chunks=memoryChunks(body);
  assert.equal(chunks.map(c=>c.text).join(''),body);assert(chunks.every(c=>c.text.length<=950));
  for(const [i,c] of chunks.entries()){assert.equal(c.text,body.slice(c.offset,c.end));assert(!/[\uD800-\uDBFF]$/.test(c.text));if(i)assert.equal(c.offset,chunks[i-1].end);}
});
test('semantic search finds non-keyword passages, caches full source chunks across restart, invalidates edits, and bypasses exact references',async t=>{
  const {root,plane,task,calls}=await fixture(t);
  const body='Unrelated introduction. '.repeat(70)+'\n\nThe reservation is returned when cancelled.';
  plane.collaboration.data.memory=[{project:task.project,key:'refund-policy',text:body,revision:1}];
  const result=await plane.notebooks.search(task,{query:'How do we give the material back?',scope:'shared'});
  assert.equal(result.ranking.status,'embedded');assert.match(result.matches[0].text,/reservation/);assert(result.matches[0].offset>0);assert.equal(result.matches[0].sha256,memoryHash(body));
  assert.equal(calls.length,2);assert.equal(calls[0].body.input_type,'document');assert.equal(calls[0].body.inputs[0].join(''),body);
  assert.equal((await plane.notebooks.readSource(task,result.matches[0].source.retrieve.input)).text,body.slice(result.matches[0].offset));
  assert((await plane.notebooks.search(task,{query:'How do we give the material back?',scope:'shared'})).ranking.cacheHit);assert.equal(calls.length,2);
  const cacheFile=path.join(root,'.heloscrum/agents',task.id,'embeddings/index.json');await assertPrivate(cacheFile);assert(!(await readFile(cacheFile,'utf8')).includes('test-key'));
  plane.notebooks=new WorkingMemory(plane);await plane.notebooks.search(task,{query:'How do we give the material back?',scope:'shared'});assert.equal(calls.length,3);assert.equal(calls.at(-1).body.input_type,'query');
  await plane.notebooks.search(task,{query:'refund-policy',scope:'shared'});await plane.notebooks.search(task,{query:memoryHash(body),scope:'shared'});assert.equal(calls.length,3);
  plane.collaboration.data.memory[0].text+=' Now updated.';plane.collaboration.data.memory[0].revision++;
  await assert.rejects(plane.notebooks.readSource(task,result.matches[0].source.retrieve.input),/changed/);
  await plane.notebooks.search(task,{query:'How do we give the material back?',scope:'shared'});assert.equal(calls.length,4);
  const dir=path.join(root,'.heloscrum/agents',task.id,'context-usage');const records=await Promise.all((await readdir(dir)).map(f=>readFile(path.join(dir,f),'utf8')));
  assert(records.every(r=>JSON.parse(r).usage.total_tokens===123));assert(records.every(r=>!r.includes('test-key')));
});
test('notebook, project and History permissions are applied before cloud requests and cached retrieval',async t=>{
  const {plane,task,calls,root}=await fixture(t),peer=randomUUID();
  plane.data.agentNotebooks[task.id]={project:task.project,revision:1,entries:[{id:randomUUID(),category:'decision',text:'reservation returned',sources:[],status:'active'}]};
  plane.data.agentNotebooks[peer]={project:task.project,revision:1,entries:[{text:'PEER SECRET'}]};
  plane.collaboration.data.memory=[{project:'/other',key:'foreign',text:'FOREIGN SECRET'}];
  await plane.notebooks.search(task,{query:'give the material back',scope:'notebook'});
  plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  await plane.history.captureRecords([{project:task.project,kind:'transcript',id:'mine',taskId:task.id,body:{event:{text:'reservation returned'}}},{project:task.project,kind:'transcript',id:'peer',taskId:peer,body:{event:{text:'PEER SECRET'}}},{project:'/other',kind:'memory',id:'foreign',body:{text:'FOREIGN SECRET'}},{project:task.project,kind:'memory',id:'shared',body:{key:'shared',text:'SHARED reservation'}}]);
  const result=await plane.notebooks.search(task,{query:'give the material back',scope:'history'});assert.equal(result.matches.length,2);assert(calls.some(c=>JSON.stringify(c.body).includes('SHARED')));
  plane.collaboration.allowed=()=>false;const revoked=await plane.notebooks.search(task,{query:'give the material back',scope:'history'});assert.equal(revoked.matches.length,1);assert(!JSON.stringify(revoked).includes('SHARED'));assert(!JSON.stringify(calls).includes('SECRET'));
  await assert.rejects(plane.notebooks.readSource({...task,id:peer},result.matches.find(m=>m.source.recordId==='mine').source.retrieve.input),/not available/);
});
test('missing keys, failures and explicit local mode return keyword results without retries or secret echoes',async t=>{
  const {plane,task,calls}=await fixture(t);plane.collaboration.data.memory=[{project:task.project,key:'policy',revision:1,text:'reservation returned'}];
  await plane.notebooks.search(task,{query:'reservation',scope:'shared',ranking:'local'});assert.equal(calls.length,0);
  let attempts=0;plane.ai.client.fetcher=async()=>{attempts++;return new Response('test-key and private source',{status:429});};
  const result=await plane.notebooks.search(task,{query:'reservation',scope:'shared'});assert.equal(result.ranking.status,'fallback');assert.equal(result.matches.length,1);assert(!JSON.stringify(result).includes('test-key'));assert.equal(attempts,1);assert.equal(result.ranking.calls,1);assert.deepEqual(result.ranking.usage,[null]);
  assert.equal((await plane.notebooks.search(task,{query:'reservation',scope:'shared'})).ranking.reason,'service-cooldown');assert.equal(attempts,1);
  plane.data.aiConnections[0].enabled=false;assert.equal((await plane.notebooks.search(task,{query:'reservation',scope:'shared'})).ranking.reason,'connection-unavailable');
  plane.data.aiConnections[0].enabled=true;delete plane.ai.secrets.voyage;assert.equal((await plane.notebooks.search(task,{query:'reservation',scope:'shared'})).ranking.reason,'connection-unavailable');assert.equal(attempts,1);
});
test('partial indexing resumes completed windows and reports coverage without claiming the full corpus was searched',async t=>{
  const {plane,task,calls}=await fixture(t);plane.collaboration.data.memory=[{project:task.project,key:'large',revision:1,text:Array.from({length:7000},(_,i)=>'Line '+i+' about reservations.\n').join('')}];
  const first=await plane.notebooks.search(task,{query:'give the material back',scope:'shared'});assert.equal(first.ranking.status,'embedded');assert(first.ranking.partial);assert.equal(calls.length,5);
  const original=new Set(calls.filter(c=>c.body.input_type==='document').map(c=>JSON.stringify(c.body.inputs)));
  const second=await plane.notebooks.search(task,{query:'give the material back',scope:'shared'});assert(second.ranking.indexedChunks>first.ranking.indexedChunks);assert(calls.slice(5).every(c=>!original.has(JSON.stringify(c.body.inputs))));
});
test('History fallback finds older keyword matches and exact archived IDs without cloud requests',async t=>{
  const {plane,task,calls,root}=await fixture(t);plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const id=randomUUID();await plane.history.captureRecords([{project:task.project,kind:'transcript',id,taskId:task.id,body:{event:{text:'Reservation policy'}}},...Array.from({length:25},(_,i)=>({project:task.project,kind:'transcript',id:'recent-'+i,taskId:task.id,body:{event:{text:'Unrelated recent event '+i}}}))]);
  const exact=await plane.notebooks.search(task,{query:id,scope:'history'});assert.equal(exact.matches[0].source.recordId,id);assert.equal(calls.length,0);
  await plane.notebooks.search(task,{query:'docs/missing-file.md',scope:'history'});assert.equal(calls.length,0);
  plane.ai.client.fetcher=async()=>new Response('',{status:503});
  const fallback=await plane.notebooks.search(task,{query:'reservation',scope:'history'});assert.equal(fallback.ranking.status,'fallback');assert.equal(fallback.matches[0].source.recordId,id);
});
test('three History results rank a larger deduplicated pool and recover an older correction without shared keywords',async t=>{
  const {plane,task,calls,root}=await fixture(t);plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const at='2026-10-01T12:30:00.000Z',message=(id,text,extra={})=>({project:task.project,kind:'message',id,at,body:{from:'human',to:task.id,text,...extra}});
  await plane.history.captureRecords([message('older-correction','Correction: the reservation is returned when cancelled.'),...Array.from({length:12},(_,i)=>message('later-'+i,'Unrelated discussion '+i)),...Array.from({length:30},(_,i)=>message('delivery-noise','A repeated recent status update',{deliveryAttempt:i}))]);
  const input={query:'How do we give the material back?',scope:'history',limit:3};
  const result=await plane.notebooks.search(task,input);
  assert.equal(result.ranking.status,'embedded');assert.equal(result.matches.length,3);assert.equal(result.matches[0].source.recordId,'older-correction');
  assert.equal(result.historyCoverage.candidates,14);assert.equal(result.historyCoverage.keywordCandidates,0);assert.equal(result.ranking.totalChunks,14);
  assert.equal(result.matches[0].occurredAt,at);assert.match(result.matches[0].capturedAt,/Z$/);assert.match(result.matches[0].source.version,/^[a-f0-9]{64}$/);
  const text=calls.filter(c=>c.body.input_type==='document').flatMap(c=>c.body.inputs.flat());assert.equal(text.filter(t=>t==='A repeated recent status update').length,1);
  const one=await plane.notebooks.search(task,{...input,limit:1});assert.equal(one.matches.length,1);assert.equal(one.historyCoverage.candidates,14);assert(one.ranking.cacheHit);
  assert.match((await plane.notebooks.readSource(task,result.matches[0].source.retrieve.input)).text,/Correction/);
  const archived=(await plane.history.rows(task.project,'message')).find(r=>r.record_id==='delivery-noise'),callCount=calls.length;
  const exact=await plane.notebooks.search(task,{query:archived.version,scope:'history',limit:3});
  assert.equal(exact.matches.length,1);assert.equal(exact.matches[0].source.entryId,archived.seq);assert.equal(calls.length,callCount,'explicit versions never call Voyage');
});
test('History supplements recent semantic candidates with old keyword evidence without uploading inaccessible matches',async t=>{
  const {plane,task,calls,root}=await fixture(t);plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const record=(id,text,owner=task.id,project=task.project)=>({project,kind:'transcript',id,taskId:owner,body:{event:{text}}});
  await plane.history.captureRecords([record('old-correction','Reservation correction: return the material on cancellation.'),record('peer-private','SECRET reservation correction','peer'),record('foreign','SECRET reservation correction',task.id,'/foreign'),...Array.from({length:150},(_,i)=>record('noise-'+i,'Unrelated recent event '+i))]);
  const result=await plane.notebooks.search(task,{query:'reservation correction',scope:'history',limit:3});
  assert.equal(result.matches[0].source.recordId,'old-correction');assert.equal(result.historyCoverage.recentCandidates,80);assert.equal(result.historyCoverage.keywordCandidates,1);assert.equal(result.historyCoverage.candidates,81);assert(result.historyCoverage.hasOlder);assert(result.nextHistoryBefore);
  assert(!JSON.stringify(calls).includes('SECRET'));assert(!JSON.stringify(result).includes('SECRET'));
  const older=await plane.notebooks.search(task,{query:'reservation correction',scope:'history',limit:3,historyBefore:result.nextHistoryBefore});
  assert.equal(older.historyCoverage.recentCandidates,71);assert.equal(older.nextHistoryBefore,null);assert.equal(older.matches[0].source.recordId,'old-correction');
});
test('Voyage transport rejects incomplete, duplicated and invalid vectors; bounds requests and cancels redirects',async()=>{
  const c={kind:'voyage',model:EMBEDDING_MODEL},inputs=[['hello','world']];let n=0;
  const good=await voyageEmbed(c,'secret',inputs,'document',{fetcher:async(url,options)=>{n++;assert.equal(url,'https://api.voyageai.com/v1/contextualizedembeddings');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer secret');return Response.json(reply(inputs));}});assert.equal(good.vectors[0].length,2);
  for(const mutate of [r=>r.data.pop(),r=>r.data[0].data[1].index=0,r=>r.data[0].data[0].embedding=[1],r=>r.data[0].data[0].embedding=Array(512).fill(0)]){const invalid=reply(inputs);mutate(invalid);await assert.rejects(voyageEmbed(c,'secret',inputs,'document',{fetcher:async()=>Response.json(invalid)}),/Voyage returned/);}
  await assert.rejects(voyageEmbed(c,'secret',[['x'.repeat(30000)]],'document',{fetcher:async()=>{n++;}}),/byte budget/);assert.equal(n,1);
});
test('Voyage configuration keeps keys private and cannot be used as an agent, summary or decision model',async t=>{
  const {plane,root}=await fixture(t);plane.ai.file=path.join(root,'keys.json');
  const c=await plane.ai.configure({kind:'voyage',name:'Memory',apiKey:'private-key'});assert.equal(c.model,EMBEDDING_MODEL);assert(c.hasKey);assert(!JSON.stringify(plane.ai.list()).includes('private-key'));
  await assert.rejects(plane.ai.configure({kind:'voyage',name:'Bad',supportsTools:true}),/cannot run agents/);
  await assert.rejects(plane.ai.configureContext({expectedRevision:0,summaryConnectionId:c.id}),/language model/);
  await assert.rejects(plane.ai.configureContext({expectedRevision:0,decisionConnectionId:c.id}),/Jev/);
  await assert.rejects(plane.ai.complete(c.id,{messages:[]}),/cannot generate/);
  const settings=await plane.ai.configureContext({expectedRevision:0,memoryEmbeddingConnectionId:c.id});assert.equal(settings.memoryEmbeddingConnectionId,c.id);
  assert.equal((await plane.ai.test(c.id)).model,EMBEDDING_MODEL);
});

test('cold History indexing reaches an older message despite large keyword-heavy transcripts within the same call budget',async t=>{
  const {plane,task,calls,root}=await fixture(t);plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const text='Correction: the reservation is returned when cancelled.';
  await plane.history.captureRecords([{project:task.project,kind:'message',id:'correction',body:{from:'reviewer',to:task.id,text}},...Array.from({length:14},(_,i)=>({project:task.project,kind:'transcript',id:'trace-'+i,taskId:task.id,body:{event:{text:('give the material back; a repeated tool trace '+i+'\n').repeat(800)}}}))]);
  const result=await plane.notebooks.search(task,{query:'How do we give the material back?',scope:'history',limit:3});
  assert(result.ranking.partial);assert.equal(result.matches[0].source.recordId,'correction');
  assert.equal(calls.filter(c=>c.body.input_type==='document').length,4);assert.equal(calls.filter(c=>c.url.endsWith('/rerank')).length,1);
  assert(calls.find(c=>c.url.endsWith('/rerank')).body.documents.includes(text));
});

test('query echo masking is private to ranking; exact reads, local search and returned passage offsets retain original text',async t=>{
  const {plane,task,calls,root}=await fixture(t);plane.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const text='Use memory_search with query "reservation returned". Report whether the search found evidence.';
  await plane.history.captureRecords([{project:task.project,kind:'message',id:'request',body:{from:'human',to:task.id,text}},{project:task.project,kind:'message',id:'answer',body:{from:'reviewer',to:task.id,text:'The reservation is returned on cancellation.'}}]);
  const result=await plane.notebooks.search(task,{query:'reservation returned',scope:'history',limit:3});
  const sent=calls.filter(c=>c.body.input_type==='document').flatMap(c=>c.body.inputs.flat());assert(!sent.find(t=>t.startsWith('Use memory_search')).includes('reservation returned'));
  const request=result.matches.find(r=>r.source.recordId==='request');assert.equal(request.text,text.slice(request.offset,request.end));assert.equal(request.sha256,memoryHash(text));assert(!('rankingText' in request));assert(!('rankingBody' in request));
  assert.equal((await plane.notebooks.readSource(task,request.source.retrieve.input)).text,text);
  const count=calls.length,local=await plane.notebooks.search(task,{query:'reservation returned',scope:'history',ranking:'local',limit:3});assert(local.matches.some(r=>r.text===text));assert.equal(calls.length,count);
  const exact=await plane.notebooks.search(task,{query:'request',scope:'history'});assert.equal(exact.matches[0].text,text);assert.equal(calls.length,count);
});
