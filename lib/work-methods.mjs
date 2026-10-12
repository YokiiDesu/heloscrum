import {randomUUID} from 'node:crypto';
import {assert,string} from './adapters.mjs';
import {methods,methodDefaults,hasPhases,hasSprints,sprintPhase,phases} from '../dist/work-methods.js';

export function normalizeReviewers(ids,participants){
  assert(Array.isArray(ids)&&ids.length<=20&&new Set(ids).size===ids.length,'Choose up to 20 different delegated reviewers');
  assert(ids.every(id=>typeof id==='string'&&participants.includes(id)),'Choose reviewers from the selected team');
  return [...ids];
}
export const isPlanReviewer=(plan,actor)=>actor.human||!plan.management?.qaLeadId||plan.management.qaLeadId===actor.id||plan.management.reviewerIds?.includes(actor.id)===true;
export const canReviewTask=(plan,actor,task)=>actor.human||task.ownerId!==actor.id&&!task.contributors?.includes(actor.id)&&isPlanReviewer(plan,actor);

export function normalizeManagement(input,participants){
  if(input==null)return null; // Pre-existing briefs keep their original behavior.
  assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.hasOwn(methods,input.method),'Choose Waterfall, Scrum, Kanban, or Hybrid');
  const m=methodDefaults(input.method);
  for(const key of ['goal','reason','definitionOfDone','syncCadence','scopeBaseline','scheduleBaseline','riskRegister'])if(input[key]!=null)m[key]=input[key]===''?'':string(input[key],key,key==='syncCadence'?300:8000);
  for(const key of ['processLeadId','productOwnerId','qaLeadId']){m[key]=input[key]||null;assert(!m[key]||participants.includes(m[key]),'Choose delivery roles from the selected team');}
  for(const key of ['sprintCapacity','wipLimit']){const n=Number(input[key]??m[key]);assert(Number.isInteger(n)&&n>=1&&n<=(key==='wipLimit'?100:200),`Choose a valid ${key==='wipLimit'?'WIP limit (1–100)':'sprint capacity (1–200 points)'}`);m[key]=n;}
  m.reviewerIds=normalizeReviewers(input.reviewerIds??[],participants);
  assert(m.definitionOfDone.trim(),'Define what Done means for this work');return m;
}
export const newFlow=()=>({phaseIndex:0,gates:[],sprints:[],activeSprintId:null});
export function managementBrief(plan){const m=plan.management;if(!m)return null;return {...m,reviewerIds:m.reviewerIds||[],protocol:methods[m.method].protocol,flow:plan.flow,controls:'The sponsor starts/closes sprints and approves phase gates in Delivery. Agents manage task changes under changePolicy; this does not approve releases or other irreversible actions. Independent evidence-backed verification is required for Done.'};}
export function managementMarkdown(plan){const m=managementBrief(plan);return m?`## Delivery approach\n${methods[m.method].name}\nReason: ${m.reason||'Selected by sponsor'}\nProduct goal: ${m.goal||plan.title}\nProcess lead: ${m.processLeadId||'Sponsor'}\nProduct Owner: ${m.productOwnerId||'Sponsor'}\nQA lead: ${m.qaLeadId||'Independent teammate or sponsor'}\nDelegated reviewers: ${(m.reviewerIds||[]).join(', ')||'None'}\nReviewers may verify only work they did not own or contribute to. Final sponsor acceptance remains separate.\n${m.protocol}\n${m.controls}\nDefinition of Done: ${m.definitionOfDone}\n${hasSprints(m)?`Sprint capacity: ${m.sprintCapacity} points. Sync: ${m.syncCadence}. Active sprint: ${plan.flow?.activeSprintId||'None; refine backlog before starting'}.\n`:''}${m.method==='kanban'?`WIP limit: ${m.wipLimit}, including blocked and review work.\n`:''}${hasPhases(m)?`Current phase: ${phases[plan.flow?.phaseIndex||0]}.\nScope baseline: ${m.scopeBaseline||'Not yet recorded'}\nSchedule baseline: ${m.scheduleBaseline||'Not yet recorded'}\nRisk register: ${m.riskRegister||'Not yet recorded'}\n`:''}\n`:'';}

export function methodItem(plan,input,task,old){
  if(!plan.management)return;
  if(input.points!==undefined){assert(input.points==null||[1,2,3,5,8,13,20].includes(input.points),'Use a story point estimate of 1, 2, 3, 5, 8, 13, or 20');task.points=input.points;}
  if(input.acceptance!==undefined)task.acceptance=input.acceptance?string(input.acceptance,'task acceptance criteria',8000):'';
  if(hasPhases(plan.management)){task.phase=input.phase??task.phase??phases[plan.flow?.phaseIndex||0];assert(phases.includes(task.phase),'Choose a valid delivery phase');}
  if(old?.sprintId&&old.sprintId===plan.flow?.activeSprintId){
    assert(task.points===old.points,'Estimates are frozen during a sprint. Record the variance in progress notes.',409);
    assert(task.title===old.title&&task.description===old.description&&task.acceptance===old.acceptance&&task.phase===old.phase&&task.parentId===old.parentId&&JSON.stringify(task.dependsOn)===JSON.stringify(old.dependsOn)&&task.status!=='cancelled','Sprint scope is protected. Close the sprint before changing scope or cancelling an item.',409);
  }
}
export function checkMethodChange(plan,actor,task,old){
  const m=plan.management;if(!m)return;
  assert(task.status!=='done'||old?.status==='done','Use independent verification to mark this task Done',409);
  if(old?.status==='done'&&task.status==='done')assert(['title','description','acceptance','phase','ownerId','points','dependsOn','parentId'].every(k=>JSON.stringify(task[k])===JSON.stringify(old[k])),'Reopen verified work before changing its scope or owner',409);
  if(task.status==='needs_review')assert(task.note?.trim(),'Attach progress evidence before requesting review');
  if(['in_progress','blocked','needs_review'].includes(task.status))assert(task.ownerId,'Active work must keep one accountable owner');
  if(!actor.human&&m.method==='kanban'&&task.status==='todo'&&['in_progress','blocked','needs_review'].includes(old?.status))assert(false,'The sponsor must return active Kanban work to backlog; blocked work stays counted',403);
  const starting=['in_progress','needs_review','blocked'].includes(task.status)&&!['in_progress','needs_review','blocked'].includes(old?.status);
  if(!actor.human&&m.processLeadId===actor.id&&['scrum','kanban','hybrid'].includes(m.method)&&task.ownerId&&task.ownerId!==old?.ownerId&&task.ownerId!==actor.id)assert(false,'The Process Agent facilitates adaptive work; developers pull tasks instead of receiving assignments from the Scrum Master',403);
  if(starting){
    assert(plan.status==='active','Start the brief before beginning its tasks',409);
    assert(task.ownerId,'Assign one accountable owner before starting work');
    if(hasPhases(m))assert(task.phase===phases[plan.flow.phaseIndex],'This task belongs to another phase. Wait for its gate.',409);
    if(sprintPhase(m,plan.flow))assert(plan.flow.activeSprintId&&task.sprintId===plan.flow.activeSprintId,'Pull this task into a sprint from Delivery before starting work',409);
    if(m.method==='kanban')assert(plan.items.filter(t=>t.id!==task.id&&['in_progress','blocked','needs_review'].includes(t.status)).length<m.wipLimit,'WIP limit reached. Finish or unblock existing work first; blocked and review items count.',409);
  }
  if(task.ownerId&&(starting||['in_progress','needs_review','blocked'].includes(task.status)))task.contributors=[...new Set([...(task.contributors||[]),task.ownerId])];
  if(task.status!==old?.status){if(starting)task.startedAt||=new Date().toISOString();if(old?.status==='done')delete task.verification;}
}

export function advanceFlow(plan,input){
  const m=plan.management,f=plan.flow;assert(m&&f,'This brief has no delivery framework',409);
  assert(plan.status==='active','Start or restore this brief before managing delivery',409);
  const note=string(input.note,'evidence / review notes',8000),at=new Date().toISOString();
  if(input.action==='start_sprint'){
    assert(sprintPhase(m,f),'Sprints are available in Scrum, or Hybrid Design / Implementation / Testing');assert(!f.activeSprintId,'Close the current sprint first',409);
    assert(!plan.proposals.some(p=>p.status==='pending'),'Review pending task changes before committing sprint scope',409);
    const goal=string(input.goal,'Sprint Goal',1000),ids=input.itemIds;assert(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length,'Select ready tasks for this sprint');
    const items=ids.map(id=>{const t=plan.items.find(t=>t.id===id);assert(t&&t.status==='todo'&&t.ownerId&&t.acceptance?.trim()&&[1,2,3,5,8].includes(t.points),'Sprint items need an owner, acceptance criteria, a 1–8 point estimate, and To do status');if(hasPhases(m))assert(t.phase===phases[f.phaseIndex],'Select tasks from the current phase');return t;});
    assert(items.reduce((n,t)=>n+t.points,0)<=m.sprintCapacity,'Selected work exceeds sprint capacity');
    assert(items.every(t=>t.dependsOn.every(id=>ids.includes(id)||plan.items.find(x=>x.id===id)?.status==='done')),'Finish external dependencies before committing this sprint');
    const sprint={id:randomUUID(),name:`Sprint ${f.sprints.length+1}`,goal,capacity:m.sprintCapacity,phase:hasPhases(m)?phases[f.phaseIndex]:null,items:items.map(t=>({id:t.id,points:t.points})),status:'active',startedAt:at,planning:note,schedule:input.schedule||null};
    f.sprints.push(sprint);f.activeSprintId=sprint.id;for(const t of items)t.sprintId=sprint.id;return `${sprint.name} started: ${goal}`;
  }
  if(input.action==='close_sprint'){
    const sprint=f.sprints.find(s=>s.id===f.activeSprintId);assert(sprint,'No active sprint',409);
    const improvement=string(input.improvement,'retrospective improvement',4000);
    sprint.doneIds=sprint.items.filter(t=>plan.items.find(i=>i.id===t.id)?.status==='done').map(t=>t.id);
    sprint.donePoints=sprint.items.reduce((n,t)=>n+(sprint.doneIds.includes(t.id)?t.points:0),0);sprint.review=note;sprint.improvement=improvement;sprint.closedAt=at;sprint.status='closed';
    for(const t of plan.items.filter(t=>t.sprintId===sprint.id)){if(!['done','cancelled'].includes(t.status)){t.status='todo';t.sprintId=null;t.note=`Returned to backlog after ${sprint.name}. ${t.note||''}`;t.updatedAt=at;}}
    f.activeSprintId=null;return `${sprint.name} closed: ${sprint.donePoints} verified points. Unfinished work returned to backlog. Improvement: ${improvement}`;
  }
  if(input.action==='approve_gate'){
    assert(hasPhases(m),'This method does not use phase gates');assert(f.phaseIndex<phases.length,'All phase gates are already approved');assert(!f.activeSprintId,'Close the sprint before approving the phase gate',409);
    assert(!plan.proposals.some(p=>p.status==='pending'),'Review pending changes before approving a phase gate',409);
    assert(plan.items.filter(t=>t.phase===phases[f.phaseIndex]).every(t=>['done','cancelled'].includes(t.status)),'Finish or cancel the tasks in this phase before approving its gate');
    if(f.phaseIndex===0)for(const key of ['scopeBaseline','scheduleBaseline','riskRegister'])m[key]=string(input[key]||m[key],key,8000);
    f.gates.push({phase:phases[f.phaseIndex],evidence:note,approvedBy:'human',at});return `${phases[f.phaseIndex++]} gate approved`;
  }
  assert(false,'Choose a supported delivery action');
}
