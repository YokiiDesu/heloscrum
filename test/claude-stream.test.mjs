import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {StructuredSessions,CLAUDE_ENGINE_SOURCE} from '../lib/structured-sessions.mjs';
import {ClaudeStream,STREAM_FLAGS} from '../lib/claude-stream.mjs';
import {ManagedAgents,withManagedAgents} from '../lib/managed-agents.mjs';
import {claudeStreamProvider,structuredProvider,hostedProvider,managedProvider} from '../lib/providers.mjs';
import {nativeSelection} from '../lib/native-setup.mjs';

// A scripted `claude --print` process speaking stream-json the way Claude Code
// 2.1.318 does: it replays user messages, streams deltas, asks permission with
// control requests, and answers interrupt control requests.
function fakeClaude(options={}){
  options={sessionId:'4d3a1f1e-9b7c-4e21-a3d5-6f0b2c8e1a11',hold:false,...options};const hold=options.hold;
  let sessionId=options.sessionId;const server={lines:[],responses:[],spawned:0,args:null,options:null,child:null,sessionId,hold,uuids:[]};
  server.spawnProcess=(executable,args,options)=>{
    server.spawned++;server.executable=executable;server.args=args;server.options=options;
    const given=args.indexOf('--session-id')>=0?args[args.indexOf('--session-id')+1]:args.indexOf('--resume')>=0?args[args.indexOf('--resume')+1]:null;if(given)server.sessionId=sessionId=given;
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;
    child.kill=()=>{child.killed=true;child.exitCode=143;child.emit('close',143);};
    let buffer='';child.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.trim())server.receive(JSON.parse(line));}});
    child.stdin.on('finish',()=>{if(!server.stayOpen){child.exitCode=0;setTimeout(()=>child.emit('close',0),5);}});
    server.child=child;return child;
  };
  server.send=message=>server.child.stdout.write(JSON.stringify(message)+'\n');
  server.init=()=>server.send({type:'system',subtype:'init',cwd:server.options.cwd,session_id:sessionId,model:'claude-test-5',tools:['Bash','Write'],mcp_servers:[],permissionMode:'default'});
  server.user=(content,extra={})=>{const uuid=randomUUID();server.uuids.push(uuid);server.send({type:'user',message:{role:'user',content},session_id:sessionId,parent_tool_use_id:null,uuid,timestamp:new Date().toISOString(),...extra});return uuid;};
  server.delta=(messageId,text,index=0)=>server.send({type:'stream_event',event:{type:'content_block_delta',index,delta:{type:'text_delta',text}},session_id:sessionId,parent_tool_use_id:null,uuid:randomUUID(),api_message_id:messageId});
  server.assistant=(messageId,content)=>{const uuid=randomUUID();server.send({type:'assistant',message:{model:'claude-test-5',id:messageId,type:'message',role:'assistant',content},parent_tool_use_id:null,session_id:sessionId,uuid,timestamp:new Date().toISOString()});return uuid;};
  server.ask=(toolName,input,{suggestions=[],requestId=randomUUID(),toolUseId='toolu_'+requestId.slice(0,8)}={})=>{server.assistant('msg_'+requestId.slice(0,8),[{type:'tool_use',id:toolUseId,name:toolName,input}]);server.send({type:'control_request',request_id:requestId,request:{subtype:'can_use_tool',tool_name:toolName,display_name:toolName,input,tool_use_id:toolUseId,...(suggestions.length?{permission_suggestions:suggestions}:{}),...(toolName==='AskUserQuestion'?{requires_user_interaction:true}:{})}});return {requestId,toolUseId};};
  server.toolResult=(toolUseId,content,isError=false)=>server.user([{type:'tool_result',tool_use_id:toolUseId,content,is_error:isError}]);
  server.result=({subtype='success',result='Done',usage={input_tokens:4,cache_creation_input_tokens:100,cache_read_input_tokens:900,output_tokens:40,output_tokens_details:{thinking_tokens:8}},cost=0.0123}={})=>server.send({type:'result',subtype,is_error:subtype!=='success',duration_ms:1200,duration_api_ms:1000,num_turns:1,result,stop_reason:'end_turn',session_id:sessionId,total_cost_usd:cost,usage,uuid:randomUUID()});
  server.receive=message=>{
    server.lines.push(message);
    if(message.type==='control_response'){server.responses.push(message.response);server.send(message);return;} // The CLI echoes responses.
    if(message.type==='control_request'){
      if(message.request?.subtype==='interrupt'){server.send({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{still_queued:[]}}});server.user([{type:'text',text:'[Request interrupted by user for tool use]'}]);return;}
      server.send({type:'control_response',response:{subtype:'error',request_id:message.request_id,error:'unsupported '+message.request?.subtype}});return;
    }
    if(message.type==='user'){
      server.init();server.user(message.message.content,{isReplay:true});
      if(server.onTurn)return server.onTurn(message);
      if(server.hold)return;
      const id='msg_'+randomUUID().slice(0,8);server.delta(id,'Hello ');server.delta(id,'there');server.assistant(id,[{type:'text',text:'Hello there'}]);server.result();
    }
  };
  server.waitFor=predicate=>new Promise(resolve=>{const check=()=>{const hit=server.lines.find(predicate);if(hit)return resolve(hit);setTimeout(check,5);};check();});
  return server;
}
async function fixture(options){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-claude-stream-')),worktree=path.join(root,'repo');await mkdir(worktree);
  const sessionId=options?.sessionId||'4d3a1f1e-9b7c-4e21-a3d5-6f0b2c8e1a11';
  const task={id:randomUUID(),path:worktree,kind:'claude',model:'opus',effort:'high',role:'Builder',prompt:'Build the approved scope',project:root,name:'test',nativeSetup:{profile:null,files:[],claudeEngine:'stream-json'},...(options?.task||{})};
  const server=fakeClaude({sessionId,hold:options?.hold});
  const launches=[];
  const p={root,data:{tasks:[task]},save:async()=>{},tools:{claude:'/mock/claude'},transcripts:{cache:new Map()},images:{validateModel:()=>{},readFor:async()=>({mimeType:'image/png',base64:Buffer.from('png').toString('base64')})},
    collaboration:{connections:new Map(),launchConfig:async(t,{resumeSessionId}={})=>{launches.push({task:t,resumeSessionId});return [...(resumeSessionId?['--resume',resumeSessionId]:['--session-id',sessionId]),'--model',t.model||'default','--effort',t.effort||'high','--mcp-config','{"mcpServers":{"heloscrum":{"command":"node","args":["bridge.mjs"]}}}','--settings','{"hooks":{"SessionStart":[]}}'];}}};
  p.structured=new StructuredSessions(p,{spawnProcess:server.spawnProcess});
  // Records arrive over the fake stdout, then run through the session's ordered
  // queue and persist to disk. Wait for that queue rather than a fixed delay.
  const settle=async()=>{for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,20));for(const s of p.structured.sessions.values())await p.structured.drain(s);}};
  return {root,task,p,server,launches,settle,close:async()=>{await p.structured.close();await rm(root,{recursive:true,force:true});}};
}
const until=async(check,message)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail(message);};

test('engine selection: Claude stream-json is a structured, hosted provider without a Herdr pane',()=>{
  assert.deepEqual(nativeSelection('claude',{claudeEngine:'stream-json'}),{profile:null,files:[],claudeEngine:'stream-json'});
  assert.deepEqual(nativeSelection('claude',{claudeEngine:'terminal'}),{profile:null,files:[]});
  assert.throws(()=>nativeSelection('codex',{claudeEngine:'stream-json'}),/Claude Code terminal or stream-json/);
  const task={kind:'claude',nativeSetup:{claudeEngine:'stream-json'}};
  assert.equal(claudeStreamProvider(task),true);assert.equal(structuredProvider(task),true);assert.equal(hostedProvider(task),true);assert.equal(managedProvider(task),false);
  assert.equal(claudeStreamProvider({kind:'claude',nativeSetup:{}}),false);assert.equal(claudeStreamProvider({kind:'codex',nativeSetup:{claudeEngine:'stream-json'}}),false);
});

test('starting a session launches claude --print stream-json with the terminal engine’s own arguments and no --bare',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);
    assert.equal(f.server.spawned,1);assert.equal(f.server.executable,'/mock/claude');assert.equal(f.server.options.cwd,f.task.path);
    assert.deepEqual(f.server.args.slice(0,STREAM_FLAGS.length),STREAM_FLAGS);
    assert(f.server.args.includes('--permission-prompt-tool')&&f.server.args.includes('--replay-user-messages'));assert(!f.server.args.includes('--bare'));
    assert.equal(f.server.args[f.server.args.indexOf('--session-id')+1],f.server.sessionId);assert(f.server.args.includes('--mcp-config')&&f.server.args.includes('--settings'));
    assert.equal(f.task.providerSessionId,f.server.sessionId);assert.equal(f.task.pane,'structured:'+f.task.id+':'+f.server.sessionId);assert.equal(f.task.workspace,null);
    assert.equal(f.launches[0].resumeSessionId,undefined);
    const rows=f.p.structured.list();assert.equal(rows.length,1);assert.equal(rows[0].engine,'stream-json');assert.equal(rows[0].agent,'claude');assert.equal(rows[0].agent_status,'idle');assert.equal(rows[0].interactive_ready,true);
    const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.sessionId+'.json'),'utf8'));assert.equal(saved.engine,'stream-json');assert.equal(saved.taskId,f.task.id);
    assert.equal(s.status,'idle');
  }finally{await f.close();}
});

test('delivery returns the replay receipt, streams the reply, maps tool calls, and idle with usage comes from the result',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);
    const receipt=await f.p.structured.prompt(f.task.pane,'Initial task');
    assert.equal(receipt.confirmation,'protocol');assert.equal(receipt.accepted,true);assert.equal(receipt.turnId,f.server.uuids[0]);assert.equal(s.status,'working');assert.equal(s.model,'claude-test-5');
    const sent=f.server.lines.find(l=>l.type==='user');assert.deepEqual(sent.message,{role:'user',content:'Initial task'});
    await f.settle();assert.equal(s.events.filter(e=>e.role==='user'&&e.text==='Initial task').length,1);
    await assert.rejects(f.p.structured.prompt(f.task.pane,'Too early'),/Wait for this agent/);
    f.server.delta('msg_1','Working ');f.server.delta('msg_1','on it');await f.settle();
    const live=s.events.find(e=>e.id==='live:msg_1:0');assert.equal(live.text,'Working on it');assert.equal(live.status,'running');
    f.server.assistant('msg_1',[{type:'text',text:'Working on it'},{type:'tool_use',id:'toolu_1',name:'Bash',input:{command:'npm test'}}]);await f.settle();
    assert(!s.events.some(e=>e.id==='live:msg_1:0'),'streamed placeholder replaced by the final message');
    assert.equal(s.events.filter(e=>e.role==='assistant'&&e.text==='Working on it').length,1);
    const call=s.events.find(e=>e.id==='toolu_1');assert.equal(call.type,'tool');assert.equal(call.name,'Bash');assert.equal(call.status,'running');
    f.server.toolResult('toolu_1','all green');await f.settle();assert.equal(s.events.find(e=>e.id==='toolu_1').output,'all green');assert.equal(s.events.find(e=>e.id==='toolu_1').status,'completed');
    assert.equal(s.status,'working');
    f.server.result();await until(()=>s.status==='done','result reports idle');
    assert.deepEqual(s.usage,{inputTokens:1004,cachedInputTokens:900,outputTokens:40,reasoningOutputTokens:8,totalTokens:1044});
    assert.equal(s.usageRecords.length,1);assert.equal(s.usageRecords[0].costUsd,0.0123);assert.equal(s.usageRecords[0].model,'claude-test-5');
    const transcript=await f.p.structured.transcript(f.task);assert.equal(transcript.source,CLAUDE_ENGINE_SOURCE);assert.equal(transcript.sessionId,f.server.sessionId);assert.equal(transcript.model,'claude-test-5');
    assert.deepEqual(transcript.events.map(e=>e.type),['message','message','tool']);
    const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.sessionId+'.json'),'utf8'));assert.equal(saved.model,'claude-test-5');assert.equal(saved.events.length,3);
    // A failed turn leaves the session idle and says why.
    await f.p.structured.prompt(f.task.pane,'Next');f.server.result({subtype:'error_max_turns',result:'Reached max turns'});await until(()=>s.status==='idle','error result');
    assert.match(s.events.at(-1).text,/Turn failed: error_max_turns · Reached max turns/);
  }finally{await f.close();}
});

test('a permission prompt blocks the session as a structured request; the choice is returned as a control response',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
    const {requestId}=f.server.ask('Bash',{command:'rm -rf build',description:'Clean build output'},{suggestions:[{type:'addRules',rules:[{toolName:'Bash',ruleContent:'rm -rf build'}],behavior:'allow',destination:'session'}]});
    await until(()=>s.status==='blocked','prompt blocks the session');
    const current=f.p.structured.request(f.task.pane);assert.equal(current.pending,true);
    assert.equal(current.request.type,'tool-approval');assert.equal(current.request.title,'Allow Bash?');assert.match(current.request.details,/rm -rf build/);assert.match(current.request.details,/Clean build output/);
    assert.deepEqual(current.request.tool,{name:'Bash',arguments:'rm -rf build'});assert.deepEqual(current.request.options.map(o=>o.id),['allow','allow-session','deny']);
    assert.equal(f.p.structured.list()[0].agent_status,'blocked');
    assert.throws(()=>f.p.structured.choose(f.task.pane,'allow','stale'),/changed/);
    f.p.structured.choose(f.task.pane,'allow-session',current.fingerprint);
    const answer=await f.server.waitFor(l=>l.type==='control_response'&&l.response.request_id===requestId);
    assert.equal(answer.response.subtype,'success');assert.equal(answer.response.response.behavior,'allow');assert.deepEqual(answer.response.response.updatedInput,{command:'rm -rf build',description:'Clean build output'});assert.equal(answer.response.response.updatedPermissions.length,1);
    assert.equal(s.status,'working');assert.equal(f.p.structured.request(f.task.pane).pending,false);await f.settle();assert.match(s.events.at(-1).text,/Allow Bash\? Allow for session\./);
    // Deny, without suggestions: only allow and deny are offered.
    const second=f.server.ask('Write',{file_path:'/repo/a.txt',content:'hello'});await until(()=>s.status==='blocked','second prompt');
    const request=f.p.structured.request(f.task.pane);assert.deepEqual(request.request.options.map(o=>o.id),['allow','deny']);assert.match(request.request.details,/change \/repo\/a.txt/);
    f.p.structured.choose(f.task.pane,'deny',request.fingerprint);
    const denied=await f.server.waitFor(l=>l.type==='control_response'&&l.response.request_id===second.requestId);assert.equal(denied.response.response.behavior,'deny');assert.match(denied.response.response.message,/Denied/);
    // A request the CLI withdraws itself leaves nothing pending.
    const third=f.server.ask('Read',{file_path:'/repo/b.txt'});await until(()=>s.status==='blocked','third prompt');
    f.server.send({type:'control_cancel_request',request_id:third.requestId});await until(()=>s.status==='working','withdrawn');assert.equal(f.p.structured.request(f.task.pane).pending,false);
  }finally{await f.close();}
});

test('questions with options are answered through the question request; other shapes are declined without blocking',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
    const input={questions:[{question:'Which color?',header:'Color',multiSelect:false,options:[{label:'Red',description:'Pick red'},{label:'Blue',description:'Pick blue'}]}]};
    const {requestId}=f.server.ask('AskUserQuestion',input);await until(()=>s.status==='blocked','question blocks');
    const current=f.p.structured.request(f.task.pane);assert.equal(current.request.type,'question');assert.equal(current.request.title,'Color');assert.equal(current.request.details,'Which color?');assert.deepEqual(current.request.options.map(o=>o.label),['Red','Blue']);
    assert.throws(()=>f.p.structured.choose(f.task.pane,'option-5',current.fingerprint),/not available/);
    f.p.structured.choose(f.task.pane,'option-1',current.fingerprint);
    const answer=await f.server.waitFor(l=>l.type==='control_response'&&l.response.request_id===requestId);
    assert.deepEqual(answer.response.response,{behavior:'allow',updatedInput:{...input,answers:{'Which color?':'Blue'}}});
    const free=f.server.ask('AskUserQuestion',{questions:[{question:'Describe the bug',header:'Bug',options:[]}]});
    const declined=await f.server.waitFor(l=>l.type==='control_response'&&l.response.request_id===free.requestId);
    assert.equal(declined.response.response.behavior,'deny');assert.match(declined.response.response.message,/cannot answer this question/);assert.equal(s.status,'working');assert.equal(f.p.structured.request(f.task.pane).pending,false);
  }finally{await f.close();}
});

test('interrupt cancels an open prompt, sends the interrupt control request, and leaves the session idle for the next message',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
    const {requestId}=f.server.ask('Bash',{command:'until false; do sleep 1; done'});await until(()=>s.status==='blocked','prompt blocks');
    await f.p.structured.interrupt(f.task.pane);
    const cancelled=f.server.lines.find(l=>l.type==='control_response'&&l.response.request_id===requestId);assert.equal(cancelled.response.response.behavior,'deny');assert.match(cancelled.response.response.message,/Interrupted/);
    assert(f.server.lines.some(l=>l.type==='control_request'&&l.request.subtype==='interrupt'));
    assert.equal(s.status,'idle');assert.equal(s.turnId,null);await f.settle();
    assert(s.events.some(e=>e.role==='system'&&/Turn interrupted/.test(e.text)));assert(s.events.some(e=>e.role==='user'&&/Request interrupted by user/.test(e.text)));
    await f.p.structured.interrupt(f.task.pane); // Idle: nothing to send.
    assert.equal(f.server.lines.filter(l=>l.type==='control_request').length,1);
    const receipt=await f.p.structured.prompt(f.task.pane,'Carry on');assert.equal(receipt.confirmation,'protocol');assert.equal(s.status,'working');
  }finally{await f.close();}
});

test('steering waits for the model boundary while a turn runs and delivers directly when idle',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);
    const receipt=await f.p.structured.steer(f.task.pane,'Start here');assert.equal(receipt.confirmation,'protocol');assert.equal(s.status,'working');
    await assert.rejects(f.p.structured.steer(f.task.pane,'Correction'),e=>e.code==='steering_deferred');
    assert.equal(f.server.lines.filter(l=>l.type==='user').length,1);
  }finally{await f.close();}
});

test('an unacknowledged message is reported as unconfirmed and the session returns to idle',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);
    f.server.receive=message=>{f.server.lines.push(message);}; // Swallow everything: no replay.
    const promise=f.p.structured.prompt(f.task.pane,'Lost message');
    // Shorten the wait by firing the pending timer early.
    await until(()=>!!s.pendingSend,'pending send registered');clearTimeout(s.pendingSend.timer);const pending=s.pendingSend;s.pendingSend=null;pending.reject(Object.assign(Error('Claude Code did not acknowledge the message'),{status:504}));
    await assert.rejects(promise,/did not acknowledge/);assert.equal(s.status,'idle');
  }finally{await f.close();}
});

test('a Claude Code exit takes the session offline without losing its saved events; exit() ends the process on purpose',async()=>{
  const f=await fixture();try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');await until(()=>s.status==='done','turn completes');
    f.server.child.exitCode=1;f.server.child.emit('close',1);await f.settle();
    assert.equal(f.p.structured.list().length,0);assert.equal(s.status,'idle');
    const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.sessionId+'.json'),'utf8'));
    assert.match(saved.events.at(-1).text,/Claude Code exited with code 1/);assert(saved.events.some(e=>e.text==='Hello there'));
    assert.throws(()=>f.p.structured.request(f.task.pane),/offline/);
    // Resume: the same session ID is passed with --resume and the saved events are loaded.
    f.task.resumeOnly=true;const resumed=await f.p.structured.start(f.task);
    assert.equal(f.server.spawned,2);assert.equal(f.server.args[f.server.args.indexOf('--resume')+1],f.server.sessionId);assert.equal(f.launches.at(-1).resumeSessionId,f.server.sessionId);
    assert.equal(resumed.events.length,saved.events.length);assert.equal(resumed.model,'claude-test-5');
    await f.p.structured.exit(f.task.pane);
    assert.equal(f.p.structured.list().length,0);assert.equal(f.server.child.exitCode,0,'stdin end lets the CLI leave');
    await f.settle();assert.equal(resumed.events.filter(e=>/Claude Code exited/.test(e.text)).length,1,'a deliberate exit is not reported as a crash');
  }finally{await f.close();}
});

test('resuming a session last driven from a terminal hydrates its registered transcript',async()=>{
  const f=await fixture();try{
    const config=path.join(f.root,'claude-config'),dir=path.join(config,'projects','slug');await mkdir(dir,{recursive:true});
    const transcript=path.join(dir,f.server.sessionId+'.jsonl'),id=f.server.sessionId;
    await writeFile(transcript,[{type:'user',uuid:'u1',sessionId:id,cwd:f.task.path,message:{role:'user',content:'Earlier request'},timestamp:'2026-11-06T00:00:00.000Z'},{type:'assistant',uuid:'a1',sessionId:id,cwd:f.task.path,message:{role:'assistant',model:'claude-test-5',content:[{type:'text',text:'Earlier reply'}]},timestamp:'2026-11-06T00:00:01.000Z'}].map(r=>JSON.stringify(r)).join('\n')+'\n');
    f.task.resumeOnly=true;f.task.providerSessionId=id;f.task.transcriptPath=transcript;
    const previous=process.env.CLAUDE_CONFIG_DIR;process.env.CLAUDE_CONFIG_DIR=config;
    let s;try{s=await f.p.structured.start(f.task);}finally{if(previous===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previous;}
    assert.deepEqual(s.events.map(e=>e.text),['Earlier request','Earlier reply']);assert(s.events.every(e=>e.at));
  }finally{await f.close();}
});

test('image attachments travel as base64 image blocks beside the text',async()=>{
  const f=await fixture({hold:true});try{
    await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Look at this',{attachments:[{id:'image-1',kind:'image'},{id:'doc-1',kind:'file'}]});
    const sent=f.server.lines.find(l=>l.type==='user');assert.equal(sent.message.content.length,2);assert.deepEqual(sent.message.content[0],{type:'text',text:'Look at this'});
    assert.deepEqual(sent.message.content[1],{type:'image',source:{type:'base64',media_type:'image/png',data:Buffer.from('png').toString('base64')}});
  }finally{await f.close();}
});

test('the Herdr proxy routes stream-json panes, defers steering, and refuses a native terminal',async()=>{
  const f=await fixture({hold:true});try{
    f.p.ai={get:()=>({})};const managed=new ManagedAgents(f.p);
    const proxy=withManagedAgents({list:async()=>{throw Error('Herdr offline');},prompt:async()=>assert.fail('native prompt must not be used')},managed,f.p.structured);
    await f.p.structured.start(f.task);
    const rows=await proxy.list();assert.equal(rows.length,1);assert.equal(rows[0].engine,'stream-json');
    const receipt=await proxy.prompt(f.task.pane,'Hello');assert.equal(receipt.confirmation,'protocol');await f.settle();
    await assert.rejects(proxy.steer(f.task.pane,'Change course'),e=>e.code==='steering_deferred');
    await assert.rejects(proxy.terminal(f.task.pane),/native terminal/);
    assert.match(await proxy.read(f.task.pane),/Hello/);
    await proxy.interrupt(f.task.pane);assert.equal(f.p.structured.list()[0].agent_status,'idle');
  }finally{await f.close();}
});

test('closing with a running turn interrupts it, ends the process, and finishes queued writes',async()=>{
  const f=await fixture({hold:true});try{
    const s=await f.p.structured.start(f.task);await f.p.structured.prompt(f.task.pane,'Initial task');
    f.server.delta('msg_9','Half ');
    await f.p.structured.close();
    assert(f.server.lines.some(l=>l.type==='control_request'&&l.request.subtype==='interrupt'));assert.equal(f.server.child.exitCode,0);
    const saved=JSON.parse(await readFile(path.join(f.root,'.heloscrum/agents',f.task.id,'structured',f.server.sessionId+'.json'),'utf8'));
    assert(saved.events.some(e=>e.text==='Half '));assert.equal(f.p.structured.list().length,0);
    assert.equal(s.client.connected,false);
    await rm(f.root,{recursive:true,force:true});
  }finally{await f.close();}
});

test('the stream client answers control requests, resolves its own, reports exits, and limits line size',async()=>{
  const server=fakeClaude();const client=new ClaudeStream('/mock/claude',['--session-id',server.sessionId],{cwd:'/tmp',spawnProcess:server.spawnProcess,timeoutMs:30});
  const seen=[];client.onMessage(m=>seen.push(m.type));client.onRequest(async request=>{if(request.subtype==='can_use_tool')return {behavior:'deny',message:'no'};throw Error('nope');});
  const closes=[];client.onClose(reason=>closes.push(reason.message));
  client.start();assert.equal(client.connected,true);
  server.send({type:'control_request',request_id:'r1',request:{subtype:'can_use_tool',tool_name:'Bash',input:{}}});server.send({type:'control_request',request_id:'r2',request:{subtype:'hook_callback'}});
  const first=await server.waitFor(l=>l.type==='control_response'&&l.response.request_id==='r1');assert.deepEqual(first.response,{subtype:'success',request_id:'r1',response:{behavior:'deny',message:'no'}});
  const second=await server.waitFor(l=>l.type==='control_response'&&l.response.request_id==='r2');assert.equal(second.response.subtype,'error');assert.equal(second.response.error,'nope');
  const ack=await client.request('interrupt');assert.deepEqual(ack,{still_queued:[]});
  server.receive=m=>{server.lines.push(m);};await assert.rejects(client.request('interrupt'),/did not answer/);
  assert(seen.includes('user'),'interrupt marker delivered as a message');
  server.child.stdout.write('not json\n');server.send({type:'rate_limit_event'});await new Promise(r=>setTimeout(r,10));assert(seen.includes('rate_limit_event'));
  server.child.stderr.write('Not logged in\n');server.child.exitCode=1;server.child.emit('close',1);assert.equal(client.connected,false);assert.deepEqual(closes,['Claude Code exited with code 1: Not logged in']);
  assert.throws(()=>client.request('interrupt'),/not running/);
  const big=fakeClaude();const limited=new ClaudeStream('/mock/claude',[],{spawnProcess:big.spawnProcess});const reasons=[];limited.onClose(r=>reasons.push(r.message));limited.start();
  big.child.stdout.write('x'.repeat(8*1024*1024+1));await new Promise(r=>setTimeout(r,10));assert.match(reasons[0],/size limit/);assert.equal(big.child.killed,true);
});

test('control plane: a stream-json Claude agent launches without Herdr, delivers queued messages on the result, and routes prompts',async()=>{
  const {ControlPlane}=await import('../lib/control-plane.mjs');
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-claude-stream-plane-'));
  try{
    const plane=await new ControlPlane(root).init();
    await plane.git.command(root,['init','-b','main']);await plane.git.command(root,['config','user.name','HeloScrum Test']);await plane.git.command(root,['config','user.email','test@example.invalid']);
    await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');await plane.git.command(root,['add','.']);await plane.git.command(root,['commit','-m','fixture']);
    plane.tools.claude='/fixture/claude';plane.tools.herdr=null;
    const server=fakeClaude({hold:true});plane.structured.spawnProcess=server.spawnProcess;
    plane.herdr.list=async()=>{throw Error('Herdr is not installed');};
    const task=await plane.createTask({title:'Streamed task',prompt:'Task instructions',kind:'claude',branch:'feat/stream',nativeSetup:{claudeEngine:'stream-json'}});
    for(let i=0;i<200&&(plane.busy||task.phase==='starting');i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(task.phase,'launched');assert.match(task.pane,/^structured:/);assert.equal(task.providerSessionId,server.sessionId);assert.equal(task.nativeSetup.claudeEngine,'stream-json');
    assert.deepEqual(server.args.slice(0,STREAM_FLAGS.length),STREAM_FLAGS);assert(!server.args.includes('--bare'));
    const mcp=JSON.parse(server.args[server.args.indexOf('--mcp-config')+1]);assert.match(mcp.mcpServers.heloscrum.args[1],/connection\.json$/);
    const settings=JSON.parse(server.args[server.args.indexOf('--settings')+1]);assert.match(settings.hooks.SessionStart[0].hooks[0].command,/agent-hook\.mjs/);
    const first=server.lines.find(l=>l.type==='user');assert.match(first.message.content,/^Task instructions/);assert.match(first.message.content,/work_brief/);
    const queued=await plane.collaboration.queuePrompt(task,'Second message');await plane.collaboration.deliverReady();assert.equal(queued.delivery,'queued');
    server.ask('Bash',{command:'npm test'});
    for(let i=0;i<100&&(await plane.taskRequest(task.id)).pending!==true;i++)await new Promise(r=>setTimeout(r,10));
    const request=await plane.taskRequest(task.id);assert.equal(request.pending,true);assert.equal(request.request.tool.name,'Bash');
    await plane.chooseTaskResponse(task.id,'allow',request.fingerprint);await server.waitFor(l=>l.type==='control_response'&&l.response.response?.behavior==='allow');
    server.result();for(let i=0;i<100&&plane.structured.get(task.pane).status!=='done';i++)await new Promise(r=>setTimeout(r,10));
    await plane.collaboration.deliverReady();assert.equal(queued.delivery,'delivered');
    assert.equal(server.lines.filter(l=>l.type==='user').length,2);
    await plane.interruptTask(task.id);assert.equal(plane.structured.get(task.pane).status,'idle');
    const snapshot=await plane.snapshot();const row=snapshot.tasks.find(t=>t.id===task.id);assert.equal(row.live?.engine,'stream-json');assert.equal(row.status,'idle');
    const history=await plane.transcripts.read(task,row.live);assert.equal(history.source,CLAUDE_ENGINE_SOURCE);assert(history.events.some(e=>e.role==='user'&&/Second message/.test(e.text)));
    await plane.structured.close();
  }finally{await rm(root,{recursive:true,force:true});}
});
