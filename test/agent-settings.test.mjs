import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ControlPlane} from '../lib/control-plane.mjs';
import {AgentSettings,handoffText} from '../lib/agent-settings.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {Transcripts} from '../lib/transcripts.mjs';
import {run} from '../lib/adapters.mjs';
import {NativeSetup} from '../lib/native-setup.mjs';
import {AIConnections} from '../lib/ai-connections.mjs';
import {ManagedAgents,withManagedAgents} from '../lib/managed-agents.mjs';
const session='11111111-1111-4111-8111-111111111111';
async function fixture(kind='codex'){
 const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-model-'));await mkdir(path.join(root,'.heloscrum'));const cwd=path.join(root,'worktree');await mkdir(cwd);await writeFile(path.join(cwd,'draft.txt'),'keep my edits');
 const plane=new ControlPlane(root);plane.tools={codex:'/mock/codex',claude:'/mock/claude',herdr:'/mock/herdr'};
 const task={id:'22222222-2222-4222-8222-222222222222',project:root,path:cwd,worktreeId:'worktree',branch:'test/agent',role:'Builder',title:'Build a utility',summary:'Writes and tests utilities',prompt:'Implement the agreed utility',kind,model:kind==='codex'?'old-codex':'opus',name:'old',pane:'old-pane',workspace:'old-workspace',phase:'launched',providerSessionId:session,agentState:{state:'focused',metrics:{contextPercent:80}},toolPolicy:{mode:'selected',allowed:['memory_read']},containerIds:['test-container'],createdAt:new Date().toISOString()};
 plane.data.tasks.push(task);plane.collaboration=new Collaboration(plane);plane.collaboration.data.credentials[task.id]='test-token';plane.transcripts=new Transcripts(plane);plane.agentSettings=new AgentSettings(plane);
 plane.agentSettings.cached={at:Date.now(),value:{providers:[{id:'codex',installed:true,label:'Codex',models:[{id:'new-codex',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{id:'old-codex',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]},{id:'claude',installed:true,label:'Claude Code',effortLevels:['low','medium','high','xhigh','max'],models:[{id:'sonnet'},{id:'opus'}]}]}};
 let agents=[{name:task.name,pane_id:task.pane,agent:kind,interactive_ready:true,agent_status:'done'}];const calls=[];
 const history={sessionId:session,source:'Provider history',events:[{id:'u',type:'message',role:'user',text:'Create the utility'},{id:'a',type:'message',role:'assistant',text:'Tests passed. Awaiting review.'}]};
 plane.transcripts.readCurrent=async()=>history;
 plane.herdr={list:async()=>agents,createWorkspace:async(cwd)=>{calls.push(['workspace',cwd]);return {root_pane:{pane_id:'new-pane'},workspace:{workspace_id:'new-workspace'}};},exitAgent:async pane=>{calls.push(['exit',pane]);agents=[];},startAgent:async(name,kind,pane,args)=>{calls.push(['start',name,kind,pane,args]);agents=[{name,agent:kind,pane_id:pane,interactive_ready:true,agent_status:'idle'}];},prompt:async(pane,text)=>calls.push(['prompt',pane,text])};
 return {root,plane,task,calls,history,agents,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('opening settings does not wait for transcript or model discovery',async()=>{
 const f=await fixture();try{
  f.plane.agentSettings.cached=null;
  f.plane.transcripts.readCurrent=async()=>{assert.fail('Opening a form must not read full history');};
  f.plane.transcripts.codex.models=async()=>{assert.fail('Opening a form must not wait on model discovery');};
  const details=await f.plane.agentSettings.details(f.task.id);assert.equal(details.canSwitch,true);assert.equal(details.kind,'codex');assert(details.providers.find(p=>p.id==='codex').catalogPending);
 }finally{await f.cleanup();}
});
test('local provider selection is independent of a stalled native model catalog and sees newly saved connections',async()=>{
 const f=await fixture();try{
  f.plane.agentSettings.cached=null;f.plane.ai=new AIConnections(f.plane);
  const connection={id:'local',kind:'lmstudio',model:'qwen/test',name:'Local',supportsTools:true};f.plane.data.aiConnections.push(connection);
  let release,calls=0;f.plane.transcripts.codex.models=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const catalog1=f.plane.agentSettings.provider('codex'),catalog2=f.plane.agentSettings.provider('codex');
  const selected=await f.plane.agentSettings.selection({kind:'lmstudio',connectionId:'local'});assert.equal(selected.model,'qwen/test');assert.equal(calls,1);
  connection.model='qwen/updated';assert.equal((await f.plane.agentSettings.provider('lmstudio')).models[0].id,'qwen/updated');
  release([{id:'native',isDefault:true}]);assert.deepEqual((await catalog1).models,(await catalog2).models);
 }finally{await f.cleanup();}
});
test('offline agent replacement preserves the exact saved conversation and files',async()=>{
 const f=await fixture();try{
  f.plane.herdr.list=async()=>[];
  assert.equal((await f.plane.agentSettings.details(f.task.id)).status,'offline');
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});
  assert.equal(preview.historyUnavailable,false);await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Reviewed offline handoff. Wait.'});
  assert.equal(f.calls.filter(c=>c[0]==='exit').length,0);assert.equal(f.calls.filter(c=>c[0]==='start').length,1);
  const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'sessions',f.task.sessionArchives[0].id+'.json'),'utf8'));assert.deepEqual(saved.history,f.history);
  assert.equal(await readFile(path.join(f.task.path,'draft.txt'),'utf8'),'keep my edits');
 }finally{await f.cleanup();}
});
test('offline Codex with unreadable history can switch to a local agent only after explicit handoff acknowledgement',async()=>{
 const f=await fixture();try{
  f.plane.herdr.list=async()=>[];f.plane.ai=new AIConnections(f.plane,{client:{complete:async()=>({message:{role:'assistant',content:'Ready'},usage:{total_tokens:1}})}});
  f.plane.data.aiConnections.push({id:'local',name:'LM Studio',kind:'lmstudio',model:'qwen/test',supportsTools:true});
  f.plane.managed=new ManagedAgents(f.plane);f.plane.herdr=withManagedAgents(f.plane.herdr,f.plane.managed);
  f.plane.transcripts.readCurrent=async(task,...args)=>{if(task.kind==='codex')throw new Error('Codex history request timed out');return Transcripts.prototype.readCurrent.call(f.plane.transcripts,task,...args);};
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'lmstudio',connectionId:'local'});assert.equal(preview.historyUnavailable,true);assert.equal(preview.freshSession,true);
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Wait.'}),/Confirm/);assert.equal(f.task.kind,'codex');assert.equal(f.task.phase,'launched');
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Reviewed handoff. Wait.',acknowledgeIncompleteHistory:true});
  const managed=f.plane.managed.get(f.task.pane);await managed.running;
  assert.equal(f.task.kind,'lmstudio');assert.equal(f.task.connectionId,'local');assert.equal(f.task.phase,'launched');assert.equal(managed.events.at(-1).text,'Ready');assert.equal(f.task.sessionArchives[0].historyUnavailable,true);
  assert.equal((await f.plane.agentSettings.details(f.task.id)).canSwitch,true);
  const persisted=JSON.parse(await readFile(path.join(f.root,'.heloscrum/state.json'),'utf8'));assert.equal(persisted.tasks[0].connectionId,'local');
  assert.equal(f.calls.filter(c=>c[0]==='exit'||c[0]==='workspace').length,0);assert.equal(await readFile(path.join(f.task.path,'draft.txt'),'utf8'),'keep my edits');
  const transcript=await f.plane.transcripts.read(f.task);assert.match(transcript.events.find(e=>e.type==='session').text,/history was unavailable/);
  await f.plane.managed.close();
 }finally{await f.cleanup();}
});
test('unknown engine status and another agent in the same worktree never count as safely offline',async()=>{
 const f=await fixture();try{
  f.plane.herdr.list=async()=>{throw Error('Engine unreachable');};assert.equal((await f.plane.agentSettings.details(f.task.id)).canSwitch,false);
  await assert.rejects(f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'}),/Engine unreachable/);
  f.plane.herdr.list=async()=>[{pane_id:'other',cwd:f.task.path,interactive_ready:true,agent_status:'idle'}];assert.equal((await f.plane.agentSettings.details(f.task.id)).canSwitch,false);
  await assert.rejects(f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'}),/Wait for the agent/);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('local connections do not hide a native engine outage when changing a native agent',async()=>{
 const f=await fixture();try{
  f.plane.data.aiConnections=[{id:'local',kind:'lmstudio',supportsTools:true}];f.plane.managed=new ManagedAgents(f.plane);
  f.plane.herdr.list=async()=>{throw Error('Native engine unavailable');};f.plane.herdr=withManagedAgents(f.plane.herdr,f.plane.managed);
  assert.deepEqual(await f.plane.herdr.list(),[]);const details=await f.plane.agentSettings.details(f.task.id);assert.equal(details.canSwitch,false);assert.equal(details.status,'unknown');assert.match(details.statusError,/Native engine/);
  await assert.rejects(f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'}),/Native engine/);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('a reconnected offline agent or newly recovered history invalidates the handoff review',async()=>{
 const f=await fixture();try{
  f.plane.herdr.list=async()=>[];const read=f.plane.transcripts.readCurrent;f.plane.transcripts.readCurrent=async()=>{throw Error('Unavailable');};
  let preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});
  f.plane.transcripts.readCurrent=read;
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Missing history',acknowledgeIncompleteHistory:true}),/conversation changed/);
  preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});f.plane.herdr.list=async()=>f.agents;
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Offline review'}),/status changed/);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('native profile changes require a fresh reviewed session and reject configuration drift before exit',async()=>{
 const f=await fixture();try{
  await run('git',['init','-q'],{cwd:f.root});const home=path.join(f.root,'native-home');await mkdir(home);
  const file=path.join(home,'specialist.config.toml');await writeFile(file,'model = "profile-model"\n');
  f.plane.nativeSetup=new NativeSetup(f.plane,{home:f.root,codexHome:home});
  const input={kind:'codex',model:'',nativeSetup:{profile:'user:specialist',files:[]}};
  let preview=await f.plane.agentSettings.preview(f.task.id,input);assert(preview.freshSession);assert.equal(preview.model,'Provider default');
  await writeFile(file,'model = "changed"\n');await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Continue carefully'}),/configuration changed/);
  assert.equal(f.calls.length,0);assert.equal(f.task.phase,'launched');
  preview=await f.plane.agentSettings.preview(f.task.id,input);await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Reviewed native profile. Wait.'});
  const args=f.calls.find(c=>c[0]==='start')[4];assert.equal(args[args.indexOf('--profile')+1],'specialist');assert(!args.includes('--model'));assert(!args.includes('resume'));
  assert.equal(f.task.nativeSetup.profile,'user:specialist');assert.equal(f.task.sessionArchives.length,1);
 }finally{await f.cleanup();}
});
test('reviewed checkpoints rotate an unchanged provider and preserve the old transcript and brief',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'codex',model:'old-codex',freshSession:true});assert.equal(preview.crossProvider,false);assert.equal(preview.freshSession,true);
  const result=await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Approved checkpoint. Wait for the next instruction.'});
  assert.equal(result.freshSession,true);assert.equal(f.task.contextRotation,true);assert.equal(f.task.sessionArchives[0].sessionId,session);
  const args=f.calls.find(c=>c[0]==='start')[4];assert(!args.includes('resume'));const prompt=f.calls.find(c=>c[0]==='prompt')[2];assert.match(prompt,/Implement the agreed utility/);assert.match(prompt,/Approved checkpoint/);
  const archive=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'sessions',f.task.sessionArchives[0].id+'.json'),'utf8'));assert.deepEqual(archive.history.events,f.history.events);
 }finally{await f.cleanup();}
});
test('fresh checkpoints cannot rotate a session whose transcript changed after preview',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'codex',model:'old-codex',freshSession:true});f.history.events.push({id:'new',type:'message',role:'user',text:'New constraint'});
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Old summary'}),/conversation changed/);assert.equal(f.task.pane,'old-pane');assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('Kiro switches preserve the exact session or require a fresh reviewed handoff',async()=>{
 for(const kind of ['kiro','codex']){
  const f=await fixture(kind);try{
   await run('git',['init','-q'],{cwd:f.task.path});
   f.plane.agentSettings.cached.value.providers.push({id:'kiro',installed:true,label:'Kiro CLI',models:[{id:'auto',isDefault:true}]});
   const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'kiro',model:kind==='kiro'?null:'auto'});
   await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Continue the reviewed task.'});
   const args=f.calls.find(c=>c[0]==='start')[4];assert.equal(args[0],'chat');assert.equal(f.task.kind,'kiro');
   if(kind==='kiro'){assert.equal(args[args.indexOf('--resume-id')+1],session);assert.equal(args[args.indexOf('--model')+1],'auto');assert.equal(f.task.providerSessionId,session);assert(!f.calls.some(c=>c[0]==='prompt'));}
   else{assert(!args.includes('--resume-id'));assert.equal(f.task.providerSessionId,undefined);assert.equal(f.calls.filter(c=>c[0]==='prompt').length,1);assert.equal(f.task.sessionArchives[0].kind,'codex');}
   assert.equal(await readFile(path.join(f.task.path,'draft.txt'),'utf8'),'keep my edits');
  }finally{await f.cleanup();}
 }
});
test('changing models resumes the exact session and does not re-submit the task',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'codex',model:'new-codex'});assert.equal(preview.crossProvider,false);
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId});
  const start=f.calls.find(c=>c[0]==='start');assert.deepEqual(start[4].slice(0,4),['resume',session,'--model','new-codex']);
  assert(!f.calls.some(c=>c[0]==='prompt'));assert(f.calls.findIndex(c=>c[0]==='exit')<f.calls.findIndex(c=>c[0]==='start'));
  assert.equal(f.task.providerSessionId,session);assert.equal(f.task.phase,'launched');assert.equal(f.task.sessionRevision,1);assert.equal(f.task.agentState,undefined);
  assert.equal(f.task.toolPolicy.allowed[0],'memory_read');assert.equal(f.task.worktreeId,'worktree');assert.equal(await readFile(path.join(f.task.path,'draft.txt'),'utf8'),'keep my edits');
  assert.equal(f.plane.collaboration.data.credentials[f.task.id],'test-token');assert.equal(f.task.sessionArchives,undefined);
 }finally{await f.cleanup();}
});
test('switching providers saves history, preserves identity, and sends only the reviewed handoff',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});assert(preview.crossProvider);assert.match(preview.handoff,/Tests passed/);
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Reviewed handoff: tests passed; await my next task.'});
  assert.equal(f.task.kind,'claude');assert.notEqual(f.task.providerSessionId,session);assert.equal(f.task.model,'sonnet');assert.equal(f.task.containerIds[0],'test-container');
  const args=f.calls.find(c=>c[0]==='start')[4];assert(args.includes('--session-id'));assert(!args.includes('--resume'));assert(args.includes('sonnet'));
  const prompts=f.calls.filter(c=>c[0]==='prompt');assert.equal(prompts.length,1);assert.match(prompts[0][2],/^Reviewed handoff: tests passed/);assert(!prompts[0][2].includes('Implement the agreed utility'));
  const archive=f.task.sessionArchives[0],saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'sessions',archive.id+'.json'),'utf8'));
  assert.deepEqual(saved.history,f.history);assert.equal(saved.kind,'codex');
  f.plane.transcripts.readCurrent=async()=>({sessionId:f.task.providerSessionId,source:'Claude history',events:[{id:'new',type:'message',role:'assistant',text:'Handoff received.'}]});
  const combined=await f.plane.transcripts.read(f.task);assert.equal(combined.events.length,4);assert.equal(combined.events[2].type,'session');assert.equal(combined.events[3].text,'Handoff received.');
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Duplicate'}),/Preview expired/);
 }finally{await f.cleanup();}
});
test('Claude model changes resume its exact session with a session-local model override',async()=>{
 const f=await fixture('claude');try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId});
  const args=f.calls.find(c=>c[0]==='start')[4];assert.deepEqual(args.slice(0,4),['--resume',session,'--model','sonnet']);assert(!args.includes('--session-id'));assert(!f.calls.some(c=>c[0]==='prompt'));
 }finally{await f.cleanup();}
});
test('working sessions, in-flight messages, and stale previews cannot switch providers',async()=>{
 const f=await fixture();try{
  f.agents[0].agent_status='working';await assert.rejects(f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'}),/finish or interrupt/);
  f.agents[0].agent_status='done';const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});
  f.plane.collaboration.delivering.add(f.task.id);await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'test'}),/teammate message/);f.plane.collaboration.delivering.clear();
  f.history.events.push({id:'late',type:'message',role:'user',text:'A new requirement'});
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'test'}),/conversation changed/);
  assert.equal(f.task.phase,'launched');assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('refusal to exit preserves the original session and never launches a second writer',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});f.plane.herdr.exitAgent=async()=>{throw Error('Session did not exit');};
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'test'}),/did not exit/);
  assert.equal(f.task.kind,'codex');assert.equal(f.task.pane,'old-pane');assert.equal(f.task.providerSessionId,session);assert.equal(f.task.phase,'launched');assert(!f.calls.some(c=>c[0]==='start'));
 }finally{await f.cleanup();}
});
test('failed replacement keeps the saved conversation visible and does not send a handoff into a shell',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});f.plane.herdr.startAgent=async()=>{throw Object.assign(Error('Provider setup required'),{code:'agent_not_ready'});};
  const result=await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'test handoff'});
  assert.equal(result.phase,'awaiting-setup');assert.equal(f.task.sessionArchives.length,1);assert(!f.calls.some(c=>c[0]==='prompt'));
  f.plane.transcripts.readCurrent=async()=>{throw Error('New session is not ready');};const history=await f.plane.transcripts.read(f.task);
  assert.equal(history.events[0].text,'Create the utility');assert.match(history.warning,/not ready/);
 }finally{await f.cleanup();}
});
test('handoffs are bounded excerpts, and invalid model IDs are rejected before changing sessions',async()=>{
 const f=await fixture();try{
  const history={events:Array.from({length:300},(_,i)=>({type:'tool',id:String(i),name:'Read',input:'x'.repeat(50000),output:'y'.repeat(10000)}))};
  const text=handoffText({...f.task,prompt:'p'.repeat(16000)},history);assert(text.length<16000);assert.match(text,/excerpt shortened/);
  await assert.rejects(f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet\n/exit'}),/model ID/);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});

test('a failed provider switch can resume the original saved session without replaying work',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'}),start=f.plane.herdr.startAgent;
  f.plane.herdr.startAgent=async()=>{throw Error('Unsupported model');};
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Await instructions'});
  assert.equal((await f.plane.agentSettings.details(f.task.id)).canRecover,true);
  f.plane.herdr.startAgent=start;await f.plane.agentSettings.recover(f.task.id);
  assert.equal(f.task.kind,'codex');assert.equal(f.task.model,'old-codex');assert.equal(f.task.providerSessionId,session);assert.equal(f.task.phase,'launched');assert.equal(f.task.sessionArchives.length,0);
  assert(!f.calls.some(c=>c[0]==='prompt'));assert.deepEqual(f.calls.find(c=>c[0]==='start')[4].slice(0,4),['resume',session,'--model','old-codex']);
 }finally{await f.cleanup();}
});
test('concurrent change requests start at most one replacement session',async()=>{
 const f=await fixture();try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'codex',model:'new-codex'});
  const requests=await Promise.allSettled([f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId}),f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId})]);
  assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.filter(c=>c[0]==='start').length,1);
 }finally{await f.cleanup();}
});

test('a user message already being delivered prevents switching the session underneath it',async()=>{
 const f=await fixture();let release;try{
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'sonnet'});
  const gate=new Promise(resolve=>release=resolve);f.plane.herdr.prompt=async()=>gate;
  const sending=f.plane.promptTask(f.task.id,'Keep this message in the old session');
  await assert.rejects(f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'test'}),/message is being sent/);
  release();await sending;assert.equal(f.calls.length,0);assert.equal(f.task.kind,'codex');
 }finally{release?.();await f.cleanup();}
});

test('effort-only changes resume the same conversation using provider-local arguments',async()=>{
 for(const kind of ['codex','claude']){
  const f=await fixture(kind);try{
   f.task.reportedEffort='medium';
   const preview=await f.plane.agentSettings.preview(f.task.id,{kind,model:f.task.model,effort:'high'});
   assert.equal(preview.effort,'high');assert.equal(preview.crossProvider,false);
   await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId});
   const args=f.calls.find(c=>c[0]==='start')[4];
   if(kind==='codex')assert(args.includes('model_reasoning_effort="high"'));
   else assert.equal(args[args.indexOf('--effort')+1],'high');
   assert.equal(f.task.effort,'high');assert.equal(f.task.providerSessionId,session);assert.equal(f.task.reportedEffort,undefined);
   assert(!f.calls.some(c=>c[0]==='prompt'));
  }finally{await f.cleanup();}
 }
});
test('unsupported efforts are rejected before creating or exiting a session',async()=>{
 const f=await fixture();try{
  for(const input of [{kind:'codex',model:'new-codex',effort:'ultra'},{kind:'codex',model:'unknown',effort:'high'},{kind:'claude',model:'haiku',effort:'high'},{kind:'claude',model:'opus',effort:{value:'high'}},{kind:'claude',model:'opus',effort:'high --permission-mode bypassPermissions'}]){
   await assert.rejects(f.plane.agentSettings.preview(f.task.id,input),/effort/);
  }
  assert.equal(f.calls.length,0);
  const chosen=await f.plane.agentSettings.selection({kind:'claude',model:'claude-opus-5',effort:'xhigh'});assert.equal(chosen.effort,'xhigh');
 }finally{await f.cleanup();}
});
test('inherited effort omits overrides, and failed-switch recovery restores prior effort',async()=>{
 const f=await fixture();try{
  f.task.effort='high';
  let preview=await f.plane.agentSettings.preview(f.task.id,{kind:'codex',model:f.task.model,effort:''});
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId});
  assert.equal(f.task.effort,null);assert(!f.calls.find(c=>c[0]==='start')[4].some(a=>a.includes('model_reasoning_effort')));
  preview=await f.plane.agentSettings.preview(f.task.id,{kind:'claude',model:'opus',effort:'xhigh'});
  const start=f.plane.herdr.startAgent;f.plane.herdr.startAgent=async()=>{throw Error('Model unavailable');};
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId,handoff:'Await instructions'});
  assert.equal(f.task.effort,'xhigh');f.plane.herdr.startAgent=start;
  await f.plane.agentSettings.recover(f.task.id);assert.equal(f.task.effort,null);
  assert(!f.calls.filter(c=>c[0]==='start').at(-1)[4].some(a=>a.includes('model_reasoning_effort')));
 }finally{await f.cleanup();}
});

test('reviewed native restart preserves model, effort, history and never re-prompts the agent',async()=>{
 const f=await fixture();try{
  f.task.effort='high';
  const preview=await f.plane.agentSettings.preview(f.task.id,{kind:'codex',model:'old-codex',effort:'high',restartSession:true});
  assert.equal(preview.freshSession,false);assert.equal(preview.sessionId,session);
  await f.plane.agentSettings.change(f.task.id,{previewId:preview.previewId});
  const args=f.calls.find(c=>c[0]==='start')[4];assert.deepEqual(args.slice(0,4),['resume',session,'--model','old-codex']);
  assert.equal(f.task.effort,'high');assert.equal(f.task.providerSessionId,session);assert(!f.calls.some(c=>c[0]==='prompt'));
  assert.equal(await readFile(path.join(f.task.path,'draft.txt'),'utf8'),'keep my edits');
 }finally{await f.cleanup();}
});
