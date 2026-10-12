import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Collaboration} from '../lib/collaboration.mjs';
import {HistoryStore} from '../lib/history-store.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-questions-'));
  const db=await new HistoryStore(path.join(root,'archive.duckdb')).init();
  t.after(async()=>{await db.close();await rm(root,{recursive:true,force:true});});
  const tasks=['Builder','QA','Reviewer','Outsider'].map((role,i)=>({id:`agent-${i}`,role,title:role,summary:role,project:root,phase:'launched',pane:String(i),kind:'codex',providerSessionId:`00000000-0000-4000-a000-00000000000${i}`}));
  const calls=[],plane={root,data:{project:root,tasks,events:[]},save(){return db.saveState(this.data);},herdr:{list:async()=>tasks.map(t=>({pane_id:t.pane,interactive_ready:true,agent_status:'idle'})),prompt:async(...args)=>calls.push(args)}};
  const registry=new Collaboration(plane),human={id:'human',human:true,role:'You',project:root};
  const group=await registry.call(tasks[0],'create_group',{name:'Agent-created group',participants:[tasks[1].id,tasks[2].id]});
  return {root,db,plane,registry,human,tasks,group,calls};
}

test('agent questions notify once, require a real human answer, and deliver that answer to the group',async t=>{
  const {root,db,plane,registry:r,human,tasks,group,calls}=await fixture(t);
  const input={threadId:group.id,question:'Which edge case first?',options:['Overflow','Cycles'],requestId:'question-1'},revision=r.data.revision;
  const q=await r.call(tasks[0],'ask_user',input);
  assert.equal(q.status,'pending');assert.equal(q.response,null);assert.equal(q.receiptOnly,true);
  assert.equal((await r.call(tasks[0],'ask_user',input)).requestId,q.requestId);
  assert.equal(r.data.revision,revision,'questions do not trigger unnecessary tool rediscovery');
  const notice=r.snapshot(root).notifications.filter(n=>n.type==='human-request');assert.equal(notice.length,1);assert.equal(notice[0].threadId,group.id);assert.equal(notice[0].requestId,q.requestId);
  await r.deliver();assert.equal(calls.length,0,'asking a human does not send agent prompts');
  assert.equal(r.groups.read(tasks[1],{threadId:group.id}).userRequests[0].status,'pending');
  await assert.rejects(r.call(tasks[3],'ask_user',input),e=>e.status===403);
  await assert.rejects(r.call({...tasks[0],project:'other'},'ask_user',input),e=>e.status===403);
  await assert.rejects(r.userRequests.answer(tasks[1],{requestId:q.requestId,response:'Forged answer'}),e=>e.status===403);
  await assert.rejects(r.userRequests.answer({...human,project:'other'},{requestId:q.requestId,response:'Wrong project'}),e=>e.status===404);
  const answer=await r.sendGroup(human,null,'Overflow, then cycles',{threadId:group.id,replyTo:q.requestId,kind:'result'});
  assert.equal(answer.status,'answered');assert.equal(answer.deliveries.length,3);assert.equal(answer.requiresReply,false);
  const again=await r.userRequests.answer(human,{requestId:q.requestId,response:'Overflow, then cycles'});assert.equal(answer.id,again.id);
  const chatRetry=await r.sendGroup(human,null,'Overflow, then cycles',{threadId:group.id,replyTo:q.requestId,kind:'result'});assert.equal(chatRetry.id,answer.id);
  await assert.rejects(r.userRequests.answer(human,{requestId:q.requestId,response:'Different'}),e=>e.status===409);
  await r.deliver();assert.equal(calls.length,3);await r.deliver();assert.equal(calls.length,3);
  assert(calls.every(([,prompt])=>prompt.includes('Which edge case first?')&&prompt.includes("User's answer:\nOverflow, then cycles")));
  const page=r.groups.read(tasks[0],{threadId:group.id});assert.equal(page.messages.length,2);assert.equal(page.messages[1].replyTo,q.requestId);assert.equal(page.userRequests[0].response,'Overflow, then cycles');
  const restored=new Collaboration({...plane,data:await db.loadState()});assert.equal(restored.groups.read(tasks[0],{threadId:group.id}).userRequests[0].status,'answered');
  const versions=await db.rows(root,'human-request');assert.deepEqual(versions.map(v=>v.body.status),['pending','answered']);assert.match(versions[0].session_id,/agent-0:codex:/);
  const exported=await db.export(root);assert(exported.entries.some(e=>e.kind==='notification'&&e.body.requestId===q.requestId));
});

test('question limits and closing a group cancel pending requests without reviving them',async t=>{
  const {registry:r,tasks,group,human}=await fixture(t);
  await assert.rejects(r.call(tasks[0],'ask_user',{threadId:group.id,question:'Choose',options:['Same','Same']}),/distinct/);
  for(let i=0;i<3;i++)await r.call(tasks[0],'ask_user',{threadId:group.id,question:'Question '+i});
  assert.equal((await r.call(tasks[0],'ask_user',{threadId:group.id,question:'Question 0'})).requestId,r.data.userRequests[0].id);
  await assert.rejects(r.call(tasks[0],'ask_user',{threadId:group.id,question:'Too many'}),e=>e.status===429);
  await r.groups.status(tasks[0],{threadId:group.id,status:'closed',reason:'Outcome complete'});
  assert(r.data.userRequests.every(q=>q.status==='cancelled'));assert(r.data.messages.every(m=>m.delivery==='cancelled'));
  await assert.rejects(r.userRequests.answer(human,{requestId:r.data.userRequests[0].id,response:'Too late'}),e=>e.status===409);
  await assert.rejects(r.call(tasks[0],'ask_user',{threadId:group.id,question:'Closed'}),e=>e.status===409);
  await r.groups.status(human,{threadId:group.id,status:'open',reason:'New requirements'});assert(r.data.userRequests.every(q=>q.status==='cancelled'));
});

test('request and answer retries wait for durable persistence without duplicate fan-out',async t=>{
  const {plane,registry:r,tasks,group,human}=await fixture(t),save=plane.save.bind(plane);
  let fail=true;plane.save=async()=>{if(fail)throw Error('Disk unavailable');return save();};
  const input={threadId:group.id,question:'Need a decision',requestId:'retry'};
  for(let i=0;i<2;i++)await assert.rejects(r.call(tasks[0],'ask_user',input),/Disk unavailable/);
  fail=false;const q=await r.call(tasks[0],'ask_user',input);assert.equal(r.data.userRequests.length,1);assert.equal(r.data.notifications.filter(n=>n.type==='human-request').length,1);
  const answer={requestId:q.requestId,response:'Proceed with the documented contract'};fail=true;
  for(let i=0;i<2;i++)await assert.rejects(r.userRequests.answer(human,answer),/Disk unavailable/);
  fail=false;await r.userRequests.answer(human,answer);assert.equal(r.data.messages.length,4);
  await assert.rejects(r.call(tasks[0],'ask_user',{...input,question:'Different request'}),e=>e.status===409);
});
