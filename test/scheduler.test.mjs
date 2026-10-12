import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkManagement} from '../lib/work-management.mjs';
import {WorkScheduler} from '../lib/scheduler.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {defaultScheduleSettings,normalizePolicy,normalizeSchedule,scheduleInstant,quietUntil} from '../lib/schedule-dates.mjs';

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-schedule-'));let time=Date.parse('2026-10-05T16:00:00Z'),busy=false,prompts=[];
  const tasks=['Builder','QA','Coordinator'].map((role,i)=>({id:'agent-'+i,role,project:root,phase:'launched',pane:'pane-'+i,kind:'codex',providerSessionId:'session-'+i}));
  const plane={root,data:{project:root,projects:[{path:root,scheduleSettings:{...defaultScheduleSettings(),timeZone:'UTC',quietHours:{enabled:false,start:'22:00',end:'08:00'}}}],tasks,events:[]},projects:{project:p=>{assert.equal(p,root);return p;},resume:async()=>{throw Error('Unexpected resume');}},herdr:{list:async()=>tasks.map(t=>({pane_id:t.pane,interactive_ready:true,agent_status:busy?'working':'idle'})),prompt:async(pane,text)=>prompts.push({pane,text})},save:async()=>writeFile(path.join(root,'saved.json'),JSON.stringify(plane.data))};
  const initialize=()=>{plane.collaboration=new Collaboration(plane);plane.work=new WorkManagement(plane);plane.scheduler=new WorkScheduler(plane,{clock:()=>time});};initialize();const human=plane.work.human(root);
  const draft=overrides=>plane.work.saveDraft(human,{requestId:crypto.randomUUID(),instructions:'Ship the account page',kind:'plan',strategy:'team',changePolicy:'autonomous',participantIds:tasks.map(t=>t.id),items:[{title:'Build',ownerId:tasks[0].id,schedule:{due:'2026-10-06T16:00'}}],...overrides});
  const start=async overrides=>{let p=await draft(overrides);p=await plane.work.start(human,{planId:p.id,expectedRevision:p.revision});const actual=plane.data.workPlans.find(p1=>p1.id===p.id);actual.startedAt=new Date(time).toISOString();actual.outbox=[];return plane.work.detail(human,p.id);};
  const configure=settings=>plane.scheduler.saveSettings(human,{expectedRevision:plane.scheduler.settings(root).revision,settings});
  return {root,plane,human,tasks,start,draft,configure,initialize,prompts,setTime:v=>time=typeof v==='number'?v:Date.parse(v),time:()=>time,busy:v=>busy=v,close:()=>rm(root,{recursive:true,force:true})};
}

test('calendar dates respect DST, date-only end of day, explicit offsets and quiet hours',()=>{
  const zone='America/Los_Angeles';
  assert.equal(scheduleInstant('2026-03-08',zone,true)-scheduleInstant('2026-03-08',zone)+1,23*3600000);
  assert.equal(scheduleInstant('2026-11-01',zone,true)-scheduleInstant('2026-11-01',zone)+1,25*3600000);
  assert.throws(()=>scheduleInstant('2026-03-08T02:30',zone),/does not exist/);
  assert.equal(scheduleInstant('2026-11-01T01:30',zone),Date.parse('2026-11-01T08:30:00Z'));
  assert.equal(scheduleInstant('2026-11-01T01:30-08:00',zone),Date.parse('2026-11-01T09:30:00Z'));
  for(const bad of ['2026-02-30','bad'])assert.throws(()=>normalizeSchedule({due:bad},null,zone));
  assert.throws(()=>normalizeSchedule({start:'2026-11-02',due:'2026-11-01'},null,zone),/on or after/);
  assert.throws(()=>normalizePolicy({quietHours:'22:00'}),/quiet-hour/);
  assert.throws(()=>normalizePolicy({timeZone:'Mars/Town'},defaultScheduleSettings(),true),/time zone/);
  const settings={...defaultScheduleSettings(),timeZone:zone};assert.equal(quietUntil(Date.parse('2026-03-08T06:30Z'),settings),Date.parse('2026-03-08T15:00Z'));
});

test('saved reminders are idempotent across ticks and a disk reload without calling agents by default',async()=>{
  const f=await fixture();try{
    const p=await f.start();await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);assert.equal(f.plane.data.workPlans[0].outbox.length,0);assert.equal(f.prompts.length,0);
    await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);
    f.plane.data=JSON.parse(await readFile(path.join(f.root,'saved.json'),'utf8'));f.initialize();await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);
    const calendar=f.plane.scheduler.calendar(f.human);assert.equal(calendar.entries.find(e=>e.kind==='task').dueAt,Date.parse('2026-10-06T16:00Z'));assert.equal(calendar.entries[1].planId,p.id);
    f.setTime('2026-10-06T16:00:01Z');await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.summary(f.root).unread,1);assert.equal(f.plane.scheduler.data.notices.length,2);assert.match(f.plane.scheduler.data.notices.at(-1).summary,/Overdue/);
  }finally{await f.close();}
});

test('downtime skips obsolete alerts and coalesces missed check-ins into one useful notification',async()=>{
  const f=await fixture();try{
    await f.configure({checkInMinutes:60});await f.start();f.setTime('2026-10-08T16:00Z');await f.plane.scheduler.scan();
    assert.equal(f.plane.scheduler.data.notices.length,1);const notice=f.plane.scheduler.data.notices[0];assert.match(notice.summary,/Overdue.*Progress check-in/);assert.doesNotMatch(notice.summary,/Due soon/);
    assert.equal(f.plane.scheduler.data.jobs.filter(j=>j.rule==='checkin').length,2);await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);
  }finally{await f.close();}
});

test('quiet hours and reminder cooldown defer user alerts and queued agent delivery',async()=>{
  const f=await fixture();try{
    await f.configure({quietHours:{enabled:true,start:'15:00',end:'17:00'},agentTarget:'owner',checkInMinutes:15,cooldownMinutes:60});await f.start();await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,0);
    f.setTime('2026-10-05T17:00Z');await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);await f.plane.work.flush();assert.equal(f.plane.collaboration.data.messages.length,1);
    f.setTime('2026-10-05T17:15Z');await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);
    f.setTime('2026-10-05T18:00Z');await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,2);
    await f.configure({quietHours:{enabled:true,start:'18:00',end:'19:00'}});await f.plane.collaboration.deliver();assert.equal(f.prompts.length,0);
  }finally{await f.close();}
});

test('check-ins queue for busy owners and use existing delivery when ready without changing task authority',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'owner'});await f.start();f.busy(true);await f.plane.scheduler.scan();await f.plane.work.flush();await f.plane.collaboration.deliver();assert.equal(f.prompts.length,0);assert.equal(f.plane.collaboration.data.messages[0].delivery,'queued');
    f.busy(false);await f.plane.collaboration.deliver();assert.equal(f.prompts.length,1);assert.match(f.prompts[0].text,/work_get/);assert.match(f.prompts[0].text,/does not authorize/);assert.equal(f.plane.data.workPlans[0].items[0].status,'todo');
    await f.plane.work.flush();await f.plane.collaboration.deliver();assert.equal(f.prompts.length,1);
  }finally{await f.close();}
});

test('coordinator routing uses the assigned lead, never broadcasts when none is assigned',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'coordinator'});await f.start();await f.plane.scheduler.scan();assert.equal(f.plane.data.workPlans[0].outbox.length,0);assert.match(f.plane.scheduler.data.notices[0].deliveryNote,/No active coordinator/);
    const p=await f.start({orchestratorId:f.tasks[2].id});await f.plane.scheduler.scan();const current=f.plane.data.workPlans.find(x=>x.id===p.id);assert.deepEqual(current.outbox[0].recipients,[f.tasks[2].id]);
    f.tasks[2].archivedAt=new Date(f.time()).toISOString();await f.plane.work.flush();assert.equal(f.plane.collaboration.data.messages.length,0);
  }finally{await f.close();}
});

test('rescheduled, completed, archived and reassigned tasks invalidate reminders before dispatch',async()=>{
  for(const action of ['reschedule','done','archive','reassign']){
    const f=await fixture();try{
      await f.configure({agentTarget:'owner'});let p=await f.start();await f.plane.scheduler.scan();await f.plane.work.flush();
      if(action==='archive')await f.plane.work.state(f.human,{planId:p.id,expectedRevision:p.revision,status:'archived'});
      else await f.plane.work.change(f.human,{planId:p.id,itemId:p.items[0].id,expectedRevision:p.revision,...(action==='reschedule'?{schedule:{due:'2026-10-20'}}:action==='reassign'?{ownerId:f.tasks[1].id}:{status:'done'})},'update');
      await f.plane.collaboration.deliver();assert.equal(f.prompts.length,0,action);assert.equal(f.plane.collaboration.data.messages[0].delivery,'cancelled',action);
    }finally{await f.close();}
  }
});

test('saved agent envelopes remain safe across queue retry and uncertain provider delivery',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'owner'});const p=await f.start();await f.plane.scheduler.scan();const send=f.plane.collaboration.send.bind(f.plane.collaboration);let once=true;
    f.plane.collaboration.send=async(...args)=>{const r=await send(...args);if(once){once=false;throw Error('lost queue response');}return r;};
    await f.plane.work.flush();assert.equal(f.plane.collaboration.data.messages.length,1);f.setTime(f.time()+31000);await f.plane.work.flush();assert.equal(f.plane.collaboration.data.messages.length,1);
    f.plane.herdr.prompt=async()=>{f.prompts.push('attempt');throw Error('provider response lost');};await f.plane.collaboration.deliver();assert.equal(f.prompts.length,1);assert.equal(f.plane.collaboration.data.messages[0].delivery,'uncertain');
    f.plane.data=JSON.parse(await readFile(path.join(f.root,'saved.json'),'utf8'));f.initialize();await f.plane.scheduler.scan();await f.plane.work.flush();await f.plane.collaboration.deliver();assert.equal(f.prompts.length,1);
    const n=f.plane.scheduler.summary(f.root).notices[0];assert.equal(n.deliveries[0].status,'uncertain');assert.equal(n.deliveries[0].retryable,false);
    await assert.rejects(f.plane.scheduler.reminder(f.human,{id:n.id,action:'retry',eventId:n.deliveries[0].eventId}),/uncertain/);assert.equal(p.id,n.planId);
  }finally{await f.close();}
});

test('scan persistence failure rolls back notifications and outbox; queue errors expose a safe retry',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'owner'});await f.start();const save=f.plane.save;f.plane.save=async()=>{throw Error('disk full');};await assert.rejects(f.plane.scheduler.scan(),/disk full/);
    assert.equal(f.plane.scheduler.data.notices.length,0);assert.equal(f.plane.data.workPlans[0].outbox.length,0);
    f.plane.save=save;await f.plane.scheduler.scan();const send=f.plane.collaboration.send;f.plane.collaboration.send=async()=>{throw Error('Inbox is full');};await f.plane.work.flush();
    const n=f.plane.scheduler.summary(f.root).notices[0];assert.equal(n.deliveries[0].status,'failed');assert.equal(n.deliveries[0].retryable,true);
    f.plane.collaboration.send=send;await f.plane.scheduler.reminder(f.human,{id:n.id,action:'retry',eventId:n.deliveries[0].eventId});await f.plane.work.flush();assert.equal(f.plane.collaboration.data.messages.length,1);
    await f.plane.scheduler.reminder(f.human,{id:n.id,action:'read'});assert.equal(f.plane.scheduler.summary(f.root).unread,0);
  }finally{await f.close();}
});

test('MCP calendar visibility and date proposals preserve review policy, revisions and settings authority',async()=>{
  const f=await fixture();try{
    const hidden=await f.draft();let p=await f.start({changePolicy:'review'});
    const api=(name,input)=>f.plane.collaboration.call(f.tasks[0],name,input);
    assert.equal((await api('work_schedule',{})).plans.length,1);await assert.rejects(api('work_schedule',{planId:hidden.id}),/not available/);
    await assert.rejects(api('work_update_schedule',{planId:p.id,expectedRevision:p.revision,schedule:{overrides:{agentTarget:'owner'}}}),/Only the user/);
    await assert.rejects(f.plane.scheduler.saveSettings(f.tasks[0],{settings:{resumeInactive:true}}),/Only the user/);
    p=await api('work_update_schedule',{planId:p.id,expectedRevision:p.revision,schedule:{due:'2026-10-20'},note:'Delivery dependency requires another day'});assert.equal(p.schedule.due,null);assert.equal(p.proposals[0].operation,'schedule');
    p=await f.plane.work.review(f.human,{planId:p.id,expectedRevision:p.revision,proposalId:p.proposals[0].id,decision:'approve'});assert.equal(p.schedule.due,'2026-10-20');
    await assert.rejects(api('work_update_schedule',{planId:p.id,expectedRevision:1,schedule:{due:'2026-10-21'}}),/changed/);
    p=await api('work_update_task',{planId:p.id,expectedRevision:p.revision,itemId:p.items[0].id,schedule:{due:'2026-10-20'}});assert.equal(p.items[0].schedule.due,'2026-10-06T16:00');assert.equal(p.proposals.at(-1).operation,'update');
    await assert.rejects(f.plane.scheduler.saveSettings(f.human,{expectedRevision:500,settings:{}}),/changed/);
    assert.throws(()=>f.plane.scheduler.calendar({...f.tasks[0],project:'/other'},p.id),/not available/);
  }finally{await f.close();}
});

test('sprint windows share calendar records and ending a window never closes the sprint',async()=>{
  const f=await fixture();try{
    let p=await f.start({management:{method:'scrum'},items:[{title:'Build',ownerId:f.tasks[0].id,points:3,acceptance:'Works with keyboard'}]});
    p=await f.plane.work.delivery(f.human,{planId:p.id,expectedRevision:p.revision,action:'start_sprint',goal:'Usable account',note:'Ready',itemIds:p.items.map(t=>t.id),schedule:{start:'2026-10-05',due:'2026-10-06'}});
    const sprint=f.plane.scheduler.calendar(f.human).entries.find(e=>e.kind==='sprint');assert.equal(sprint.dueDate,'2026-10-06');
    f.setTime('2026-10-07T16:00Z');await f.plane.scheduler.scan();assert.equal(f.plane.data.workPlans[0].flow.activeSprintId,p.flow.activeSprintId);assert.match(f.plane.scheduler.data.notices[0].summary,/Sprint 1/);
    await assert.rejects(f.plane.work.delivery(f.tasks[0],{planId:p.id,action:'close_sprint'}),/sponsor/);
  }finally{await f.close();}
});

test('resuming inactive agents requires project opt-in and never repeats an uncertain launch',async()=>{
  const f=await fixture();try{
    let resumes=0;f.plane.herdr.list=async()=>[];f.plane.projects.resume=async()=>{resumes++;throw Error('Launch outcome unknown');};await f.configure({agentTarget:'owner'});await f.start();await f.plane.scheduler.scan();await f.plane.scheduler.resumeRecipients();assert.equal(resumes,0);
    await f.configure({resumeInactive:true});await f.plane.scheduler.resumeRecipients();assert.equal(resumes,1);await f.plane.scheduler.resumeRecipients();assert.equal(resumes,1);
    f.plane.data=JSON.parse(await readFile(path.join(f.root,'saved.json'),'utf8'));f.initialize();await f.plane.scheduler.resumeRecipients();assert.equal(resumes,1);assert.equal(f.plane.scheduler.summary(f.root).notices[0].deliveries[0].resume.state,'needs_review');
  }finally{await f.close();}
});

test('scheduler jobs and notification read state survive the authoritative DuckDB store',async()=>{
  const f=await fixture();let history;try{
    history=await new HistoryStore(path.join(f.root,'history.duckdb')).init();f.plane.save=()=>history.saveState(f.plane.data);await f.start();await f.plane.scheduler.scan();const n=f.plane.scheduler.data.notices[0];await f.plane.scheduler.reminder(f.human,{id:n.id,action:'read'});
    f.plane.data=await history.loadState();f.initialize();await f.plane.scheduler.scan();assert.equal(f.plane.scheduler.data.notices.length,1);assert.equal(f.plane.scheduler.summary(f.root).unread,0);
  }finally{await history?.close();await f.close();}
});

test('turning off agent routing cancels a queued check-in and stale schedule proposals cannot replace newer dates',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'owner'});let p=await f.start({changePolicy:'review'});await f.plane.scheduler.scan();await f.plane.work.flush();
    await f.configure({agentTarget:'none'});await f.plane.collaboration.deliver();assert.equal(f.prompts.length,0);assert.equal(f.plane.collaboration.data.messages[0].delivery,'cancelled');
    p=await f.plane.work.changeSchedule(f.tasks[0],{planId:p.id,expectedRevision:p.revision,schedule:{due:'2026-10-12'},note:'A dependency changed'});const proposal=p.proposals[0].id;
    p=await f.plane.work.changeSchedule(f.human,{planId:p.id,expectedRevision:p.revision,schedule:{due:'2026-10-20'}});
    await assert.rejects(f.plane.work.review(f.human,{planId:p.id,expectedRevision:p.revision,proposalId:proposal,decision:'approve'}),/schedule changed after/);
  }finally{await f.close();}
});

test('worker lifecycle coalesces overlapping scans, scans on startup and stops cleanly',async()=>{
  const f=await fixture();try{
    let release,scans=0;f.plane.scheduler.scan=async()=>{scans++;await new Promise(r=>release=r);};f.plane.scheduler.resumeRecipients=async()=>{};
    f.plane.scheduler.start();const pending=f.plane.scheduler.tick();assert.equal(scans,1);assert.equal(pending,f.plane.scheduler.tick());
    let stopped=false;const closing=f.plane.scheduler.stop().then(()=>stopped=true);await Promise.resolve();assert.equal(stopped,false);release();await closing;assert.equal(stopped,true);assert.equal(f.plane.scheduler.stopped,true);
    f.plane.scheduler.request();assert.equal(f.plane.scheduler.requestTimer,null);
  }finally{await f.close();}
});

test('existing queued reminders and reopened-browser toasts wait through quiet hours without being cancelled',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'owner',quietHours:{enabled:true,start:'22:00',end:'08:00'}});await f.start();await f.plane.scheduler.scan();await f.plane.work.flush();
    assert.equal(f.plane.scheduler.summary(f.root).notices[0].toastEligible,true);
    f.setTime('2026-10-05T22:00Z');await f.plane.collaboration.deliver();assert.equal(f.plane.collaboration.data.messages[0].delivery,'queued');assert.equal(f.prompts.length,0);assert.equal(f.plane.scheduler.summary(f.root).notices[0].toastEligible,false);
    f.setTime('2026-10-06T08:00Z');await f.plane.collaboration.deliver();assert.equal(f.prompts.length,1);assert.equal(f.plane.scheduler.summary(f.root).notices[0].toastEligible,true);
  }finally{await f.close();}
});

test('a failed receipt save after provider submission is surfaced as uncertain and never repeated',async()=>{
  const f=await fixture();try{
    await f.configure({agentTarget:'owner'});await f.start();await f.plane.scheduler.scan();await f.plane.work.flush();const save=f.plane.save;let fail=false;
    f.plane.herdr.prompt=async()=>{f.prompts.push('sent');fail=true;};f.plane.save=async()=>{if(fail){fail=false;throw Error('receipt write failed');}return save();};
    await f.plane.collaboration.deliver();assert.equal(f.plane.collaboration.data.messages[0].delivery,'uncertain');await f.plane.collaboration.deliver();assert.equal(f.prompts.length,1);
  }finally{await f.close();}
});
