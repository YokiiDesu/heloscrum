import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlPlane} from '../lib/control-plane.mjs';
import {Collaboration} from '../lib/collaboration.mjs';

function fixture(kind='codex'){
  const p=new ControlPlane('/queue-test'),task={id:'worker',project:p.root,path:p.root,pane:'pane',phase:'launched',kind,role:'Worker',title:'Queue test',prompt:'Test'};
  p.data.tasks=[task];p.save=async()=>{};p.collaboration=new Collaboration(p);
  let queue=Promise.resolve();p.work={serial:fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;}};
  let status='working',calls=[];p.herdr={list:async()=>[{pane_id:'pane',agent_status:status,interactive_ready:status==='idle'}],prompt:async(...a)=>calls.push(a)};
  return {p,task,calls,idle:()=>status='idle'};
}
test('all providers queue by default; busy agents cannot read queued human prompts',async()=>{
  for(const kind of ['codex','claude','kiro','cursor','ollama','llamacpp','lmstudio','bedrock','sagemaker']){
    const f=fixture(kind),r=await f.p.promptTask('worker','Do this later');assert.equal(r.message.delivery,'queued');assert.equal(f.calls.length,0);
    assert.equal((await f.p.collaboration.readInbox(f.task,{})).messages.length,0);
    await f.p.collaboration.deliver();assert.equal(f.calls.length,0);f.idle();await f.p.collaboration.deliver();assert.equal(f.calls.length,1);
    await f.p.collaboration.deliver();assert.equal(f.calls.length,1);assert.equal(f.p.collaboration.data.messages[0].delivery,'delivered');
  }
});
test('edit cancels the exact unsent prompt, and a changed resend is a new prompt',async()=>{
  const f=fixture(),a=await f.p.promptTask('worker','Original',f.p.root,{requestId:'original'});
  const cancelled=await f.p.collaboration.cancelPrompt(f.task,a.message.id);assert.equal(cancelled.text,'Original');assert.equal(cancelled.delivery,'cancelled');
  await f.p.collaboration.cancelPrompt(f.task,a.message.id);assert.equal((await f.p.collaboration.readInbox(f.task,{})).messages.length,0);
  const b=await f.p.promptTask('worker','Edited',f.p.root,{requestId:'edit'});assert.notEqual(b.message.id,a.message.id);f.idle();await f.p.collaboration.deliver();assert.equal(f.calls.length,1);assert.match(f.calls[0][1],/Edited/);assert.doesNotMatch(f.calls[0][1],/Original/);
  await assert.rejects(f.p.collaboration.cancelPrompt(f.task,b.message.id),/already been sent/);
});
test('steering is consumed at an inbox check and never delivered a second time',async()=>{
  const f=fixture(),a=await f.p.promptTask('worker','Change direction',f.p.root,{mode:'steer'});assert.equal(a.message.delivery,'queued');assert.equal(f.calls.length,0);
  const inbox=await f.p.collaboration.readInbox(f.task,{});assert.equal(inbox.messages[0].text,'Change direction');assert.equal(inbox.messages[0].deliveryChannel,'inbox');
  await assert.rejects(f.p.collaboration.cancelPrompt(f.task,a.message.id),/already been sent/);f.idle();await f.p.collaboration.deliver();assert.equal(f.calls.length,0);
});
test('idempotent retries survive restoration; mismatched or cross-project edits reject',async()=>{
  const f=fixture(),a=await f.p.promptTask('worker','Later',f.p.root,{requestId:'retry'});const b=await f.p.promptTask('worker','Later',f.p.root,{requestId:'retry'});assert.equal(a.message.id,b.message.id);
  f.p.data=structuredClone(f.p.data);f.p.collaboration=new Collaboration(f.p);
  assert.equal((await f.p.promptTask('worker','Later',f.p.root,{requestId:'retry'})).message.id,a.message.id);
  await assert.rejects(f.p.promptTask('worker','Different',f.p.root,{requestId:'retry'}),/another prompt/);
  await assert.rejects(f.p.collaboration.cancelPrompt({...f.task,project:'/other'},a.message.id),/not found/);
  await assert.rejects(f.p.promptTask('worker','Later','/other'),/not found/);
});
test('delivery wins an edit race; uncertain deliveries remain visible and are never replayed',async()=>{
  const f=fixture(),a=await f.p.promptTask('worker','Queued');f.idle();let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  f.p.herdr.prompt=async()=>{started();await gate;throw Error('lost response');};const delivery=f.p.collaboration.deliver();await ready;
  const edit=f.p.collaboration.cancelPrompt(f.task,a.message.id);release();await delivery;await assert.rejects(edit,/already been sent/);
  assert.equal(f.p.collaboration.data.messages[0].delivery,'uncertain');let replay=0;f.p.herdr.prompt=async()=>replay++;await f.p.collaboration.deliver();assert.equal(replay,0);
});
