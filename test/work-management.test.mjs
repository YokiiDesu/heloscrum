import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkManagement,MAX_WORK_FILE} from '../lib/work-management.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {workRoute,workUpload} from '../lib/work-routes.mjs';
import {Readable} from 'node:stream';

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-work-test-'));
  const tasks=['Builder','QA','Design'].map((role,i)=>({id:'agent-'+i,role,title:role,prompt:'Build carefully',summary:role,project:root,path:root,phase:'launched',pane:'pane-'+i,kind:'codex'}));
  const plane={root,data:{project:root,tasks,events:[]},projects:{project:p=>{assert.equal(p,root);return p;}},save:async()=>{},herdr:{list:async()=>tasks.map(t=>({pane_id:t.pane,interactive_ready:true,agent_status:'idle'})),prompt:async()=>{}},record:async()=>{}};
  plane.collaboration=new Collaboration(plane);plane.work=new WorkManagement(plane);const human=plane.work.human(root);
  const draft=(overrides={})=>plane.work.saveDraft(human,{requestId:crypto.randomUUID(),instructions:'Build a customer portal\nWith an accessible account page.',participantIds:tasks.slice(0,2).map(t=>t.id),strategy:'team',changePolicy:'autonomous',kind:'plan',...overrides});
  const start=p=>plane.work.start(human,{planId:p.id,expectedRevision:p.revision});
  return {root,plane,work:plane.work,tasks,human,draft,start,close:()=>rm(root,{recursive:true,force:true})};
}

test('drafts preserve resources, automatic names and portable briefs without notifying agents',async()=>{
  const f=await fixture();try{
    const upload=await f.work.upload(f.root,'requirements.md',Buffer.from('# Requirements\nDark theme'));
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWuoAAAAASUVORK5CYII=','base64');
    const image=await f.work.upload(f.root,'mock.png',png);await mkdir(path.join(f.root,'docs'));await writeFile(path.join(f.root,'docs/plan.md'),'Repository plan');
    const repo=await f.work.repoReference(f.root,'docs/plan.md');await writeFile(path.join(f.root,'docs/plan.md'),'Changed later');
    let p=await f.draft({resourceIds:[upload.id,image.id,repo.id],links:['https://example.com/spec']});
    assert.equal(p.title,'Build a customer portal');assert.equal(p.status,'draft');assert.equal(f.plane.collaboration.data.messages.length,0);
    assert.equal((await f.work.readResource(f.human,{planId:p.id,resourceId:repo.id})).text,'Repository plan');
    assert.equal((await f.work.readResource(f.human,{planId:p.id,resourceId:image.id})).mcpResult.content[1].data,png.toString('base64'));
    assert.throws(()=>f.work.detail(f.tasks[0],p.id),/not available/);
    const brief=JSON.parse(await readFile(p.files.json,'utf8'));assert.equal(brief.resources.length,3);assert.match(await readFile(p.files.markdown,'utf8'),/Success criteria/);
    await assertPrivate(p.files.json);
    p=await f.start(p);await f.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2);assert.equal(f.work.detail(f.human,p.id).deliveries.length,2);assert.equal(f.work.list(f.tasks[2]).length,0);
    await f.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2);assert.match(f.plane.collaboration.data.messages[0].text,/work_brief/);assert.ok(f.work.detail(f.human,p.id).threadId);
    await f.start(p);await f.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2,'Starting twice does not repeat delivery');
    await assert.rejects(f.work.readResource(f.tasks[2],{planId:p.id,resourceId:upload.id}),/not available/);
    assert.throws(()=>f.work.detail({...f.tasks[0],project:'/another'},p.id),/not available/);
  }finally{await f.close();}
});

test('task claims, dependencies and agent boundaries are enforced, including concurrent updates',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft());
    p=await f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,requestId:'create',title:'Implement API',ownerId:null},'create');const first=p.items[0].id;
    const results=await Promise.allSettled(f.tasks.slice(0,2).map(t=>f.work.change(t,{planId:p.id,itemId:first,expectedRevision:p.revision,ownerId:t.id,status:'in_progress'},'update')));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/changed/);
    p=f.work.detail(f.human,p.id);assert.equal(p.items[0].ownerId,f.tasks[0].id);
    await assert.rejects(f.work.change(f.tasks[1],{planId:p.id,itemId:first,expectedRevision:p.revision,status:'done'},'update'),/owner or orchestrator/);
    await assert.rejects(f.work.change(f.tasks[0],{planId:p.id,itemId:first,expectedRevision:p.revision,ownerId:f.tasks[2].id},'update'),/selected/);
    p=await f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,requestId:'second',title:'Test API',ownerId:f.tasks[1].id,dependsOn:[first],parentId:first},'create');const second=p.items[1].id;
    await assert.rejects(f.work.change(f.tasks[1],{planId:p.id,itemId:second,expectedRevision:p.revision,status:'in_progress'},'update'),/dependencies/);
    await assert.rejects(f.work.change(f.human,{planId:p.id,itemId:first,expectedRevision:p.revision,dependsOn:[second]},'update'),/cycles/);
    p=await f.work.change(f.tasks[0],{planId:p.id,itemId:first,expectedRevision:p.revision,status:'done',note:'API test suite passes'},'update');
    assert.ok(p.outbox.some(e=>e.reason.startsWith('Dependencies finished')));
    p=await f.work.change(f.tasks[1],{planId:p.id,itemId:second,expectedRevision:p.revision,status:'needs_review',note:'Ready for acceptance'},'update');
    assert.equal(f.work.list(f.human)[0].review,1);assert.equal(p.audit.at(-1).actorId,f.tasks[1].id);
    f.tasks[1].archivedAt=new Date().toISOString();assert.throws(()=>f.work.detail(f.tasks[1],p.id),/not available/);
  }finally{await f.close();}
});

test('review mode keeps scope and assignments unchanged until approved, and rejects stale proposals',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({changePolicy:'review'}));
    const input={planId:p.id,expectedRevision:p.revision,requestId:'proposal',title:'Build settings',ownerId:f.tasks[0].id};
    p=await f.work.change(f.tasks[0],input,'create');assert.equal(p.items.length,0);assert.equal(p.proposals.length,1);
    assert.equal((await f.work.change(f.tasks[0],input,'create')).proposals.length,1,'Safe agent retry');
    await assert.rejects(f.work.review(f.tasks[0],{planId:p.id}),/project owner/);
    p=await f.work.review(f.human,{planId:p.id,expectedRevision:p.revision,proposalId:p.proposals[0].id,decision:'approve'});assert.equal(p.items.length,1);
    const itemId=p.items[0].id;
    p=await f.work.change(f.tasks[0],{planId:p.id,itemId,expectedRevision:p.revision,status:'in_progress'},'update');assert.equal(p.items[0].status,'in_progress','Progress reports do not require assignment approval');
    p=await f.work.change(f.tasks[0],{planId:p.id,itemId,expectedRevision:p.revision,ownerId:f.tasks[1].id},'update');assert.equal(p.items[0].ownerId,f.tasks[0].id);
    const proposalId=p.proposals.at(-1).id;
    p=await f.work.change(f.human,{planId:p.id,itemId,expectedRevision:p.revision,note:'New user direction'},'update');
    await assert.rejects(f.work.review(f.human,{planId:p.id,expectedRevision:p.revision,proposalId,decision:'approve'}),/changed after/);
    p=await f.work.review(f.human,{planId:p.id,expectedRevision:p.revision,proposalId,decision:'reject',reason:'Keep the current owner'});assert.equal(p.proposals.at(-1).status,'rejected');
    assert.ok(p.outbox.at(-1).reason.includes('Keep the current owner'));
  }finally{await f.close();}
});

test('orchestrator delegation restricts agents; direct assignments respect the selected change policy',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({strategy:'orchestrator',orchestratorId:f.tasks[0].id}));
    await assert.rejects(f.work.change(f.tasks[1],{planId:p.id,expectedRevision:p.revision,requestId:'bad',title:'Take over'},'create'),/Only the assigned orchestrator/);
    p=await f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,requestId:'delegate',title:'QA pass',ownerId:f.tasks[1].id},'create');assert.equal(p.items[0].ownerId,f.tasks[1].id);
    let direct=await f.draft({kind:'task',strategy:'assigned',participantIds:[f.tasks[0].id]});direct=await f.start(direct);await f.work.flush();assert.equal(f.work.detail(f.human,direct.id).threadId,undefined);
    direct=await f.work.change(f.tasks[0],{planId:direct.id,expectedRevision:direct.revision,requestId:'followup',title:'More work',ownerId:f.tasks[0].id},'create');assert.equal(direct.items.length,2);
    const unassigned=await f.draft({strategy:'assigned'});await assert.rejects(f.start(unassigned),/Assign each task/);
  }finally{await f.close();}
});

test('file references reject traversal, internal files, symlink escapes and excessive uploads',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.work.upload(f.root,'../secret',Buffer.from('x')),/without directories/);
    await assert.rejects(f.work.upload(f.root,'huge',Buffer.alloc(MAX_WORK_FILE+1)),/20 MiB/);
    for(const candidate of ['../outside','/etc/passwd','.git/config','.heloscrum/state.json'])await assert.rejects(f.work.repoReference(f.root,candidate),/relative path/);
    const outsideFile=path.join(os.tmpdir(),'heloscrum-outside-'+crypto.randomUUID());await writeFile(outsideFile,'outside fixture');try{await symlink(outsideFile,path.join(f.root,'escape'),'file');await assert.rejects(f.work.repoReference(f.root,'escape'),/inside the project/);}finally{await rm(outsideFile,{force:true});}
    await mkdir(path.join(f.root,'.heloscrum'));await writeFile(path.join(f.root,'.heloscrum/key'),'secret');await symlink(path.join(f.root,'.heloscrum/key'),path.join(f.root,'key'));await assert.rejects(f.work.repoReference(f.root,'key'),/inside the project/);
    await assert.rejects(f.draft({links:['javascript:alert(1)']}),/HTTP/);
    const p=await f.draft();await assert.rejects(f.work.readResource(f.human,{planId:p.id,resourceId:'unattached'}),/not attached/);
  }finally{await f.close();}
});

test('persistence errors roll back task updates; outbox retries do not duplicate messages',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft());const save=f.plane.save;f.plane.save=async()=>{throw Error('disk full');};
    await assert.rejects(f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,requestId:'fail',title:'Do not commit'},'create'),/disk full/);
    assert.equal(f.work.detail(f.human,p.id).revision,p.revision);assert.equal(f.work.detail(f.human,p.id).items.length,0);
    f.plane.save=save;const send=f.plane.collaboration.sendGroup.bind(f.plane.collaboration);let fail=true;f.plane.collaboration.sendGroup=async(...args)=>{const result=await send(...args);if(fail){fail=false;throw Error('Lost response');}return result;};
    await f.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2);await f.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2);assert.equal(f.work.detail(f.human,p.id).outbox[0].state,'queued');
  }finally{await f.close();}
});

test('archiving preserves work history, cancels queued messages and never interrupts agents',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft());await f.work.flush();
    p=await f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'archived'});assert.equal(f.plane.collaboration.data.messages[0].delivery,'cancelled');
    await assert.rejects(f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,requestId:'late',title:'Keep working'},'create'),/Restore/);
    p=await f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'active'});assert.equal(p.status,'active');await f.work.flush();assert.equal(f.plane.collaboration.data.messages.length,2);
  }finally{await f.close();}
});

test('project work survives DuckDB reload and appears in versioned history',async()=>{
  const f=await fixture();let history;try{
    history=await new HistoryStore(path.join(f.root,'history.duckdb')).init();f.plane.save=()=>history.saveState(f.plane.data);
    let p=await f.start(await f.draft());p=await f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,requestId:'persist',title:'Durable task',ownerId:f.tasks[0].id},'create');
    const loaded=await history.loadState();assert.equal(loaded.workPlans[0].items[0].title,'Durable task');assert.equal((await history.rows(f.root,'work-plan')).length>=3,true);
    const restored={...f.plane,data:loaded};restored.work=new WorkManagement(restored);assert.equal(restored.work.detail(f.human,p.id).items[0].ownerId,f.tasks[0].id);
  }finally{await history?.close();await f.close();}
});


test('resource-only briefs and direct review policy work through the agent catalog',async()=>{
  const f=await fixture();try{
    const resource=await f.work.upload(f.root,'customer-portal.md',Buffer.from('# Implement settings'));
    let p=await f.draft({instructions:'',kind:'task',strategy:'assigned',changePolicy:'review',participantIds:[f.tasks[0].id],resourceIds:[resource.id]});assert.equal(p.title,'customer-portal');
    p=await f.start(p);await f.work.flush();
    const [message]=f.plane.collaboration.data.messages;assert.equal(message.workBrief.planId,p.id);
    const catalog=f.plane.collaboration.catalog(f.tasks[0]);assert.ok(catalog.tools.some(t=>t.name==='work_get'));
    p=await f.plane.collaboration.call(f.tasks[0],'work_create_task',{planId:p.id,expectedRevision:p.revision,requestId:'review-direct',title:'Verify settings'});
    assert.equal(p.items.length,1);assert.equal(p.proposals[0].status,'pending');
    assert.equal((await f.plane.collaboration.call(f.tasks[0],'work_read_resource',{planId:p.id,resourceId:resource.id})).text,'# Implement settings');
  }finally{await f.close();}
});

test('HTTP work routes export JSON, Markdown and exact attachment bytes with download headers',async()=>{
  const f=await fixture();try{
    const bytes=Buffer.from('# Task input\nDo not lose these bytes.\n'),req=Readable.from([bytes]);req.headers={'content-type':'application/octet-stream','content-length':String(bytes.length)};
    const r=await workUpload(req,f.work,new URL('http://localhost/api/work/upload?'+new URLSearchParams({project:f.root,name:'input.md'})));
    const p=await f.draft({resourceIds:[r.id]}),results=[];
    const invoke=async(route,params)=>{const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;results.push(this);}};await workRoute({method:'GET'},res,f.work,new URL('http://localhost/api/work/'+route+'?'+new URLSearchParams({project:f.root,planId:p.id,...params})),{},()=>{});return res;};
    const json=await invoke('export',{format:'json'});assert.equal(JSON.parse(json.body).id,p.id);assert.match(json.headers['Content-Disposition'],/attachment/);
    const md=await invoke('export',{format:'md'});assert.match(md.body,/# Build a customer portal/);assert.match(md.body,/input.md/);
    const file=await invoke('resource',{resourceId:r.id});assert.deepEqual(file.body,bytes);assert.equal(file.headers['Content-Type'],'application/octet-stream');assert.equal(file.headers['X-Content-Type-Options'],'nosniff');
    const tooLarge=Readable.from([]);tooLarge.headers={'content-type':'application/octet-stream','content-length':String(MAX_WORK_FILE+1)};await assert.rejects(workUpload(tooLarge,f.work,new URL('http://localhost/?'+new URLSearchParams({project:f.root,name:'huge'}))),/20 MiB/);
  }finally{await f.close();}
});

test('request IDs reject changed create payloads and completion requires all tasks to be resolved',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft());const create={planId:p.id,expectedRevision:p.revision,requestId:'once',title:'Ship account page',ownerId:f.tasks[0].id};p=await f.work.change(f.tasks[0],create,'create');
    await assert.rejects(f.work.change(f.tasks[0],{...create,title:'Different task'},'create'),/different task change/);
    await assert.rejects(f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'completed'}),/Finish or cancel/);
    p=await f.work.change(f.tasks[0],{planId:p.id,expectedRevision:p.revision,itemId:p.items[0].id,status:'done',note:'Acceptance criteria verified'},'update');
    p=await f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'completed'});assert.equal(p.status,'completed');assert.equal(p.audit.at(-1).actorId,'human');
  }finally{await f.close();}
});

test('delivery methods persist in briefs, exports, and restored state without migrating legacy plans',async()=>{
  const f=await fixture();try{
    for(const method of ['waterfall','scrum','kanban','hybrid']){
      const p=await f.draft({management:{method,goal:'A verified increment',sprintCapacity:8,wipLimit:2,processLeadId:f.tasks[1].id}});
      assert.equal(p.management.method,method);assert.equal(p.flow.phaseIndex,0);
      const exported=JSON.parse(await readFile(p.files.json,'utf8'));assert.equal(exported.management.method,method);assert.match(exported.management.protocol,/work|Work|Scrum|Baseline/);
      assert.match(await readFile(p.files.markdown,'utf8'),/Delivery approach/);
      const restored=new WorkManagement({...f.plane,data:structuredClone(f.plane.data)});assert.equal(restored.detail(f.human,p.id).management.goal,'A verified increment');
    }
    assert.equal((await f.draft()).management,null);
    for(const management of [{method:'unknown'},{method:'__proto__'},{method:'scrum',sprintCapacity:0},{method:'kanban',wipLimit:1.5},{method:'scrum',processLeadId:f.tasks[2].id}])await assert.rejects(f.draft({management}));
  }finally{await f.close();}
});

test('Scrum commits ready work, freezes scope, requires independent verification and returns unfinished work to backlog',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({management:{method:'scrum',sprintCapacity:8},items:[{title:'Login',ownerId:f.tasks[0].id,points:3,acceptance:'Keyboard login succeeds'},{title:'Export',ownerId:f.tasks[0].id,points:5,acceptance:'Export downloads valid CSV'}]}));
    const change=(who,fields,id=p.items[0].id)=>f.work.change(who,{planId:p.id,itemId:id,expectedRevision:p.revision,...fields},'update');
    await assert.rejects(change(f.tasks[0],{status:'in_progress'}),/sprint/);
    await assert.rejects(f.work.delivery(f.tasks[0],{planId:p.id,action:'start_sprint'}),/sponsor/);
    p=await f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'start_sprint',goal:'Usable accounts',note:'Acceptance and dependencies reviewed',itemIds:p.items.map(t=>t.id)});
    await assert.rejects(change(f.human,{points:5}),/frozen/);await assert.rejects(change(f.human,{title:'Changed scope'}),/protected/);
    p=await change(f.tasks[0],{status:'in_progress'});
    await assert.rejects(change(f.tasks[0],{status:'done',note:'I wrote it'}),/independent/);
    await assert.rejects(change(f.tasks[0],{status:'needs_review'}),/evidence/);
    p=await change(f.tasks[0],{status:'needs_review',note:'commit:abc, keyboard test passed'});
    await assert.rejects(f.work.verify(f.tasks[0],{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,passed:true,evidence:'Self-reviewed'}),/own work/);
    p=await f.work.verify(f.tasks[1],{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,passed:true,evidence:'Independently ran keyboard acceptance test; passed'});
    assert.equal(p.items[0].status,'done');await assert.rejects(change(f.human,{description:'New feature'}),/protected|Reopen/);
    p=await change(f.tasks[0],{status:'in_progress'},p.items[1].id);
    await assert.rejects(f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'completed'}),/Finish/);
    p=await f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'close_sprint',note:'Login demonstrated. CSV incomplete.',improvement:'Builder will spike CSV before estimating the next cycle.'});
    assert.equal(p.flow.activeSprintId,null);assert.equal(p.flow.sprints[0].donePoints,3);assert.equal(p.items[1].status,'todo');assert.equal(p.items[1].sprintId,null);
    assert.match(p.audit.at(-1).detail,/Returned|returned/);
    await assert.rejects(change(f.tasks[0],{status:'in_progress'},p.items[1].id),/sprint/);
    const catalog=f.plane.collaboration.catalog(f.tasks[1]);assert(catalog.tools.some(t=>t.name==='work_verify_task'));
  }finally{await f.close();}
});

test('sprint readiness and capacity block invalid commitments',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({management:{method:'scrum',sprintCapacity:2},items:[{title:'Unrefined',ownerId:f.tasks[0].id}]}));
    const sprint=()=>f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'start_sprint',goal:'One feature',note:'Ready',itemIds:p.items.map(t=>t.id)});
    await assert.rejects(sprint(),/acceptance/);
    p=await f.work.change(f.human,{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,points:3,acceptance:'Works'},'update');await assert.rejects(sprint(),/capacity/);
    p=await f.work.change(f.human,{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,points:13},'update');await assert.rejects(sprint(),/1–8/);
    assert.equal(p.flow.sprints.length,0);
  }finally{await f.close();}
});

test('Waterfall gates enforce sequence and baselines; later scope changes require sponsor change control',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({management:{method:'waterfall'},items:[{title:'Architecture',phase:'Design',ownerId:f.tasks[0].id}]}));
    await assert.rejects(f.work.change(f.tasks[0],{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,status:'in_progress'},'update'),/another phase/);
    await assert.rejects(f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'approve_gate',note:'Reviewed requirements'}),/scopeBaseline/);
    p=await f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'approve_gate',note:'Sponsor accepts testable numbered requirements',scopeBaseline:'R1 login; design then implement',scheduleBaseline:'Design precedes code and tests',riskRegister:'Auth dependency; owner Builder; mitigate with spike'});
    assert.equal(p.flow.phaseIndex,1);assert.equal(p.flow.gates[0].approvedBy,'human');
    p=await f.work.change(f.tasks[0],{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,status:'in_progress'},'update');
    p=await f.work.change(f.tasks[0],{planId:p.id,requestId:'scope-change',expectedRevision:p.revision,note:'Adds one cycle; alternatives are defer or omit.',title:'New feature',ownerId:f.tasks[0].id,phase:'Implementation'},'create');
    assert.equal(p.proposals.length,1);assert.equal(p.items.length,1,'Autonomy does not bypass baselined scope');
    await assert.rejects(f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'approve_gate',note:'Try to skip'}),/pending/);
    await assert.rejects(f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'completed'}),/Finish/);
  }finally{await f.close();}
});

test('Kanban counts blocked/review WIP and cannot evade independent review by changing owners',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({management:{method:'kanban',wipLimit:1},items:[{title:'Fix A',ownerId:f.tasks[0].id},{title:'Fix B',ownerId:f.tasks[1].id}]}));
    const change=(actor,i,fields)=>f.work.change(actor,{planId:p.id,expectedRevision:p.revision,itemId:p.items[i].id,...fields},'update');
    p=await change(f.tasks[0],0,{status:'blocked',note:'Waiting on API'});
    await assert.rejects(change(f.tasks[1],1,{status:'in_progress'}),/WIP/);await assert.rejects(change(f.tasks[0],0,{status:'todo'}),/stays counted/);
    p=await change(f.tasks[0],0,{status:'needs_review',note:'API recovered and tests passed'});await assert.rejects(change(f.tasks[1],1,{status:'in_progress'}),/WIP/);
    p=await change(f.human,0,{ownerId:f.tasks[1].id});
    for(const actor of f.tasks.slice(0,2))await assert.rejects(f.work.verify(actor,{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,passed:true,evidence:'I checked'}),/own work/);
    p=await f.work.verify(f.human,{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,passed:true,evidence:'Sponsor independently ran the API smoke test'});
    p=await change(f.tasks[1],1,{status:'in_progress'});assert.equal(p.items[1].status,'in_progress');
  }finally{await f.close();}
});

test('Hybrid uses sprints only inside delivery phases and adaptive process agents cannot assign others',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({management:{method:'hybrid',processLeadId:f.tasks[1].id},items:[{title:'Requirements',phase:'Requirements',ownerId:f.tasks[0].id}]}));
    await assert.rejects(f.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'start_sprint',goal:'Early code',note:'Start',itemIds:[p.items[0].id]}),/Sprints are available/);
    await assert.rejects(f.work.change(f.tasks[1],{planId:p.id,expectedRevision:p.revision,requestId:'push',title:'Push work',ownerId:f.tasks[0].id},'create'),/facilitates/);
    const invalid=await f.draft({management:{method:'scrum',processLeadId:f.tasks[1].id},strategy:'orchestrator',orchestratorId:f.tasks[1].id});await assert.rejects(f.start(invalid),/separate/);
  }finally{await f.close();}
});

test('human review delegation preserves independence, membership, revocation and brief visibility',async()=>{
  const f=await fixture();try{
    let p=await f.start(await f.draft({participantIds:f.tasks.map(t=>t.id),management:{method:'kanban',qaLeadId:f.tasks[1].id},items:[{title:'Engine',ownerId:f.tasks[0].id}]}));
    const itemId=p.items[0].id;
    const change=async fields=>p=await f.work.change(f.human,{planId:p.id,itemId,expectedRevision:p.revision,...fields},'update');
    const verify=(actor)=>f.work.verify(actor,{planId:p.id,itemId,expectedRevision:p.revision,passed:true,evidence:'Independent validation of the exact submitted candidate.'});
    await change({status:'needs_review',note:'Exact candidate and tests attached'});
    assert.equal((await f.work.focused(f.tasks[2],{planId:p.id})).reviewTasks.length,0);
    await assert.rejects(verify(f.tasks[2]),/QA lead/);
    await assert.rejects(f.work.setReviewers(f.tasks[2],{planId:p.id,expectedRevision:p.revision,reviewerIds:[f.tasks[2].id]}),/project owner/);
    for(const reviewerIds of [['outsider'],[f.tasks[2].id,f.tasks[2].id],null])await assert.rejects(f.work.setReviewers(f.human,{planId:p.id,expectedRevision:p.revision,reviewerIds}));
    const before=p.revision;
    p=await f.work.setReviewers(f.human,{planId:p.id,expectedRevision:before,reviewerIds:[f.tasks[2].id]});
    assert.equal(p.management.qaLeadId,f.tasks[1].id);
    assert.equal(p.items[0].status,'needs_review');
    assert.equal(p.audit.at(-1).changes[0].field,'management.reviewerIds');
    assert.deepEqual((await f.work.focused(f.tasks[2],{planId:p.id})).reviewTasks.map(t=>t.id),[itemId]);
    assert.match(await readFile(p.files.markdown,'utf8'),/Delegated reviewers: agent-2/);
    await assert.rejects(f.work.setReviewers(f.human,{planId:p.id,expectedRevision:before,reviewerIds:[]}),/changed/);
    p=await verify(f.tasks[2]);assert.equal(p.items[0].status,'done');
    await change({status:'in_progress',ownerId:f.tasks[2].id});
    await change({status:'needs_review',note:'New candidate'});
    await assert.rejects(verify(f.tasks[2]),/own work/);
    await change({ownerId:f.tasks[0].id});
    await assert.rejects(verify(f.tasks[2]),/own work/);
    assert.equal((await f.work.focused(f.tasks[2],{planId:p.id})).reviewTasks.length,0);
    p=await verify(f.tasks[1]);assert.equal(p.items[0].verification.by,f.tasks[1].id);
    p=await f.work.setReviewers(f.human,{planId:p.id,expectedRevision:p.revision,reviewerIds:[]});
    assert.deepEqual(p.management.reviewerIds,[]);
    p=await f.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'archived'});
    await assert.rejects(f.work.setReviewers(f.human,{planId:p.id,expectedRevision:p.revision,reviewerIds:[f.tasks[2].id]}),/draft or active/);
  }finally{await f.close();}
});
