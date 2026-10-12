import {createHash,randomUUID} from 'node:crypto';
import {assert} from './adapters.mjs';
import {defaultScheduleSettings,normalizePolicy,scheduleInstant,localDate,quietUntil} from './schedule-dates.mjs';

const minute=60000;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);
const unfinished=item=>!['done','cancelled'].includes(item.status);
const iso=value=>new Date(value).toISOString();
const labels={deadline:'Due soon',overdue:'Overdue',checkin:'Progress check-in'};

// One durable outbox, driven by the task service's lock. This worker never
// changes task progress, invokes a model, or grants permission to an agent.
export class WorkScheduler {
  constructor(plane,{clock=Date.now,intervalMs=30000}={}){
    this.plane=plane;this.clock=clock;this.intervalMs=intervalMs;this.stopped=true;
    plane.data.scheduler||={jobs:[],notices:[],lastTickAt:null,lastError:null,settingsAudit:[]};
    for(const project of new Set([plane.data.project,...plane.data.workPlans.map(p=>p.project)]))if(project)this.ensureSettings(project);
    this.pending=null;
  }
  get data(){return this.plane.data.scheduler;}
  ensureSettings(project){this.plane.data.projects||=[];let row=this.plane.data.projects.find(p=>p.path===project);if(!row)this.plane.data.projects.push(row={path:project});row.scheduleSettings||=defaultScheduleSettings();}
  settings(project){const saved=this.plane.data.projects?.find(p=>p.path===project)?.scheduleSettings;return {...defaultScheduleSettings(),...structuredClone(saved||{})};}
  policy(plan){const settings=this.settings(plan.project);return {...settings,...structuredClone(plan.schedule?.overrides||{})};}
  async saveSettings(actor,input){
    assert(actor.human,'Only the user can change reminder permissions',403);
    return this.plane.work.serial(async()=>{
      const previous=this.settings(actor.project);assert(input.expectedRevision===previous.revision,'Reminder settings changed. Refresh before saving.',409);
      const next={...normalizePolicy(input.settings,previous,true),revision:previous.revision+1};
      // Validate existing local times in the new zone before changing their meaning.
      for(const p of this.plane.data.workPlans.filter(p=>p.project===actor.project))for(const entity of [p,...p.items,...(p.flow?.sprints||[])]){const start=scheduleInstant(entity.schedule?.start,next.timeZone),due=scheduleInstant(entity.schedule?.due,next.timeZone,true);assert(start==null||due==null||due>=start,'Changing the timezone would put a deadline before its start');}
      const oldProjects=this.plane.data.projects,oldScheduler=this.data;
      this.plane.data.projects=structuredClone(oldProjects||[]);let row=this.plane.data.projects.find(p=>p.path===actor.project);if(!row)this.plane.data.projects.push(row={path:actor.project});row.scheduleSettings=next;
      this.plane.data.scheduler={...oldScheduler,settingsAudit:[...(oldScheduler.settingsAudit||[]),{id:randomUUID(),project:actor.project,at:iso(this.clock()),by:actor.id,before:previous,after:next}]};
      try{await this.plane.save();}catch(error){this.plane.data.projects=oldProjects;this.plane.data.scheduler=oldScheduler;throw error;}
      this.request();return this.settings(actor.project);
    });
  }
  entries(plan,at=this.clock()){
    const policy=this.policy(plan),open=plan.items.some(unfinished)||!plan.items.length;
    return [{entity:plan,kind:'plan',title:plan.title,active:open},...plan.items.map(entity=>({entity,kind:entity.schedule?.milestone?'milestone':'task',title:entity.title,active:unfinished(entity)})),...(plan.flow?.sprints||[]).map(entity=>({entity,kind:'sprint',title:entity.name,active:entity.status==='active'}))].map(({entity,kind,title,active})=>{
      const s=entity.schedule||{},startAt=scheduleInstant(s.start,policy.timeZone),dueAt=scheduleInstant(s.due,policy.timeZone,true);
      return {id:plan.id+':'+kind+':'+entity.id,entityId:entity.id,planId:plan.id,project:plan.project,planTitle:plan.title,title,kind,status:entity.status,planStatus:plan.status,ownerId:entity.ownerId||null,schedule:s,startAt,dueAt,startDate:startAt==null?null:localDate(startAt,policy.timeZone),dueDate:dueAt==null?null:localDate(dueAt,policy.timeZone),timeZone:policy.timeZone,actionable:plan.status==='active'&&active,overdue:plan.status==='active'&&active&&dueAt!=null&&at>dueAt};
    });
  }
  candidates(plan,at){
    const p=this.policy(plan);if(plan.status!=='active'||!p.enabled)return [];
    const entries=this.entries(plan,at),jobs=[];
    const add=(entry,rule,dueAt,expiresAt=null)=>{
      const version=hash([entry.schedule,p.timeZone,p.enabled,p.leadMinutes,p.overdue,p.checkInMinutes,p.agentTarget,p.cooldownMinutes,p.quietHours]);
      const id=hash([plan.id,entry.kind,entry.entityId,version,rule,dueAt]);
      jobs.push({id,planId:plan.id,project:plan.project,entityId:entry.entityId,kind:entry.kind,title:entry.title,rule,dueAt,expiresAt,version,state:'pending'});
    };
    for(const entry of entries.filter(e=>e.actionable&&e.dueAt!=null)){
      if(p.leadMinutes>0)add(entry,'deadline',entry.dueAt-p.leadMinutes*minute,entry.dueAt);
      if(p.overdue)add(entry,'overdue',entry.dueAt+1);
    }
    const planEntry=entries[0];
    if(p.checkInMinutes&&planEntry.actionable){
      const cadence=p.checkInMinutes*minute,anchor=Math.max(Date.parse(plan.startedAt||plan.createdAt),planEntry.startAt||0),index=Math.max(1,Math.floor((at-anchor)/cadence));
      add(planEntry,'checkin',anchor+index*cadence);
      if(anchor+index*cadence<=at)add(planEntry,'checkin',anchor+(index+1)*cadence);
    }
    return jobs;
  }
  recipients(plan,jobs){
    const policy=this.policy(plan),eligible=new Set(this.plane.work.agents(plan.project).filter(t=>plan.participantIds.includes(t.id)&&this.plane.collaboration.allowed(t,'work_get')).map(t=>t.id));
    let ids=[];
    if(policy.agentTarget==='coordinator')ids=[plan.management?.processLeadId||plan.orchestratorId];
    if(policy.agentTarget==='owner')ids=jobs.flatMap(job=>['task','milestone'].includes(job.kind)?[plan.items.find(t=>t.id===job.entityId)?.ownerId]:job.kind==='sprint'?plan.items.filter(t=>t.sprintId===job.entityId&&unfinished(t)).map(t=>t.ownerId):plan.items.filter(unfinished).map(t=>t.ownerId));
    return [...new Set(ids.filter(id=>eligible.has(id)))];
  }
  validJobs(meta,at=this.clock()){
    const plan=this.plane.data.workPlans.find(p=>p.id===meta.planId&&p.project===meta.project);if(!plan)return [];
    const valid=new Set(this.candidates(plan,at).filter(j=>!j.expiresAt||j.expiresAt>at).map(j=>j.id));
    return this.data.jobs.filter(j=>meta.jobIds.includes(j.id)&&valid.has(j.id));
  }
  deliveryCheck(meta,recipientId,at=this.clock()){
    const jobs=this.validJobs(meta,at),plan=this.plane.data.workPlans.find(p=>p.id===meta.planId&&p.project===meta.project);
    if(!plan||!jobs.length||!this.recipients(plan,jobs).includes(recipientId))return {state:'cancel',reason:'Reminder no longer applies to this task, schedule, or recipient'};
    if(quietUntil(at,this.policy(plan))>at)return {state:'hold',reason:'Waiting until quiet hours end'};
    return {state:'ready'};
  }
  reconcileMessages(at){
    let changed=false;
    for(const message of this.plane.collaboration.data.messages.filter(m=>m.schedule&&m.delivery==='queued')){
      const check=this.deliveryCheck(message.schedule,message.to,at);
      if(check.state==='cancel'){message.delivery='cancelled';message.error=check.reason;changed=true;}
    }
    return changed;
  }
  async scan(){return this.plane.work.serial(async()=>{
    const at=this.clock(),old=this.data,oldPlans=this.plane.data.workPlans;
    // Only these references are replaced, so rollback cannot overwrite sessions.
    this.plane.data.scheduler=structuredClone(old);this.plane.data.workPlans=structuredClone(oldPlans);
    try{
      const s=this.data;
      for(const plan of this.plane.data.workPlans){
        const candidates=this.candidates(plan,at),ids=new Set(candidates.map(j=>j.id));
        for(const job of s.jobs.filter(j=>j.planId===plan.id&&j.state==='pending'))if(!ids.has(job.id))job.state='cancelled';
        for(const candidate of candidates)if(!s.jobs.some(j=>j.id===candidate.id))s.jobs.push(candidate);
        for(const job of s.jobs.filter(j=>j.planId===plan.id&&j.state==='pending'&&j.expiresAt&&j.expiresAt<=at))job.state='skipped';
        const p=this.policy(plan),last=s.notices.filter(n=>n.planId===plan.id).at(-1);
        if(quietUntil(at,p)>at||last&&at-Date.parse(last.at)<p.cooldownMinutes*minute)continue;
        const due=s.jobs.filter(j=>j.planId===plan.id&&j.state==='pending'&&ids.has(j.id)&&j.dueAt<=at);if(!due.length)continue;
        const id=hash(due.map(j=>j.id).sort()),recipients=this.recipients(plan,due),summary=due.slice(0,6).map(j=>`${labels[j.rule]}: ${j.title}`).join(' · ')+(due.length>6?` · +${due.length-6} more`:'');
        const notice={id,project:plan.project,planId:plan.id,title:plan.title,summary,at:iso(at),jobIds:due.map(j=>j.id),readAt:null,agentTarget:p.agentTarget,recipients};
        if(p.agentTarget!=='none'&&!recipients.length)notice.deliveryNote=p.agentTarget==='coordinator'?'No active coordinator assigned. Notification saved for you.':'No active task owners assigned. Notification saved for you.';
        s.notices.push(notice);for(const j of due){j.state='notified';j.noticeId=id;}
        for(const recipientId of recipients)plan.outbox.push({id:hash([id,recipientId]),recipients:[recipientId],revision:plan.revision,reason:`Scheduled check-in for this plan. Read work_schedule and work_get for current deadlines, unfinished tasks and blockers; report only on work that still applies. Report evidence or propose changes using normal permissions; this reminder does not authorize deadline extensions, reassignment, completion approval, or sprint closure.`,createdAt:iso(at),state:'pending',schedule:{noticeId:id,project:plan.project,planId:plan.id,jobIds:notice.jobIds}});
      }
      for(const plan of this.plane.data.workPlans)for(const event of plan.outbox.filter(e=>e.schedule&&e.state==='pending'))if(this.deliveryCheck(event.schedule,event.recipients[0],at).state==='cancel'){event.state='cancelled';event.error='Reminder is obsolete';}
      s.lastTickAt=iso(at);s.lastError=null;
      await this.plane.save();
    }catch(error){this.plane.data.scheduler=old;this.plane.data.workPlans=oldPlans;throw error;}
  });}
  tick(){
    if(this.pending)return this.pending;
    this.pending=this.scan().then(()=>this.resumeRecipients()).catch(error=>{this.data.lastError=error.message;console.error('Schedule worker:',error.message);}).finally(()=>{this.pending=null;});return this.pending;
  }
  request(){if(this.stopped||this.requestTimer)return;this.requestTimer=setTimeout(()=>{this.requestTimer=null;this.tick();},50);this.requestTimer.unref?.();}
  start(){if(!this.stopped)return;this.stopped=false;this.timer=setInterval(()=>this.tick(),this.intervalMs);this.timer.unref?.();this.tick();}
  async stop(){this.stopped=true;clearInterval(this.timer);clearTimeout(this.requestTimer);this.requestTimer=null;await this.pending;}
  async resumeRecipients(){
    // A verified existing CLI session may be resumed only by explicit project
    // consent. Persist intent before touching the provider; never replay it.
    let live;const waiting=this.plane.data.workPlans.flatMap(p=>p.outbox.filter(e=>e.schedule&&['pending','queued'].includes(e.state)).map(e=>({plan:p,event:e})));
    if(!waiting.some(({plan})=>this.settings(plan.project).resumeInactive))return;
    try{live=await this.plane.herdr.list();}catch{return;}
    for(const {plan,event} of waiting){
      const to=event.recipients[0],message=this.plane.collaboration.data.messages.find(m=>m.requestId==='work:'+plan.id+':'+event.id);
      if(event.resume||message&&!['queued'].includes(message.delivery)||!this.settings(plan.project).resumeInactive)continue;
      const task=this.plane.data.tasks.find(t=>t.id===to);if(!task||live.some(a=>a.pane_id===task.pane)||['starting','switching','awaiting-setup'].includes(task.phase)||this.deliveryCheck(event.schedule,to).state!=='ready')continue;
      await this.plane.work.serial(async()=>{
        const current=this.plane.data.workPlans.find(p=>p.id===plan.id)?.outbox.find(e=>e.id===event.id);
        if(!current||current.resume||!this.settings(plan.project).resumeInactive||this.deliveryCheck(current.schedule,to).state!=='ready')return;
        if(!task.providerSessionId){current.resume={state:'blocked',at:iso(this.clock()),error:'No saved CLI session. Resume or start the agent yourself.'};await this.plane.save();return;}
        current.resume={state:'attempted',at:iso(this.clock())};await this.plane.save();
        try{await this.plane.projects.resume(plan.project,to);current.resume.state='requested';}
        catch(error){current.resume.state='needs_review';current.resume.error=error.message;}
        await this.plane.save();
      });
    }
  }
  noticeView(notice){
    const plan=this.plane.data.workPlans.find(p=>p.id===notice.planId),at=this.clock();
    const deliveries=(plan?.outbox||[]).filter(e=>e.schedule?.noticeId===notice.id).map(e=>{
      const m=this.plane.collaboration.data.messages.find(m=>m.requestId==='work:'+plan.id+':'+e.id);
      const status=m?.delivery||(e.state==='pending'&&e.error?'failed':e.state);
      const check=this.deliveryCheck(e.schedule,e.recipients[0],at),task=this.plane.data.tasks.find(t=>t.id===e.recipients[0]);
      return {eventId:e.id,to:e.recipients[0],name:task?.role||task?.title||'Agent',status,error:m?.error||e.error||null,retryable:status==='failed'&&check.state!=='cancel',nextAttemptAt:e.nextAttemptAt||null,resume:e.resume||null,waiting:status==='queued'?(check.state==='hold'?check.reason:'Waiting for an idle, ready agent session'):null};
    });
    return {...notice,toastEligible:!!plan&&quietUntil(at,this.policy(plan))<=at,obsolete:!this.validJobs({...notice,jobIds:notice.jobIds},at).length,deliveries};
  }
  summary(project){const notices=this.data.notices.filter(n=>n.project===project),valid=new Set(this.plane.data.workPlans.filter(p=>p.project===project).flatMap(p=>this.candidates(p,this.clock())).filter(j=>!j.expiresAt||j.expiresAt>this.clock()).map(j=>j.id));return {lastTickAt:this.data.lastTickAt,lastError:this.data.lastError,total:notices.length,unread:notices.filter(n=>!n.readAt&&n.jobIds.some(id=>valid.has(id))).length,notices:notices.slice(-100).reverse().map(n=>this.noticeView(n))};}
  calendar(actor,planId){
    const visible=planId?[this.plane.work.available(actor,planId)]:this.plane.work.list(actor).map(p=>this.plane.work.available(actor,p.id));
    return {timeZone:this.settings(actor.project).timeZone,settings:actor.human?this.settings(actor.project):undefined,plans:visible.map(p=>({id:p.id,title:p.title,status:p.status,revision:p.revision,schedule:p.schedule||null,reminders:this.policy(p)})),entries:visible.flatMap(p=>this.entries(p)),...(actor.human?this.summary(actor.project):{})};
  }
  async reminder(actor,input){
    assert(actor.human,'Only the user manages reminder notifications',403);
    return this.plane.work.serial(async()=>{
      if(input.action==='read-all'){const notices=this.data.notices.filter(n=>n.project===actor.project&&!n.readAt),previous=notices.map(n=>n.readAt);for(const n of notices)n.readAt=iso(this.clock());try{await this.plane.save();}catch(e){notices.forEach((n,i)=>n.readAt=previous[i]);throw e;}return {ok:true};}
      const n=this.data.notices.find(n=>n.id===input.id&&n.project===actor.project);assert(n,'Reminder not found in this project',404);
      if(input.action==='read'){const before=n.readAt;n.readAt=iso(this.clock());try{await this.plane.save();}catch(e){n.readAt=before;throw e;}}
      else if(input.action==='retry'){
        const view=this.noticeView(n),delivery=view.deliveries.find(d=>d.eventId===input.eventId);assert(delivery?.retryable,'Only a confirmed queue failure can be retried. Inspect uncertain deliveries in the agent session.',409);
        const e=this.plane.data.workPlans.find(p=>p.id===n.planId).outbox.find(e=>e.id===input.eventId),previous=e.nextAttemptAt;e.nextAttemptAt=null;try{await this.plane.save();}catch(error){e.nextAttemptAt=previous;throw error;}
      }else assert(false,'Choose read or retry');
      return this.noticeView(n);
    });
  }
}
