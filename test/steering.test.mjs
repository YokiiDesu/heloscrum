import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ControlPlane} from '../lib/control-plane.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {ManagedAgents,withManagedAgents} from '../lib/managed-agents.mjs';
import {Transcripts} from '../lib/transcripts.mjs';
import {HerdrAdapter,run} from '../lib/adapters.mjs';
import {cursorSteeringConfig} from '../lib/cursor.mjs';
import {geminiSteeringConfig,hookCommand,steeringHookOutput} from '../lib/steering.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,kind='gemini'){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-steering-'));
  const p=new ControlPlane(root),task={id:randomUUID(),providerSessionId:randomUUID(),project:root,path:root,pane:'pane',phase:'launched',kind,role:'Tester',name:'tester',prompt:'Test',connectionId:'connection'};
  p.data.tasks=[task];p.save=async()=>{};p.collaboration=new Collaboration(p);
  let queue=Promise.resolve();p.work={serial:fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;}};
  let status='working';const calls=[];
  p.herdr={list:async()=>[{pane_id:task.pane,agent:kind,agent_status:status,interactive_ready:status==='idle'}],prompt:async(...args)=>calls.push(args)};
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input={provider:kind,cwd:root,sessionId:task.providerSessionId,event:kind==='gemini'?'BeforeModel':'postToolUse'};
  return {p,task,input,root,calls,idle:()=>status='idle'};
}

test('native hook claims steering exactly once, never queue, without read_inbox',async t=>{
  for(const kind of ['gemini','cursor']){
    const f=await fixture(t,kind),c=f.p.collaboration;
    await f.p.promptTask(f.task.id,'Later');
    await f.p.promptTask(f.task.id,'Change course',f.root,{mode:'steer'});
    assert.equal((await c.readInbox(f.task,{})).messages.length,0);
    const claims=await Promise.all([c.steeringBoundary(f.task,f.input),c.steeringBoundary(f.task,f.input)]);
    assert.equal(claims.filter(x=>x.text).length,1);const claim=claims.find(x=>x.text);
    assert.match(claim.text,/Change course/);assert.doesNotMatch(claim.text,/Later/);
    assert.equal(c.data.messages[1].delivery,'uncertain');
    f.p.tools||={};f.p.transcripts=new Transcripts(f.p);t.after(()=>f.p.transcripts.close());
    f.p.transcripts.readCurrent=async()=>({sessionId:f.task.providerSessionId,events:[]});
    assert.equal((await f.p.transcripts.read(f.task)).events.length,0,'unconfirmed delivery is not shown as received');
    await c.steeringBoundary(f.task,{...f.input,receipt:claim.receipt});
    await c.steeringBoundary(f.task,{...f.input,receipt:claim.receipt});
    assert.equal(c.data.messages[1].delivery,'delivered');assert.equal(c.data.messages[1].deliveryChannel,'native-hook');
    const timeline=(await f.p.transcripts.read(f.task)).events;assert.equal(timeline.length,1);assert.equal(timeline[0].text,'Change course');assert.equal(timeline[0].label,'Steer · delivered to active turn');
    f.idle();await c.deliver();assert.equal(f.calls.length,1);assert.match(f.calls[0][1],/Later/);assert.doesNotMatch(f.calls[0][1],/Change course/);
  }
});

test('hook identity, event, workspace and archived checks precede any claim',async t=>{
  const f=await fixture(t),c=f.p.collaboration;await c.queuePrompt(f.task,'Protected',{mode:'steer'});
  for(const patch of [{provider:'cursor'},{sessionId:'old-session'},{cwd:os.tmpdir()},{event:'BeforeTool'}])await assert.rejects(c.steeringBoundary(f.task,{...f.input,...patch}));
  f.task.archivedAt='now';await assert.rejects(c.steeringBoundary(f.task,f.input));delete f.task.archivedAt;
  assert.equal(c.data.messages[0].delivery,'queued');
  f.task.external=true;await assert.rejects(c.steeringBoundary(f.task,f.input));
});

test('lost hook acknowledgement remains uncertain across restore and is never replayed',async t=>{
  const f=await fixture(t);await f.p.collaboration.queuePrompt(f.task,'Once',{mode:'steer'});
  const claim=await f.p.collaboration.steeringBoundary(f.task,f.input);assert(claim.receipt);
  f.p.data=structuredClone(f.p.data);f.p.collaboration=new Collaboration(f.p);
  assert.deepEqual(await f.p.collaboration.steeringBoundary(f.task,f.input),{});
  f.idle();await f.p.collaboration.deliver();assert.equal(f.calls.length,0);
  assert.equal(f.p.collaboration.data.messages[0].delivery,'uncertain');
});

test('Gemini keeps an accepted steer in later inferences of that turn without claiming it twice',async t=>{
  const f=await fixture(t),session={turnId:'turn-1'};f.p.managed={sessions:new Map([[f.task.pane,session]])};
  await f.p.collaboration.queuePrompt(f.task,'Keep this correction',{mode:'steer'});
  const claim=await f.p.collaboration.steeringBoundary(f.task,f.input);
  await f.p.collaboration.steeringBoundary(f.task,{...f.input,receipt:claim.receipt});
  const next=await f.p.collaboration.steeringBoundary(f.task,f.input);assert.equal(next.text,claim.text);assert.equal(next.receipt,undefined);
  session.turnId='turn-2';assert.deepEqual(await f.p.collaboration.steeringBoundary(f.task,f.input),{});
  assert.throws(()=>steeringHookOutput('gemini','direction',{}),/native model request/);
});

test('cancel and idle fallback retain their exact delivery behavior for hooks',async t=>{
  const f=await fixture(t),c=f.p.collaboration;
  const cancelled=await c.queuePrompt(f.task,'Cancelled',{mode:'steer'});await c.cancelPrompt(f.task,cancelled.id);
  assert.deepEqual(await c.steeringBoundary(f.task,f.input),{});
  await c.queuePrompt(f.task,'No further tools',{mode:'steer'});f.idle();await c.deliver();assert.equal(f.calls.length,1);
  assert.match(f.calls[0][1],/No further tools/);assert.doesNotMatch(f.calls[0][1],/Cancelled/);
});

test('managed providers apply steering after the current tool batch before inference',async t=>{
  for(const kind of ['ollama','llamacpp','lmstudio','bedrock','sagemaker']){
    const f=await fixture(t,kind),{p,task}=f,toolStarted=deferred(),finishTool=deferred(),seen=[];
    p.collaboration.catalog=()=>({tools:[{name:'work_brief',description:'Test tool',inputSchema:{type:'object'}}]});
    p.collaboration.call=async()=>{toolStarted.resolve();await finishTool.promise;return {value:'tool finished'};};
    p.ai={get:()=>({id:'connection',kind,supportsTools:true}),complete:async(id,request)=>{
      seen.push(structuredClone(request.messages));
      return {message:seen.length===1?{role:'assistant',tool_calls:[{id:'tool-1',type:'function',function:{name:'work_brief',arguments:'{}'}}]}:{role:'assistant',content:'Finished'}};
    }};
    p.managed=new ManagedAgents(p);p.herdr=withManagedAgents({list:async()=>[]},p.managed);
    await p.managed.start(task);await p.managed.prompt(task.pane,'Initial request');await toolStarted.promise;
    await p.promptTask(task.id,'Wait until done');await p.promptTask(task.id,'Use the corrected path',f.root,{mode:'steer'});
    assert.equal(seen.length,1);assert.equal(p.managed.get(task.pane).status,'working');
    finishTool.resolve();await p.managed.get(task.pane).running;
    assert.equal(seen.length,2);const second=seen[1],toolIndex=second.findIndex(m=>m.role==='tool'),steerIndex=second.findIndex(m=>typeof m.content==='string'&&m.content.includes('Use the corrected path'));
    assert(steerIndex>toolIndex);assert.doesNotMatch(JSON.stringify(second),/Wait until done/);
    assert.equal(p.collaboration.data.messages.find(m=>m.promptMode==='steer').deliveryChannel,'model-boundary');
    await p.managed.close();
  }
});

test('native terminal submission preserves text and never uses interrupt keys',async()=>{
  for(const kind of ['codex','claude','kiro']){
    const adapter=new HerdrAdapter('/herdr','/root'),calls=[];
    adapter.list=async()=>[{pane_id:'pane',agent:kind,agent_status:'working'}];adapter.read=async()=>'> Steer';adapter.json=async args=>{calls.push(args);return {ok:true};};
    const text='User direction\nwith "quotes" and $literal';await adapter.steer('pane',text,{task:{kind}});
    assert.deepEqual(calls,[['agent','prompt','pane',text]]);
    adapter.list=async()=>[{pane_id:'pane',agent:kind,agent_status:'blocked'}];
    await assert.rejects(adapter.steer('pane',text,{task:{kind}}),e=>e.code==='steering_deferred');assert.equal(calls.length,1);
    adapter.list=async()=>[{pane_id:'pane',agent:kind,agent_status:'working'}];
    adapter.json=async()=>{throw Object.assign(Error('permission opened'),{code:'agent_blocked'});};
    await assert.rejects(adapter.steer('pane',text,{task:{kind}}),e=>e.code==='steering_deferred');
  }
});

test('Gemini workspace hook preserves existing settings, hooks and policy, and is idempotent',async t=>{
  const f=await fixture(t),file=path.join(f.root,'.gemini/settings.json'),original={security:{auth:{selectedType:'oauth-personal'}},hooksConfig:{enabled:false},hooks:{BeforeModel:[{hooks:[{command:'existing'}]}]}};
  await mkdir(path.dirname(file));await writeFile(file,JSON.stringify(original));
  await geminiSteeringConfig(f.root,'hook-command');await geminiSteeringConfig(f.root,'hook-command');
  const settings=JSON.parse(await readFile(file,'utf8'));
  assert.equal(settings.hooks.BeforeModel.length,2);assert.deepEqual(settings.hooks.BeforeModel[0],original.hooks.BeforeModel[0]);assert.equal(settings.hooksConfig.enabled,false);assert.deepEqual(settings.security,original.security);
});

test('Cursor installs idempotent success and failure hooks alongside existing hooks',async t=>{
  const f=await fixture(t,'cursor');await run('git',['init','-q'],{cwd:f.root});await mkdir(path.join(f.root,'.cursor'));
  const file=path.join(f.root,'.cursor/hooks.json');await writeFile(file,JSON.stringify({version:1,hooks:{postToolUse:[{command:'existing'}],stop:[{command:'keep'}]}}));
  await cursorSteeringConfig(f.task,'steer');await cursorSteeringConfig(f.task,'steer');
  const hooks=JSON.parse(await readFile(file,'utf8')).hooks;assert.deepEqual(hooks.postToolUse.map(h=>h.command),['existing','steer']);assert.deepEqual(hooks.postToolUseFailure,[{command:'steer'}]);assert.deepEqual(hooks.stop,[{command:'keep'}]);
});

test('Cursor launch installs the steering bridge for both managed and interactive sessions',async t=>{
  const f=await fixture(t,'cursor');await run('git',['init','-q'],{cwd:f.root});
  assert.deepEqual(await f.p.collaboration.register(f.task),[]);
  f.p.tools={cursor:'/mock/cursor'};f.task.nativeSetup={cursorMode:'interactive'};const args=await f.p.collaboration.launchConfig(f.task);
  assert(args.includes('--resume'));
  const hooks=JSON.parse(await readFile(path.join(f.root,'.cursor/hooks.json'),'utf8')).hooks;
  assert.equal(hooks.postToolUse.filter(h=>h.command.includes('steering-hook.mjs')).length,1);
  assert(hooks.sessionStart.some(h=>h.command.includes('agent-hook.mjs')));
});

test('provider hook process outputs the native context field and acknowledges only after output',async t=>{
  for(const kind of ['gemini','cursor']){
    const f=await fixture(t,kind),requests=[],server=http.createServer(async(req,res)=>{
      let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);requests.push(input);
      assert.equal(req.headers.authorization,'Bearer private');
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(input.receipt?{ok:true}:{receipt:'receipt',text:'Corrected direction'}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
    const config=path.join(f.root,'connection.json');await writeFile(config,JSON.stringify({url:'http://127.0.0.1:'+server.address().port,token:'private'}));
    const child=spawn(process.execPath,['scripts/steering-hook.mjs',config,kind],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    const hook={session_id:f.input.sessionId,cwd:f.root,hook_event_name:f.input.event,llm_request:{messages:[{role:'user',content:'Original request'},{role:'model',content:'Original response'}]}};child.stdin.end(JSON.stringify(hook));
    assert.equal(await new Promise(resolve=>child.on('close',resolve)),0);assert.equal(stderr,'');assert.deepEqual(JSON.parse(stdout),steeringHookOutput(kind,'Corrected direction',hook));
    assert.equal(requests.length,2);assert.equal(requests[0].event,f.input.event);assert.equal(requests[1].receipt,'receipt');
    await new Promise(resolve=>server.close(resolve));
  }
});
