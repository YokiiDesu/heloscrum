import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {VoyageContext,cosine} from '../lib/voyage-context.mjs';
import {loadTrialCorpus,chunkSource,VoyageTrial,scoreTrial,TRIAL_QUERIES} from '../lib/voyage-trial.mjs';

const response=(inputs,dimensions=2)=>({model:'fixture',usage:{total_tokens:42},data:inputs.map((group,i)=>({index:i,data:group.map((_,j)=>({index:j,embedding:[1,...Array(dimensions-1).fill(0)]})).reverse()})).reverse()});
test('Voyage preserves per-document grouping and indexes, records usage without credentials',async()=>{
  const calls=[];
  const client=new VoyageContext('test-secret',{policy:{dimensions:2},fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json(response(JSON.parse(init.body).inputs));}});
  const vectors=await client.embed([['first','second'],['third']],'document');
  assert.deepEqual(vectors,[[[1,0],[1,0]],[[1,0]]]);assert.equal(calls[0].url,'https://api.voyageai.com/v1/contextualizedembeddings');assert.equal(calls[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].init.body).inputs,[['first','second'],['third']]);assert.equal(client.usage().knownTokens,42);assert.equal(client.usage().unknownUsageCalls,0);assert.ok(!JSON.stringify(client).includes('test-secret'));
  client.forget();await assert.rejects(client.embed([['q']],'query'),e=>e.code==='key');assert.equal(calls.length,1);
});
test('hard budgets fail before calls and service errors do not leak response text or retry',async()=>{
  let count=0;const client=new VoyageContext('hidden-key',{policy:{maxCalls:1,maxInputBytes:8,maxRequestBytes:4},fetchImpl:async()=>{count++;return new Response('hidden-key provider echo',{status:401});}});
  await assert.rejects(client.embed([['12345']],'document'),e=>e.code==='budget');assert.equal(count,0);
  await assert.rejects(client.embed([['1234']],'document'),e=>e.code==='authentication'&&!e.message.includes('hidden-key'));assert.equal(count,1);
  await assert.rejects(client.embed([['x']],'query'),e=>e.code==='budget');assert.equal(count,1);assert.equal(client.usage().unknownUsageCalls,1);
});
test('malformed responses reject duplicate indexes, zero vectors and mismatched dimensions',async()=>{
  for(const mutate of [r=>{r.data[0].data[0].index=1;r.data[0].data[1].index=1;},r=>{r.data[0].data[0].embedding=[0,0];},r=>{r.data[0].data[0].embedding=[1];}]){
    const client=new VoyageContext('fixture',{policy:{dimensions:2},fetchImpl:async()=>{const r=response([['a','b']]);mutate(r);return Response.json(r);}});
    await assert.rejects(client.embed([['a','b']],'document'),e=>e.code==='invalid-response');assert.equal(client.usage().knownTokens,42);
  }
});
test('oversized responses and invalid query groups are bounded',async()=>{
  let calls=0;const client=new VoyageContext('fixture',{policy:{maxResponseBytes:10},fetchImpl:async()=>{calls++;return new Response('x'.repeat(20));}});
  await assert.rejects(client.embed([['a','b']],'query'),e=>e.code==='input');assert.equal(calls,0);
  await assert.rejects(client.embed([['a']],'query'),e=>e.code==='response-limit');
});
test('chunks reconstruct Unicode source exactly with contiguous ranges',()=>{
  assert.throws(()=>chunkSource('🦋',1),/at least two/);
  const text=('line 🦋\n\nUnicode λ variable.\n').repeat(80),chunks=chunkSource(text,70);
  assert.equal(chunks.map(c=>c.text).join(''),text);for(let i=0;i<chunks.length;i++){assert.equal(chunks[i].offset,i?chunks[i-1].end:0);assert.equal(chunks[i].text,text.slice(chunks[i].offset,chunks[i].end));assert.ok(!/[\uD800-\uDBFF]$/.test(chunks[i].text));}
});
test('trial freezes valid labels and uses actual local search, grouped embeddings and a warm cache',async()=>{
  const corpus=await loadTrialCorpus(fileURLToPath(new URL('../',import.meta.url)));
  assert.equal(corpus.documents.length,8);assert.equal(corpus.documents.some(d=>d.path.includes('.heloscrum')),false);
  let requests=0;const client=new VoyageContext('fixture',{policy:{dimensions:2},fetchImpl:async(_url,init)=>{requests++;return Response.json(response(JSON.parse(init.body).inputs));}});
  const trial=new VoyageTrial(corpus,client),report=await trial.evaluate();assert.equal(requests,9);assert.equal(report.cases.length,TRIAL_QUERIES.length);assert.equal(report.summary.answerable,16);
  assert.equal(report.cases.find(c=>c.expected.kind==='exact-reference').hybrid[0].path,'docs/source-transfers.md');
  await trial.compare(TRIAL_QUERIES[0].query);assert.equal(requests,9);
  await trial.prepare();assert.equal(requests,9);
  for(const c of report.cases)for(const arm of ['keyword','semantic','hybrid'])for(const r of c[arm])assert.equal(corpus.documents.find(d=>d.path===r.path).text.slice(r.offset,r.end),r.text);
});
test('evidence score requires the correct source and quoted passage, not a document hit alone',()=>{
  const row={expected:{path:'correct',anchor:'evidence'},keyword:[{path:'correct',text:'wrong excerpt',exposedBytes:13}],semantic:[{path:'wrong',text:'evidence',exposedBytes:8}],hybrid:[{path:'correct',text:'evidence',exposedBytes:8}]};
  const scores=scoreTrial([row]);assert.equal(scores.keyword.documentTop1,1);assert.equal(scores.keyword.evidenceTop3,0);assert.equal(scores.semantic.evidenceTop3,0);assert.equal(scores.hybrid.evidenceTop3,1);assert.equal(cosine([1,0],[0,1]),0);
});
test('explicit continuation reuses completed documents and keeps first-attempt elapsed time',async()=>{
  const corpus=await loadTrialCorpus(fileURLToPath(new URL('../',import.meta.url)));
  let requests=0;const client=new VoyageContext('fixture',{policy:{dimensions:2},fetchImpl:async(_url,init)=>{requests++;if(requests===2)return new Response('rate limited',{status:429,headers:{'retry-after':'1'}});return Response.json(response(JSON.parse(init.body).inputs));}});
  const trial=new VoyageTrial(corpus,client);await assert.rejects(trial.evaluate(),e=>e.code==='rate-limit');assert.equal(trial.vectors.size,1);assert.equal(client.calls[1].retryAfterSeconds,1);
  const began=trial.startedAt;trial.startedAt-=1000;const result=await trial.evaluate();assert.equal(requests,10);assert.ok(result.elapsedMs>=1000);assert.equal(trial.startedAt,began-1000);assert.equal(result.usage.unknownUsageCalls,1);
});
