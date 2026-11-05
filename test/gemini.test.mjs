import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,readFile,rm,writeFile,chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GeminiClient,GeminiEvents,geminiArgs,geminiPermission,geminiUsage,geminiCommands} from '../lib/gemini.mjs';
import {ManagedAgents,withManagedAgents} from '../lib/managed-agents.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {providerIds,cliProviderIds,nativeProviderIds,managedProvider,providerName} from '../lib/providers.mjs';
import {NativeSetup,nativeSelection} from '../lib/native-setup.mjs';
import {AgentSettings} from '../lib/agent-settings.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';
import {automaticChoice} from '../lib/tool-approvals.mjs';
import {run} from '../lib/adapters.mjs';
import {GeminiControls} from '../lib/gemini-controls.mjs';
import {WorkManagement} from '../lib/work-management.mjs';
import {NativeCommands} from '../lib/native-commands.mjs';
import {editDiffHTML} from '../dist/diff-view.js';
import {geminiUsageHTML,planTaskTitles} from '../dist/gemini-controls.js';

function mockGemini({onPrompt,onRequest,loadSession=true,initError}={}){
  const sessionId=randomUUID(),calls=[],children=[],modes={currentModeId:'default',availableModes:[{id:'default',name:'Default'},{id:'plan',name:'Plan'}]};
  const spawnProcess=(executable,args,options)=>{
    const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});children.push(child);
    child.kill=signal=>{child.signal=signal;child.emit('close',null);};let buffer='';
    const send=row=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',...row})+'\n');
    const update=value=>send({method:'session/update',params:{sessionId,update:value}});
    child.stdin.setEncoding('utf8');child.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);calls.push(row);queueMicrotask(()=>{
      if(onRequest?.(row,{child,send,update,sessionId}))return;
      if(row.method==='initialize')send(initError?{id:row.id,error:{code:-32000,message:'Sign in required'}}:{id:row.id,result:{protocolVersion:1,agentCapabilities:{loadSession,promptCapabilities:{image:true}}}});
      else if(row.method==='session/new')send({id:row.id,result:{sessionId,modes,models:{currentModelId:'observed-model'}}});
      else if(row.method==='session/load'){assert.equal(row.params.sessionId,sessionId);update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'REPLAY'}});send({id:row.id,result:{modes,models:{currentModelId:'observed-model'}}});setTimeout(()=>{update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'DELAYED_REPLAY'}});update({sessionUpdate:'available_commands_update',availableCommands:[]});},20);}
      else if(row.method==='session/set_mode'){modes.currentModeId=row.params.modeId;send({id:row.id,result:{}});}
      else if(row.method==='session/set_model')send({id:row.id,result:{}});
      else if(row.method==='session/prompt'){
        if(onPrompt)onPrompt(row,{child,send,update,sessionId});
        else{update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Hello'}});send({id:row.id,result:{stopReason:'end_turn',usage:{inputTokens:4,outputTokens:2,totalTokens:6}}});}
      }else if(row.method==='session/cancel'){
        const prompt=calls.findLast(r=>r.method==='session/prompt');send({id:prompt.id,result:{stopReason:'cancelled'}});
      }
    });}});
    child.invocation={executable,args,options};return child;
  };
  return {sessionId,calls,children,spawnProcess};
}
async function fixture(t,mock=mockGemini()){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-gemini-')),repo=path.join(root,'repo');await mkdir(repo);
  const task={id:randomUUID(),kind:'gemini',path:repo,project:repo,model:'chosen-model',name:'gemini-test',role:'Tester',prompt:'Check the fixture'};
  const plane={root,data:{tasks:[task]},tools:{gemini:'/mock/gemini'},save:async()=>{},transcripts:{cache:new Map()},collaboration:{mcpServer:()=>({command:'/node',args:['bridge','private-connection.json']}),connections:new Map()}};
  plane.managed=new ManagedAgents(plane,{spawnProcess:mock.spawnProcess});
  t.after(async()=>{await plane.managed.close();await rm(root,{recursive:true,force:true});});
  return {root,task,plane,mock};
}
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for fixture state');}

test('Gemini is a managed CLI with explicit model overrides and normal approval mode',()=>{
  assert(providerIds.includes('gemini'));assert(cliProviderIds.includes('gemini'));assert(!nativeProviderIds.includes('gemini'));assert(managedProvider('gemini'));assert(managedProvider({kind:'gemini'}));assert.equal(providerName('gemini'),'Gemini CLI');
  assert.deepEqual(geminiArgs({model:'gemini-test'}),['--acp','--approval-mode','default','--model','gemini-test']);
  assert.deepEqual(geminiArgs({}),['--acp','--approval-mode','default']);
});
test('Gemini launch passes a private MCP bridge without editing provider configuration',async t=>{
  const f=await fixture(t);f.plane.collaboration=new Collaboration(f.plane);await mkdir(path.join(f.task.path,'.gemini'));const file=path.join(f.task.path,'.gemini/settings.json');const original=JSON.stringify({mcpServers:{other:{command:'keep'}}});await writeFile(file,original);
  assert.deepEqual(await f.plane.collaboration.register(f.task),[]);
  assert.equal(await readFile(file,'utf8'),original);
  const server=f.plane.collaboration.mcpServer(f.task);assert.equal(server.command,process.execPath);assert(server.args[0].endsWith('mcp-bridge.mjs'));
  const connection=JSON.parse(await readFile(server.args[1],'utf8'));assert.equal(connection.taskId,f.task.id);assert.equal(connection.token,f.plane.collaboration.data.credentials[f.task.id]);
});
test('Gemini streams UTF-8 chunks, merges partial tool updates and retains measured usage',async t=>{
  const mock=mockGemini({onPrompt:(row,{child,sessionId,send})=>{
    const updates=[{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Check result',signature:'PRIVATE'}},{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'模型 '}},{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ready'}},{sessionUpdate:'tool_call',toolCallId:'read-1',title:'Read README',rawInput:{path:'README.md'},status:'in_progress'},{sessionUpdate:'tool_call_update',toolCallId:'read-1',status:'completed',content:[{type:'content',content:{type:'text',text:'hello'}}]},{sessionUpdate:'usage_update',used:6,size:1000000}];
    const bytes=Buffer.from(updates.map(update=>JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId,update}})).join('\n')+'\n');for(const byte of bytes)child.stdout.write(Buffer.from([byte]));
    send({id:row.id,result:{stopReason:'end_turn',usage:{inputTokens:4,outputTokens:2,totalTokens:6},_meta:{quota:{model_usage:[{model:'observed-model'}]}}}});
  }}),f=await fixture(t,mock),s=await f.plane.managed.start(f.task);
  await f.plane.managed.prompt(f.task.pane,'Read');await s.running;
  assert.equal(s.status,'done');assert.equal(s.events.filter(e=>e.role==='assistant').length,1);assert.equal(s.events.find(e=>e.role==='assistant').text,'模型 ready');
  const tool=s.events.find(e=>e.type==='tool');assert.equal(tool.status,'completed');assert.equal(tool.name,'Read README');assert.equal(tool.output,'hello');assert.match(tool.input,/README/);assert.doesNotMatch(JSON.stringify(s.events),/PRIVATE/);
  assert.equal(s.usageRecords[0].usage.totalTokens,6);assert.equal(s.usageRecords[0].contextUsage.size,1000000);assert.equal(s.usageRecords[0].providerResult._meta.quota.model_usage[0].model,'observed-model');
  assert.equal(f.task.providerSessionId,mock.sessionId);assert.equal(f.task.reportedModel,'observed-model');assert.match((await f.plane.managed.transcript(f.task)).source,/Gemini/);
  assert.equal(mock.children[0].invocation.options.cwd,f.task.path);assert.equal(mock.calls.find(r=>r.method==='session/new').params.mcpServers[0].name,'heloscrum');
});
test('Gemini retains the exact session after exit and restart without replaying history or the task',async t=>{
  const f=await fixture(t),s=await f.plane.managed.start(f.task);await f.plane.managed.prompt(f.task.pane,'First');await s.running;
  await f.plane.managed.exit(f.task.pane);f.task.resumeOnly=true;const resumed=await f.plane.managed.start(f.task);
  assert.equal(resumed.id,s.id);assert.equal(f.mock.calls.filter(r=>r.method==='session/new').length,1);assert.equal(f.mock.calls.filter(r=>r.method==='session/prompt').length,1);
  assert(!resumed.events.some(e=>['REPLAY','DELAYED_REPLAY'].includes(e.text)));await f.plane.managed.prompt(f.task.pane,'Second');await resumed.running;
  assert.equal(resumed.events.filter(e=>e.text==='Hello').length,2);assert.equal(resumed.usageRecords.length,2);
  const proxy=withManagedAgents({list:async()=>{throw Error('Herdr offline');}},f.plane.managed);assert.equal((await proxy.list())[0].agent,'gemini');
});
const permission={toolCall:{toolCallId:'shell-1',title:'Run echo hello',kind:'execute',rawInput:{command:'echo hello'}},options:[{optionId:'once',kind:'allow_once',name:'Allow this command'},{optionId:'reject',kind:'reject_once',name:'Deny this command'}]};
test('Gemini approvals require an offered choice and current fingerprint, then send the provider option ID',async t=>{
  let reply;const mock=mockGemini({onPrompt:(row,{send,sessionId})=>send({id:'permission-1',method:'session/request_permission',params:{sessionId,...permission}}),onRequest:(row,{send})=>{if(row.id==='permission-1'){reply=row.result;const prompt=mock.calls.findLast(r=>r.method==='session/prompt');send({id:prompt.id,result:{stopReason:'end_turn'}});return true;}}});
  const f=await fixture(t,mock),s=await f.plane.managed.start(f.task);await f.plane.managed.prompt(f.task.pane,'Run');await until(()=>s.status==='blocked');
  const current=f.plane.managed.request(f.task.pane);assert.equal(current.request.tool.name,'shell');assert.throws(()=>f.plane.managed.choose(f.task.pane,'once','stale'),/changed/);assert.throws(()=>f.plane.managed.choose(f.task.pane,'invented',current.fingerprint),/offered/);assert.equal(reply,undefined);
  f.plane.managed.choose(f.task.pane,'reject',current.fingerprint);await s.running;assert.deepEqual(reply,{outcome:{outcome:'selected',optionId:'reject'}});assert.equal(f.plane.managed.request(f.task.pane).pending,false);
});
test('interrupt cancels a pending Gemini approval and preserves completed transcript records',async t=>{
  let reply;const mock=mockGemini({onPrompt:(row,{send,sessionId})=>send({id:'permission-1',method:'session/request_permission',params:{sessionId,...permission}}),onRequest:row=>{if(row.id==='permission-1'){reply=row.result;return true;}}});
  const f=await fixture(t,mock),s=await f.plane.managed.start(f.task);await f.plane.managed.prompt(f.task.pane,'Run');await until(()=>s.status==='blocked');
  await f.plane.managed.interrupt(f.task.pane);assert.equal(s.status,'idle');assert.deepEqual(reply,{outcome:{outcome:'cancelled'}});assert.equal(f.plane.managed.request(f.task.pane).pending,false);assert.match(s.events.at(-1).text,/interrupted/);assert(mock.calls.some(r=>r.method==='session/cancel'));
});
test('Gemini sends authorized images as ACP image blocks',async t=>{
  const f=await fixture(t);f.plane.images={validateModel:()=>{},readFor:async(task,id)=>{assert.equal(task,f.task);assert.equal(id,'image');return {mimeType:'image/png',base64:'YWJj'};}};
  const s=await f.plane.managed.start(f.task);await f.plane.managed.prompt(f.task.pane,'Inspect',{attachments:[{id:'image',kind:'image'}]});await s.running;
  assert.deepEqual(f.mock.calls.find(r=>r.method==='session/prompt').params.prompt,[{type:'text',text:'Inspect'},{type:'image',mimeType:'image/png',data:'YWJj'}]);
});
test('Gemini process failure clears its approval and reconnects to the saved session on the next prompt',async t=>{
  let turns=0;const mock=mockGemini({onPrompt:(row,{send,sessionId,update})=>{
    if(++turns===1)send({id:'permission-1',method:'session/request_permission',params:{sessionId,...permission}});
    else{update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Recovered'}});send({id:row.id,result:{stopReason:'end_turn'}});}
  }}),f=await fixture(t,mock),s=await f.plane.managed.start(f.task);
  await f.plane.managed.prompt(f.task.pane,'First');await until(()=>s.status==='blocked');mock.children[0].emit('close',1);await s.running;
  assert.equal(s.status,'idle');assert.equal(f.plane.managed.request(f.task.pane).pending,false);assert.match(s.events.at(-1).text,/exited/);
  await f.plane.managed.prompt(f.task.pane,'Continue');await s.running;assert.equal(s.status,'done');assert.equal(s.events.at(-1).text,'Recovered');assert.equal(mock.calls.filter(r=>r.method==='session/new').length,1);assert.equal(mock.calls.filter(r=>r.method==='session/load').length,1);
});
test('Gemini interruption stops an unresponsive turn and settles its promise',async t=>{
  const mock=mockGemini({onPrompt:()=>{},onRequest:row=>row.method==='session/cancel'}),f=await fixture(t,mock),s=await f.plane.managed.start(f.task);
  await f.plane.managed.prompt(f.task.pane,'Wait');await f.plane.managed.interrupt(f.task.pane);
  assert.equal(s.status,'idle');assert.equal(mock.children[0].signal,'SIGTERM');assert.match(s.events.at(-1).text,/interrupted/);
});
test('Gemini refuses missing resume capability and reports authentication errors without starting a new session',async t=>{
  const f=await fixture(t,mockGemini({loadSession:false})),client=new GeminiClient({executable:'/mock',task:f.task,spawnProcess:f.mock.spawnProcess});
  await assert.rejects(client.start(f.mock.sessionId),/cannot load/);assert(!f.mock.calls.some(r=>r.method==='session/new'));assert(f.mock.children[0].signal);
  const auth=mockGemini({initError:true}),bad=new GeminiClient({executable:'/mock',task:f.task,spawnProcess:auth.spawnProcess});await assert.rejects(bad.start(),/finish signing in/);assert(auth.children[0].signal);
  assert(ControlPlane.prototype.canRetryStart({kind:'gemini',phase:'setup-error'}));assert(!ControlPlane.prototype.canRetryStart({kind:'gemini',phase:'setup-error',promptAttemptedAt:'now'}));
});
test('Gemini rejects oversized, malformed and mismatched session events, and times out stalled setup',async t=>{
  const f=await fixture(t);
  for(const fault of ['bad-json','null','oversized','identity']){
    const mock=mockGemini({onPrompt:(row,{child,send})=>{if(fault==='bad-json')child.stdout.write('not json\n');else if(fault==='null')child.stdout.write('null\n');else if(fault==='oversized')child.stdout.write('x'.repeat(2*1024*1024+1));else send({method:'session/update',params:{sessionId:randomUUID(),update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'WRONG'}}}});}});
    const client=new GeminiClient({executable:'/mock',task:f.task,spawnProcess:mock.spawnProcess});await client.start();await assert.rejects(client.prompt([{type:'text',text:'test'}],new AbortController().signal),/invalid ACP (?:JSON|message)|size limit|identity changed/);assert(client.failure);
  }
  const mock=mockGemini({onRequest:()=>true}),client=new GeminiClient({executable:'/mock',task:f.task,spawnProcess:mock.spawnProcess,timeout:10});await assert.rejects(client.start(),/timed out/);
});
test('Gemini tool permissions retain edit previews and scope MCP approval rules',()=>{
  const request=geminiPermission({...permission,toolCall:{...permission.toolCall,content:[{type:'diff',path:'a.txt',oldText:'before',newText:'after'}],_meta:{'gemini-cli':{mcp:{server_name:'heloscrum',tool_name:'invoke_tool'}}},rawInput:{name:'allowed'}}});
  assert.match(request.details,/Before\nbefore\n\+\+\+ After\nafter/);assert.equal(request.tool.server,'heloscrum');
  const task={toolPolicy:{approvals:{shared:{default:'ask',tools:{allowed:'allow'}},native:{default:'ask',tools:{}}}}},collab={rawCatalog:()=>({tools:[{name:'allowed'}]}),allowed:()=>true};assert.equal(automaticChoice(task,request,collab).choice,'once');
  assert.throws(()=>geminiPermission({...permission,options:[permission.options[0],permission.options[0]]}),/Invalid/);
  const reducer=new GeminiEvents();assert.equal(reducer.update({sessionUpdate:'available_commands_update'}),null);
});
test('Gemini discovers only supported configuration and preserves settings while copying',async t=>{
  const f=await fixture(t);await run('git',['init','-q'],{cwd:f.task.project});await mkdir(path.join(f.task.project,'.gemini'));await writeFile(path.join(f.task.project,'.gemini/settings.json'),'{}');await writeFile(path.join(f.task.project,'GEMINI.md'),'Project guidance');await writeFile(path.join(f.task.project,'.gemini/oauth_creds.json'),'PRIVATE');
  const native=new NativeSetup(f.plane,{home:f.root}),files=await native.files('gemini',f.task.project);assert.deepEqual(files.files.map(f=>f.path),['.gemini/settings.json','GEMINI.md']);assert.doesNotMatch(JSON.stringify(files),/PRIVATE/);
  assert.throws(()=>nativeSelection('gemini',{profile:'user:custom'}),/without a named profile/);assert.throws(()=>nativeSelection('gemini',{files:['.gemini/oauth_creds.json']}),/supported/);
  f.task.path=path.join(f.root,'worktree');await mkdir(f.task.path);await run('git',['init','-q'],{cwd:f.task.path});f.task.nativeSetup={files:['.gemini/settings.json','GEMINI.md']};await native.prepare(f.task);assert.equal(await readFile(path.join(f.task.path,'GEMINI.md'),'utf8'),'Project guidance');
  const settings=new AgentSettings(f.plane);assert.equal((await settings.provider('gemini',{quick:true})).label,'Gemini CLI');await assert.rejects(settings.validateEffort('gemini','exact','high'),/not supported/);
});
test('Gemini task creation, model switching and restart resume use the managed lifecycle without Herdr',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-gemini-lifecycle-')),plane=await new ControlPlane(root).init(),mock=mockGemini();
  t.after(async()=>{await plane.managed.close();plane.transcripts.close();await plane.mcp.close();await plane.saveQueue;await rm(root,{recursive:true,force:true});});
  for(const args of [['init','-q'],['config','user.name','Test'],['config','user.email','test@example.invalid']])await plane.git.command(root,args);
  await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');await writeFile(path.join(root,'README.md'),'Gemini fixture');await plane.git.command(root,['add','.']);await plane.git.command(root,['commit','-qm','fixture']);
  plane.projects.remember(root);plane.tools.gemini='/mock/gemini';plane.tools.herdr=null;plane.managed=new ManagedAgents(plane,{spawnProcess:mock.spawnProcess});plane.herdr=withManagedAgents({list:async()=>{throw Error('Herdr offline');}},plane.managed);
  plane.agentSettings.providerCache.set('gemini',{at:Date.now(),value:{id:'gemini',label:'Gemini CLI',installed:true,models:[]}});
  const task=await plane.createTask({kind:'gemini',title:'Gemini fixture',prompt:'Check this repository',branch:'test/gemini',model:'first-model'});await until(()=>task.phase==='launched');const first=plane.managed.get(task.pane);await first.running;
  assert.notEqual(task.path,root);assert.equal(task.workspace,null);assert.equal(first.status,'done');assert.equal(mock.calls.filter(r=>r.method==='session/prompt').length,1);assert.match(first.events[0].text,/Check this repository/);
  const preview=await plane.agentSettings.preview(task.id,{kind:'gemini',model:'second-model'});assert.equal(preview.freshSession,false);await plane.agentSettings.change(task.id,{previewId:preview.previewId});
  assert.equal(task.providerSessionId,mock.sessionId);assert.equal(task.model,'second-model');assert.equal(mock.calls.filter(r=>r.method==='session/prompt').length,1);assert(mock.calls.some(r=>r.method==='session/set_model'&&r.params.modelId==='second-model'));
  await plane.managed.close();plane.managed=new ManagedAgents(plane,{spawnProcess:mock.spawnProcess});plane.herdr=withManagedAgents({list:async()=>{throw Error('Herdr offline');}},plane.managed);task.resumeOnly=true;await plane.launch(task);
  assert.equal(task.phase,'launched');assert.equal((await plane.transcripts.readCurrent(task)).events.filter(e=>e.text==='Hello').length,1);assert.equal(mock.calls.filter(r=>r.method==='session/prompt').length,1);
});
test('Gemini catalog reads the installed CLI JSON format without inventing models or effort levels',async t=>{
  const f=await fixture(t),executable=path.join(f.root,'gemini-fixture.mjs');
  await writeFile(executable,`#!${process.execPath}\nimport assert from 'node:assert/strict';assert.deepEqual(process.argv.slice(2),['models','--output-format','json']);console.log(JSON.stringify([{id:'exact-model',modelId:'exact-model',displayName:'Exact model',contextLimits:{inputTokens:1000000}}]));\n`);await chmod(executable,0o700);f.plane.tools.gemini=executable;
  const settings=new AgentSettings(f.plane),catalog=await settings.provider('gemini');assert.deepEqual(catalog.models,[{id:'exact-model',label:'Exact model'}]);assert.equal(catalog.effortLevels,undefined);assert.equal(catalog.error,undefined);
});

async function controlsFixture(t,mock){
  const f=await fixture(t,mock),p=f.plane;p.task=id=>{assert.equal(id,f.task.id);return f.task;};p.projects={project:project=>project};p.collaboration.delivering=new Set();p.collaboration.data={messages:[]};p.agentSettings={changing:new Set()};p.record=async()=>{};p.work=new WorkManagement(p);p.gemini=new GeminiControls(p);p.herdr=withManagedAgents({list:async()=>[]},p.managed);f.task.phase='launched';f.task.title='Plan fixture';
  f.s=await p.managed.start(f.task);return f;
}
test('Gemini metadata arrives before startup and while idle without becoming transcript text',async t=>{
  let update;const f=await controlsFixture(t,mockGemini({onRequest:(row,io)=>{update=io.update;if(row.method==='session/new')io.update({sessionUpdate:'available_commands_update',availableCommands:[{name:'help',description:'Help'}]});}}));
  assert.deepEqual(f.s.geminiState.commands.map(c=>c.name),['/help']);assert.equal(f.s.events.length,0);
  update({sessionUpdate:'usage_update',used:250,size:1000});update({sessionUpdate:'available_commands_update',availableCommands:[{name:'memory:show',description:'Show memory'}]});await f.s.geminiEvents;
  assert.equal((await f.plane.gemini.inspect(f.task.id)).usage.context.percent,25);assert.equal(f.s.geminiState.commands[0].name,'/memory:show');assert.equal(f.s.events.length,0);
  const saved=await f.plane.managed.load(f.task);assert.equal(saved.geminiState.context.used,250);
});
test('Gemini mode changes require the current idle session and advertised mode, and resume retains planning mode',async t=>{
  const f=await controlsFixture(t),report=await f.plane.gemini.inspect(f.task.id);
  await assert.rejects(f.plane.gemini.mode(f.task.id,{expected:'old',modeId:'plan'}),/changed/);
  await assert.rejects(f.plane.gemini.mode(f.task.id,{expected:report.expected,modeId:'invented'}),/advertised/);
  f.s.status='working';await assert.rejects(f.plane.gemini.mode(f.task.id,{expected:report.expected,modeId:'plan'}),/finish/);f.s.status='idle';
  await f.plane.gemini.mode(f.task.id,{expected:report.expected,modeId:'plan'});assert.equal(f.s.geminiState.currentModeId,'plan');assert.equal(f.s.status,'idle');
  await assert.rejects(f.plane.gemini.mode(f.task.id,{expected:report.expected,modeId:'default'}),/changed/);
  await f.plane.managed.exit(f.task.pane);f.task.resumeOnly=true;const s=await f.plane.managed.start(f.task);assert.equal(s.geminiState.currentModeId,'plan');
  assert.deepEqual(geminiArgs({nativeSetup:{geminiMode:'plan'}}),['--acp','--approval-mode','plan']);assert.equal(nativeSelection('gemini',{geminiMode:'plan'}).geminiMode,'plan');assert.throws(()=>nativeSelection('gemini',{geminiMode:'yolo'}),/default or plan/);
});
test('reviewed Gemini plans become assigned drafts without starting agents, duplicates or trusting completion claims',async t=>{
  const f=await controlsFixture(t);await f.plane.managed.geminiMetadata(f.s,{sessionUpdate:'plan',entries:[{content:'Add adapter',status:'completed',priority:'high'}]});const report=await f.plane.gemini.inspect(f.task.id);
  const input={sessionId:f.s.id,expectedPlan:report.plan.expected,title:'Reviewed adapter plan',planText:report.plan.text,items:['Add reviewed adapter'],ownerId:f.task.id};
  await assert.rejects(f.plane.gemini.importPlan(f.task.id,{...input,sessionId:randomUUID()}),/session changed/);
  await assert.rejects(f.plane.gemini.importPlan(f.task.id,{...input,ownerId:randomUUID()}),/active sessions/);
  const result=await f.plane.gemini.importPlan(f.task.id,input),plan=f.plane.work.detail(f.plane.work.human(f.task.project),result.planId);
  assert.equal(plan.status,'draft');assert.equal(plan.changePolicy,'review');assert.equal(plan.items[0].ownerId,f.task.id);assert.equal(plan.items[0].status,'todo');assert.equal(plan.outbox.length,0);assert.equal(f.plane.collaboration.data.messages.length,0);assert.match(plan.planText,/Source: Gemini CLI session/);assert.equal(f.mock.calls.filter(c=>c.method==='session/prompt').length,0);
  assert.equal((await f.plane.gemini.importPlan(f.task.id,input)).planId,result.planId);assert.equal(f.plane.data.workPlans.length,1);
  assert.throws(()=>f.plane.work.available({id:f.task.id,project:f.task.project},result.planId),/not available/);
  await f.plane.managed.geminiMetadata(f.s,{sessionUpdate:'plan',entries:[{content:'Changed plan',status:'pending'}]});await assert.rejects(f.plane.gemini.importPlan(f.task.id,input),/plan changed/);
});
test('Gemini plan mode captures the completed response and preserves newer structured tasks',async t=>{
  const mock=mockGemini({onPrompt:(row,{send,update})=>{update({sessionUpdate:'plan',entries:[{content:'Build A',status:'pending'}]});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'# Plan\n- Build A\n- Verify A'}});send({id:row.id,result:{stopReason:'end_turn'}});}}),f=await controlsFixture(t,mock);
  const report=await f.plane.gemini.inspect(f.task.id);await f.plane.gemini.mode(f.task.id,{expected:report.expected,modeId:'plan'});await f.plane.managed.prompt(f.task.pane,'Plan only');await f.s.running;
  const result=await f.plane.gemini.inspect(f.task.id);assert.match(result.plan.text,/# Plan/);assert.equal(result.plan.entries[0].content,'Build A');assert.equal(result.usage.turns,1);assert.equal(result.usage.measuredTurns,0);assert.equal(result.usage.totalTokens,null);
});
test('Gemini commands use only the session advertised catalog, preserve literal arguments and reject stale or busy delivery',async t=>{
  const f=await controlsFixture(t),commands=new NativeCommands(f.plane);await f.plane.managed.geminiMetadata(f.s,{sessionUpdate:'available_commands_update',availableCommands:[{name:'help',description:'Help'}]});const report=await commands.inspect(f.task.id);
  assert(report.ready);assert.equal(report.transport,'acp');await assert.rejects(commands.run(f.task.id,{name:'/model',requestId:randomUUID(),expected:report.expected}),/library/);
  const input={name:'/help',args:'literal $HOME',requestId:randomUUID(),expected:report.expected};const sent=await commands.run(f.task.id,input);await f.s.running;assert.equal(f.mock.calls.findLast(c=>c.method==='session/prompt').params.prompt[0].text,'/help literal $HOME');assert.deepEqual(await commands.run(f.task.id,input),sent);
  await f.plane.managed.geminiMetadata(f.s,{sessionUpdate:'available_commands_update',availableCommands:[{name:'help',description:'New help'},{name:'memory:show',description:'Memory'}]});await assert.rejects(commands.run(f.task.id,{...input,requestId:randomUUID()}),/session changed/);
  f.s.status='blocked';assert.equal((await commands.inspect(f.task.id)).ready,false);f.s.status='idle';
});
test('Gemini usage separates context, measured totals and unknown fields; edits preserve complete escaped text',()=>{
  const records=[{purpose:'agent',usage:{inputTokens:10,outputTokens:2,totalTokens:12,cachedReadTokens:4}},{purpose:'agent',usage:{inputTokens:20,outputTokens:3,totalTokens:23}},{purpose:'agent',usage:null}];
  const u=geminiUsage(records,{used:500,size:1000});assert.equal(u.totalTokens,35);assert.equal(u.turns,3);assert.equal(u.measuredTurns,2);assert.equal(u.cachedReadTokens,null);assert.equal(u.context.percent,50);assert.equal(geminiUsage([]).totalTokens,null);assert.equal(geminiUsage([],{used:0,size:0}).context,null);
  assert.match(geminiUsageHTML(u),/2 measured \/ 3/);assert.match(geminiUsageHTML({}),/Not reported/);
  assert.deepEqual(geminiCommands([{name:'help'},{name:'help'},{name:'bad\nname'},{name:'memory:show'}]).map(c=>c.name),['/help','/memory:show']);assert.deepEqual(geminiCommands(null),[]);
  assert.deepEqual(planTaskTitles({text:'# Plan\n- Build A\n2. Verify A'}),['Build A','Verify A']);
  const html=editDiffHTML([{path:'<a>.txt',oldText:'keep\n<script>\nend\n',newText:'keep\n&new\nend'}]);assert.match(html,/&lt;script&gt;/);assert.match(html,/&amp;new/);assert.match(html,/No final newline/);assert.match(html,/edit-remove/);assert.doesNotMatch(html,/<script>/);
  const reducer=new GeminiEvents();const event=reducer.update({sessionUpdate:'tool_call',toolCallId:'edit',content:[{type:'diff',path:'a',oldText:null,newText:'all new'}]});assert.deepEqual(event.edits,[{path:'a',oldText:null,newText:'all new'}]);assert.deepEqual(reducer.update({sessionUpdate:'tool_call_update',toolCallId:'edit',status:'completed'}).edits,event.edits);
});

test('Gemini explicitly applies plan mode before the first prompt even if ACP ignores the launch flag',async t=>{const f=await fixture(t);f.task.nativeSetup={geminiMode:'plan'};const s=await f.plane.managed.start(f.task);assert.equal(s.geminiState.currentModeId,'plan');assert(f.mock.calls.some(c=>c.method==='session/set_mode'&&c.params.modeId==='plan'));assert(!f.mock.calls.some(c=>c.method==='session/prompt'));});

test('native Gemini commands in Plan mode do not replace a reviewed plan with help text',async t=>{
  const f=await controlsFixture(t);f.s.geminiState.currentModeId='plan';f.s.geminiState.planText='Keep this reviewed plan';await f.plane.managed.prompt(f.task.pane,'/help');await f.s.running;assert.equal(f.s.geminiState.planText,'Keep this reviewed plan');
});

test('Gemini resumes after rejecting a malformed streamed tool event',async t=>{
  let turns=0;const f=await fixture(t,mockGemini({onPrompt:(row,{send,update})=>{if(++turns===1)update({sessionUpdate:'tool_call',title:'Missing tool identity'});else{update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Recovered after malformed stream'}});send({id:row.id,result:{stopReason:'end_turn'}});}}}));
  const s=await f.plane.managed.start(f.task);await f.plane.managed.prompt(f.task.pane,'First');await s.running;assert.equal(s.status,'idle');assert.match(s.events.at(-1).text,/Invalid Gemini tool call/);await f.plane.managed.prompt(f.task.pane,'Continue');await s.running;assert.equal(s.status,'done');assert.equal(s.events.at(-1).text,'Recovered after malformed stream');assert.equal(f.mock.calls.filter(c=>c.method==='session/new').length,1);
});
