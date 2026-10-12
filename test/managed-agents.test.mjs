import {TOOL_IMAGE_NOTICE} from '../lib/image-attachments.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ManagedAgents,withManagedAgents} from '../lib/managed-agents.mjs';
import {ModelClient} from '../lib/model-client.mjs';
import {ContextManager,estimateTokens} from '../lib/context-manager.mjs';
import {workspaceCall,workspacePath} from '../lib/worktree-tools.mjs';
import {cursorEvent,cursorArgs,cursorLaunchConfig} from '../lib/cursor.mjs';
import {run} from '../lib/adapters.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';

async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-managed-')),worktree=path.join(root,'repo');await mkdir(worktree);const task={id:randomUUID(),path:worktree,kind:'ollama',connectionId:'connection',model:'test-model',role:'Builder',prompt:'Build the approved scope',project:root,name:'test'};const c={id:'connection',kind:'ollama',model:'test-model',supportsTools:true,contextWindow:32768,maxOutputTokens:4096};const p={root,data:{contextSettings:{budgetTokens:16000,toolResultChars:2000}},save:async()=>{},tools:{},transcripts:{cache:new Map()},ai:{get:()=>c},collaboration:{catalog:()=>({tools:[]})}};p.managed=new ManagedAgents(p);p.context=new ContextManager(p);return {root,task,p,c,close:async()=>{await p.managed.close();await rm(root,{recursive:true,force:true});}};}
test('endpoint agents perform scoped file tools, record events and resume without replaying a task',async()=>{
  const f=await fixture();try{
    let calls=0;f.p.ai.complete=async()=>({message:++calls===1?{role:'assistant',content:'Creating file',tool_calls:[{id:'write-1',type:'function',function:{name:'workspace_write',arguments:JSON.stringify({path:'hello.txt',content:'hello'})}}]}:{role:'assistant',content:'File saved'},usage:{prompt_tokens:100}});
    const session=await f.p.managed.start(f.task);await f.p.managed.prompt(f.task.pane,'Please create hello.txt');await session.running;
    assert.equal(await readFile(path.join(f.task.path,'hello.txt'),'utf8'),'hello');assert.equal(session.status,'done');assert.equal(session.events.find(e=>e.id==='write-1').status,'completed');assert.equal(calls,2);
    assert.equal(session.usageRecords.length,2);assert.equal(session.usageRecords[0].usage.prompt_tokens,100);
    const id=f.task.providerSessionId;await f.p.managed.exit(f.task.pane);f.task.resumeOnly=true;await f.p.managed.start(f.task);assert.equal(f.p.managed.get(f.task.pane).usageRecords.length,2);assert.equal(f.task.providerSessionId,id);assert.equal(calls,2);assert.equal((await f.p.managed.transcript(f.task)).events.at(-1).text,'File saved');
  }finally{await f.close();}
});
test('duplicate prompts cannot interleave, and shell commands wait for a matching human approval',async()=>{
  const f=await fixture();try{
    let calls=0;f.p.ai.complete=async()=>({message:++calls===1?{role:'assistant',content:'',tool_calls:[{id:'shell',type:'function',function:{name:'workspace_command',arguments:JSON.stringify({command:'printf approved > approval.txt'})}}]}:{role:'assistant',content:'Complete'}});
    const s=await f.p.managed.start(f.task);await f.p.managed.prompt(f.task.pane,'Run the command');
    await assert.rejects(f.p.managed.prompt(f.task.pane,'Duplicate'),/finish/);
    for(let i=0;i<100&&s.status!=='blocked';i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(s.status,'blocked');await assert.rejects(readFile(path.join(f.task.path,'approval.txt')),{code:'ENOENT'});
    const req=f.p.managed.request(f.task.pane);assert.throws(()=>f.p.managed.choose(f.task.pane,'allow','stale'),/changed/);f.p.managed.choose(f.task.pane,'allow',req.fingerprint);await s.running;
    assert.equal(await readFile(path.join(f.task.path,'approval.txt'),'utf8'),'approved');assert.equal(s.status,'done');
  }finally{await f.close();}
});
test('workspace tools reject traversal, symlink escapes and credential configuration',async()=>{
  const f=await fixture();try{
    await writeFile(path.join(f.root,'outside'),'secret');await symlink(f.root,path.join(f.task.path,'link'));
    for(const file of ['../outside','link/outside','.git/config','.aws/credentials','.env','sub/.cursor/mcp.json'])await assert.rejects(workspacePath(f.task,file,{write:true}));
    await workspaceCall(f.task,'workspace_write',{path:'src/hello.js',content:'export const hello=1;'});assert.equal((await workspaceCall(f.task,'workspace_read',{path:'src/hello.js',limit:6})).text,'export');
  }finally{await f.close();}
});
test('context compaction archives old records, retains complete tool exchanges and the pinned task',async()=>{
  const f=await fixture();try{
    const s=await f.p.managed.start(f.task);s.controller=new AbortController();s.messages=[{role:'user',content:'old '.repeat(4000)},{role:'assistant',content:'earlier '.repeat(3000)},{role:'user',content:'Current task'},{role:'assistant',content:'',tool_calls:[{id:'c',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'c',content:'current result'}];
    f.p.data.contextSettings.budgetTokens=5000;f.p.ai.complete=async()=>({message:{content:'Goal remains. Earlier decisions retained. Verify current result.'}});
    const system={role:'system',content:'Pinned task and constraints'};await f.p.context.fitSession(s,system,[],f.c);
    assert(s.summary.reference);assert(s.messages.some(m=>m.tool_calls?.[0].id==='c'));assert(s.messages.some(m=>m.tool_call_id==='c'));assert(estimateTokens([system,...s.messages])<=5000);assert.equal((await f.p.context.read(f.task,{reference:s.summary.reference})).source,'Model context before compaction');
  }finally{await f.close();}
});
test('failed context summary leaves all model input records intact',async()=>{
  const f=await fixture();try{
    const s=await f.p.managed.start(f.task);s.controller=new AbortController();s.messages=[{role:'user',content:'x'.repeat(18000)},{role:'assistant',content:'done'},{role:'user',content:'next'}];const before=structuredClone(s.messages);f.p.data.contextSettings.budgetTokens=4096;f.p.ai.complete=async()=>{throw Error('summary offline');};
    await assert.rejects(f.p.context.fitSession(s,{role:'system',content:'task'},[],f.c),/offline/);assert.deepEqual(s.messages,before);
  }finally{await f.close();}
});
test('Cursor adapter uses exact resumable IDs, sandbox, and readable tool events without force approvals',async()=>{
  const id=randomUUID(),args=cursorArgs({path:'/repo',providerSessionId:id,model:'auto'},'Build');assert.equal(args[args.indexOf('--resume')+1],id);assert(args.includes('enabled'));assert(!args.includes('--force'));assert(!args.includes('--approve-mcps'));
  const event=cursorEvent({type:'tool_call',subtype:'completed',call_id:'read-1',tool_call:{readToolCall:{args:{path:'README.md'},result:{success:{content:'Hello'}}}}});assert.equal(event.name,'read');assert.equal(event.status,'completed');assert.match(event.output,/Hello/);
  assert.equal(cursorEvent({type:'assistant',message:{content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'Visible'}]}}).text,'Visible');
});
test('Cursor MCP configuration preserves existing servers and rejects conflicting entries',async()=>{
  const f=await fixture();try{
    await run('git',['init','-q'],{cwd:f.task.path});await mkdir(path.join(f.task.path,'.cursor'));const file=path.join(f.task.path,'.cursor/mcp.json');await writeFile(file,JSON.stringify({mcpServers:{existing:{command:'other'}}}));
    await cursorLaunchConfig(f.task,{command:'/node',args:['bridge','private-connection']});const config=JSON.parse(await readFile(file,'utf8'));assert.equal(config.mcpServers.existing.command,'other');assert.equal(config.mcpServers.heloscrum.command,'/node');
    await assert.rejects(cursorLaunchConfig(f.task,{command:'different',args:[]}),/different settings/);
  }finally{await f.close();}
});
test('Cursor runtime resumes the exact chat and persists split UTF-8 output and tool events',async()=>{
  const f=await fixture();try{
    const id=randomUUID(),invocations=[];f.task.kind='cursor';f.p.tools.cursor='/mock/cursor-agent';
    f.p.managed=new ManagedAgents(f.p,{execute:async(executable,args)=>{assert.equal(args[0],'create-chat');return id;},spawnProcess:(executable,args)=>{
      invocations.push(args);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
      setImmediate(()=>{const rows=[{type:'assistant',session_id:id,message:{content:[{type:'thinking',thinking:'Check the recorded result.',signature:'PRIVATE_SIGNATURE'},{type:'text',text:'模型 ready'}]}},{type:'tool_call',session_id:id,subtype:'completed',call_id:'read-'+invocations.length,tool_call:{readToolCall:{args:{path:'README.md'},result:{success:{content:'Hello'}}}}},{type:'result',session_id:id,result:'模型 ready'}];const bytes=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');for(const byte of bytes)child.stdout.write(Buffer.from([byte]));child.stdout.end();child.emit('close',0);});return child;
    }});
    const s=await f.p.managed.start(f.task);await f.p.managed.prompt(f.task.pane,'Read');await s.running;assert.equal(s.status,'done');assert.equal(s.events.filter(e=>e.role==='assistant').length,1);assert.equal(s.events.find(e=>e.type==='tool').name,'read');assert.equal(s.events.find(e=>e.type==='thinking').text,'Check the recorded result.');assert.doesNotMatch(JSON.stringify(s.events),/PRIVATE_SIGNATURE/);
    await f.p.managed.prompt(f.task.pane,'Again');await s.running;assert.equal(s.events.filter(e=>e.text==='模型 ready').length,2);assert(invocations.every(args=>args[args.indexOf('--resume')+1]===id));assert.equal((await f.p.managed.transcript(f.task)).events.filter(e=>e.type==='thinking').length,2);
  }finally{await f.close();}
});
test('managed agents remain discoverable when the native engine is offline',async()=>{
  const f=await fixture();try{await f.p.managed.start(f.task);const proxy=withManagedAgents({list:async()=>{throw Error('Herdr offline');}},f.p.managed);assert.equal((await proxy.list())[0].agent,'ollama');await assert.rejects(proxy.terminal(f.task.pane),/native terminal/);}finally{await f.close();}
});
test('endpoint runtime refreshes its scoped catalog without prompting a model',async()=>{
  const f=await fixture();try{
    let revision=1,reads=0,seen=0;f.p.collaboration.catalogRevision=()=>revision;f.p.collaboration.catalog=()=>{reads++;return {revision,tools:[]};};f.p.collaboration.seen=(task,value)=>{assert.equal(task.id,f.task.id);seen=value;};
    await f.p.managed.start(f.task);f.p.managed.list();f.p.managed.list();assert.equal(reads,1);assert.equal(seen,1);revision=2;f.p.managed.list();assert.equal(reads,2);assert.equal(seen,2);
  }finally{await f.close();}
});

test('interrupting a streamed tool request clears activity without executing incomplete work',async()=>{
  const f=await fixture();try{
    let stream;const client=new ModelClient({fetcher:async(url,{signal})=>new Response(new ReadableStream({start(c){stream=c;signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}}),{headers:{'content-type':'text/event-stream'}})});
    f.c.baseUrl='http://local.test/v1';f.p.ai.complete=(id,input)=>client.complete(f.c,null,input);
    const s=await f.p.managed.start(f.task);await f.p.managed.prompt(f.task.pane,'Create a file');
    for(let n=0;n<100&&!stream;n++)await new Promise(r=>setTimeout(r,5));assert(stream);
    assert.equal(f.p.managed.list()[0].modelActivity.phase,'waiting');
    stream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'write',function:{name:'workspace_write',arguments:'{"path":"never.txt","content":"incomplete"}'}}]}}]})+'\n\n'));
    await new Promise(r=>setImmediate(r));assert.equal(f.p.managed.list()[0].modelActivity.phase,'receiving');
    await f.p.managed.interrupt(f.task.pane);assert.equal(s.status,'idle');assert.equal(f.p.managed.list()[0].modelActivity,null);
    await assert.rejects(readFile(path.join(f.task.path,'never.txt')),{code:'ENOENT'});assert.equal(s.messages.filter(m=>m.role==='assistant').length,0);
    assert.match(s.events.at(-1).text,/Turn interrupted/);
    f.p.ai.complete=async(id,{onProgress})=>{onProgress({phase:'receiving'});return {message:{role:'assistant',content:'Ready for the next instruction'}};};
    await f.p.managed.prompt(f.task.pane,'Stop here');await s.running;assert.equal(s.status,'done');assert.equal(f.p.managed.list()[0].modelActivity,null);
    assert.equal(s.events.at(-1).text,'Ready for the next instruction');
  }finally{await f.close();}
});

test('failed local inference clears activity and keeps the user request without retrying',async()=>{
  const f=await fixture();try{
    let calls=0;f.p.ai.complete=async(id,{onProgress})=>{calls++;onProgress({phase:'waiting'});throw Object.assign(Error('The local model did not start responding within 300 seconds.'),{code:'MODEL_START_TIMEOUT'});};
    const s=await f.p.managed.start(f.task);await f.p.managed.prompt(f.task.pane,'Keep this request');await s.running;
    assert.equal(calls,1);assert.equal(s.status,'idle');assert.equal(f.p.managed.list()[0].modelActivity,null);assert.equal(s.messages[0].content,'Keep this request');
    assert.match(s.events.at(-1).text,/300 seconds/);
  }finally{await f.close();}
});
test('Jev assessments are bounded and gated by growth; hard budgets override continue',async()=>{
  const f=await fixture();try{
    const s=await f.p.managed.start(f.task);s.controller=new AbortController();f.p.data.contextSettings.budgetTokens=4096;f.p.data.contextSettings.decisionConnectionId='jev';
    s.messages=[{role:'user',content:'history '.repeat(1300)},{role:'assistant',content:'earlier'},{role:'user',content:'Keep the request verbatim.'},{role:'assistant',content:'tool A'},{role:'assistant',content:'tool B'}];
    let decisions=0;f.p.ai.decide=async(id,state)=>{decisions++;assert.equal(id,'jev');assert(JSON.stringify(state).length<4000);return {answers:{action:{choice:'continue',confidence:.99}}};};f.p.ai.complete=async()=>({message:{content:'Summary of prior work'}});
    const system={role:'system',content:'Pinned task'};await f.p.context.fitSession(s,system,[],f.c);await f.p.context.fitSession(s,system,[],f.c);assert.equal(decisions,1);assert.equal(s.summary,undefined);
    s.messages[0].content+=' added'.repeat(800);await f.p.context.fitSession(s,system,[],f.c);assert(s.summary);assert(s.messages.some(m=>m.content==='Keep the request verbatim.'));assert(estimateTokens([system,...s.messages])<=4096);
  }finally{await f.close();}
});


test('compaction retains the user request and keeps returned images with their tool exchange',async()=>{
  const f=await fixture();try{
    const s=await f.p.managed.start(f.task);s.controller=new AbortController();
    const request={role:'user',content:'Keep this requirement verbatim after inspecting the image.'};
    const call={role:'assistant',content:'',tool_calls:[{id:'image',function:{name:'attachment_read',arguments:'{}'}}]};
    const result={role:'tool',tool_call_id:'image',content:'Image supplied separately.'};
    const images={role:'user',content:[{type:'text',text:TOOL_IMAGE_NOTICE},{type:'image_url',image_url:{url:'heloscrum-image:fixture'}}]};
    s.messages=[{role:'user',content:'history '.repeat(4000)},{role:'assistant',content:'Earlier work'},request,call,result,images,{role:'assistant',content:'Image inspected'}];
    f.p.data.contextSettings.budgetTokens=5000;f.p.ai.complete=async()=>({message:{content:'Summary of earlier work'}});
    await f.p.context.fitSession(s,{role:'system',content:'Pinned task'},[],f.c);
    assert(s.summary);assert(s.messages.includes(request),'User instruction survives the synthetic image message');
    assert(s.messages.includes(call));assert(s.messages.includes(result));assert(s.messages.includes(images),'Image stays with the complete exchange');
  }finally{await f.close();}
});
