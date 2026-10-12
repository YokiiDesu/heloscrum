import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir,stat,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkingMemory} from '../lib/working-memory.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {WorkManagement} from '../lib/work-management.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {SMART_TASK_GUIDANCE} from '../lib/work-guidance.mjs';

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-notebook-'));
  const tasks=['Engine','QA','Other team'].map(role=>({id:randomUUID(),role,title:role,prompt:'Preserve saved progress.',project:root,path:root,phase:'launched',pane:role,kind:'codex'}));
  const calls=[],plane={root,data:{project:root,tasks,contextSettings:{toolResultChars:12000}},projects:{project:p=>p},save:async()=>{await writeFile(path.join(root,'state.json'),JSON.stringify(plane.data));},herdr:{list:async()=>tasks.map(t=>({pane_id:t.pane,interactive_ready:true,agent_status:'idle'})),prompt:async(...args)=>calls.push(args)},record:async()=>{}};
  plane.context=new ContextManager(plane);plane.collaboration=new Collaboration(plane);plane.work=new WorkManagement(plane);plane.notebooks=new WorkingMemory(plane);
  const human=plane.work.human(root);let plan=await plane.work.saveDraft(human,{requestId:randomUUID(),title:'Example simulation',instructions:'Build a print simulation. Keep saves compatible.',acceptance:'Refund the full reservation after cancellation.',planText:'Owners implement; QA verifies independently.',kind:'plan',strategy:'team',changePolicy:'review',participantIds:tasks.slice(0,2).map(t=>t.id),management:{method:'kanban',definitionOfDone:'Independent checks must pass; never pay a job twice.',wipLimit:2},items:[{title:'Printer engine',ownerId:tasks[0].id,description:'Immutable transitions.',acceptance:'One reward per job.'},{title:'Verify engine',ownerId:tasks[1].id,description:'Check refunds and saves.',acceptance:'Exercise reload.'}]});
  plan=await plane.work.start(human,{planId:plan.id,expectedRevision:plan.revision});
  return {root,tasks,plane,human,plan,calls,note:{expectedRevision:0,category:'decision',text:'Refund the full filament reservation after partial progress.',confidence:'reported',status:'active'},close:()=>rm(root,{recursive:true,force:true})};
}

test('notebooks persist across sessions/providers with private identities, archived revisions and stale-edit protection',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0],b=f.tasks[1],n=f.plane.notebooks;
    const first=await n.write(a,f.note);assert.equal(first.revision,1);assert.equal((await n.read(b)).entries.length,0);
    const results=await Promise.allSettled([n.write(a,{...f.note,id:first.note.id,expectedRevision:1,text:'Reviewed correction.'}),n.write(a,{...f.note,id:first.note.id,expectedRevision:1,text:'Stale overwrite.'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/Notebook changed/);
    assert.equal((await n.read(a,{revision:1})).entries[0].text,f.note.text);assert.equal((await n.read(a,{revision:1})).historical,true);assert.equal((await n.history(a,1)).entries[0].text,f.note.text);await assertPrivate(path.join(n.directory(a),'revision-1.json'));
    const saved=JSON.parse(await readFile(path.join(f.root,'state.json'),'utf8'));const restored=new WorkingMemory({...f.plane,data:saved});
    assert.equal((await restored.read({...a,kind:'claude',providerSessionId:randomUUID()})).entries[0].text,'Reviewed correction.');
    assert.throws(()=>restored.check({...a,project:'/different'}),/another project/);
    await assert.rejects(n.history(b,1),/existing notebook revision/);
    f.plane.save=async()=>{throw Error('Disk unavailable');};await assert.rejects(n.write(a,{...f.note,expectedRevision:2,text:'Must not replace saved data'}),/Disk unavailable/);assert.equal(n.current(a).revision,2);
  }finally{await f.close();}
});

test('source changes are flagged without laundering author confidence into independent verification',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0],n=f.plane.notebooks;await writeFile(path.join(f.root,'engine.mjs'),'version one');
    const saved=await n.write(a,{...f.note,confidence:'verified',sources:[{kind:'file',path:'engine.mjs'},{kind:'task',planId:f.plan.id,itemId:f.plan.items[0].id,revision:f.plan.revision}]});
    assert.equal(saved.note.freshness.state,'current');assert.equal((await n.search(a,{query:'engine.mjs',scope:'notebook'})).matches[0].source.id,saved.note.id);await writeFile(path.join(f.root,'engine.mjs'),'version two');
    const stale=await n.read(a);assert.equal(stale.entries[0].freshness.state,'stale');assert.equal(stale.entries[0].confidence,'verified');assert.match(stale.authority,/author reports/);
    await assert.rejects(n.write(a,{...f.note,expectedRevision:1,sources:[{kind:'file',path:'../secret'}]}),/inside/);
    const outsideFile=path.join(os.tmpdir(),'heloscrum-outside-'+randomUUID());await writeFile(outsideFile,'outside fixture');try{await symlink(outsideFile,path.join(f.root,'outside'),'file');await assert.rejects(n.fileSource(a,'outside'),/inside/);}finally{await rm(outsideFile,{force:true});}
    await assert.rejects(n.write(a,{...f.note,expectedRevision:1,sources:[{kind:'task',planId:f.plan.id,revision:0}]}),/current board/);
    assert.equal(f.plane.work.detail(f.human,f.plan.id).items[0].status,'todo','A verified note does not change task status');
  }finally{await f.close();}
});

test('retrieval ranks exact references, returns bounded source passages and enforces project/agent/tool boundaries',async()=>{
  const f=await fixture();try{
    const [a,b,other]=f.tasks,n=f.plane.notebooks,c=f.plane.context;
    await n.write(a,f.note);await n.write(b,{...f.note,text:'private peer notebook secret'});
    await f.plane.collaboration.call(a,'memory_write',{key:'Refund rule',text:'Refunds preserve all reserved filament.',expectedRevision:0});
    const ref=await c.store(a,'This is archived rationale. '.repeat(120)+'Avoid partial refunds.','Run record');await c.store(b,'private peer transcript secret','Other run');
    const result=await n.search(a,{query:'refund'});assert(result.matches.some(m=>m.source.kind==='notebook'));assert(result.matches.some(m=>m.source.kind==='shared'));assert(result.matches.some(m=>m.source.kind==='archive'));assert(result.matches.every(m=>m.text.length<=950));assert(!JSON.stringify(result).includes('private peer'));
    const exact=await n.search(a,{query:f.plan.items[0].id});assert.equal(exact.matches[0].source.itemId,f.plan.items[0].id);
    assert.equal((await n.search(other,{query:'print simulation',scope:'tasks'})).matches.length,0);
    await assert.rejects(n.readSource(b,{source:{kind:'archive',reference:ref.reference}}),/not found/);
    await assert.rejects(n.readSource(other,{source:{kind:'plan',planId:f.plan.id}}),/not available/);
    a.toolPolicy={mode:'selected',allowed:[]};assert(!(await n.search(a,{query:'refund',scope:'shared'})).matches.length);await assert.rejects(n.readSource(a,{source:{kind:'shared',key:'Refund rule'}}),/outside/);
    const snippet=await n.readSource(a,{source:{kind:'notebook',id:n.current(a).entries[0].id}});assert.equal(snippet.text,f.note.text);
  }finally{await f.close();}
});

test('focused brief retains policy, DoD, dependencies and notes without replaying audit or unrelated task descriptions',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0],work=f.plane.work,live=work.available(a,f.plan.id);await f.plane.notebooks.write(a,f.note);
    live.audit.push({detail:'old conversation '.repeat(5000)});live.items.push({id:randomUUID(),title:'Unrelated delivery',status:'todo',ownerId:f.tasks[1].id,dependsOn:[],description:'Unrelated large description '.repeat(500)});
    const brief=await work.focused(a,{planId:live.id});assert.equal(brief.revision,live.revision);assert.equal(brief.changePolicy,'review');assert.match(brief.management.definitionOfDone,/never pay/);assert.equal(brief.items.length,1);assert.equal(brief.notebook.entries.length,1);assert.equal(brief.items[0].readiness.canWork,true);assert(!JSON.stringify(brief).includes('old conversation'));assert(!JSON.stringify(brief).includes('Unrelated large description'));
    assert(JSON.stringify(brief).length<JSON.stringify(work.detail(a,live.id)).length*.2);
    const delta=await work.focused(a,{planId:live.id,sinceRevision:live.revision});assert.equal(delta.changes.changed,false);assert(JSON.stringify(delta).length<600);
    const previous=live.revision;await work.change(a,{planId:live.id,itemId:live.items[0].id,expectedRevision:previous,status:'in_progress'},'update');
    const changed=await work.focused(a,{planId:live.id,sinceRevision:previous});assert(changed.changes.items.some(i=>i.id===live.items[0].id));assert(changed.revision>previous);
    await assert.rejects(work.call(a,'work_update_task',{planId:live.id,itemId:live.items[0].id,expectedRevision:previous,note:'stale'}),/changed/);
    const receipt=await work.call(a,'work_update_task',{planId:live.id,itemId:live.items[0].id,expectedRevision:changed.revision,note:'Working'});assert(!receipt.audit);assert.equal(receipt.item.status,'in_progress');
  }finally{await f.close();}
});

test('SMART brief guidance carries actual schedules without creating deadlines, changing gates or repeating in receipts',async()=>{
  const f=await fixture();try{
    const [owner,,outsider]=f.tasks,work=f.plane.work,plan=work.available(owner,f.plan.id);
    f.plane.scheduler={settings:()=>({timeZone:'America/Los_Angeles'}),policy:()=>({timeZone:'America/Los_Angeles'})};
    const before=structuredClone(plan);
    const brief=await work.focused(owner,{planId:plan.id});
    assert.equal(brief.taskGuidance,SMART_TASK_GUIDANCE);
    assert.equal(brief.schedule.due,null,'Reading guidance must not invent a deadline');
    assert.equal(brief.items[0].readiness.canWork,true,'Missing dates do not block authorized work');
    assert.deepEqual(plan,before,'Reading guidance does not rewrite scope or schedule');
    const delta=await work.focused(owner,{planId:plan.id,sinceRevision:plan.revision});
    assert.equal(delta.taskGuidance,undefined);assert(JSON.stringify(delta).length<600);
    const noAssignment=await work.focused(outsider);
    assert.equal(noAssignment.taskGuidance,SMART_TASK_GUIDANCE);assert.deepEqual(noAssignment.plans,[]);
    await assert.rejects(work.focused(outsider,{planId:plan.id}),/not available/);
    plan.schedule={start:null,due:'2026-10-09T17:00:00-07:00',milestone:false};
    plan.items[0].dependsOn=[plan.items[1].id];
    const blocked=await work.focused(owner,{planId:plan.id});
    assert.deepEqual(blocked.schedule,plan.schedule);assert.equal(blocked.timeZone,'America/Los_Angeles');
    assert.equal(blocked.items[0].readiness.canWork,false);assert.match(blocked.items[0].readiness.reason,/Dependencies/);
    assert.equal(blocked.taskGuidance,SMART_TASK_GUIDANCE);
    assert(!work.markdown(plan).includes(SMART_TASK_GUIDANCE),'Portable task content stays separate from general runtime guidance');
    await work.flush();
    assert(f.plane.collaboration.data.messages.every(m=>!m.text.includes(SMART_TASK_GUIDANCE)),'Ordinary delivery messages do not repeat guidance');
  }finally{await f.close();}
});

test('focused brief rejects mistaken text offsets without losing canonical continuations or task pagination',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0],work=f.plane.work,p=work.available(a,f.plan.id),item=p.items[0];
    item.description='Required detail. '.repeat(100)+'Protect saved progress.';
    const brief=await work.focused(a,{planId:p.id,itemId:item.id});
    const continuation=brief.items[0].description.retrieve;
    assert.equal(continuation.tool,'work_read_brief');assert.equal(continuation.input.offset,1200);
    await assert.rejects(work.focused(a,{planId:p.id,itemId:item.id,offset:1200}),/work_read_brief/);
    await assert.rejects(work.focused(a,{planId:p.id,offset:1200}),/work_read_brief/);
    // Even an unchanged revision must not silently accept a misrouted field page.
    await assert.rejects(work.focused(a,{planId:p.id,itemId:item.id,offset:1200,sinceRevision:p.revision}),/work_read_brief/);
    const page=await work.call(a,continuation.tool,continuation.input);
    assert.equal(brief.items[0].description.preview+page.text,item.description);
    for(let i=0;i<4;i++)p.items.push({...structuredClone(item),id:randomUUID(),title:'Additional task '+i});
    const first=await work.focused(a,{planId:p.id});assert.equal(first.items.length,4);assert.equal(first.nextOffset,4);
    const last=await work.focused(a,{planId:p.id,offset:first.nextOffset});assert.equal(last.items.length,1);assert.equal(last.nextOffset,null);
    assert.equal(last.items[0].id,p.items.at(-1).id);
  }finally{await f.close();}
});

test('long binding instructions remain exactly retrievable, and dependency/sprint gates still block work',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0],work=f.plane.work,p=work.available(a,f.plan.id);p.instructions='Constraint. '.repeat(1600)+'NEVER overwrite a save.';p.items[0].dependsOn=[p.items[1].id];
    const focused=await work.focused(a,{planId:p.id});assert.equal(focused.instructions.requiredRead,true);assert.equal(focused.items[0].readiness.canWork,false);
    let text=focused.instructions.preview,input=focused.instructions.retrieve.input;while(input){const page=await work.call(a,'work_read_brief',input);text+=page.text;input=page.nextOffset!==null?{...input,offset:page.nextOffset}:null;}
    assert.equal(text,p.instructions);assert(text.endsWith('NEVER overwrite a save.'));
    p.items[0].dependsOn=[];p.management.method='scrum';p.flow.activeSprintId=null;assert.match((await work.focused(a,{planId:p.id})).items[0].readiness.reason,/sprint/);
    await assert.rejects(work.focused(f.tasks[2],{planId:p.id}),/not available/);
  }finally{await f.close();}
});

test('deferred schemas are discoverable without granting access or changing old direct tool calls',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0],c=f.plane.collaboration,full=c.catalog(a),small=c.catalog(a,{compact:true});
    assert(small.tools.some(t=>t.name==='notebook_write'));assert(!small.tools.some(t=>t.name==='work_verify_task'));assert(small.tools.length<full.tools.length/2);
    const found=await c.call(a,'toolbox',{name:'work_verify_task'});assert(found.tools[0].inputSchema.required.includes('expectedRevision'));
    assert((await c.call(a,'toolbox',{})).tools.every(t=>!t.inputSchema));
    a.toolPolicy={mode:'selected',allowed:[]};await assert.rejects(c.call(a,'toolbox',{name:'memory_write'}),/not available/);await assert.rejects(c.call(a,'invoke_tool',{name:'memory_write',input:{key:'x',text:'x',expectedRevision:0}}),/outside/);
    assert.equal((await c.call(a,'invoke_tool',{name:'work_brief',input:{planId:f.plan.id}})).revision,f.plan.revision);
  }finally{await f.close();}
});

test('Done receipts stay in the inbox while only ready dependency owners are awakened',async()=>{
  const f=await fixture();try{
    const work=f.plane.work,[a,b]=f.tasks,p=work.available(a,f.plan.id);p.items[1].dependsOn=[p.items[0].id];p.items[0].status='needs_review';p.items[0].note='Author checks pass';p.items[0].contributors=[a.id];p.outbox=[];
    const verified=await work.verify(f.human,{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,passed:true,evidence:'Independent refund, save and reward checks passed.'});await work.flush();
    const messages=f.plane.collaboration.data.messages;assert.equal(messages.filter(m=>m.to===a.id).length,1);assert.equal(messages.find(m=>m.to===a.id).delivery,'inbox');assert.equal(messages.find(m=>m.to===b.id).delivery,'queued');
    await f.plane.collaboration.deliver();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],b.pane);assert.match(f.calls[0][1],/Dependencies finished/);await work.flush();assert.equal(messages.length,2);
    assert.equal(verified.items[0].status,'done');
  }finally{await f.close();}
});

test('editing reviewed checkpoints preserves corrections for the next summary',async()=>{
  const f=await fixture();try{
    const a=f.tasks[0];a.contextCheckpoint={summary:'stale unreviewed text',reviewedHandoff:'Reviewed correction: full refund, high effort.'};
    const events=[{id:'one',type:'message',text:'Finished'}],{fingerprint}=await import('../lib/patch.mjs');
    f.plane.task=()=>a;f.plane.agentSettings={previews:new Map(),preview:async()=>{f.plane.agentSettings.previews.set('p',{historyFingerprint:fingerprint(JSON.stringify(events))});return {previewId:'p'};}};
    f.plane.transcripts={readCurrent:async()=>({events})};f.plane.git={status:async()=>[]};f.plane.data.contextSettings.summaryConnectionId='summary';let payload;
    f.plane.ai={get:()=>({model:'economical-summary',contextWindow:32000,maxOutputTokens:2048}),complete:async(id,input)=>{payload=JSON.parse(input.messages[1].content);return {message:{content:'Checkpoint with corrected full refund.'}};}};
    await f.plane.context.checkpoint(a.id);assert.equal(payload.previousCheckpoint,a.contextCheckpoint.reviewedHandoff);assert(payload.currentWork);assert(payload.currentWork.notebook);assert(!JSON.stringify(payload).includes('stale unreviewed text'));
  }finally{await f.close();}
});
