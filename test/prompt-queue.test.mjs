import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlPlane} from '../lib/control-plane.mjs';
import {Collaboration} from '../lib/collaboration.mjs';

function fixture(kind='codex'){
  const p=new ControlPlane('/queue-test'),task={id:'worker',project:p.root,path:p.root,pane:'pane',phase:'launched',kind,role:'Worker',title:'Queue test',prompt:'Test'};
  p.data.tasks=[task];p.save=async()=>{};p.collaboration=new Collaboration(p);
  let queue=Promise.resolve();p.work={serial:fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;}};
  let status='working',calls=[];p.herdr={list:async()=>[{pane_id:'pane',agent:kind,agent_status:status,interactive_ready:status==='idle'}],prompt:async(...a)=>calls.push(a),steer:async(...a)=>calls.push(a)};
  return {p,task,calls,idle:()=>status='idle'};
}
test('all providers queue by default; busy agents cannot read queued human prompts',async()=>{
  for(const kind of ['codex','claude','kiro','cursor','gemini','ollama','llamacpp','lmstudio','bedrock','sagemaker']){
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
test('native steering enters a working turn without an inbox check; queue stays held',async()=>{
  for(const kind of ['codex','claude','kiro']){
    const f=fixture(kind),queued=await f.p.promptTask('worker','Later');
    const a=await f.p.promptTask('worker','Change direction',f.p.root,{mode:'steer',requestId:'once'});
    assert.equal(a.message.delivery,'delivered');assert.equal(a.message.deliveryChannel,'native-steer');assert.equal(f.calls.length,1);
    assert.match(f.calls[0][1],/Change direction/);assert.doesNotMatch(f.calls[0][1],/Later/);
    await f.p.promptTask('worker','Change direction',f.p.root,{mode:'steer',requestId:'once'});assert.equal(f.calls.length,1);
    await assert.rejects(f.p.collaboration.cancelPrompt(f.task,a.message.id),/already been sent/);
    f.idle();await f.p.collaboration.deliver();assert.equal(f.calls.length,2);assert.match(f.calls[1][1],/Later/);
    assert.equal(f.p.collaboration.data.messages.find(m=>m.id===queued.message.id).delivery,'delivered');
  }
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
test('delivery records whether the provider confirmed the envelope or it was only typed',async()=>{
  const f=fixture();await f.p.promptTask('worker','Typed');f.idle();await f.p.collaboration.deliver();
  const typed=f.p.collaboration.data.messages[0];assert.equal(typed.delivery,'delivered');assert.equal(typed.deliveryConfirmation,'keystrokes');assert.equal(typed.deliveryReceipt,undefined);
  f.p.herdr.prompt=async()=>({accepted:true,turnId:'turn-7',confirmation:'protocol'});await f.p.promptTask('worker','Confirmed');await f.p.collaboration.deliver();
  const confirmed=f.p.collaboration.data.messages[1];assert.equal(confirmed.delivery,'delivered');assert.equal(confirmed.deliveryConfirmation,'protocol');assert.equal(confirmed.deliveryReceipt,'turn-7');
});
async function restartMidDelivery(f,text){
  f.idle();let hold;const held=new Promise(r=>hold=r);f.p.herdr.prompt=async()=>{await held;};
  const queued=await f.p.collaboration.queuePrompt(f.task,text),delivery=f.p.collaboration.deliver(),a={message:queued};
  for(let i=0;i<50&&a.message.delivery!=='delivering';i++)await new Promise(r=>setTimeout(r,2));assert.equal(a.message.delivery,'delivering');
  // Snapshot the state as it was saved mid-delivery, then "restart" on that copy.
  f.p.data=structuredClone(f.p.data);f.task=f.p.data.tasks[0];f.p.collaboration=new Collaboration(f.p);hold();await delivery.catch(()=>{});
  const message=f.p.collaboration.data.messages.find(m=>m.id===a.message.id);assert.equal(message.delivery,'uncertain');assert.match(message.deliveryNote,/Checking the agent history/);
  f.calls.length=0;f.p.herdr.prompt=async(...args)=>f.calls.push(args);return message;
}
test('after a restart mid-delivery, a message found in the agent history is delivered and never re-sent',async()=>{
  const f=fixture(),message=await restartMidDelivery(f,'Keep going');
  f.p.transcripts={readCurrent:async(task,live,{full})=>{assert.equal(task.id,'worker');assert.equal(full,true);return {events:[{role:'user',text:`[HeloScrum direct message ${message.id} from You, agent human; reply=normal]\nKeep going\n[/HeloScrum message]`},{role:'assistant',text:'On it'}]};}};
  await f.p.collaboration.deliver();
  assert.equal(message.delivery,'delivered');assert.equal(message.deliveryConfirmation,'history');assert.equal(message.deliveryChannel,'prompt');assert(message.deliveredAt);assert.equal(message.reconcile,undefined);assert.equal(message.deliveryNote,undefined);
  await f.p.collaboration.deliver();assert.equal(f.calls.length,0);
});
test('after a restart mid-delivery, a message missing from a readable history is queued and sent exactly once',async()=>{
  const f=fixture(),message=await restartMidDelivery(f,'Lost in restart');
  f.p.transcripts={readCurrent:async()=>({events:[{role:'user',text:'Earlier task'},{role:'assistant',text:'Done'}]})};
  await f.p.collaboration.deliver();
  assert.equal(message.delivery,'delivered');assert.equal(message.deliveryConfirmation,'keystrokes');assert.equal(f.calls.length,1);assert.match(f.calls[0][1],new RegExp(message.id));
  await f.p.collaboration.deliver();assert.equal(f.calls.length,1);
});
test('after a restart mid-delivery, an unreadable history leaves the message uncertain; a changing session is retried',async()=>{
  const f=fixture(),message=await restartMidDelivery(f,'Unknown fate');
  let reads=0;f.p.transcripts={readCurrent:async()=>{reads++;throw Object.assign(new Error('The session changed while history was loading. Refresh it.'),{status:409});}};
  await f.p.collaboration.deliver();assert.equal(message.delivery,'uncertain');assert.match(message.deliveryNote,/Waiting for the agent session/);assert.equal(f.calls.length,0);
  f.p.transcripts={readCurrent:async()=>{reads++;throw new Error('Session file is unreadable');}};
  await f.p.collaboration.deliver();assert.equal(reads,2);assert.equal(message.delivery,'uncertain');assert.equal(message.reconcile,undefined);assert.match(message.error,/could not be read.*Session file is unreadable/);assert.equal(message.deliveryNote,undefined);
  await f.p.collaboration.deliver();assert.equal(reads,2);assert.equal(f.calls.length,0);
});
