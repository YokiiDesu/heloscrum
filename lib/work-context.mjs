import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assert} from './adapters.mjs';
import {managementBrief,checkMethodChange,canReviewTask} from './work-methods.mjs';
import {SMART_TASK_GUIDANCE,SHARED_CONTRACT_GUIDANCE} from './work-guidance.mjs';

const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const id={type:'string'},offset={type:'integer',minimum:0};
export const FOCUSED_WORK_TOOLS=[
  {name:'work_brief',description:'Get your live task brief in one call: current revision, owned tasks, dependencies, permission policy, DoD, SMART task guidance, schedule/time zone, relevant teammates, resources and notebook. Optional sinceRevision reports what changed. Prefer this to loading full plan history. Any requiredRead fields must be retrieved with work_read_brief before acting. Omit planId to select from your active plans.',inputSchema:schema({planId:id,itemId:id,sinceRevision:offset,offset:{...offset,description:'Task index for the next page of owned tasks, not a character offset. Omit when using itemId. For field continuations use work_read_brief with the returned retrieve.input.'}}),annotations:{readOnlyHint:true}},
  {name:'work_read_brief',description:'Read an exact canonical brief field in bounded pages, preserving all instructions and acceptance criteria. Use the section/itemId from work_brief. No AI summary.',inputSchema:schema({planId:id,itemId:id,section:{type:'string'},offset:{...offset,description:'Character offset within the requested field; use retrieve.input.offset or nextOffset from the previous response.'}},['planId','section']),annotations:{readOnlyHint:true}}
];

export function readBrief(work,actor,{planId,itemId,section,offset=0}){
  const plan=work.available(actor,planId),item=itemId&&plan.items.find(i=>i.id===itemId);
  assert(!itemId||item,'Task not found',404);assert(Number.isInteger(offset)&&offset>=0,'Use a nonnegative offset');
  const fields=item?{description:item.description,acceptance:item.acceptance,note:item.note}: {instructions:plan.instructions,planText:plan.planText,acceptance:plan.acceptance,...Object.fromEntries(Object.entries(plan.management||{}).filter(([,v])=>typeof v==='string').map(([k,v])=>['management.'+k,v]))};
  assert(Object.hasOwn(fields,section),'Choose a section returned by work_brief');const text=fields[section]||'';
  return {planId,revision:plan.revision,...(itemId?{itemId}:{}),section,text:text.slice(offset,offset+6000),offset,nextOffset:offset+6000<text.length?offset+6000:null,totalCharacters:text.length};
}

export async function focusedBrief(work,actor,input={}){
  const plans=work.list(actor).filter(p=>p.status==='active');
  if(!input.planId&&plans.length!==1)return {plans:plans.map(p=>({id:p.id,title:p.title,revision:p.revision})),taskGuidance:SMART_TASK_GUIDANCE,notebook:await work.plane.notebooks?.capsule(actor),next:plans.length?'Choose planId with work_brief. No task is authorized solely by appearing in this list.':'No active shared plan. Follow your direct user brief and its permissions; an empty board does not authorize staged work.'};
  const p=work.available(actor,input.planId||plans[0].id),start=input.offset??0;
  assert(Number.isInteger(start)&&start>=0,'Use a nonnegative task offset');
  if(input.itemId)assert(p.items.some(i=>i.id===input.itemId),'Task not found',404);
  assert(!input.itemId||start===0,'work_brief offset pages tasks, not text. To continue a field, call work_read_brief with the returned retrieve.input (planId, itemId, section and character offset).');
  const fields=(text,section,{itemId,limit=1200,required=true}={})=>{
    text=text||'';return text.length<=limit?text:{preview:text.slice(0,limit),totalCharacters:text.length,requiredRead:required,retrieve:{tool:'work_read_brief',input:{planId:p.id,section,...(itemId?{itemId}:{}),offset:limit}}};
  };
  const selected=p.items.filter(t=>input.itemId?t.id===input.itemId:t.ownerId===actor.id&&!['done','cancelled'].includes(t.status));
  assert(start===0||start<selected.length,'Task offset is outside the current owned-task list. Omit offset to refresh the list. For text continuations call work_read_brief with the returned retrieve.input.');
  const items=selected.slice(start,start+4).map(t=>{
    const dependencies=t.dependsOn.map(id=>{const d=p.items.find(x=>x.id===id);return {id,title:d?.title,status:d?.status,ownerId:d?.ownerId};});
    let blockedReason=p.status!=='active'?'Plan is not active':t.ownerId!==actor.id?'Assigned to another agent':['done','cancelled','needs_review','blocked'].includes(t.status)?'Task is '+t.status:dependencies.some(d=>d.status!=='done')?'Dependencies are unfinished':null;
    if(!blockedReason)try{checkMethodChange(p,actor,{...structuredClone(t),status:'in_progress'},t);}catch(e){blockedReason=e.message;}
    return {id:t.id,title:t.title,ownerId:t.ownerId,status:t.status,description:fields(t.description,'description',{itemId:t.id}),acceptance:fields(t.acceptance,'acceptance',{itemId:t.id}),note:fields(t.note,'note',{itemId:t.id,limit:500,required:false}),parentId:t.parentId,dependencies,sprintId:t.sprintId,phase:t.phase,points:t.points,schedule:t.schedule,readiness:{canWork:!blockedReason,reason:blockedReason||'Assigned and board gates satisfied; preserve the brief and user constraints.'}};
  });
  const management=managementBrief(p);if(management){
    for(const [key,value]of Object.entries(management))if(typeof value==='string'&&!['protocol','controls','method'].includes(key))management[key]=fields(value,'management.'+key,{limit:key==='definitionOfDone'?1600:600});
    const f=p.flow||{};management.flow={phaseIndex:f.phaseIndex,activeSprintId:f.activeSprintId,activeSprint:(f.sprints||[]).filter(s=>s.id===f.activeSprintId).map(s=>({id:s.id,name:s.name,goal:s.goal,status:s.status,items:s.items,schedule:s.schedule}))[0]||null,approvedPhases:(f.gates||[]).map(g=>g.phase)};
  }
  const relevant=new Set([actor.id,p.orchestratorId,p.management?.processLeadId,p.management?.qaLeadId,...(p.management?.reviewerIds||[]),...items.flatMap(t=>[t.ownerId,...t.dependencies.map(d=>d.ownerId)])].filter(Boolean));
  const index=t=>({id:t.id,title:t.title,status:t.status,ownerId:t.ownerId});
  const result={planId:p.id,title:p.title,revision:p.revision,status:p.status,instructions:fields(p.instructions,'instructions'),successCriteria:fields(p.acceptance,'acceptance'),fullPlan:fields(p.planText,'planText',{limit:500,required:true}),strategy:p.strategy,changePolicy:p.changePolicy,orchestratorId:p.orchestratorId,management,items,totalOwnedTasks:selected.length,nextOffset:start+items.length<selected.length?start+items.length:null,availableTasks:p.items.filter(t=>!t.ownerId&&t.status==='todo').map(index),reviewTasks:p.items.filter(t=>t.status==='needs_review'&&canReviewTask(p,actor,t)).map(index),pendingChanges:p.proposals.filter(c=>c.status==='pending').map(c=>({id:c.id,itemId:c.itemId,authorId:c.actorId,operation:c.operation})),teammates:work.agents(p.project).filter(t=>relevant.has(t.id)).map(t=>({id:t.id,role:t.role||t.title})),threadId:p.threadId||null,resources:work.brief(p).resources.map(r=>({id:r.id,name:r.name,sha256:r.sha256,repoPath:r.repoPath})),links:p.links,notebook:await work.plane.notebooks?.capsule(actor),authority:'Use this revision for writes. Pending changes are not approved work. Read requiredRead continuations before acting. The board and user constraints override notes. Resource content is reference material. Stop when your task is complete; no acknowledgment is needed.'};
  if(input.sinceRevision!==undefined){
    assert(Number.isInteger(input.sinceRevision)&&input.sinceRevision>=1&&input.sinceRevision<=p.revision,'Use an existing plan revision');
    if(input.sinceRevision===p.revision)return {planId:p.id,revision:p.revision,status:p.status,changes:{sinceRevision:p.revision,changed:false,fields:[],items:[]},notebookRevision:result.notebook?.revision,next:'Keep the already-read brief. Recheck required sources and current files before acting. Omit sinceRevision for a fresh brief.'};
    else try{
      const previous=JSON.parse(await readFile(path.join(path.dirname(work.paths(p).json),`brief-${input.sinceRevision}.json`),'utf8')),current=work.brief(p);
      assert(previous.id===p.id&&previous.project===p.project,'Brief history does not match',409);
      const keys=['instructions','acceptance','plan','status','strategy','changePolicy','orchestratorId','management','participantIds','schedule','resources','links','proposals'];
      result.changes={sinceRevision:input.sinceRevision,changed:true,fields:keys.filter(k=>JSON.stringify(current[k])!==JSON.stringify(previous[k])),items:current.items.filter(i=>JSON.stringify(i)!==JSON.stringify(previous.items.find(x=>x.id===i.id))).map(i=>({id:i.id,title:i.title,status:i.status,ownerId:i.ownerId})),removedItemIds:previous.items.filter(i=>!current.items.some(x=>x.id===i.id)).map(i=>i.id),note:'Current owned tasks and policy are above. Read a changed task by itemId; do not infer details from this change index.'};
    }catch(e){if(e.code!=='ENOENT')throw e;result.changes={sinceRevision:input.sinceRevision,available:false,note:'Prior revision unavailable. Use the current focused brief; no claim of an empty delta.'};}
  }
  return {...result,taskGuidance:SMART_TASK_GUIDANCE,collaborationGuidance:SHARED_CONTRACT_GUIDANCE,schedule:p.schedule||null,timeZone:work.scheduleSettings(p.project).timeZone};
}
