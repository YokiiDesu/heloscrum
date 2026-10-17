import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {apiFixture} from './api-fixture.mjs';
import {HeloClient,codeRoot} from '../cli/client.mjs';
import {ApiOperations} from '../lib/api-operations.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {projectId} from '../lib/api-access.mjs';
import {openapi,API_ROUTES} from '../lib/api-contract.mjs';

function cli(f,args,input){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(codeRoot,'bin/heloscrum.mjs'),...args,'--credential',path.join(f.root,'.heloscrum/api-owner.json'),'--json'],{cwd:f.root,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(input);});}
const fullScopes=['projects:read','agents:read','work:read','work:write','work:review','messages:read','messages:write','events:read','tools:read','tools:invoke'];

test('queued agent directions and cancellation are durable operator actions with project checks',async()=>{
  const f=await apiFixture();try{
    f.plane.herdr.list=async()=>f.plane.data.tasks.map(t=>({pane_id:t.pane,interactive_ready:false,agent_status:'working'}));
    const route=f.base+'/agents/agent-0',message=await f.client.mutate(route+'/message',{text:'After this turn',mode:'queue'});
    assert.equal(message.message.delivery,'queued');assert.equal(f.prompts.length,0);
    const agentCredential=await f.credential(['agents:write']),agent=new HeloClient({url:f.owner.url,token:agentCredential.token});
    await assert.rejects(agent.mutate(route+'/messages/'+message.message.id+'/cancel',{}),e=>e.status===403);
    const cancelled=await f.client.mutate(route+'/messages/'+message.message.id+'/cancel',{});assert.equal(cancelled.delivery,'cancelled');assert.equal(cancelled.text,'After this turn');
    assert.equal(f.plane.collaboration.data.messages.find(m=>m.id===message.message.id).delivery,'cancelled');
    await assert.rejects(f.client.mutate(f.base+'/agents/agent-1/messages/'+message.message.id+'/cancel',{}),e=>e.status===404);
    agent.close();
  }finally{await f.close();}
});

test('v1 rejects unauthenticated, cross-project, impersonated, and out-of-scope requests',async()=>{
  const f=await apiFixture();try{
    assert.equal((await fetch(f.plane.baseUrl+'/api/v1/projects')).status,401);
    const token=await f.credential(['projects:read','work:read','tools:invoke']);const agent=new HeloClient(token);
    assert.equal((await agent.list('/projects')).items.length,1);
    await assert.rejects(agent.request('/projects/'+projectId(f.other)+'/plans'),e=>e.status===403);
    await assert.rejects(agent.mutate(f.base+'/plans',{instructions:'Impersonate',participantIds:['agent-0']}),e=>e.status===403);
    await assert.rejects(agent.mutate(f.base+'/tools/invoke',{name:'invoke_tool',input:{name:'work_create_task',input:{}}}),e=>e.status===403);
    await assert.rejects(f.client.mutate(f.base+'/plans',{instructions:'Inject actor',human:true,project:f.other}),/schema/);
    await assertPrivate(path.join(f.root,'.heloscrum/api-owner.json'));
    assert.ok(!JSON.stringify(f.plane.data).includes(token.token),'Only credential hashes enter persisted state');
    await f.client.request('/tokens/'+token.id,{method:'DELETE',body:{}});await assert.rejects(agent.request('/me'),e=>e.status===401);
    const expired=await f.credential(['projects:read']);f.api.access.records.find(r=>r.id===expired.id).expiresAt='2000-01-01T00:00:00.000Z';await assert.rejects(new HeloClient(expired).request('/me'),e=>e.status===401);
    assert.equal((await fetch(f.plane.baseUrl+'/api/v1/projects',{headers:{Authorization:'Bearer '+f.owner.token,Origin:'https://example.invalid'}})).status,403);
  }finally{await f.close();}
});

test('brief → dispatch → agent progress → proposal review → independent verification uses shared records',async()=>{
  const f=await apiFixture({history:true});try{
    f.plane.data.project=f.other;
    const input={instructions:'Build account settings',participantIds:['agent-0','agent-1'],strategy:'team',changePolicy:'review',kind:'plan',management:{method:'kanban',wipLimit:2},items:[{title:'Account page',ownerId:'agent-0',acceptance:'Keyboard test passes'}]};
    const result=await cli(f,['plans','create','--project',f.root,'--file','-','--attach',path.join(f.root,'brief.md'),'--request-id','portable-brief'],JSON.stringify(input));
    assert.equal(result.code,0,result.err);assert.ok(!result.out.includes('\x1b'));const created=JSON.parse(result.out).data;
    assert.equal(f.plane.data.project,f.other,'API does not follow or change browser selection');
    let plan=await f.client.request(f.base+'/plans/'+created.id);assert.equal(plan.resources[0].name,'brief.md');assert.equal(plan.status,'draft');assert.equal(f.plane.collaboration.data.messages.length,0);
    const route=f.base+'/plans/'+plan.id;
    await f.client.mutate(route+'/start',{expectedRevision:plan.revision});await f.plane.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2);
    const agent=new HeloClient(await f.credential(fullScopes)),qa=new HeloClient(await f.credential(fullScopes,'agent-1'));
    plan=await agent.request(route);const taskId=plan.items[0].id;
    await agent.mutate(route+'/tasks/'+taskId,{expectedRevision:plan.revision,status:'in_progress'}, {method:'PATCH'});plan=await agent.request(route);
    const rev=plan.revision;await agent.mutate(route+'/tasks',{expectedRevision:rev,title:'Follow-up accessibility audit',ownerId:'agent-1',acceptance:'Evidence is recorded'},{key:'propose-audit'});
    plan=await f.client.request(route);assert.equal(plan.items.length,1);assert.equal(plan.proposals.length,1);
    await assert.rejects(agent.mutate(route+'/proposals/'+plan.proposals[0].id+'/review',{expectedRevision:plan.revision,decision:'approve'}),e=>e.status===403);
    await f.client.mutate(route+'/proposals/'+plan.proposals[0].id+'/review',{expectedRevision:plan.revision,decision:'approve',reason:'Include the audit'});plan=await f.client.request(route);assert.equal(plan.items.length,2);
    await assert.rejects(agent.mutate(route+'/tasks/'+taskId,{expectedRevision:rev,status:'needs_review',note:'Old revision'},{method:'PATCH'}),e=>e.status===409);
    await agent.mutate(route+'/tasks/'+taskId,{expectedRevision:plan.revision,status:'needs_review',note:'Keyboard acceptance test passed; evidence in test.log'},{method:'PATCH'});plan=await qa.request(route);
    await assert.rejects(agent.mutate(route+'/tasks/'+taskId+'/verify',{expectedRevision:plan.revision,passed:true,evidence:'Self approval'}),e=>e.status===403);
    await qa.mutate(route+'/tasks/'+taskId+'/verify',{expectedRevision:plan.revision,passed:true,evidence:'Independently ran the keyboard acceptance test'});plan=await f.client.request(route);assert.equal(plan.items[0].status,'done');
    assert.equal(f.plane.work.detail(f.plane.work.human(f.root),plan.id).revision,plan.revision,'Web/MCP and HTTP see one authoritative board');
    const loaded=await f.plane.history.loadState();assert.equal(loaded.workPlans[0].items[0].verification.by,'agent-1');
  }finally{await f.close();}
});

test('operation keys deduplicate concurrent writes, identify lost responses, and survive restart',async()=>{
  const f=await apiFixture({history:true});try{
    const input={instructions:'One brief',kind:'task',strategy:'team',participantIds:['agent-0']};
    const [one,two]=await Promise.all([f.client.mutate(f.base+'/plans',input,{key:'one-write'}),f.client.mutate(f.base+'/plans',input,{key:'one-write'})]);
    assert.equal(one.operationId,two.operationId);assert.equal(f.plane.data.workPlans.length,1);
    await assert.rejects(f.client.mutate(f.base+'/plans',{...input,title:'Different'},{key:'one-write'}),e=>e.status===409);
    assert.equal((await f.client.request('/operations?requestId=one-write')).items[0].id,one.operationId);
    const scoped=new HeloClient(await f.credential(fullScopes));await assert.rejects(scoped.request('/operations/'+one.operationId),e=>e.status===404);
    f.plane.data.api.operations.push({id:'interrupted',key:'unsafe-replay',callerId:'local-owner',status:'running',createdAt:new Date().toISOString()});await f.plane.save();
    const restored={data:await f.plane.history.loadState(),save:async()=>{}};await new ApiOperations(restored).init();assert.equal(restored.data.api.operations.find(o=>o.id==='interrupted').status,'uncertain');
    const rejected=await cli(f,['plans','get','missing','--project',f.root]);assert.equal(rejected.code,4);assert.equal(rejected.out,'');assert.equal(JSON.parse(rejected.err).ok,false);
  }finally{await f.close();}
});

test('resumable events publish committed changes, avoid save noise, and stop on revocation',async()=>{
  const f=await apiFixture();try{
    const token=await f.credential(['events:read','projects:read']),agent=new HeloClient(token),seen=[],controller=new AbortController();
    let ready;const readyPromise=new Promise(resolve=>ready=resolve);
    const watching=agent.watch(projectId(f.root),{signal:controller.signal,onEvent:event=>{seen.push(event);if(event.type==='ready')ready();}});
    await readyPromise;const before=f.plane.data.api.sequence;await f.plane.save();assert.equal(f.plane.data.api.sequence,before);
    await f.client.mutate(f.base+'/plans',{instructions:'Event-producing brief',strategy:'team',participantIds:['agent-0']});
    for(let i=0;i<100&&!seen.some(e=>e.type==='workspace.changed');i++)await new Promise(r=>setTimeout(r,10));
    const changed=seen.find(e=>e.type==='workspace.changed');assert.ok(changed);controller.abort();await watching;
    const replay=[],replayController=new AbortController();
    await agent.watch(projectId(f.root),{after:String(before),signal:replayController.signal,onEvent:e=>{replay.push(e);if(e.type==='workspace.changed')replayController.abort();}});assert.equal(replay.at(-1).id,changed.id);
    const revoked=agent.watch(projectId(f.root),{onEvent:()=>{}});const caught=assert.rejects(revoked,e=>e.status===401);
    await f.client.request('/tokens/'+token.id,{method:'DELETE',body:{}});await caught;
    assert.equal(f.api.events.streams.size,0);
  }finally{await f.close();}
});

test('Git review and staging reject stale contents and require the exact commit tree',async()=>{
  const f=await apiFixture();try{
    const tree=(await f.client.request(f.base+'/worktrees')).items[0],route=f.base+'/worktrees/'+tree.id;
    await writeFile(path.join(f.root,'change.txt'),'one\n');const review=await f.client.request(route+'/diff?file=change.txt');assert.match(review.preview.diff,/\+one/);
    await writeFile(path.join(f.root,'change.txt'),'two\n');await assert.rejects(f.client.mutate(route+'/stage',{file:'change.txt',unstage:false,expected:review.fingerprint}),e=>e.status===409);
    const current=await f.client.request(route+'/diff?file=change.txt');await f.client.mutate(route+'/stage',{file:'change.txt',unstage:false,expected:current.fingerprint});
    const preview=await f.client.request(route+'/commit-preview');assert.equal(preview.files[0].path,'change.txt');
    const commit=await f.client.mutate(route+'/commit',{message:'Reviewed through API',expected:{tree:preview.tree,head:preview.head}});assert.match(commit.head,/^[a-f0-9]{40}$/);
  }finally{await f.close();}
});

test('OpenAPI describes every registered method and its input constraints',()=>{
  const doc=openapi();assert.equal(doc.openapi,'3.1.0');for(const route of API_ROUTES){const operation=doc.paths['/api/v1'+route.path][route.method.toLowerCase()];assert.equal(operation.operationId,route.id);if(route.input)assert.deepEqual(operation.requestBody.content['application/json'].schema,route.input);}
});

test('operator tools remain project-scoped and uncertain provider delivery is never replayed',async()=>{
  const f=await apiFixture();try{
    f.plane.collaboration.data.tools.push({id:'local-a',name:'local_tool',project:f.root,description:'Visible',inputSchema:{type:'object'},executable:'/private/program',args:['secret-argument']},{id:'local-b',name:'other_project_tool',project:f.other,description:'Private other project',inputSchema:{type:'object'}});
    const credential=await f.client.request('/tokens',{method:'POST',body:{name:'Project operator',kind:'operator',projects:[projectId(f.root)],scopes:['tools:read','projects:read','agents:write']}}),operator=new HeloClient(credential);
    const toolbox=await operator.request(f.base+'/tools');assert.ok(toolbox.tools.some(t=>t.name==='local_tool'));assert.ok(!JSON.stringify(toolbox).includes('secret-argument'));assert.ok(!JSON.stringify(toolbox).includes('other_project_tool'));
    let attempts=0;f.plane.herdr.prompt=async()=>{attempts++;throw Error('Lost provider reply');};f.plane.data.project=f.other;
    const input={text:'Perform one check'};
    for(let i=0;i<2;i++)await assert.rejects(operator.mutate(f.base+'/agents/agent-0/message',input,{key:'uncertain-delivery'}),e=>e.code==='OUTCOME_UNCERTAIN');
    assert.equal(attempts,1);assert.equal((await operator.request('/operations?requestId=uncertain-delivery')).items[0].status,'uncertain');
  }finally{await f.close();}
});

test('live reviewer delegation is owner-controlled and used by the verification endpoint',async()=>{
  const f=await apiFixture();let reviewer;try{
    const made=await f.client.mutate(f.base+'/plans',{instructions:'Independent task review',kind:'plan',strategy:'assigned',participantIds:['agent-0','agent-1'],management:{method:'kanban',qaLeadId:'agent-0'},items:[{title:'Candidate',ownerId:'agent-0'}]});
    const route=f.base+'/plans/'+made.id;
    let p=await f.client.request(route);
    await f.client.mutate(route+'/start',{expectedRevision:p.revision});p=await f.client.request(route);
    await f.client.mutate(route+'/tasks/'+p.items[0].id,{expectedRevision:p.revision,status:'needs_review',note:'Ready for independent review'},{method:'PATCH'});p=await f.client.request(route);
    reviewer=new HeloClient(await f.credential(fullScopes,'agent-1'));
    await assert.rejects(reviewer.mutate(route+'/reviewers',{expectedRevision:p.revision,reviewerIds:['agent-1']}),e=>e.status===403);
    const revision=p.revision;
    const delegated=await f.client.mutate(route+'/reviewers',{expectedRevision:revision,reviewerIds:['agent-1']},{key:'delegate-reviewer'});
    const replay=await f.client.mutate(route+'/reviewers',{expectedRevision:revision,reviewerIds:['agent-1']},{key:'delegate-reviewer'});
    assert.equal(delegated.operationId,replay.operationId);
    p=await f.client.request(route);assert.deepEqual(p.management.reviewerIds,['agent-1']);assert.equal(p.management.qaLeadId,'agent-0');
    await reviewer.mutate(route+'/tasks/'+p.items[0].id+'/verify',{expectedRevision:p.revision,passed:true,evidence:'Observed acceptance checks on the submitted candidate'});
    p=await f.client.request(route);assert.equal(p.items[0].verification.by,'agent-1');assert.equal(p.items[0].status,'done');
  }finally{reviewer?.close();await f.close();}
});

test('agents run structured conversations through v1 tool invocation with message scopes',async()=>{
  const f=await apiFixture();try{
    const group=await f.client.mutate(f.base+'/conversations',{name:'API decisions',participants:['agent-0','agent-1']});
    const builder=new HeloClient(await f.credential(['messages:read','messages:write','tools:invoke'])),qa=new HeloClient(await f.credential(['messages:read','messages:write','tools:invoke'],'agent-1')),reader=new HeloClient(await f.credential(['messages:read','tools:invoke']));
    const invoke=(client,name,input)=>client.mutate(f.base+'/tools/invoke',{name,input});
    const opened=await invoke(builder,'start_proposal',{threadId:group.id,title:'Adopt the v1 client',summary:'Use HeloClient everywhere.',options:['Adopt']});
    await assert.rejects(invoke(reader,'start_debate',{threadId:group.id,question:'Read-only?'}),e=>e.status===403);
    await invoke(builder,'cast_vote',{structureId:opened.structure.id,stance:'support',rationale:'One client is easier to secure.'});
    const voted=await invoke(qa,'cast_vote',{structureId:opened.structure.id,stance:'support',rationale:'Tests already use it.'});
    assert.equal(voted.structure.status,'accepted');assert.equal(voted.decision.decision,'Adopt');
    const read=await reader.request(f.base+'/conversations/'+group.id);assert.deepEqual(read.structures.map(s=>[s.type,s.status]),[['proposal','accepted'],['decision','accepted']]);
    for(const client of [builder,qa,reader])client.close();
  }finally{await f.close();}
});
