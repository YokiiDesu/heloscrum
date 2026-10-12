import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ControlPlane} from '../lib/control-plane.mjs';

async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-task-test-'));const plane=await new ControlPlane(root).init();await plane.git.command(root,['init','-b','main']);await plane.git.command(root,['config','user.name','HeloScrum Test']);await plane.git.command(root,['config','user.email','test@example.invalid']);await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');await plane.git.command(root,['add','.']);await plane.git.command(root,['commit','-m','fixture']);plane.tools.codex='/fixture/codex';plane.tools.herdr='/fixture/herdr';return {root,plane};}
async function settle(plane){for(let i=0;i<100&&(plane.busy||plane.data.tasks.some(t=>t.phase==='starting'));i++)await new Promise(r=>setTimeout(r,10));assert.equal(plane.busy,false);await plane.saveQueue;}
test('dispatch joins task, worktree and agent, then persists without launching a paid agent',async()=>{
 const {root,plane}=await fixture(),calls=[];
 try{
  plane.herdr={list:async()=>[],createWorkspace:async(cwd,title)=>{calls.push(['workspace',cwd,title]);return {root_pane:{pane_id:'w-test:p1'},workspace:{workspace_id:'w-test'}};},startAgent:async(...args)=>calls.push(['start',...args]),prompt:async(...args)=>calls.push(['prompt',...args])};
  const task=await plane.createTask({title:'Test task',prompt:'Task instructions',kind:'codex',branch:'feat/task'});await settle(plane);
  assert.equal(task.phase,'launched');assert.equal(task.pane,'w-test:p1');assert.deepEqual(calls.map(c=>c[0]),['workspace','start','prompt']);assert.equal(calls[0][1],task.path);assert.equal(calls[2][1],'w-test:p1');assert.match(calls[2][2],/^Task instructions/);assert.match(calls[2][2],/work_brief/);assert(calls[1][4].includes('mcp_servers.heloscrum.enabled=true'));
  const persisted=JSON.parse(await readFile(path.join(root,'.heloscrum/state.json'),'utf8'));assert.equal(persisted.tasks[0].worktreeId,task.worktreeId);
  await assert.rejects(plane.createTask({title:'Duplicate',prompt:'Nope',kind:'codex',branch:'feat/task'}),/already uses/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('agent startup failure preserves worktree and pane for recovery without submitting the task',async()=>{
 const {root,plane}=await fixture();let prompted=false;
 try{
  plane.herdr={list:async()=>[],createWorkspace:async()=>({root_pane:{pane_id:'w-recover:p1'},workspace:{workspace_id:'w-recover'}}),startAgent:async()=>{throw Error('Authentication required');},prompt:async()=>{prompted=true;}};
  const task=await plane.createTask({title:'Recover',prompt:'Instructions',kind:'codex',branch:'feat/recover'});await settle(plane);
  assert.equal(task.phase,'setup-error');assert.equal(task.pane,'w-recover:p1');assert.match(task.error,/Authentication/);assert.equal(prompted,false);assert.equal((await plane.git.worktrees(root)).length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('manual service ownership takes precedence over stale container labels and directories',async()=>{
 const plane=new ControlPlane('/project');
 plane.data.tasks=[{id:'one',project:'/project',worktreeId:'one',pane:'pane-one',phase:'launched'},{id:'two',project:'/project',worktreeId:'two',pane:'pane-two',phase:'launched',containerIds:['container']}];
 plane.tools={};plane.git.worktrees=async()=>[{id:'one',path:'/one'},{id:'two',path:'/two'}];plane.git.status=async()=>[];plane.herdr={list:async()=>[]};plane.dockerState=async()=>({connected:true,containers:[{id:'container',taskId:'one',workingDir:'/one'}]});
 const state=await plane.snapshot();assert.equal(state.containers[0].worktreeId,'two');assert.equal(state.containers[0].ownerTaskId,'two');
});

test('four agent runtimes start concurrently while worktree setup remains serialized',async()=>{
 const {root,plane}=await fixture();const starts=[];let release;
 const gate=new Promise(resolve=>release=resolve);
 try{
  plane.herdr={list:async()=>[],createWorkspace:async(cwd)=>({root_pane:{pane_id:cwd},workspace:{workspace_id:cwd}}),startAgent:async(name)=>{starts.push(name);await gate;},prompt:async()=>{}};
  for(let i=0;i<4;i++)await plane.createTask({title:'Role '+i,prompt:'Task '+i,kind:'codex',branch:'feat/concurrent-'+i});
  for(let i=0;i<100&&starts.length<4;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(starts.length,4);assert.equal(plane.data.tasks.filter(t=>t.phase==='starting').length,4);assert.equal(plane.busy,false);
  release();await settle(plane);assert(plane.data.tasks.every(t=>t.phase==='launched'));
 }finally{release();await settle(plane);await rm(root,{recursive:true,force:true});}
});

test('contact registration failure releases the setup lock and preserves a recoverable task',async()=>{
 const {root,plane}=await fixture();
 try{
  plane.herdr={list:async()=>[]};plane.collaboration.register=async()=>{throw Error('Connection file unavailable');};
  await assert.rejects(plane.createTask({title:'Registration failure',prompt:'Task',kind:'codex',branch:'feat/registration-failure'}),/Connection file/);
  assert.equal(plane.busy,false);assert.equal(plane.data.tasks[0].phase,'setup-error');assert.equal((await plane.git.worktrees(root)).length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('recovery role starts with memory and coordination access but no registered executable tools',async()=>{
 const {root,plane}=await fixture();let prompt;
 try{
  plane.herdr={list:async()=>[],createWorkspace:async()=>({root_pane:{pane_id:'coach-pane'},workspace:{workspace_id:'coach-workspace'}}),startAgent:async()=>{},prompt:async(_,text)=>{prompt=text;}};
  await plane.collaboration.addTool({name:'deploy_fixture',description:'Must not be exposed to the coach',executable:process.execPath,args:[]},root);
  const task=await plane.createTask({title:'Help the pack recover',role:'Therapist',roleType:'recovery',summary:'Recovery plans',prompt:'Respond to support requests',kind:'codex',branch:'team/coach'});await settle(plane);
  const names=plane.collaboration.catalog(task).tools.map(t=>t.name);assert(names.includes('memory_write'));assert(names.includes('report_state'));assert(!names.includes('deploy_fixture'));assert.match(prompt,/at most three concrete next steps/);assert.match(prompt,/Report state only when intervention or recovery matters/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('retry preserves the task, contact and worktree, replaces an idle wrapped pane, and submits once',async()=>{
 const {root,plane}=await fixture();let fail=true,workspaces=0,starts=0,prompts=0;
 try{
  plane.herdr={list:async()=>[],wrappedShell:async()=>true,createWorkspace:async()=>({root_pane:{pane_id:'w'+(++workspaces)+':p1'},workspace:{workspace_id:'w'+workspaces}}),startAgent:async()=>{starts++;if(fail)throw Object.assign(Error('unavailable shell'),{code:'agent_pane_busy'});},prompt:async()=>{prompts++;}};
  const task=await plane.createTask({title:'Recover',prompt:'Original prompt',kind:'codex',branch:'feat/retry'});await settle(plane);
  assert(plane.canRetryStart(task));assert(!task.error.startsWith('{'));assert.equal(prompts,0);
  await assert.rejects(plane.promptTask(task.id,'Do not run this in a shell'),/not running/);
  const original={worktreeId:task.worktreeId,path:task.path,name:task.name,credential:plane.collaboration.data.credentials[task.id],revision:plane.collaboration.data.revision};
  fail=false;const retry=plane.retryTask(task.id);await assert.rejects(plane.retryTask(task.id),/cannot be safely retried/);await retry;await settle(plane);
  assert.equal(task.phase,'launched');assert.equal(prompts,1);assert.equal(starts,2);assert.equal(workspaces,2);assert.equal(task.previousPanes[0].pane,'w1:p1');
  assert.deepEqual({worktreeId:task.worktreeId,path:task.path,name:task.name,credential:plane.collaboration.data.credentials[task.id],revision:plane.collaboration.data.revision},original);
  assert.equal((await plane.git.worktrees(root)).length,2);assert.equal(plane.data.tasks.length,1);await assert.rejects(plane.retryTask(task.id),/cannot be safely retried/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('retry reuses a normal pane and refuses existing agents or uncertain prompt delivery',async()=>{
 const {root,plane}=await fixture();let fail=true,prompts=0,workspaces=0,live=[];
 try{
  plane.herdr={list:async()=>live,wrappedShell:async()=>false,createWorkspace:async()=>{workspaces++;return {root_pane:{pane_id:'w:p1'},workspace:{workspace_id:'w'}};},startAgent:async()=>{if(fail)throw Object.assign(Error('busy'),{code:'agent_pane_busy'});},prompt:async()=>{prompts++;throw Object.assign(Error('Delivery uncertain'),{code:'agent_pane_busy'});}};
  const task=await plane.createTask({title:'Recovery checks',prompt:'Original task',kind:'codex',branch:'feat/checks'});await settle(plane);
  live=[{pane_id:task.pane,name:task.name}];await assert.rejects(plane.retryTask(task.id),/already exists/);assert.equal(prompts,0);
  live=[];fail=false;await plane.retryTask(task.id);await settle(plane);assert.equal(workspaces,1);assert.equal(prompts,1);assert.equal(plane.canRetryStart(task),false);await assert.rejects(plane.retryTask(task.id),/cannot be safely retried/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('legacy persisted Herdr JSON errors become readable and retryable on load',async()=>{
 const {root,plane}=await fixture();
 try{
  plane.data.tasks.push({id:'legacy',project:root,phase:'setup-error',pane:'w:p1',error:JSON.stringify({error:{code:'agent_pane_busy',message:'not an available shell'}})});await plane.save();
  const loaded=await new ControlPlane(root).init(),task=loaded.task('legacy');assert.equal(task.errorCode,'agent_pane_busy');assert.match(task.error,/Retry start/);assert(loaded.canRetryStart(task));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('provider setup retains the original prompt until ready, including across restart, then dispatches only once',async()=>{
 const {root,plane}=await fixture();let prompts=0;
 try{
  plane.herdr={list:async()=>[],createWorkspace:async()=>({root_pane:{pane_id:'setup:p1'},workspace:{workspace_id:'setup'}}),startAgent:async()=>{throw Object.assign(Error('Trust this folder'),{code:'agent_not_ready'});},prompt:async()=>{prompts++;}};
  const task=await plane.createTask({title:'Provider setup',prompt:'Keep the original brief',kind:'codex',branch:'feat/provider-setup'});await settle(plane);
  assert.equal(task.phase,'awaiting-setup');assert.equal(prompts,0);assert.equal(plane.canRetryStart(task),false);
  await assert.rejects(plane.promptTask(task.id,'Override'),/provider setup/);
  const resumed=await new ControlPlane(root).init(),saved=resumed.task(task.id);let status='blocked',ready=false,received;
  resumed.herdr={list:async()=>[{pane_id:saved.pane,name:saved.name,agent:saved.kind,interactive_ready:ready,agent_status:status}],prompt:async(_,text)=>{prompts++;received=text;}};
  await resumed.resumePendingStarts();assert.equal(prompts,0);assert.equal(saved.phase,'awaiting-setup');
  ready=true;status='idle';await Promise.all([resumed.resumePendingStarts(),resumed.resumePendingStarts()]);await resumed.resumePendingStarts();
  assert.equal(prompts,1);assert.match(received,/^Keep the original brief/);assert.equal(saved.phase,'launched');assert.equal(saved.error,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a timed-out startup recovers the unnamed ready agent in its exact worktree without replay',async()=>{
 const {root,plane}=await fixture();let prompts=0;
 try{
  plane.herdr={list:async()=>[],createWorkspace:async()=>({root_pane:{pane_id:'slow:p1'},workspace:{workspace_id:'slow'}}),startAgent:async()=>{throw Object.assign(Error('timed out waiting for agent startup'),{code:'timeout'});},prompt:async()=>{prompts++;}};
  const task=await plane.createTask({title:'Slow startup',prompt:'Initial task only',kind:'codex',branch:'feat/slow'});await settle(plane);
  assert.equal(task.phase,'awaiting-setup');assert.equal(prompts,0);assert.match(task.error,/still queued/);
  // Also migrate the older persisted state that stranded the real session.
  task.phase='setup-error';task.error='timed out waiting for agent startup';await plane.save();
  const loaded=await new ControlPlane(root).init(),saved=loaded.task(task.id);assert.equal(saved.phase,'awaiting-setup');
  const live={pane_id:saved.pane,agent:'codex',cwd:saved.path,interactive_ready:true,agent_status:'idle'};
  loaded.herdr={list:async()=>[live],prompt:async(pane,text)=>{assert.equal(pane,saved.pane);assert.match(text,/^Initial task only/);prompts++;}};
  for(const patch of [{cwd:root},{agent:'claude'},{name:'other-agent'},{interactive_ready:false},{agent_status:'blocked'}]){
   const original={...live};Object.assign(live,patch);await loaded.resumePendingStarts();assert.equal(prompts,0);for(const key of Object.keys(live))delete live[key];Object.assign(live,original);
  }
  await Promise.all([loaded.resumePendingStarts(),loaded.resumePendingStarts()]);await loaded.resumePendingStarts();
  assert.equal(prompts,1);assert.equal(saved.phase,'launched');assert(saved.promptAttemptedAt);assert.equal(saved.error,undefined);
  await loaded.startupFailed(saved,Object.assign(Error('timed out waiting for agent startup'),{code:'timeout'}));
  await loaded.resumePendingStarts();assert.equal(prompts,1);assert.equal(saved.phase,'setup-error');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('new tasks validate effort before worktree creation and persist the launch choice',async()=>{
 const {root,plane}=await fixture(),calls=[];try{
  plane.agentSettings.cached={at:Date.now(),value:{providers:[{id:'codex',installed:true,models:[{id:'test-model',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}]}};
  plane.herdr={list:async()=>[],createWorkspace:async()=>({root_pane:{pane_id:'effort-pane'},workspace:{workspace_id:'effort-workspace'}}),startAgent:async(...args)=>calls.push(args),prompt:async()=>{}};
  const input={title:'Effort',prompt:'Task instructions',kind:'codex',model:'test-model',branch:'test/effort',effort:'ultra'};
  await assert.rejects(plane.createTask(input),/effort/);assert.equal((await plane.git.worktrees(root)).length,1);assert.equal(plane.data.tasks.length,0);assert.equal(plane.busy,false);
  const task=await plane.createTask({...input,effort:'high'});await settle(plane);
  assert(calls[0][3].includes('model_reasoning_effort="high"'));assert.equal(task.effort,'high');
  assert.equal(JSON.parse(await readFile(path.join(root,'.heloscrum/state.json'),'utf8')).tasks[0].effort,'high');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('workspace sound progress includes task and plan transitions only for the selected project',async()=>{
  const {WorkspaceSoundObserver}=await import('../dist/preferences.js');
  const plane=new ControlPlane('/project'),heard=[],observer=new WorkspaceSoundObserver(cue=>heard.push(cue));
  plane.tools={};plane.git.worktrees=async()=>[];plane.herdr={list:async()=>[]};plane.dockerState=async()=>({connected:true,containers:[]});
  const plan={id:'plan',project:'/project',kind:'plan',status:'active',revision:1,items:[{id:'item',status:'needs_review',note:'Private evidence'}]};
  plane.data.workPlans=[plan,{...plan,id:'other',project:'/other'}];
  const state=await plane.snapshot();observer.observe(state);
  assert.equal(state.work.plans.length,1);assert.equal(state.work.plans[0].items[0].note,undefined,'progress does not duplicate task prose');
  plan.items[0].status='done';plan.revision++;observer.observe(await plane.snapshot());
  plan.status='completed';plan.revision++;observer.observe(await plane.snapshot());observer.observe(await plane.snapshot());
  assert.deepEqual(heard,['complete','plan-complete']);
});
