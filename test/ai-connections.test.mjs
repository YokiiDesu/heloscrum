import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,stat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AIConnections,connectionURL} from '../lib/ai-connections.mjs';
import {ModelClient,bedrockRequest,bedrockResponse,fetchJSON} from '../lib/model-client.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {randomUUID} from 'node:crypto';

async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-ai-'));const p={root,data:{tasks:[]},save:async()=>{},agentSettings:{cached:{}}};p.ai=await new AIConnections(p).init();p.context=new ContextManager(p);return {p,root,close:()=>rm(root,{recursive:true,force:true})};}
test('several same-provider connections retain independent URLs, model limits, and private keys',async()=>{
  const f=await fixture();try{
    const a=await f.p.ai.configure({kind:'ollama',name:'Laptop',model:'qwen3:8b',apiKey:'private-test-key',supportsTools:true});
    const b=await f.p.ai.configure({kind:'ollama',name:'Remote workstation',model:'qwen3:32b',baseUrl:'http://192.168.1.33:11434/v1',contextWindow:65536,supportsTools:true});
    assert.notEqual(a.id,b.id);assert.equal(a.location,'This backend computer');assert.equal(b.location,'Network endpoint');assert.equal(f.p.ai.get(b.id).contextWindow,65536);
    assert(!JSON.stringify(f.p.ai.list()).includes('private-test-key'));assert(!JSON.stringify(f.p.data).includes('private-test-key'));
    const file=path.join(f.root,'.heloscrum/ai-credentials.json');await assertPrivate(file);assert.equal(JSON.parse(await readFile(file,'utf8'))[a.id],'private-test-key');
    const updated=await f.p.ai.configure({...a,expectedRevision:a.revision,name:'Renamed',apiKey:''});assert(updated.hasKey);
    await assert.rejects(f.p.ai.configure({...a,expectedRevision:a.revision}),/changed/);
    await f.p.ai.configure({...updated,expectedRevision:updated.revision,clearKey:true});assert(!f.p.ai.list().connections[0].hasKey);
    const reloaded=await new AIConnections(f.p).init();assert(!reloaded.secrets[a.id]);
  }finally{await f.close();}
});
test('connection validation rejects credentials in URLs, invalid AWS settings and contradictory budgets',async()=>{
  const f=await fixture();try{
    for(const value of ['file:///etc/passwd','http://user:secret@localhost:11434/v1','http://localhost/v1?key=secret','http://169.254.169.254/v1'])assert.throws(()=>connectionURL(value));
    assert.equal(connectionURL('http://localhost:1111/v1/'),'http://localhost:1111/v1');
    assert.equal(connectionURL('http://localhost:1234'),'http://localhost:1234/v1');
    await assert.rejects(f.p.ai.configure({kind:'bedrock',name:'AWS',region:'--option'}),/region/);
    await assert.rejects(f.p.ai.configure({kind:'lmstudio',name:'Small',contextWindow:4096,maxOutputTokens:4096}),/leave room/);
  }finally{await f.close();}
});
test('repeated local setup reuses a connection without overwriting settings or credentials',async()=>{
  const f=await fixture();try{
    const draft={kind:'lmstudio',name:'Local',model:'test-model',supportsTools:true,apiKey:'test-only-key'};
    const results=await Promise.all([f.p.ai.configure(draft),f.p.ai.configure({...draft,name:'Clicked setup again',baseUrl:'http://localhost:1234/'})]);
    assert.equal(results[0].id,results[1].id);assert.equal(results[1].reused,true);assert.equal(f.p.ai.list().connections.length,1);
    assert.equal(f.p.ai.get(results[0].id).name,'Local');assert.equal(f.p.ai.get(results[0].id).revision,1);
    await assert.rejects(f.p.ai.configure({...draft,contextWindow:65536}),/already has a connection/);
    assert.equal(f.p.ai.secrets[results[0].id],'test-only-key');
    const otherModel=await f.p.ai.configure({...draft,model:'other-model'});
    const otherServer=await f.p.ai.configure({...draft,baseUrl:'http://localhost:1235/v1'});
    const otherAccount=await f.p.ai.configure({...draft,apiKey:'another-test-key'});
    assert.equal(new Set([results[0].id,otherModel.id,otherServer.id,otherAccount.id]).size,4);
  }finally{await f.close();}
});
test('unused local connections can be archived and restored without losing history or keys',async()=>{
  const f=await fixture();try{
    const c=await f.p.ai.configure({kind:'llamacpp',name:'Duplicate',model:'test-model',supportsTools:true,apiKey:'test-archive-key'});
    f.p.data.tasks.push({connectionId:c.id});
    await assert.rejects(f.p.ai.archive({id:c.id,expectedRevision:c.revision}),/still used/);
    f.p.data.tasks=[];f.p.data.agentProfiles=[{connectionId:c.id}];
    await assert.rejects(f.p.ai.archive({id:c.id,expectedRevision:c.revision}),/still used/);
    f.p.data.agentProfiles=[];f.p.data.contextSettings.summaryConnectionId=c.id;
    await assert.rejects(f.p.ai.archive({id:c.id,expectedRevision:c.revision}),/still used/);
    f.p.data.contextSettings.summaryConnectionId=null;
    const archived=await f.p.ai.archive({id:c.id,expectedRevision:c.revision});
    assert.equal(f.p.ai.list().connections.length,0);assert.equal(f.p.ai.list().archivedConnections[0].id,c.id);assert.equal((await f.p.ai.catalog('llamacpp')).length,0);
    assert.equal(f.p.ai.get(c.id).model,'test-model');assert.equal(f.p.ai.secrets[c.id],'test-archive-key');
    await assert.rejects(f.p.ai.archive({id:c.id,expectedRevision:c.revision,restore:true}),/changed/);
    await f.p.ai.archive({id:c.id,expectedRevision:archived.revision,restore:true});
    assert.equal(f.p.ai.list().connections[0].id,c.id);assert.equal(f.p.ai.list().archivedConnections.length,0);
  }finally{await f.close();}
});
test('Jev decisions and summary connections cannot be confused',async()=>{
  const f=await fixture();try{
    const jev=await f.p.ai.configure({kind:'jev',name:'Jev',apiKey:'key'}),llm=await f.p.ai.configure({kind:'lmstudio',name:'Summary',model:'local-model'});
    await assert.rejects(f.p.ai.configureContext({expectedRevision:0,summaryConnectionId:jev.id}),/language model/);
    await assert.rejects(f.p.ai.configureContext({expectedRevision:0,decisionConnectionId:llm.id}),/Jev/);
    const settings=await f.p.ai.configureContext({expectedRevision:0,decisionConnectionId:jev.id,summaryConnectionId:llm.id});assert.equal(settings.revision,1);
    await assert.rejects(f.p.ai.complete(jev.id,{messages:[]}),/Jev selects context/);
  }finally{await f.close();}
});
test('native summary connections use CLI accounts, require a model, and cannot enable agent tools',async()=>{
  const f=await fixture();try{
    f.p.ai.client.codex='/test/codex';f.p.ai.client.claude='/test/claude';
    for(const kind of ['codex-summary','claude-summary']){
      await assert.rejects(f.p.ai.configure({kind,name:'Summary',model:'sonnet',supportsTools:true}),/cannot create agent sessions/);
      await assert.rejects(f.p.ai.configure({kind,name:'Summary',model:'sonnet',apiKey:'key'}),/signed-in CLI account/);
      await assert.rejects(f.p.ai.configure({kind,name:'Summary'}),/Choose a model/);
    }
    const summary=await f.p.ai.configure({kind:'codex-summary',name:'Luna summary',model:'gpt-6-luna',contextWindow:64000,maxOutputTokens:2048});
    assert.equal(summary.supportsTools,false);assert.equal(summary.hasKey,false);
    const settings=await f.p.ai.configureContext({expectedRevision:0,summaryConnectionId:summary.id});assert.equal(settings.summaryConnectionId,summary.id);
  }finally{await f.close();}
});
test('OpenAI-compatible transport handles model catalogs, tool calls, exact URLs and authorization',async()=>{
  const calls=[],client=new ModelClient({fetcher:async(url,init)=>{calls.push([url,init]);return Response.json(url.endsWith('/models')?{data:[{id:'local-1'}]}:{model:'local-1',choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'workspace_read',arguments:'{"path":"README.md"}'}}]}}],usage:{prompt_tokens:10}});}});
  const c={kind:'ollama',baseUrl:'http://localhost:11435/v1',model:'local-1',maxOutputTokens:4096};
  assert.equal((await client.models(c,'secret'))[0].id,'local-1');
  const result=await client.complete(c,'secret',{messages:[{role:'user',content:'Read the README'}],tools:[{type:'function',function:{name:'workspace_read'}}]});
  assert.equal(result.message.tool_calls[0].id,'c1');assert.equal(calls[1][0],c.baseUrl+'/chat/completions');assert.equal(calls[1][1].headers.Authorization,'Bearer secret');assert.equal(calls[1][1].redirect,'error');
});
test('provider failures do not echo response content or silently retry an inference',async()=>{
  let n=0;await assert.rejects(fetchJSON('https://example.test',{fetcher:async()=>{n++;return new Response('private prompt / secret',{status:401});}}),e=>/HTTP 401/.test(e.message)&&!e.message.includes('private'));assert.equal(n,1);
});
test('model discovery works before saving and never forwards a saved key to a changed server',async()=>{
  const f=await fixture(),calls=[];try{
    f.p.ai.client.models=async(c,key)=>{calls.push({c,key});return [{id:'local-model'}];};
    const preview=await f.p.ai.discover({kind:'lmstudio'});
    assert.equal(preview.models[0].id,'local-model');assert.equal(f.p.data.aiConnections.length,0);
    assert.equal(calls[0].c.baseUrl,'http://127.0.0.1:1234/v1');
    const saved=await f.p.ai.configure({kind:'lmstudio',name:'Local',apiKey:'private-test-key'});
    await f.p.ai.discover(saved.id);assert.equal(calls.at(-1).key,'private-test-key');
    await f.p.ai.discover({id:saved.id,baseUrl:'http://localhost:1235/v1'});assert.equal(calls.at(-1).key,undefined);
    await f.p.ai.discover({id:saved.id,clearKey:true});assert.equal(calls.at(-1).key,undefined);
    await assert.rejects(f.p.ai.discover({kind:'lmstudio',baseUrl:'http://user:secret@localhost/v1'}),/without credentials/);
    assert.equal(f.p.data.aiConnections.length,1);assert.equal(saved.revision,1);
  }finally{await f.close();}
});
test('LM Studio discovery distinguishes loaded LLMs and uses the active context limit',async()=>{
  const client=new ModelClient({fetcher:async url=>Response.json(url.includes('/api/v1/')?{models:[
    {key:'unloaded',type:'llm',loaded_instances:[],max_context_length:999999},
    {key:'loaded',type:'llm',display_name:'Loaded Model',loaded_instances:[{id:'loaded',config:{context_length:36000}}],max_context_length:999999,capabilities:{trained_for_tool_use:true,vision:false}},
    {key:'embedding',type:'embedding',loaded_instances:[]}
  ]}:{data:[{id:'unloaded'},{id:'embedding'},{id:'loaded'}]})});
  const models=await client.models({kind:'lmstudio',baseUrl:'http://localhost:1234/v1'});
  assert.deepEqual(models.map(m=>m.id),['loaded','unloaded']);assert.equal(models[0].contextWindow,36000);
  assert.equal(models[0].supportsTools,true);assert.equal(models[0].supportsImages,false);assert.equal(models[1].loaded,false);
  const older=new ModelClient({fetcher:async url=>url.includes('/api/v1/')?new Response('',{status:404}):Response.json({data:[{id:'older'}]})});
  assert.equal((await older.models({kind:'lmstudio',baseUrl:'http://localhost:1234/v1'}))[0].id,'older');
});
test('Jev sends bounded typed decisions to the documented System One endpoint',async()=>{
  let sent;const client=new ModelClient({fetcher:async(url,init)=>{sent={url,...init};return Response.json({model:'jev-latest',answers:{action:{type:'choice',choice:'checkpoint',confidence:.8}}});}});
  const answer=await client.decide({kind:'jev',model:'jev-latest'},'key',{events:50},{action:{type:'choice',instructions:'Continue?',criteria:{continue:null,checkpoint:null}}});
  assert.equal(sent.url,'https://api.typesafe.ai/v1/systemone');assert.equal(JSON.parse(sent.body).questions.action.type,'choice');assert.equal(answer.answers.action.choice,'checkpoint');
  await assert.rejects(client.decide({kind:'jev'},'key','x'.repeat(25000),{}),/24,000/);
});
test('Bedrock exchanges preserve complete tool requests and replies with native Converse shapes',()=>{
  const messages=[{role:'system',content:'Constraints'},{role:'user',content:'Read'},{role:'assistant',content:'',tool_calls:[{id:'c',function:{name:'read',arguments:'{"path":"x"}'}}]},{role:'tool',tool_call_id:'c',content:'hello'}];
  const input=bedrockRequest('model',messages,[{function:{name:'read',description:'Read',parameters:{type:'object'}}}],2048);
  assert.equal(input.system[0].text,'Constraints');assert.equal(input.messages[1].content[0].toolUse.input.path,'x');assert.equal(input.messages[2].content[0].toolResult.toolUseId,'c');
  assert.equal(input.toolConfig.tools[0].toolSpec.inputSchema.json.type,'object');
  const output=bedrockResponse({output:{message:{content:[{text:'Working'},{toolUse:{toolUseId:'a',name:'read',input:{path:'x'}}}]}},usage:{inputTokens:10}});
  assert.equal(output.message.content,'Working');assert.equal(output.message.tool_calls[0].function.arguments,'{"path":"x"}');
});
test('AWS profiles use argument arrays and private request files, cleaned after invocation',async()=>{
  const calls=[];let temporary;
  const client=new ModelClient({aws:'/test/aws',execute:async(executable,args)=>{calls.push([executable,args]);temporary=args[args.indexOf('--cli-input-json')+1].slice(7);const body=JSON.parse(await readFile(temporary,'utf8'));assert.equal(body.modelId,'us.test-model');await assertPrivate(temporary);return JSON.stringify({output:{message:{content:[{text:'OK'}]}}});}});
  const result=await client.complete({kind:'bedrock',model:'us.test-model',region:'us-west-2',profile:'engineering'},null,{messages:[{role:'user',content:'Test'}]});
  assert.equal(result.message.content,'OK');assert(calls[0][1].includes('engineering'));await assert.rejects(stat(temporary),{code:'ENOENT'});
});
test('SageMaker invokes the configured endpoint with the chat-completion body',async()=>{
  const {writeFile}=await import('node:fs/promises');let argsSeen;
  const client=new ModelClient({execute:async(executable,args)=>{argsSeen=args;const file=args[args.indexOf('--body')+1].slice(8);const payload=JSON.parse(await readFile(file,'utf8'));assert.equal(payload.messages[0].content,'Test');await writeFile(args.at(-1),JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}]}));return '{}';}});
  const result=await client.complete({kind:'sagemaker',model:'local-1',region:'us-east-1',endpointName:'my-llm'},null,{messages:[{role:'user',content:'Test'}]});assert.equal(result.message.content,'OK');assert.equal(argsSeen[argsSeen.indexOf('--endpoint-name')+1],'my-llm');
});
test('oversized tool results are durable, paginated and isolated to the original agent identity',async()=>{
  const f=await fixture();try{
    const task={id:randomUUID(),project:f.root},other={...task,id:randomUUID()};f.p.data.contextSettings.toolResultChars=2000;
    const original={revision:23,audit:'a'.repeat(40000)},value=await f.p.context.bound(task,'work_get',original);
    assert(value.offloaded);assert(JSON.stringify(value).length<2000);
    const first=await f.p.context.read(task,{reference:value.reference,limit:1000});assert.equal(first.offset,0);assert.equal(first.nextOffset,1000);
    let recovered=first.text;for(let offset=first.nextOffset;offset!==null;){const page=await f.p.context.read({...task,providerSessionId:randomUUID()},{reference:value.reference,offset});recovered+=page.text;offset=page.nextOffset;}
    assert.deepEqual(JSON.parse(recovered),original);await assert.rejects(f.p.context.read(other,{reference:value.reference}),/not found/);await assert.rejects(f.p.context.read(task,{reference:'../escape'}),/Invalid/);
  }finally{await f.close();}
});
test('context assessment falls back to rules on Jev failure and sends only bounded records',async()=>{
  const f=await fixture();try{
    const task={id:randomUUID(),pane:'p',phase:'launched',prompt:'Goal',role:'QA',agentState:{metrics:{contextPercent:88}}};f.p.task=()=>task;f.p.herdr={list:async()=>[{pane_id:'p',agent_status:'done',interactive_ready:true}]};f.p.transcripts={readCurrent:async()=>({sessionId:'s',events:Array.from({length:500},()=>({type:'message',text:'x'.repeat(5000)}))})};f.p.data.contextSettings.decisionConnectionId=(await f.p.ai.configure({kind:'jev',name:'Decision',apiKey:'fixture'})).id;
    f.p.ai.decide=async(id,state)=>{assert(JSON.stringify(state).length<10000);throw Error('offline');};
    const result=await f.p.context.inspect(task.id,{evaluate:true});assert.equal(result.recommendation,'checkpoint');assert.equal(result.decisionError,'offline');assert(result.canCheckpoint);
  }finally{await f.close();}
});
test('context inference audit retains each attempt across rotations, including missing usage and failures',async()=>{
  const {readdir}=await import('node:fs/promises'),f=await fixture();try{
    const c=await f.p.ai.configure({kind:'jev',name:'Decision',apiKey:'secret-fixture'}),task={id:randomUUID(),project:f.root,providerSessionId:'before'};
    let calls=0;await f.p.context.measuredCall(task,'decision',c.id,async()=>{calls++;return {model:'jev-test',answers:{action:{choice:'checkpoint',confidence:.9}}};});
    task.providerSessionId='after';await f.p.context.measuredCall(task,'summary',c.id,async()=>{calls++;return {usage:{input_tokens:12,output_tokens:3}};});
    await assert.rejects(f.p.context.measuredCall(task,'summary',c.id,async()=>{calls++;throw Error('offline');}),/offline/);
    const dir=path.join(f.root,'.heloscrum/agents',task.id,'context-usage'),files=await readdir(dir),rows=await Promise.all(files.map(name=>readFile(path.join(dir,name),'utf8').then(JSON.parse)));
    assert.equal(calls,3);assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.requestId)).size,3);
    assert(rows.some(r=>r.sessionId==='before'&&r.status==='completed'&&r.usage===null));assert(rows.some(r=>r.sessionId==='after'&&r.usage?.input_tokens===12));assert(rows.some(r=>r.status==='failed'&&r.usage===null));
    assert(!JSON.stringify(rows).includes('secret-fixture'));assert(files.every(name=>name.endsWith('.json')));await assertPrivate(path.join(dir,files[0]));
  }finally{await f.close();}
});
test('context search returns bounded passages and preserves MCP image blocks',async()=>{
  const f=await fixture();try{
    const task={id:randomUUID(),project:f.root};f.p.data.contextSettings.toolResultChars=2000;
    const image={type:'image',mimeType:'image/png',data:'fixture-image'};
    const value=await f.p.context.bound(task,'mcp_lookup',{mcpResult:{content:[{type:'text',text:'filler '.repeat(900)+'Exact decision: keep the brass color. '+ 'filler '.repeat(900)},image]}});
    assert.deepEqual(value.mcpResult.content[1],image);const stored=JSON.parse(value.mcpResult.content[0].text);assert(stored.offloaded);
    const result=await f.p.context.search(task,{reference:stored.reference,query:'brass color'});assert(result.matches.some(m=>m.text.includes('brass color')));assert(result.matches.length<=6);assert(result.matches.every(m=>m.text.length<=1100));
    await assert.rejects(f.p.context.search({...task,id:randomUUID()},{reference:stored.reference,query:'brass'}),/not found/);
  }finally{await f.close();}
});
test('HTTP responses preserve UTF-8 split across network chunks',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({text:'模型 🦙'}));
  const data=await fetchJSON('https://example.test',{fetcher:async()=>new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}))});
  assert.equal(data.text,'模型 🦙');
});
