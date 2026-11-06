import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadTrialCorpus} from '../lib/voyage-trial.mjs';
import {freezeRerankCases,RerankClient,RerankTrial} from '../lib/rerank-trial.mjs';

async function fixture(){
  const corpus=await loadTrialCorpus(fileURLToPath(new URL('../',import.meta.url)));
  const row=(i,offset=0)=>{const d=corpus.documents[i],text=d.text.slice(offset,offset+900);return {path:d.path,sha256:d.sha256,offset,end:offset+text.length,text};};
  const report={corpusSha256:corpus.sha256,cases:[{query:'Read source files?',expected:{path:corpus.documents[0].path,anchor:'Large source handoffs'},semantic:[row(0),row(1)],keyword:[row(1),row(0)]},{query:corpus.documents[0].path,expected:{kind:'exact-reference',path:corpus.documents[0].path},semantic:[row(1),row(0)],keyword:[row(0)]},{query:'Tomorrow lunch menu?',expected:{kind:'unanswerable'},semantic:[row(0),row(1)],keyword:[]}]};
  return {corpus,report,cases:freezeRerankCases(report,corpus)};
}
const result=(provider,count)=>provider==='jev'?{model:'jev-fixture',usage:{input_tokens:100,output_tokens:10},answers:Object.fromEntries(Array.from({length:count},(_,i)=>['relevant_'+i,{type:'noul',noul:1-i*.1}]))}:{model:'rerank-3',usage:{total_tokens:80},data:Array.from({length:count},(_,i)=>({index:i,relevance_score:1-i*.1})).reverse()};
test('candidate freeze verifies hashes/ranges, deduplicates and gives models the same text',async()=>{
  const {cases,report,corpus}=await fixture(),item=cases[0];assert.equal(item.candidates.length,2);assert.deepEqual(item.documents.map(JSON.parse),item.state.candidates);assert.equal(item.expected.path,corpus.documents[0].path);assert.equal(item.state.expected,undefined);
  report.cases[0].semantic[0].text+='tamper';assert.throws(()=>freezeRerankCases(report,corpus),e=>e.code==='snapshot');
});
test('both provider requests preserve judgments and usage without leaking keys; no truncation',async()=>{
  const {cases}=await fixture();for(const provider of ['jev','voyage']){let payload,url,options;const client=new RerankClient(provider,'private-'+provider,{fetchImpl:async(u,init)=>{url=u;options=init;payload=JSON.parse(init.body);return Response.json(result(provider,cases[0].candidates.length));}});const ranked=await client.rank(cases[0]);assert.deepEqual(ranked.scores,[1,.9]);assert.equal(options.redirect,'error');assert.ok(url.startsWith(provider==='jev'?'https://api.typesafe.ai/':'https://api.voyageai.com/'));assert.equal(payload.model,provider==='jev'?'jev-latest':'rerank-3');if(provider==='voyage'){assert.equal(payload.truncation,false);assert.deepEqual(payload.documents,cases[0].documents);}else assert.deepEqual(payload.state.candidates,cases[0].documents.map(JSON.parse));assert.equal(client.usage().unknownUsageCalls,0);assert.ok(client.calls[0].raw);assert.ok(!JSON.stringify(client).includes('private-'+provider));client.forget();await assert.rejects(client.rank(cases[0]),e=>e.code==='key');}
});
test('reject malformed scores and indexes while retaining reported usage',async()=>{
  const {cases}=await fixture();for(const provider of ['jev','voyage']){const raw=result(provider,2);if(provider==='jev')raw.answers.relevant_0.noul=2;else raw.data[0].index=raw.data[1].index;const client=new RerankClient(provider,'key',{fetchImpl:async()=>Response.json(raw)});await assert.rejects(client.rank(cases[0]),e=>e.code==='invalid-response');assert.ok(client.usage().knownInputTokens>0);}
});
test('request ceilings and HTTP errors fail without automatic retries or error-body exposure',async()=>{
  const {cases}=await fixture();let calls=0;const client=new RerankClient('voyage','key',{policy:{maxCallsPerProvider:1},fetchImpl:async()=>{calls++;return new Response('secret key echo',{status:429,headers:{'retry-after':'3'}});}});await assert.rejects(client.rank(cases[0]),e=>e.code==='rate-limit'&&!e.message.includes('secret'));assert.equal(calls,1);assert.equal(client.calls[0].retryAfterSeconds,3);await assert.rejects(client.rank(cases[0]),e=>e.code==='budget');assert.equal(calls,1);
});
test('paired trial skips exact references, bounds output, and reuses successful calls on continuation',async()=>{
  const {cases,corpus}=await fixture();let fail=true;const clients=Object.fromEntries(['jev','voyage'].map(provider=>[provider,new RerankClient(provider,'key',{fetchImpl:async(_url,init)=>{if(provider==='jev'&&fail){fail=false;return new Response('',{status:503});}const p=JSON.parse(init.body);return Response.json(result(provider,provider==='jev'?p.state.candidates.length:p.documents.length));}})]));
  const trial=new RerankTrial(cases,clients,{corpusSha256:corpus.sha256});await assert.rejects(trial.evaluate(),e=>e.code==='service');assert.equal(trial.completed.size,1);
  const report=await trial.evaluate();assert.equal(clients.voyage.calls.length,2);assert.equal(clients.jev.calls.length,3);assert.equal(report.cases[1].exactLookupBypass,true);assert.equal(report.cases[1].results.jev[0].path,corpus.documents[0].path);assert.equal(report.summary.candidateEvidenceCeiling,1);assert.equal(report.summary.jev.evidenceTop3,1);assert.equal(report.summary.unanswerable,1);
  for(const c of report.cases)for(const arm of ['jev','voyage']){assert.ok(c.results[arm].length<=3);assert.equal(new Set(c.results[arm].map(r=>r.path)).size,c.results[arm].length);assert.ok(c.results[arm].every(r=>r.text.length<=950));}
});
