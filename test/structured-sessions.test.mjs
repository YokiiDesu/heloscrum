import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {StructuredSessions} from '../lib/structured-sessions.mjs';
import {CodexAppServer} from '../lib/codex-app-server.mjs';
import {ManagedAgents,withManagedAgents} from '../lib/managed-agents.mjs';
import {structuredProvider,hostedProvider,managedProvider} from '../lib/providers.mjs';
import {nativeSelection} from '../lib/native-setup.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {HerdrAdapter} from '../lib/adapters.mjs';

// A scripted `codex app-server`: newline JSON-RPC over stdio with the field
// names of codex-cli 0.163.0. It records requests and lets a test drive the
// notifications and server requests a real thread would emit.
function fakeAppServer({threadId='01a14756-5160-7b31-a216-dcc9edf7fd4c',turnId='01a14756-519f-76e0-b03a-9d643c5513e5',resumedTurns=[]}={}){
  const server={requests:[],spawned:0,child:null,threadId,turnId};
  server.spawnProcess=(executable,args)=>{
    server.spawned++;assert.deepEqual(args,['app-server','--listen','stdio://']);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{child.killed=true;child.emit('close',0);};
    let buffer='';child.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())server.receive(JSON.parse(line));}});
    server.child=child;return child;
  };
  server.send=message=>server.child.stdout.write(JSON.stringify(message)+'\n');
  server.notify=(method,params)=>server.send({method,params});
  server.request=(id,method,params)=>server.send({id,method,params});
  server.answers=new Map();
  server.receive=message=>{
    server.requests.push(message);
    if(message.id===undefined){if(message.method==='initialized')return;if(server.answers.has('response:'+message.id))server.answers.get('response:'+message.id)(message);return;}
    if(message.result!==undefined||message.error!==undefined){server.answers.get('response:'+message.id)?.(message);return;}
    const {id,method,params}=message;
    if(method==='initialize')return server.send({id,result:{userAgent:'fake',codexHome:'/tmp',platformFamily:'unix',platformOs:'linux'}});
    if(method==='thread/start')return server.send({id,result:{thread:{id:threadId,sessionId:threadId,status:{type:'idle'},turns:[]},model:params.model||'gpt-test',modelProvider:'openai',cwd:params.cwd,approvalPolicy:params.approvalPolicy}});
    if(method==='thread/resume')return server.send({id,result:{thread:{id:params.threadId,sessionId:params.threadId,status:{type:'idle'},turns:[]},model:'gpt-test',modelProvider:'openai',cwd:params.cwd,approvalPolicy:params.approvalPolicy}});
    if(method==='thread/turns/list')return server.send({id,result:{data:resumedTurns,nextCursor:null}});
    if(method==='turn/start'){server.send({id,result:{turn:{id:turnId,items:[],status:'inProgress'}}});server.notify('thread/status/changed',{threadId,status:{type:'active',activeFlags:[]}});server.notify('turn/started',{threadId,turn:{id:turnId,items:[],status:'inProgress'}});const text=params.input[0].text;server.notify('item/started',{threadId,turnId,startedAtMs:1,item:{type:'userMessage',id:'user-'+server.requests.length,content:params.input}});server.notify('item/completed',{threadId,turnId,completedAtMs:1,item:{type:'userMessage',id:'user-'+server.requests.length,content:params.input}});server.onTurn?.(text,params);return;}
    if(method==='turn/interrupt'){server.send({id,result:{}});server.notify('turn/completed',{threadId,turn:{id:params.turnId,items:[],status:'interrupted',error:null}});server.notify('thread/status/changed',{threadId,status:{type:'idle'}});return;}
    if(method==='turn/steer'){
      if(server.onSteer)return server.onSteer(message);
      server.send({id,result:{turnId}});
      server.notify('item/completed',{threadId,turnId,item:{type:'userMessage',id:'steer-'+id,content:params.input}});return;
    }
    server.send({id,error:{code:-32601,message:'unknown method '+method}});
  };
  server.waitFor=predicate=>new Promise(resolve=>{const check=()=>{const hit=server.requests.find(predicate);if(hit)return resolve(hit);setTimeout(check,5);};check();});
  server.complete=(status='completed')=>{server.notify('turn/completed',{threadId,turn:{id:turnId,items:[],status,error:null}});server.notify('thread/status/changed',{threadId,status:{type:'idle'}});};
  return server;
}
async function fixture(options){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-structured-')),worktree=path.join(root,'repo');await mkdir(worktree);
  const task={id:randomUUID(),path:worktree,kind:'codex',model:'gpt-test',effort:'high',role:'Builder',prompt:'Build the approved scope',project:root,name:'test',nativeSetup:{profile:'user:work',files:[],codexEngine:'app-server'}};
  const server=fakeAppServer(options);
  const p={root,data:{tasks:[task]},save:async()=>{},tools:{codex:'/mock/codex'},transcripts:{cache:new Map()},collaboration:{connections:new Map(),mcpBridge:async()=>({command:'/usr/bin/node',args:['bridge.mjs','/connection.json']})},images:{validateModel:()=>{},readFor:async()=>({mimeType:'image/png',base64:Buffer.from('png').toString('base64')})}};
  p.structured=new StructuredSessions(p,{spawnProcess:server.spawnProcess});
  // Notifications arrive over the fake stdout, then run through each session's
  // ordered queue and persist to disk. Wait for that queue, not a fixed delay:
  // a slow filesystem (Windows CI) outlasts any sleep.
  const settle=async()=>{for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,20));for(const s of p.structured.sessions.values())await p.structured.drain(s);}};
  return {root,task,p,server,settle,close:async()=>{await p.structured.close();await rm(root,{recursive:true,force:true});}};
}
const until=async(check,message)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail(message);};

test('engine selection: Codex app-server is a structured, hosted provider without a Herdr pane',()=>{
  assert.deepEqual(nativeSelection('codex',{codexEngine:'app-server'}),{profile:null,files:[],codexEngine:'app-server'});
  assert.deepEqual(nativeSelection('codex',{codexEngine:'terminal'}),{profile:null,files:[]});
  assert.throws(()=>nativeSelection('claude',{codexEngine:'app-server'}));assert.throws(()=>nativeSelection('codex',{codexEngine:'acp'}));
  const structured={kind:'codex',nativeSetup:{codexEngine:'app-server'}};
  assert.equal(structuredProvider(structured),true);assert.equal(managedProvider(structured),false);assert.equal(hostedProvider(structured),true);
  assert.equal(structuredProvider({kind:'codex',nativeSetup:{profile:null,files:[]}}),false);assert.equal(hostedProvider({kind:'codex'}),false);assert.equal(structuredProvider('codex'),false);
});

test('starting a session passes the toolbox bridge through thread config and reports idle until a turn runs',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);
    const init=f.server.requests.find(r=>r.method==='initialize');assert.equal(init.params.clientInfo.name,'heloscrum');assert.equal(init.params.capabilities.experimentalApi,true);
    assert(f.server.requests.some(r=>r.method==='initialized'&&r.id===undefined));
    const start=f.server.requests.find(r=>r.method==='thread/start');
    assert.equal(start.params.cwd,f.task.path);assert.equal(start.params.model,'gpt-test');assert.equal(start.params.approvalPolicy,'on-request');assert.equal(start.params.sandbox,'workspace-write');
    assert.equal(start.params.config['mcp_servers.heloscrum.command'],'/usr/bin/node');assert.deepEqual(start.params.config['mcp_servers.heloscrum.args'],['bridge.mjs','/connection.json']);assert.equal(start.params.config['mcp_servers.heloscrum.enabled'],true);assert.equal(start.params.config.profile,'work');
    assert.equal(f.task.providerSessionId,f.server.threadId);assert.equal(f.task.pane,'structured:'+f.task.id+':'+f.server.threadId);
    const [row]=f.p.structured.list();assert.equal(row.agent,'codex');assert.equal(row.agent_status,'idle');assert.equal(row.interactive_ready,true);assert.equal(row.engine,'app-server');assert.deepEqual(row.agent_session,{agent:'codex',kind:'id',value:f.server.threadId});
    assert.equal(s.status,'idle');assert.equal(f.server.spawned,1);
    const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.threadId+'.json'),'utf8'));assert.equal(saved.engine,'app-server');assert.equal(saved.taskId,f.task.id);
  }finally{await f.close();}
});

test('delivery returns a protocol receipt, streams the reply, and idle comes from turn/completed',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);
    const receipt=await f.p.structured.prompt(f.task.pane,'Summarize the repo');
    assert.deepEqual(receipt,{accepted:true,turnId:f.server.turnId,confirmation:'protocol'});
    const turn=f.server.requests.find(r=>r.method==='turn/start');assert.deepEqual(turn.params.input,[{type:'text',text:'Summarize the repo'}]);assert.equal(turn.params.effort,'high');assert.equal(turn.params.threadId,f.server.threadId);
    await until(()=>s.status==='working','turn should be working');
    await assert.rejects(f.p.structured.prompt(f.task.pane,'Duplicate'),/finish or interrupt/);
    assert.equal(f.p.structured.list()[0].interactive_ready,false);
    f.server.notify('item/started',{threadId:f.server.threadId,turnId:f.server.turnId,startedAtMs:1,item:{type:'agentMessage',id:'msg-1',text:''}});
    f.server.notify('item/agentMessage/delta',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'msg-1',delta:'Two '});
    f.server.notify('item/agentMessage/delta',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'msg-1',delta:'modules.'});
    await until(()=>s.events.find(e=>e.id==='msg-1')?.text==='Two modules.','deltas should stream into one message');
    assert.equal(s.events.find(e=>e.id==='msg-1').status,'running');
    f.server.notify('item/started',{threadId:f.server.threadId,turnId:f.server.turnId,startedAtMs:2,item:{type:'commandExecution',id:'cmd-1',command:'ls',cwd:f.task.path,commandActions:[],status:'inProgress'}});
    f.server.notify('item/completed',{threadId:f.server.threadId,turnId:f.server.turnId,completedAtMs:3,item:{type:'commandExecution',id:'cmd-1',command:'ls',cwd:f.task.path,commandActions:[],status:'completed',aggregatedOutput:'README.md\n',exitCode:0}});
    f.server.notify('item/completed',{threadId:f.server.threadId,turnId:f.server.turnId,completedAtMs:4,item:{type:'agentMessage',id:'msg-1',text:'Two modules.'}});
    f.server.notify('thread/tokenUsage/updated',{threadId:f.server.threadId,turnId:f.server.turnId,tokenUsage:{total:{inputTokens:120,outputTokens:8},last:{inputTokens:120,outputTokens:8}}});
    f.server.complete();
    await until(()=>s.status==='done','turn/completed should end the turn');
    assert.equal(s.turnId,null);assert.equal(f.p.structured.list()[0].interactive_ready,true);
    const command=s.events.find(e=>e.id==='cmd-1');assert.equal(command.type,'tool');assert.equal(command.output,'README.md\n');assert.equal(command.status,'completed');
    assert.equal(s.events.find(e=>e.id==='msg-1').status,'completed');assert.equal(s.events.find(e=>e.role==='user').text,'Summarize the repo');
    assert.equal(s.usage.inputTokens,120);assert.equal(s.usageRecords.length,1);
    const transcript=await f.p.structured.transcript(f.task);assert.equal(transcript.source,'Codex app-server');assert.equal(transcript.sessionId,f.server.threadId);assert.equal(transcript.events.find(e=>e.id==='msg-1').text,'Two modules.');assert.deepEqual(transcript.events.map(e=>e.id).slice(-2),['msg-1','cmd-1']);
    assert.equal(f.p.transcripts.cache.size,0);
  }finally{await f.close();}
});

test('a command approval blocks the session as a structured request and the chosen decision is returned to Codex',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Run the tests');
    f.server.notify('item/started',{threadId:f.server.threadId,turnId:f.server.turnId,startedAtMs:1,item:{type:'commandExecution',id:'cmd-2',command:'npm test',cwd:f.task.path,commandActions:[],status:'inProgress'}});
    f.server.request(900,'item/commandExecution/requestApproval',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'cmd-2',startedAtMs:1,command:'npm test',cwd:f.task.path,reason:'Verify the change'});
    await until(()=>s.status==='blocked','approval should block the session');
    assert.equal(f.p.structured.list()[0].agent_status,'blocked');
    const current=f.p.structured.request(f.task.pane);assert.equal(current.pending,true);assert.equal(current.request.type,'tool-approval');assert.equal(current.request.title,'Run command?');assert.match(current.request.details,/npm test/);assert.match(current.request.details,/Verify the change/);
    assert.deepEqual(current.request.tool,{name:'shell',arguments:'npm test'});assert.deepEqual(current.request.options.map(o=>o.id),['allow','allow-session','deny']);assert.equal(current.request.options[0].label,'Allow');
    assert.throws(()=>f.p.structured.choose(f.task.pane,'allow','stale'),/changed/);assert.throws(()=>f.p.structured.choose(f.task.pane,'always','stale'),/changed/);
    f.p.structured.choose(f.task.pane,'allow',current.fingerprint);
    const answer=await f.server.waitFor(r=>r.id===900&&r.result);assert.deepEqual(answer.result,{decision:'accept'});
    assert.equal(s.status,'working');assert.equal(f.p.structured.request(f.task.pane).pending,false);
    f.server.request(901,'item/fileChange/requestApproval',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'patch-1',startedAtMs:2,grantRoot:f.task.path});
    await until(()=>s.status==='blocked','file change approval should block');
    const patch=f.p.structured.request(f.task.pane);assert.equal(patch.request.tool.name,'apply_patch');
    f.p.structured.choose(f.task.pane,'deny',patch.fingerprint);
    assert.deepEqual((await f.server.waitFor(r=>r.id===901&&r.result)).result,{decision:'decline'});
    f.server.request(902,'mcpServer/elicitation/request',{threadId:f.server.threadId,serverName:'other'});
    assert.deepEqual((await f.server.waitFor(r=>r.id===902&&r.result)).result,{action:'decline'});
    f.server.request(903,'item/tool/requestUserInput',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'q',isBlocking:true,questions:[{id:'a',header:'Pick',question:'Which?'},{id:'b',header:'Pick',question:'And?'}]});
    const refused=await f.server.waitFor(r=>r.id===903&&r.error);assert.equal(refused.error.code,-32601);
    assert.equal(s.status,'working');
  }finally{await f.close();}
});

test('interrupt cancels an open approval and the running turn; the session is idle again',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Go');
    f.server.request(910,'item/commandExecution/requestApproval',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'x',startedAtMs:1,command:'rm -rf build'});
    await until(()=>s.status==='blocked','should block');
    await f.p.structured.interrupt(f.task.pane);
    assert.deepEqual((await f.server.waitFor(r=>r.id===910&&r.result)).result,{decision:'cancel'});
    const interrupt=await f.server.waitFor(r=>r.method==='turn/interrupt');assert.deepEqual(interrupt.params,{threadId:f.server.threadId,turnId:f.server.turnId});
    await until(()=>s.status==='idle','interrupted turn should end idle');
    assert.match(s.events.at(-1).text,/interrupted/i);
  }finally{await f.close();}
});

test('resume reopens the same thread with excludeTurns and hydrates earlier turns; exit frees the pane',async()=>{
  const f=await fixture({resumedTurns:[{id:'t1',status:'completed',items:[{type:'userMessage',id:'u1',content:[{type:'text',text:'Earlier ask'}]},{type:'agentMessage',id:'a1',text:'Earlier answer'}]}]});try{
    await f.p.structured.start(f.task);const id=f.task.providerSessionId;
    await f.p.structured.exit(f.task.pane);assert.equal(f.p.structured.list().length,0);await assert.rejects(f.p.structured.prompt(f.task.pane,'x'),/offline/);
    f.task.resumeOnly=true;const s=await f.p.structured.start(f.task);
    const resume=f.server.requests.find(r=>r.method==='thread/resume');assert.equal(resume.params.threadId,id);assert.equal(resume.params.excludeTurns,true);assert.equal(resume.params.config['mcp_servers.heloscrum.command'],'/usr/bin/node');
    assert.equal(f.task.providerSessionId,id);assert.equal(f.server.spawned,1);
    assert.deepEqual(s.events.map(e=>e.text),['Earlier ask','Earlier answer']);
    assert.equal((await f.p.structured.transcript(f.task,{full:true})).events.length,2);
  }finally{await f.close();}
});

test('an app-server exit takes its sessions offline without losing their saved events',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Go');
    f.server.child.kill();
    await until(()=>f.p.structured.list().length===0,'session should go offline');
    await f.p.structured.drain(s);const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.threadId+'.json'),'utf8'));
    assert.deepEqual(saved.events.map(e=>e.role),['user','system']);assert.match(saved.events.at(-1).text,/Codex app-server exited/);
    f.task.resumeOnly=true;await f.p.structured.start(f.task);assert.equal(f.server.spawned,2);assert.equal(f.p.structured.list()[0].agent_status,'idle');
  }finally{await f.close();}
});

test('closing while notifications are in flight finishes their writes first and writes nothing afterwards',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
    f.server.notify('item/agentMessage/delta',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'msg-1',delta:'Working on it'});
    // No settle: the user message and the delta are still queued on the client.
    await f.p.structured.close();
    const file=path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.threadId+'.json');
    const saved=JSON.parse(await readFile(file,'utf8'));
    assert(saved.events.some(e=>e.role==='user'&&e.text?.includes('Initial task')),'queued user message is persisted before close resolves');
    assert.equal(saved.events.find(e=>e.id==='msg-1')?.text,'Working on it');
    assert.equal(s.status,'working');assert.equal(f.p.structured.list().length,0);
    f.server.notify('item/agentMessage/delta',{threadId:f.server.threadId,turnId:f.server.turnId,itemId:'msg-1',delta:' still'});await f.settle();
    assert.equal(await readFile(file,'utf8'),JSON.stringify(saved),'nothing is written after close');
    await rm(f.root,{recursive:true,force:true});
  }finally{await f.close();}
});

test('image attachments are passed as localImage files kept private to the task',async()=>{
  const f=await fixture();try{
    await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Look',{attachments:[{id:'img-1',kind:'image'},{id:'doc-1',kind:'file'}]});
    const turn=f.server.requests.find(r=>r.method==='turn/start');assert.equal(turn.params.input.length,2);assert.equal(turn.params.input[1].type,'localImage');
    assert(turn.params.input[1].path.startsWith(path.join(f.root,'.heloscrum/agents',f.task.id,'structured','attachments')));assert.equal(await readFile(turn.params.input[1].path,'utf8'),'png');
  }finally{await f.close();}
});

test('the Herdr proxy routes structured panes beside managed ones and keeps them listed when Herdr is offline',async()=>{
  const f=await fixture();try{
    f.p.ai={get:()=>({})};const managed=new ManagedAgents(f.p);
    const proxy=withManagedAgents({list:async()=>{throw Error('Herdr offline');},prompt:async()=>assert.fail('native prompt must not be used')},managed,f.p.structured);
    await f.p.structured.start(f.task);
    const rows=await proxy.list();assert.equal(rows.length,1);assert.equal(rows[0].pane_id,f.task.pane);
    const receipt=await proxy.prompt(f.task.pane,'Hello');assert.equal(receipt.confirmation,'protocol');await f.settle();
    await assert.rejects(proxy.terminal(f.task.pane),/native terminal/);
    assert.match(await proxy.read(f.task.pane),/Hello/);
    await f.p.structured.interrupt(f.task.pane);
  }finally{await f.close();}
});

test('the app-server client answers unknown server requests with a JSON-RPC error and times out silent calls',async()=>{
  const server=fakeAppServer();const client=new CodexAppServer('/mock/codex',{spawnProcess:server.spawnProcess,timeoutMs:30});
  await client.connect();assert.equal(client.info.platformOs,'linux');
  server.request(5,'attestation/generate',{});const refused=await server.waitFor(r=>r.id===5&&r.error);assert.equal(refused.error.code,-32601);
  await assert.rejects(client.rpc('thread/list',{}),/unknown method/);
  server.receive=()=>{};await assert.rejects(client.rpc('model/list',{}),/did not answer/);
  client.close();assert.equal(client.connected,false);
});

test('control plane: an app-server agent launches without Herdr, delivers queued messages on reported idle, and routes approvals',async()=>{
  const {ControlPlane}=await import('../lib/control-plane.mjs');
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-structured-plane-'));
  try{
    const plane=await new ControlPlane(root).init();
    await plane.git.command(root,['init','-b','main']);await plane.git.command(root,['config','user.name','HeloScrum Test']);await plane.git.command(root,['config','user.email','test@example.invalid']);
    const {writeFile}=await import('node:fs/promises');await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');await plane.git.command(root,['add','.']);await plane.git.command(root,['commit','-m','fixture']);
    plane.tools.codex='/fixture/codex';plane.tools.herdr=null;
    const server=fakeAppServer();plane.structured.spawnProcess=server.spawnProcess;
    const herdrCalls=[];plane.herdr.list=async()=>{herdrCalls.push('list');throw Error('Herdr is not installed');};
    const task=await plane.createTask({title:'Structured task',prompt:'Task instructions',kind:'codex',branch:'feat/structured',nativeSetup:{codexEngine:'app-server'}});
    for(let i=0;i<200&&(plane.busy||task.phase==='starting');i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(task.phase,'launched');assert.match(task.pane,/^structured:/);assert.equal(task.providerSessionId,server.threadId);assert.equal(task.nativeSetup.codexEngine,'app-server');
    const start=server.requests.find(r=>r.method==='thread/start');assert.equal(start.params.cwd,task.path);assert.match(start.params.config['mcp_servers.heloscrum.args'][1],/connection\.json$/);
    const first=server.requests.find(r=>r.method==='turn/start');assert.match(first.params.input[0].text,/^Task instructions/);assert.match(first.params.input[0].text,/work_brief/);
    // Queued while the first turn runs; delivered only after Codex reports the turn complete.
    const queued=await plane.collaboration.queuePrompt(task,'Second message');await plane.collaboration.deliverReady();assert.equal(queued.delivery,'queued');
    server.complete();await until(()=>plane.structured.list()[0]?.agent_status==='done','turn should complete');await plane.collaboration.deliverReady();
    assert.equal(queued.delivery,'delivered');const second=server.requests.filter(r=>r.method==='turn/start')[1];assert.match(second.params.input[0].text,/Second message/);
    // Approval routed through the plane's request API without any screen parsing.
    server.request(950,'item/commandExecution/requestApproval',{threadId:server.threadId,turnId:server.turnId,itemId:'c',startedAtMs:1,command:'npm test',cwd:task.path});
    for(let i=0;i<100&&plane.structured.list()[0].agent_status!=='blocked';i++)await new Promise(r=>setTimeout(r,5));
    const current=await plane.taskRequest(task.id);assert.equal(current.pending,true);assert.equal(current.request.tool.name,'shell');
    assert.deepEqual(task.observedApprovalTools,undefined); // shell is a known native approval target
    await plane.chooseTaskResponse(task.id,'allow',current.fingerprint);
    assert.deepEqual((await server.waitFor(r=>r.id===950&&r.result)).result,{decision:'accept'});
    assert.equal((await plane.taskRequest(task.id)).pending,false);
    await plane.interruptTask(task.id);await server.waitFor(r=>r.method==='turn/interrupt');await until(()=>plane.structured.list()[0]?.agent_status==='idle','interrupt should settle');
    const snapshot=await plane.snapshot();assert.equal(snapshot.tasks[0].status,'idle');assert.equal(snapshot.tasks[0].live.engine,'app-server');
    const history=await plane.transcripts.read(task,snapshot.tasks[0].live);assert.equal(history.source,'Codex app-server');assert(history.events.some(e=>e.role==='user'&&/Second message/.test(e.text)));
    await plane.structured.close();await plane.transcripts.close();await plane.managed.close();await plane.scheduler?.stop?.();await plane.history?.close?.();
  }finally{await rm(root,{recursive:true,force:true});}
});

test('shutdown drains queued notifications and their final transcript writes before returning',async()=>{
  const f=await fixture();let release;try{
    const s=await f.p.structured.start(f.task);
    s.sequence=new Promise(resolve=>{release=resolve;});
    f.server.notify('item/completed',{threadId:s.id,turnId:f.server.turnId,item:{type:'agentMessage',id:'last-message',text:'Saved before shutdown'}});
    f.server.notify('thread/closed',{threadId:s.id});
    let closed=false;const closing=f.p.structured.close().then(()=>{closed=true;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.server.child.killed,true,'stop the provider before waiting for disk writes');
    assert.equal(closed,false,'queued events must finish before shutdown completes');
    release();await closing;
    const saved=await f.p.structured.load(f.task);
    assert(saved.events.some(e=>e.id==='last-message'&&e.text==='Saved before shutdown'));
    assert(saved.events.some(e=>/Codex closed this thread/.test(e.text)));
    assert.equal(f.p.structured.notifications.size,0);
  }finally{release?.();await f.close();}
});

test('active steering uses turn/steer through collaboration, keeps queue pending, and appears once in history',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
    f.task.phase='launched';f.p.data.project=f.root;
    f.p.collaboration=new Collaboration(f.p);
    const native=new HerdrAdapter('/unused',f.root);native.list=async()=>[];
    native.json=async()=>assert.fail('structured steering must not type into Herdr');
    f.p.herdr=withManagedAgents(native,{plane:f.p,list:()=>[]},f.p.structured);
    await f.p.collaboration.queuePrompt(f.task,'Wait until done');
    await f.p.collaboration.queuePrompt(f.task,'Use the corrected path',{mode:'steer'});
    await f.p.collaboration.deliver();await f.settle();
    const request=f.server.requests.find(r=>r.method==='turn/steer');
    assert.equal(request.params.threadId,s.id);assert.equal(request.params.expectedTurnId,f.server.turnId);
    assert.match(request.params.input[0].text,/Use the corrected path/);assert.doesNotMatch(request.params.input[0].text,/Wait until done/);
    assert.deepEqual(f.p.collaboration.data.messages.map(m=>m.delivery),['queued','delivered']);
    assert.equal(s.events.filter(e=>e.role==='user'&&e.text.includes('Use the corrected path')).length,1);
    assert.equal(f.server.requests.filter(r=>r.method==='turn/start').length,1);
    f.server.complete();await until(()=>s.status==='done','initial turn should finish');await f.p.collaboration.deliver();
    assert.deepEqual(f.p.collaboration.data.messages.map(m=>m.delivery),['delivered','delivered']);
    assert.equal(f.server.requests.filter(r=>r.method==='turn/start').length,2);
    assert.equal(f.server.requests.filter(r=>r.method==='turn/steer').length,1);
    assert.equal(f.server.requests.filter(r=>r.method==='turn/interrupt').length,0);
  }finally{await f.close();}
});

test('steering defers blocked or changed turns and accepts only the expected protocol receipt',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');await f.settle();
    s.status='blocked';await assert.rejects(f.p.structured.steer(f.task.pane,'Correction'),e=>e.code==='steering_deferred');
    s.status='working';const images=f.p.structured.attachmentInputs.bind(f.p.structured);
    f.p.structured.attachmentInputs=async()=>{s.turnId='different-turn';return [];};
    await assert.rejects(f.p.structured.steer(f.task.pane,'Correction'),e=>e.code==='steering_deferred');
    assert.equal(f.server.requests.filter(r=>r.method==='turn/steer').length,0);
    f.p.structured.attachmentInputs=images;s.turnId=f.server.turnId;
    f.server.onSteer=({id})=>f.server.send({id,error:{code:-32602,message:'No active turn for this thread'}});
    await assert.rejects(f.p.structured.steer(f.task.pane,'Correction'),e=>e.code==='steering_deferred');
    f.server.onSteer=({id})=>f.server.send({id,result:{turnId:'unexpected'}});
    await assert.rejects(f.p.structured.steer(f.task.pane,'Correction'),/expected steering turn/);
    f.server.onSteer=null;
    const receipt=await f.p.structured.steer(f.task.pane,'Image direction',{attachments:[{id:'image-1',kind:'image'}]});
    assert.equal(receipt.turnId,f.server.turnId);
    const input=f.server.requests.findLast(r=>r.method==='turn/steer').params.input;
    assert.deepEqual(input[0],{type:'text',text:'Image direction'});assert.equal(input[1].type,'localImage');
  }finally{await f.close();}
});

test('unconfirmed app-server steering stays uncertain and is not replayed automatically',async()=>{
  const f=await fixture();try{
    await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');await f.settle();
    f.task.phase='launched';f.p.data.project=f.root;f.p.collaboration=new Collaboration(f.p);
    f.p.herdr=withManagedAgents({list:async()=>[]},{plane:f.p,list:()=>[]},f.p.structured);
    f.p.structured.client.timeoutMs=20;f.server.onSteer=()=>{};
    await f.p.collaboration.queuePrompt(f.task,'Do not duplicate this direction',{mode:'steer'});
    await f.p.collaboration.deliver();assert.equal(f.p.collaboration.data.messages[0].delivery,'uncertain');
    await f.p.collaboration.deliver();assert.equal(f.server.requests.filter(r=>r.method==='turn/steer').length,1);
  }finally{await f.close();}
});

test('interrupt and turn completion cancel questions without fabricating user answers',async()=>{
  for(const action of ['interrupt','complete']){
    const f=await fixture();try{
      const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
      f.server.request(950,'item/tool/requestUserInput',{threadId:s.id,turnId:s.turnId,questions:[{id:'choice',header:'Choose',question:'Which approach?',options:[{label:'A'},{label:'B'}]}]});
      await until(()=>s.approval,'question should be pending');
      if(action==='interrupt')await f.p.structured.interrupt(f.task.pane);else f.server.complete();
      const response=await f.server.waitFor(r=>r.id===950&&r.result);
      assert.deepEqual(response.result,{answers:{}});assert.equal(s.approval,null);
      assert(!JSON.stringify(response).includes('undefined'));
    }finally{await f.close();}
  }
});
