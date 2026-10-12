import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {MemoryRanking,memoryRankingRequest,relevanceAnswers} from '../lib/memory-ranking.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {WorkingMemory} from '../lib/working-memory.mjs';
const candidate=(text,score=0,extra={})=>({title:'Decision',text,score,source:{kind:'notebook',id:randomUUID(),revision:1},...extra});
function fixture(root){
  const task={id:randomUUID(),project:'/project'},calls=[];
  const plane={root,data:{contextSettings:{memoryRankingEnabled:true,decisionConnectionId:'jev'},agentNotebooks:{}},ai:{get:()=>({id:'jev',kind:'jev',model:'jev-latest',enabled:true}),decide:async(_id,state,questions)=>{calls.push({state,questions});return {model:'jev-test',answers:Object.fromEntries(state.candidates.map((c,i)=>['relevant_'+i,{type:'noul',noul:c.passage.includes('reservation')?0.93:0.02}])),usage:{input_tokens:50,output_tokens:10}};}},collaboration:{allowed:()=>false,data:{memory:[]}},work:{list:()=>[]}};
  plane.context=new ContextManager(plane);return {task,plane,calls};
}
test('semantic retrieval finds a paraphrase, pins exact sources, rejects irrelevant extras and persists raw judgments/usage',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-ranking-'));try{
    const {task,plane,calls}=fixture(root),ranking=new MemoryRanking(plane),candidates=[candidate('reservation is returned when cancelled'),candidate('Exact reference with a different topic',20,{exact:true}),candidate('Weather tomorrow')];
    const result=await ranking.rank(task,'Do we give the material back?',candidates,6);
    assert.equal(result.matches.length,2);assert(result.matches[0].exact);assert.equal(result.matches[1].relevanceProbability,.93);assert.equal(result.ranking.status,'ranked');
    const dir=path.join(root,'.heloscrum/agents',task.id,'context-usage'),records=await readdir(dir),audit=JSON.parse(await readFile(path.join(dir,records[0]),'utf8'));
    assert.equal(audit.answers.relevant_0.noul,.02);assert.equal(audit.usage.input_tokens,50);assert.equal(audit.evaluation.validation,'valid');assert.equal(audit.kind,'memory-ranking');
    assert((await ranking.rank(task,'Do we give the material back?',candidates,6)).ranking.cacheHit);assert.equal(calls.length,1);
    candidates[0].source.revision=2;await ranking.rank(task,'Do we give the material back?',candidates,6);assert.equal(calls.length,2);
    assert.match(calls[0].questions.relevant_0.instructions,/reference data/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('invalid model answers, timeouts and disabled connections fall back to local results without invention or retry',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-ranking-fallback-'));try{
    const {task,plane}=fixture(root),ranking=new MemoryRanking(plane),candidates=[candidate('keyword evidence',2)];let calls=0;
    plane.ai.decide=async()=>{calls++;return {answers:{relevant_0:{type:'noul',noul:1.4}},usage:{input_tokens:1}};};
    const invalid=await ranking.rank(task,'query',candidates,6);assert.equal(invalid.ranking.reason,'invalid-model-answer');assert.equal(invalid.matches.length,1);assert.equal(calls,1);
    plane.ai.decide=async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});};assert.equal((await ranking.rank(task,'query',candidates,6)).ranking.reason,'service-timeout');
    plane.ai.get=()=>{throw Error('disabled');};assert.equal((await ranking.rank(task,'query',candidates,6)).ranking.reason,'connection-unavailable');
    assert.equal(relevanceAnswers({answers:{relevant_0:{type:'score',score:.5}}},1),null);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('authorization is applied before reranking, with bounded requests and a per-search local override',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-ranking-private-'));try{
    const {task,plane,calls}=fixture(root),peer=randomUUID();
    plane.data.agentNotebooks[task.id]={project:task.project,revision:1,entries:[{id:randomUUID(),category:'decision',text:'The reservation is returned when a print is cancelled.',status:'active',confidence:'reported',sources:[]}]};
    plane.data.agentNotebooks[peer]={project:task.project,revision:1,entries:[{text:'PRIVATE PEER SECRET'}]};plane.collaboration.data.memory.push({project:'/other',key:'secret',text:'FOREIGN PROJECT SECRET'});
    const memory=new WorkingMemory(plane),result=await memory.search(task,{query:'How do we give the material back?',scope:'notebook'});
    assert.equal(result.matches.length,1);assert(!JSON.stringify(calls).includes('SECRET'));
    await memory.search(task,{query:'reservation',ranking:'local'});assert.equal(calls.length,1);
    plane.data.contextSettings.memoryRankingEnabled=false;await memory.search(task,{query:'reservation'});assert.equal(calls.length,1);
    const request=memoryRankingRequest('x'.repeat(200),Array.from({length:12},()=>candidate('x'.repeat(950))));assert(JSON.stringify(request).length<24000);
  }finally{await rm(root,{recursive:true,force:true});}
});
