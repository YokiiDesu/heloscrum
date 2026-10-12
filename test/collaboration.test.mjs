import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Collaboration} from '../lib/collaboration.mjs';
import {responseStates} from '../lib/agent-state.mjs';
import {codexItems,claudeItems} from '../lib/transcripts.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-collab-'));const task={id:'11111111-1111-4111-a111-111111111111',title:'Build API',role:'Engineer',summary:'Implements the API',project:root,path:root,phase:'launched',pane:'one',kind:'codex'};const plane={root,data:{tasks:[task]},save:async()=>{},record:async()=>{},herdr:{list:async()=>[],prompt:async()=>{}}};const registry=new Collaboration(plane);return {root,plane,task,registry};}

test('contacts, exact delivery receipts, role summaries, project isolation and shared memory revisions',async()=>{
 const {root,plane,task,registry}=await fixture();try{
  const args=await registry.register(task);assert(args.some(a=>a.startsWith('mcp_servers.heloscrum.args=')));
  const qa={...task,id:'22222222-2222-4222-a222-222222222222',role:'QA',summary:'Regression tests',pane:'two'};plane.data.tasks.push(qa);await registry.register(qa);
  const catalog=registry.catalog(task),contact=catalog.contacts.find(c=>c.id===qa.id);assert.match(catalog.tools.find(t=>t.name===contact.tool).description,/Regression tests/);
  const receipt=await registry.call(task,contact.tool,{message:'Check expiry',requestId:'one'});assert.equal(receipt.delivery,'queued');assert.equal((await registry.call(task,contact.tool,{message:'Check expiry',requestId:'one'})).id,receipt.id);
  assert.equal((await registry.call(qa,'read_inbox')).messages[0].from,task.id);
  await assert.rejects(registry.send(task,'outside','Hello'),/not in your project/);
  let calls=[];plane.herdr={list:async()=>[{pane_id:'two',interactive_ready:true,agent_status:'working'}],prompt:async(...args)=>calls.push(args)};await registry.deliver();assert.equal(calls.length,0);
  plane.herdr.list=async()=>[{pane_id:'two',interactive_ready:true,agent_status:'idle'}];await registry.deliver();assert.equal(receipt.delivery,'delivered');assert.match(calls[0][1],/Check expiry/);await registry.deliver();assert.equal(calls.length,1);
  const reply=await registry.call(qa,'send_message',{to:task.id,message:'Expiry verified',replyTo:receipt.id});assert.equal(reply.replyTo,receipt.id);
  await registry.call(task,'memory_write',{key:'api-contract',text:'Expiry is inclusive',expectedRevision:0});await assert.rejects(registry.call(qa,'memory_write',{key:'api-contract',text:'Overwrite',expectedRevision:0}),/Memory changed/);assert.equal((await registry.call(qa,'memory_read',{key:'api-contract'})).notes[0].revision,1);
  assert.equal(registry.data.notifications[0].type,'contact');assert.equal(registry.snapshot(root).contacts[0].connected,true);assert.equal(registry.snapshot(root).contacts[0].discovery.seenRevision,undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('idempotent retries acknowledge groups and messages only after persistence succeeds',async()=>{
 const {root,plane,task,registry}=await fixture();
 try{
  const qa={...task,id:'22222222-2222-4222-a222-222222222222',role:'QA'},reviewer={...task,id:'33333333-3333-4333-a333-333333333333',role:'Reviewer'};plane.data.tasks.push(qa,reviewer);
  let fail=true;plane.save=async()=>{if(fail)throw Error('Disk unavailable');};
  const input={name:'Durable group',participants:[qa.id,reviewer.id],requestId:'create-once'};
  await assert.rejects(registry.groups.create(task,input),/Disk unavailable/);
  await assert.rejects(registry.groups.create(task,input),/Disk unavailable/);
  fail=false;const group=await registry.groups.create(task,input);assert.equal(registry.data.threads.length,1);
  for(const send of [()=>registry.send(task,qa.id,'Verify',{requestId:'dm-once'}),()=>registry.sendGroup(task,null,'Verify together',{threadId:group.id,requestId:'group-once'})]){
    fail=true;await assert.rejects(send(),/Disk unavailable/);const count=registry.data.messages.length;
    await assert.rejects(send(),/Disk unavailable/);assert.equal(registry.data.messages.length,count);
    fail=false;await send();assert.equal(registry.data.messages.length,count);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('registered executable tools validate schema and execute without a shell',async()=>{
 const {root,task,registry}=await fixture();try{
  await registry.addTool({name:'echo_json',description:'Echo a structured value',executable:process.execPath,args:['-e','process.stdin.on("data", b => process.stdout.write(JSON.parse(b).value))'],inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}},root);
  const result=await registry.call(task,'invoke_tool',{name:'echo_json',input:{value:'literal $(do-not-execute)'}});assert.equal(result.stdout,'literal $(do-not-execute)');assert.equal(result.exitCode,0);
  await assert.rejects(registry.call(task,'echo_json',{unexpected:true}),/schema/);assert.equal(registry.data.notifications[0].type,'tool');assert.equal(registry.data.notifications[0].detail,'echo_json has been added to the Toolbox');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('provider histories render the same session messages and tool results, excluding internal reasoning',()=>{
 const events=codexItems([{id:'turn',status:'completed',items:[{id:'u',type:'userMessage',content:[{type:'text',text:'Use `auth`'}]},{id:'a',type:'agentMessage',text:'## Done\n- Checked'},{id:'c',type:'commandExecution',command:'npm test',aggregatedOutput:'passed',status:'completed'},{id:'r',type:'reasoning',content:['internal']}]}]);assert.equal(events.length,4);assert.equal(events[2].output,'passed');assert.equal(events[3].text,'');assert.doesNotMatch(JSON.stringify(events),/internal/);
 const rows=[{uuid:'u',type:'assistant',message:{content:[{type:'text',text:'Working'},{type:'tool_use',id:'call',name:'Read',input:{file:'app.js'}}]}},{uuid:'v',type:'user',message:{content:[{type:'tool_result',tool_use_id:'call',content:[{type:'text',text:'source'}]}]}}];const claude=claudeItems([...rows,rows[0]]);assert.equal(claude.length,2);assert.equal(claude[1].output,'source');assert.equal(claude[1].status,'completed');
});

function bridge(file){const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url)),file],{stdio:['pipe','pipe','pipe']});let next=0;const pending=new Map(),notifications=[];const lines=createInterface({input:child.stdout});lines.on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else notifications.push(m);});child.stderr.on('data',()=>{});return {child,notifications,call(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('MCP timeout: '+method)),8000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});},notify(method){child.stdin.write(JSON.stringify({jsonrpc:'2.0',method})+'\n');}};}

test('two live MCP clients discover contacts and tools after list-change notifications and exchange direct messages',async()=>{
 const {root,plane,task,registry}=await fixture();let a,b,server;
 try{
  server=http.createServer(async(req,res)=>{try{const agent=registry.authenticate(req.headers.authorization?.replace('Bearer ',''));let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};let value;if(req.url==='/agent-api/catalog'){registry.heartbeat(agent);value=registry.catalog(agent);}else if(req.url==='/agent-api/listed'){registry.seen(agent,input.revision);value={ok:true};}else value=await registry.call(agent,input.name,input.input);res.setHeader('content-type','application/json');res.end(JSON.stringify(value));}catch(error){res.writeHead(error.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
  await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});plane.baseUrl='http://127.0.0.1:'+server.address().port;
  await registry.register(task);a=bridge(path.join(root,'.heloscrum/agents',task.id,'connection.json'));await a.call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test-a',version:'1'}});a.notify('notifications/initialized');await a.call('tools/list');
  const qa={...task,id:'22222222-2222-4222-a222-222222222222',role:'QA',summary:'Regression tests',pane:'two'};plane.data.tasks.push(qa);await registry.register(qa);
  for(let i=0;i<50&&!a.notifications.some(n=>n.method==='notifications/tools/list_changed');i++)await delay(100);
  assert(a.notifications.some(n=>n.method==='notifications/tools/list_changed'));
  const tools=await a.call('tools/list'),qaTool=tools.tools.find(t=>t.name.startsWith('chat_qa_'));assert(qaTool);
  const sent=await a.call('tools/call',{name:qaTool.name,arguments:{message:'Please verify the API'}});const receipt=JSON.parse(sent.content[0].text);assert.equal(receipt.to,qa.id);
  b=bridge(path.join(root,'.heloscrum/agents',qa.id,'connection.json'));await b.call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test-b',version:'1'}});b.notify('notifications/initialized');await b.call('tools/list');const inbox=await b.call('tools/call',{name:'read_inbox',arguments:{}});assert.equal(JSON.parse(inbox.content[0].text).messages[0].text,'Please verify the API');
  const builder={...task,id:'33333333-3333-4333-a333-333333333333',role:'Builder',pane:'three'};plane.data.tasks.push(builder);await registry.register(builder);
  const groupTools=await a.call('tools/list');for(const name of ['create_group','list_groups','read_group','send_group_message','set_chat_status','ask_user'])assert(groupTools.tools.some(t=>t.name===name));
  const created=await a.call('tools/call',{name:'create_group',arguments:{name:'Protocol group',participants:[qa.id,builder.id],requestId:'group-once'}}),group=JSON.parse(created.content[0].text);
  const groupSent=await a.call('tools/call',{name:'send_group_message',arguments:{threadId:group.id,message:'Shared acceptance criteria',kind:'request',requestId:'send-once'}});assert.equal(JSON.parse(groupSent.content[0].text).deliveries.length,2);
  const readGroup=await b.call('tools/call',{name:'read_group',arguments:{threadId:group.id}});assert.equal(JSON.parse(readGroup.content[0].text).messages[0].text,'Shared acceptance criteria');
  const asked=await b.call('tools/call',{name:'ask_user',arguments:{threadId:group.id,question:'Which scenario should I prioritize?',options:['Overflow','Cycles'],requestId:'ask-once'}});const question=JSON.parse(asked.content[0].text);assert.equal(question.status,'pending');assert.equal(question.response,null);assert(registry.snapshot(root).notifications.some(n=>n.requestId===question.requestId));
  await registry.addTool({name:'refresh_fixture',description:'A test-only tool',executable:process.execPath,args:['-e','console.log("refreshed")']},root);
  for(let i=0;i<60&&!b.notifications.some(n=>n.method==='notifications/tools/list_changed');i++)await delay(100);assert(b.notifications.some(n=>n.method==='notifications/tools/list_changed'));assert((await b.call('tools/list')).tools.some(t=>t.name==='refresh_fixture'));
  const call=await b.call('tools/call',{name:'refresh_fixture',arguments:{}});assert.equal(JSON.parse(call.content[0].text).stdout,'refreshed\n');
  await registry.setScope(qa,{mode:'selected',allowed:[],expectedRevision:0});
  const restricted=await b.call('tools/list');assert(!restricted.tools.some(t=>t.name==='refresh_fixture'));const denied=await b.call('tools/call',{name:'invoke_tool',arguments:{name:'refresh_fixture',input:{}}});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/outside/);
  await delay(30);assert.equal(registry.snapshot(root).contacts.find(c=>c.id===qa.id).discovery.seenRevision,registry.data.revision);
  const previousNotices=b.notifications.length,otherRevision=registry.catalog(task).revision;
  const refresh=await registry.refreshContacts(root,qa.id);
  assert.equal(registry.catalog(task).revision,otherRevision,'refresh is scoped to the selected contact');
  assert(registry.snapshot(root).contacts.find(c=>c.id===qa.id).discovery.seenRevision<refresh.revision,'requesting does not fake acknowledgment');
  for(let i=0;i<60&&b.notifications.length===previousNotices;i++)await delay(100);
  assert(b.notifications.length>previousNotices,'the live bridge requests tool-list discovery');
  await b.call('tools/list');await delay(30);
  assert.equal(registry.snapshot(root).contacts.find(c=>c.id===qa.id).discovery.seenRevision,refresh.revision);

 }finally{a?.child.kill();b?.child.kill();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('per-agent scopes filter discovery and block invocation bypasses, including future tools',async()=>{
 const {root,plane,task,registry}=await fixture();try{
  const other={...task,id:'22222222-2222-4222-a222-222222222222',role:'QA'};plane.data.tasks.push(other);
  await registry.addTool({name:'read_fixture',description:'Fixture',executable:process.execPath,args:['-e','console.log("OK")']},root);
  await registry.setScope(task,{mode:'selected',allowed:['memory_read'],expectedRevision:0,supportAgentId:null});
  assert(!registry.catalog(task).tools.some(t=>t.name==='read_fixture'));assert(registry.catalog(other).tools.some(t=>t.name==='read_fixture'));
  await assert.rejects(registry.call(task,'read_fixture',{}),e=>e.status===403);await assert.rejects(registry.call(task,'invoke_tool',{name:'read_fixture',input:{}}),e=>e.status===403);
  await assert.rejects(registry.call(task,'memory_write',{key:'x',text:'x',expectedRevision:0}),e=>e.status===403);
  await registry.addTool({name:'future_fixture',description:'New fixture',executable:process.execPath,args:[]},root);assert(!registry.catalog(task).tools.some(t=>t.name==='future_fixture'));
  await assert.rejects(registry.setScope(task,{mode:'all',allowed:[],expectedRevision:0}),/changed/);
  assert((await registry.call(task,'contact_book')).contacts.some(c=>c.id===other.id));assert(registry.catalog(task).tools.some(t=>t.name==='report_state'));
  await registry.setScope(task,{mode:'selected',allowed:['read_fixture'],expectedRevision:1});assert.equal((await registry.call(task,'read_fixture',{})).stdout,'OK\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('state reports preserve unknown metrics and support requests route to a real contact without looping',async()=>{
 const {root,plane,task,registry}=await fixture();try{
  const coach={...task,id:'22222222-2222-4222-a222-222222222222',role:'Therapist',roleType:'recovery',summary:'Recovery planning'};plane.data.tasks.push(coach);
  const report=await registry.call(task,'report_state',{state:'overloaded',reason:'The same test has failed three times',nextStep:'Ask for a smaller verification plan'});assert.equal(report.source,'agent');assert.equal(report.metrics,undefined);
  await assert.rejects(registry.call(task,'report_state',{state:'happy',reason:'x',nextStep:'x'}),/supported/);
  await assert.rejects(registry.call(task,'report_state',{state:'focused',reason:'x',nextStep:'x',metrics:{contextPercent:101}}),/Invalid/);
  const input={goal:'Fix session expiry',summary:'Repeated attempts did not change the failure',attempts:['Checked comparison','Changed test clock']};
  await assert.rejects(registry.call(task,'request_support',input),/No recovery coach/);
  await registry.setScope(task,{mode:'selected',allowed:[],expectedRevision:0,supportAgentId:coach.id});
  const request=await registry.call(task,'request_support',input),again=await registry.call(task,'request_support',input);assert.equal(request.messageId,again.messageId);assert.equal(registry.data.messages.length,1);assert.equal(request.receipt.to,coach.id);assert.match(request.receipt.text,/Fix session expiry/);assert.match(request.receipt.text,/Reported work state: overloaded/);assert.match(request.receipt.text,/The same test has failed three times/);assert.match(request.receipt.text,/Ask for a smaller verification plan/);
  await assert.rejects(registry.call(coach,'request_support',input),/cannot|must reply/);
  const reply=await registry.call(coach,'send_message',{to:task.id,replyTo:request.messageId,message:'Freeze the clock and run one boundary test.'});assert.equal(registry.data.supportRequests[0].replyId,reply.id);assert.equal((await registry.call(task,'read_inbox')).messages[0].id,reply.id);
  await assert.rejects(registry.call(task,'request_support',input),/Wait a minute/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('response pills require a successful preceding state call and never backfill old responses',()=>{
 const report={state:'stuck',reason:'Repeated failure',nextStep:'Read the failing assertion'};
 const events=codexItems([{id:'turn',status:'completed',items:[{id:'old',type:'agentMessage',text:'Old response'},{id:'state',type:'mcpToolCall',server:'heloscrum',tool:'report_state',arguments:report,status:'completed',result:{content:[]}},{id:'new',type:'agentMessage',text:'Trying a smaller step'},{id:'missing',type:'agentMessage',text:'No new report'}]}]);
 assert.equal(events[0].agentState,null);assert.equal(events[1].type,'state');assert.equal(events[2].agentState.state,'stuck');assert.equal(events[3].agentState,null);
 const failed=codexItems([{id:'turn',status:'completed',items:[{id:'state',type:'mcpToolCall',server:'heloscrum',tool:'report_state',arguments:report,status:'completed',result:{isError:true}},{id:'a',type:'agentMessage',text:'Hello'}]}]);assert.equal(failed[1].agentState,null);
 const interrupted=codexItems([{id:'one',status:'completed',items:[{id:'state',type:'mcpToolCall',server:'heloscrum',tool:'report_state',arguments:report,status:'completed'}]},{id:'two',status:'completed',items:[{id:'answer',type:'agentMessage',text:'New turn'}]}]);assert.equal(interrupted[1].agentState,null);
 const claude=claudeItems([{uuid:'tool',type:'assistant',message:{content:[{type:'tool_use',id:'s',name:'mcp__heloscrum__report_state',input:report}]}},{uuid:'result',type:'user',message:{content:[{type:'tool_result',tool_use_id:'s',content:'Recorded'}]}},{uuid:'answer',type:'assistant',message:{content:[{type:'text',text:'One next check.'}]}}]);assert.equal(claude[1].agentState.state,'stuck');
});


test('contact refreshes persist per-agent revisions and require a fresh runtime acknowledgment',async()=>{
 const {root,plane,task,registry}=await fixture();try{
  const qa={...task,id:'22222222-2222-4222-a222-222222222222',role:'QA'},outside={...task,id:'outside',project:'elsewhere'};plane.data.tasks.push(qa,outside);
  registry.seen(task,registry.catalog(task).revision);registry.seen(qa,registry.catalog(qa).revision);
  const base=registry.data.revision,first=await registry.refreshContacts(root,task.id);
  assert.equal(registry.data.revision,base);assert.equal(registry.catalog(qa).revision,base);assert(registry.catalog(task).revision>base);
  assert.equal(registry.snapshot(root).contacts.find(c=>c.id===task.id).discovery.seenRevision,base);
  assert.throws(()=>registry.seen(qa,first.revision),/Invalid/);
  registry.heartbeat(task);assert.equal(registry.connections.get(task.id).seenRevision,base,'a heartbeat is not a tool-list fetch');
  registry.seen(task,first.revision);assert.equal(registry.connections.get(task.id).seenRevision,first.revision);
  await assert.rejects(registry.refreshContacts(root,outside.id),/not found/);
  const all=await registry.refreshContacts(root);assert.equal(all.requested.length,2);assert.equal(registry.catalog(qa).revision,all.revision);assert.equal(registry.catalog(outside).revision,base);
  const restored=new Collaboration(plane);assert.equal(restored.catalog(task).revision,all.revision);assert.equal(restored.connections.get(task.id),undefined);
  await restored.notify('tool','fixture','Tool changed',root);assert(restored.data.revision>all.revision,'future catalog changes cannot fall behind manual refreshes');
  assert.equal(restored.catalog(task).revision,restored.data.revision);assert.equal(registry.data.messages.length,0,'refresh does not inject prompts or messages');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unchanged state reports are coalesced with small receipts but changed evidence is preserved',async()=>{
 const {root,task,registry}=await fixture();try{
  const input={state:'stuck',reason:'Three attempts fail on the same assertion',nextStep:'Check the fixture',metrics:{repeatedFailures:3}};
  const first=await registry.call(task,'report_state',input),before=task.agentState;
  const second=await registry.call(task,'report_state',{...input,metrics:{repeatedFailures:3}});
  assert(first.recorded);assert.equal(second.recorded,false);assert.equal(registry.data.stateReports.length,1);assert.equal(task.agentState,before);assert(JSON.stringify(first).length<100);
  await registry.call(task,'report_state',{...input,nextStep:'Inspect the boundary condition'});assert.equal(registry.data.stateReports.length,2);
  await registry.call(task,'report_state',{state:'focused',reason:'The boundary fix passed',nextStep:'Resume the assigned task'});assert.equal(registry.data.stateReports.length,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('one support call can record the blocker state without a separate state tool round trip',async()=>{
 const {root,plane,task,registry}=await fixture();try{
  const coach={...task,id:'coach',role:'Therapist',roleType:'recovery'};plane.data.tasks.push(coach);task.supportAgentId=coach.id;
  const input={goal:'Finish the import',summary:'Two requirements conflict',attempts:['Read both source documents'],state:'uncertain'};
  const result=await registry.call(task,'request_support',input);assert.equal(task.agentState.state,'uncertain');assert.equal(registry.data.stateReports.length,1);assert.match(result.receipt.text,/Reported work state: uncertain/);
  await registry.call(task,'request_support',input);assert.equal(registry.data.stateReports.length,1);assert.equal(registry.data.messages.length,1);
  await registry.call(task,'request_support',{...input,state:'stuck'});assert.equal(task.agentState.state,'stuck');assert.equal(registry.data.messages.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('state signals survive deferred tool dispatch and combined support requests',()=>{
 const state={state:'uncertain',reason:'Two incompatible specifications',nextStep:'Ask which applies'};
 const events=codexItems([{id:'turn',status:'completed',items:[{id:'s',type:'mcpToolCall',server:'heloscrum',tool:'invoke_tool',arguments:{name:'report_state',input:state},status:'completed'},{id:'a',type:'agentMessage',text:'Which requirement takes priority?'}]}]);
 assert.equal(events[0].type,'state');assert.equal(events[1].agentState.state,'uncertain');
 const withCommand=responseStates([{type:'tool',name:'heloscrum / report_state',input:state,status:'completed'},{type:'tool',name:'Terminal command',input:'node --test',status:'completed'},{type:'message',role:'assistant',text:'The contradiction remains'}]);assert.equal(withCommand.at(-1).agentState.state,'uncertain');
 const support=codexItems([{id:'turn',status:'completed',items:[{id:'s',type:'mcpToolCall',server:'heloscrum',tool:'invoke_tool',arguments:{name:'request_support',input:{state:'stuck',summary:'Repeated failure',goal:'Finish',attempts:[]}},status:'completed'},{id:'a',type:'agentMessage',text:'Waiting for the recovery plan.'}]}]);
 assert.equal(support[0].type,'tool');assert.equal(support[1].agentState.state,'stuck');
});
