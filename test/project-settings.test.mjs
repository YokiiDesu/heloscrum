import {assertPrivate} from './private-file-assert.mjs';
import {fileURLToPath} from 'node:url';
import {SCRUM_MASTER_ID,THERAPIST_ID,ORCHESTRATOR_ID,therapistProfile} from '../lib/agent-profiles.mjs';
import {RECOVERY_BRIEF} from '../lib/agent-state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Collaboration} from '../lib/collaboration.mjs';
import {ProjectSettings} from '../lib/project-settings.mjs';
import {ProjectLibrary} from '../lib/project-library.mjs';
import {McpConnections,mcpToolName} from '../lib/mcp-connections.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';
import {NativeSetup} from '../lib/native-setup.mjs';
const script=fileURLToPath(new URL('./fixtures/mcp-tools.mjs',import.meta.url));
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-settings-')),other=path.join(root,'other');await mkdir(other);
  const a={id:'agent-a',role:'Builder',title:'Build',summary:'Build apps',prompt:'Test carefully',project:root,path:root,kind:'codex',phase:'launched'},b={...a,id:'agent-b',role:'QA'},c={...a,id:'agent-c',project:other,path:other};
  const p={root,data:{project:root,projects:[{path:root},{path:other}],tasks:[a,b,c],events:[]},tools:{codex:true,herdr:true},save:async()=>{},record:async()=>{},herdr:{list:async()=>[]}};
  p.task=id=>p.data.tasks.find(t=>t.id===id);p.projects=new ProjectLibrary(p);p.collaboration=new Collaboration(p);p.projectSettings=new ProjectSettings(p);p.mcp=await new McpConnections(p).init();
  return {p,root,other,a,b,c,close:async()=>{await p.mcp.close();await rm(root,{recursive:true,force:true});}};
}
const local={name:'echo_settings',description:'A test tool',executable:process.execPath,args:['-e','console.log("ok")']};

test('local tools move project/global scope and enforce agent assignments on direct and fallback calls',async()=>{
  const f=await fixture(),{p,a,b,c,root,other}=f;
  try{
    await p.collaboration.addTool(local,root);const tool=p.collaboration.data.tools[0];
    assert(p.collaboration.catalog(a).tools.some(t=>t.name===local.name));assert(!p.collaboration.catalog(c).tools.some(t=>t.name===local.name));
    await p.projectSettings.updateTool({id:tool.id,expectedRevision:0,scope:'global'});
    assert.equal((await p.collaboration.call(c,local.name,{})).stdout,'ok\n');
    b.toolPolicy={mode:'selected',allowed:[],revision:0};
    await p.projectSettings.updateTool({id:tool.id,expectedRevision:1,scope:'project',project:root,assignment:'selected',agentIds:[b.id]});
    assert(p.collaboration.catalog(b).tools.some(t=>t.name===local.name),'explicit assignment enables a selected toolbox');
    await assert.rejects(p.collaboration.call(a,'invoke_tool',{name:local.name,input:{}}),/not registered/);
    await assert.rejects(p.collaboration.call(c,local.name,{}),/not registered/);
    await assert.rejects(p.projectSettings.updateTool({id:tool.id,expectedRevision:1,scope:'global'}),/changed/);
    await p.projectSettings.updateTool({id:tool.id,expectedRevision:2,scope:'project',project:other,assignment:'all'});
    assert(!p.collaboration.catalog(b).tools.some(t=>t.name===local.name));assert(p.collaboration.catalog(c).tools.some(t=>t.name===local.name));
    await p.collaboration.addTool(local,root);await assert.rejects(p.projectSettings.updateTool({id:tool.id,expectedRevision:3,scope:'global'}),/Another tool/);
    await assert.rejects(p.collaboration.addTool({...local,name:'mcp_reserved'},root),/unique/);
  }finally{await f.close();}
});

test('global profiles start independent project tasks, share historical appearance, and can be restricted again',async()=>{
  const f=await fixture(),{p,a,root,other}=f;
  try{
    const profile=await p.projectSettings.saveProfile({sourceTaskId:a.id,scope:'global',appearance:{color:'mint',icon:'globe'}});
    assert.equal(a.profileId,profile.id);assert.equal(a.project,root);assert.equal(a.prompt,'Test carefully');
    assert.equal(p.projectSettings.prepareTask({profileId:profile.id,prompt:'Coach this task',roleType:'recovery'},root).roleType,'recovery');
    p.data.project=other;p.nativeSetup=new NativeSetup(p);p.agentSettings={validateEffort:async()=>null};p.git={create:async(project,branch)=>({id:branch,path:project})};p.dispatch=()=>{};
    const task=await ControlPlane.prototype.createTask.call(p,{profileId:profile.id,title:'New project work',branch:'test/profile',prompt:'Review this project'});
    assert.notEqual(task.id,a.id);assert.equal(task.project,other);assert.match(task.prompt,/Test carefully\n\nTask in this project:\nReview this project/);assert.equal(task.kind,a.kind);
    task.archivedAt='2026-10-05';
    await p.projectSettings.saveProfile({id:profile.id,expectedRevision:1,scope:'project',project:root,appearance:{color:'rose',icon:'shield-check'}});
    assert.equal(task.appearance.color,'rose');assert.equal(a.appearance.icon,'shield-check');assert.equal(task.project,other);
    assert.throws(()=>p.projectSettings.prepareTask({profileId:profile.id,prompt:'No access'},other),/not available/);
    await p.projects.appearance(a.id,{color:'sky',icon:'brain'});
    assert.equal(task.appearance.color,'sky');assert.equal(p.projectSettings.profile(profile.id).appearance.icon,'brain');
  }finally{await f.close();}
});

test('MCP stdio discovery paginates, namespaces duplicate names and revokes selected-agent calls immediately',async()=>{
  const f=await fixture(),{p,a,b,c,root}=f;
  try{
    b.toolPolicy={mode:'selected',allowed:[],revision:0};
    const server=await p.mcp.configure({name:'Knowledge',transport:'stdio',command:process.execPath,args:[script],scope:'global',assignment:'selected',agentIds:[b.id]});
    const found=await p.mcp.discover(server.id);assert.equal(found.tools.length,2);
    const name=mcpToolName(server.id,'search_documentation');assert(p.collaboration.catalog(b).tools.some(t=>t.name===name&&t.source.name==='Knowledge'));
    assert(mcpToolName(server.id,'a'.repeat(200)).length<=64);
    assert(!p.collaboration.catalog(a).tools.some(t=>t.name===name));
    b.path=path.join(root,'agent-worktree');await mkdir(b.path);
    const result=await p.collaboration.call(b,'invoke_tool',{name,input:{query:'Literal query'}});assert.equal(result.mcpResult.content[0].text,'Literal query');assert.equal(await import('node:fs/promises').then(fs=>fs.realpath(result.mcpResult.structuredContent.cwd)),await import('node:fs/promises').then(fs=>fs.realpath(b.path)),'local tools run in the assigned agent worktree');
    const error=await p.collaboration.call(b,name,{query:'failure'});assert.equal(error.mcpResult.isError,true);
    b.toolPolicy.allowed=[];await p.mcp.discover(server.id);assert(!p.collaboration.catalog(b).tools.some(t=>t.name===name),'refresh preserves manually excluded tools');b.toolPolicy.allowed=[name];
    const second=await p.mcp.configure({name:'Other Knowledge',transport:'stdio',command:process.execPath,args:[script],scope:'global'});await p.mcp.discover(second.id);
    assert.notEqual(name,mcpToolName(second.id,'search_documentation'));assert(p.collaboration.catalog(c).tools.some(t=>t.source?.id===second.id));
    await p.mcp.configure({id:server.id,expectedRevision:server.revision,scope:'project',project:root,assignment:'selected',agentIds:[a.id]});
    await assert.rejects(p.collaboration.call(b,'invoke_tool',{name,input:{}}),/not registered/);
    assert(p.collaboration.catalog(a).tools.some(t=>t.name===name));
    const revision=p.mcp.get(server.id).revision;
    const outcomes=await Promise.allSettled([p.mcp.configure({id:server.id,expectedRevision:revision,enabled:false}),p.mcp.configure({id:server.id,expectedRevision:revision,scope:'global'})]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert(!p.collaboration.catalog(a).tools.some(t=>t.name===name));
  }finally{await f.close();}
});

test('MCP profile assignments follow availability and new sessions; stale in-flight calls recheck per-agent policy',async()=>{
  const f=await fixture(),{p,a,b,c}=f;
  try{
    const profile=await p.projectSettings.saveProfile({sourceTaskId:a.id,scope:'global'});c.profileId=profile.id;
    const server=await p.mcp.configure({name:'Profile MCP',transport:'stdio',command:process.execPath,args:[script],scope:'global',assignment:'selected',profileIds:[profile.id]});await p.mcp.discover(server.id);
    const name=mcpToolName(server.id,'search_documentation');assert(p.collaboration.catalog(c).tools.some(t=>t.name===name));assert(!p.collaboration.catalog(b).tools.some(t=>t.name===name));
    const original=p.mcp.open.bind(p.mcp);p.mcp.open=async(...args)=>{const connection=await original(...args);a.toolPolicy={mode:'selected',allowed:[],revision:1};return connection;};
    await assert.rejects(p.collaboration.call(a,name,{}),/access changed/);p.mcp.open=original;
    await p.projectSettings.saveProfile({id:profile.id,expectedRevision:1,scope:'project',project:a.project});
    assert(!p.collaboration.catalog(c).tools.some(t=>t.name===name));assert.equal(c.profileId,profile.id);
  }finally{await f.close();}
});

test('MCP HTTP credentials stay private, survive restart and authenticate protocol discovery/calls',async()=>{
  const f=await fixture(),{p,a,root}=f;let requests=[],bridge;
  const server=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/agent-api/')){
      try{
        const task=p.collaboration.authenticate(req.headers.authorization?.replace('Bearer ',''));let raw='';for await(const chunk of req)raw+=chunk;const data=raw?JSON.parse(raw):{};
        const result=req.url.endsWith('/catalog')?p.collaboration.catalog(task):req.url.endsWith('/listed')?(p.collaboration.seen(task,data.revision),{ok:true}):await p.collaboration.call(task,data.name,data.input);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
      }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
      return;
    }
    requests.push(req.headers.authorization);
    if(req.method!=='POST'){res.writeHead(405);res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;const m=JSON.parse(raw);
    if(m.id===undefined){res.writeHead(202);res.end();return;}
    const result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'HTTP fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'read_docs',description:'Read docs',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'HTTP docs'},{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}],structuredContent:{page:'documentation'},isError:m.params?.arguments?.fail===true};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const connection=await p.mcp.configure({name:'HTTP Knowledge',transport:'http',url:`http://127.0.0.1:${server.address().port}/mcp`,headers:{Authorization:'Bearer fixture-only-secret'},scope:'project',project:root});
    assert(connection.hasCredentials);assert(!JSON.stringify(connection).includes('fixture-only-secret'));assert(!JSON.stringify(p.data).includes('fixture-only-secret'));
    await assertPrivate(path.join(root,'.heloscrum/mcp-secrets.json'));
    assert((await readFile(path.join(root,'.heloscrum/mcp-secrets.json'),'utf8')).includes('fixture-only-secret'));
    await p.mcp.discover(connection.id);const result=await p.collaboration.call(a,mcpToolName(connection.id,'read_docs'),{});assert.equal(result.mcpResult.content[0].text,'HTTP docs');assert(requests.every(h=>h==='Bearer fixture-only-secret'));
    p.baseUrl=`http://127.0.0.1:${server.address().port}`;await p.collaboration.register(a);
    bridge=new Client({name:'Bridge integration test',version:'1'},{capabilities:{}});
    const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url)),path.join(root,'.heloscrum/agents',a.id,'connection.json')],stderr:'pipe'});transport.stderr.on('data',()=>{});await bridge.connect(transport);
    const name=mcpToolName(connection.id,'read_docs');assert((await bridge.listTools()).tools.some(t=>t.name===name));
    const native=await bridge.callTool({name,arguments:{fail:true}});assert.equal(native.isError,true);assert.equal(native.content[0].text,'HTTP docs');assert.equal(native.content[1].type,'image');assert.deepEqual(native.structuredContent,{page:'documentation'});
    await bridge.close();bridge=null;
    await p.mcp.close();p.mcp=await new McpConnections(p).init();assert(p.mcp.public(p.mcp.get(connection.id)).hasCredentials);
    await assert.rejects(p.mcp.configure({name:'Bad',transport:'http',url:'http://public.example/mcp'}),/HTTPS/);
    await assert.rejects(p.mcp.configure({name:'Bad',transport:'http',url:'https://example.com/mcp?token=secret'}),/Headers/);
    await p.mcp.configure({id:connection.id,expectedRevision:connection.revision,clearCredentials:true});assert(!p.mcp.public(p.mcp.get(connection.id)).hasCredentials);
  }finally{await bridge?.close();await f.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Scrum Master is a durable global template; duplicate profiles are independent and customizable',async()=>{
  const f=await fixture();try{
    const settings=f.p.projectSettings,template=settings.directory(f.root).profiles.find(p=>p.builtIn);
    assert.equal(template.name,'Scrum Master');assert.equal(template.scope,'global');assert.match(template.instructions,/must not assign work/);
    const copy=await settings.saveProfile({sourceProfileId:template.id,name:'Project facilitator',kind:'kiro',scope:'project',project:f.other,instructions:'Facilitate using our team agreement.',appearance:{color:'rose',icon:'brain'}});
    assert.notEqual(copy.id,template.id);assert(!copy.builtIn);assert.equal(copy.sourceProfileId,template.id);assert.equal(copy.kind,'kiro');assert.equal(copy.project,f.other);
    await settings.saveProfile({id:copy.id,expectedRevision:copy.revision,summary:'Custom Scrum facilitator'});
    assert.equal(settings.profile(template.id).name,'Scrum Master');assert.notEqual(settings.profile(template.id).instructions,copy.instructions);
    await assert.rejects(settings.saveProfile({id:template.id,expectedRevision:template.revision,name:'Overwrite default'}),/Duplicate/);
    const restarted=new ProjectSettings(f.p);assert.equal(restarted.directory(f.other).profiles.filter(p=>p.builtIn).length,3);
    assert.match(restarted.prepareTask({profileId:template.id,prompt:'Help this project plan a sprint'},f.other).prompt,/Scrum Master/);
  }finally{await f.close();}
});


test('new team templates migrate once, preserve saved profiles and sessions, and keep recovery role on copies',async()=>{
  const f=await fixture();try{
    const settings=f.p.projectSettings,initialTasks=structuredClone(f.p.data.tasks);
    const therapist=settings.profile(THERAPIST_ID),orchestrator=settings.profile(ORCHESTRATOR_ID);
    assert.equal(therapist.roleType,'recovery');assert.equal(orchestrator.roleType,'worker');
    assert.equal(therapist.scope,'global');assert.equal(orchestrator.scope,'global');
    const copy=await settings.saveProfile({sourceProfileId:therapist.id,name:'Project support',kind:'claude',scope:'project',project:f.other});
    assert.equal(copy.roleType,'recovery');assert.equal(copy.kind,'claude');assert(!copy.builtIn);
    const prepared=settings.prepareTask({profileId:copy.id,prompt:'Wait for a support request.'},f.other);
    assert.equal(prepared.roleType,'recovery');assert.equal(prepared.kind,'claude');
    for(const template of [therapist,orchestrator])await assert.rejects(settings.saveProfile({id:template.id,expectedRevision:1,name:'Replace template'}),/Duplicate/);
    f.p.data.agentProfiles=f.p.data.agentProfiles.filter(p=>![THERAPIST_ID,ORCHESTRATOR_ID].includes(p.id));
    new ProjectSettings(f.p);new ProjectSettings(f.p);
    assert.equal(f.p.data.agentProfiles.filter(p=>p.builtIn).length,3);
    assert.equal(settings.profile(copy.id).name,'Project support');assert.deepEqual(f.p.data.tasks,initialTasks,'Templates do not start or alter sessions');
  }finally{await f.close();}
});

test('SMART template upgrades preserve customized copies and existing sessions and run only once',async()=>{
  const f=await fixture();try{
    const settings=f.p.projectSettings;
    const copy=await settings.saveProfile({sourceProfileId:ORCHESTRATOR_ID,name:'Our coordinator',instructions:'Use our reviewed delivery agreement.',kind:'claude',scope:'project',project:f.root});
    const customBefore=structuredClone(settings.profile(copy.id));
    f.a.profileId=ORCHESTRATOR_ID;const sessionsBefore=structuredClone(f.p.data.tasks);
    for(const id of [SCRUM_MASTER_ID,ORCHESTRATOR_ID])Object.assign(settings.profile(id),{templateVersion:1,revision:7,instructions:'Legacy guidance'});
    const restarted=new ProjectSettings(f.p);
    for(const id of [SCRUM_MASTER_ID,ORCHESTRATOR_ID]){
      assert.equal(restarted.profile(id).templateVersion,2);assert.equal(restarted.profile(id).revision,8);
      assert.match(restarted.prepareTask({profileId:id,prompt:'Review this assignment.'},f.root).prompt,/SMART task guidance/);
    }
    assert.deepEqual(restarted.profile(copy.id),customBefore);assert.deepEqual(f.p.data.tasks,sessionsBefore);
    const once=structuredClone(f.p.data.agentProfiles);new ProjectSettings(f.p);assert.deepEqual(f.p.data.agentProfiles,once);
    Object.assign(restarted.profile(ORCHESTRATOR_ID),{templateVersion:3,instructions:'Newer template from a later release'});
    new ProjectSettings(f.p);assert.equal(restarted.profile(ORCHESTRATOR_ID).templateVersion,3);
    assert.equal(restarted.profile(ORCHESTRATOR_ID).instructions,'Newer template from a later release','An older release must not downgrade a template');
  }finally{await f.close();}
});

test('Therapist startup includes its recovery guidance once, while custom recovery roles still receive it',async()=>{
  const p=new ControlPlane('/project'),sent=[];p.save=async()=>{};p.record=async()=>{};p.herdr={prompt:async(pane,text)=>sent.push(text)};
  const task={id:'coach',project:'/project',pane:'p',kind:'codex',roleType:'recovery',prompt:therapistProfile().instructions};
  await p.submitInitialPrompt(task);assert.equal(sent[0].split(RECOVERY_BRIEF).length-1,1);
  await p.submitInitialPrompt({...task,prompt:'Help with a blocker.'});assert.equal(sent[1].split(RECOVERY_BRIEF).length-1,1);
});

// Tone changes affect instructions, not permission or scheduling state.
test('conversation styles are project-scoped, revision-checked and do not dispatch work',async()=>{
  const f=await fixture();try {
    assert.deepEqual(f.p.projectSettings.directory(f.root).conversation,{style:'conversational',revision:0});
    await f.p.projectSettings.setConversation({project:f.root,style:'expressive',expectedRevision:0});
    assert.equal(f.p.projectSettings.directory(f.root).conversation.style,'expressive');
    assert.equal(f.p.projectSettings.directory(f.other).conversation.style,'conversational');
    await assert.rejects(f.p.projectSettings.setConversation({project:f.root,style:'concise',expectedRevision:0}),/changed/);
    await assert.rejects(f.p.projectSettings.setConversation({project:f.root,style:'fake emotions',expectedRevision:1}),/Choose/);
    assert.equal(f.p.collaboration.data.messages.length,0);
  }finally{await f.close();}
});
