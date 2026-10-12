import test from 'node:test';
import assert from 'node:assert/strict';
import {contextDecisionState,contextDecisionAnswer} from '../lib/context-decision.mjs';

test('decision evidence uses current owned work and private notes instead of a stale bootstrap goal',async()=>{
  const plan={id:'plan',title:'Current game',revision:14,status:'active',items:[{id:'mine',ownerId:'agent',title:'Save migration',status:'done',description:'Preserve agreed terms',note:'Independent checks passed',updatedAt:'2026-10-06'},{id:'other',ownerId:'other',note:'PRIVATE OTHER AGENT'}]};
  const state=await contextDecisionState({work:{list:()=>[plan],available:()=>plan},notebooks:{capsule:async()=>({revision:10,entries:[{category:'decision',text:'Preserve partial work',confidence:'reported',freshness:{state:'stale'}}]})}},{id:'agent',role:'Builder',prompt:'BOOTSTRAP WAIT ONLY'},{idle:true},[{type:'message',role:'assistant',text:'M3 complete'}]);
  assert.equal(state.goal,'Current game');assert.equal(state.currentWork[0].status,'done');assert.equal(state.currentWork[0].revision,14);assert.equal(state.notebook.entries[0].freshness,'stale');assert(!JSON.stringify(state).includes('PRIVATE OTHER AGENT'));assert(!JSON.stringify(state).includes('BOOTSTRAP WAIT ONLY'));
});
test('decision evidence bounds oversized notes, tasks and tool output without carrying full history',async()=>{
  const giant='x'.repeat(100000),plan={id:'p',title:giant,status:'active',items:Array.from({length:100},(_,i)=>({id:String(i),ownerId:'a',title:giant,description:giant,note:giant}))};
  const s=await contextDecisionState({work:{list:()=>[plan],available:()=>plan},notebooks:{capsule:async()=>({entries:Array.from({length:30},()=>({text:giant}))})}},{id:'a',prompt:giant},{idle:true},Array.from({length:100},()=>({type:'tool',name:'tool',output:giant})));
  assert.equal(s.currentWork.length,4);assert.equal(s.notebook.entries.length,4);assert.equal(s.recent.length,6);assert(JSON.stringify(s).length<10000);
});
test('binary Choice probability and confidence remain distinct; malformed distributions reject',()=>{
  const a={type:'choice',choice:'checkpoint',confidence:.64,probabilities:{continue:.18,checkpoint:.82}};
  assert.equal(contextDecisionAnswer(a).selectedProbability,.82);assert.equal(contextDecisionAnswer(a).confidence,.64);
  for(const value of [{...a,probabilities:undefined},{...a,probabilities:{continue:.2,checkpoint:.2}},{...a,confidence:NaN},{...a,choice:'continue'},{...a,type:'noul'}])assert.throws(()=>contextDecisionAnswer(value),/invalid/);
});
