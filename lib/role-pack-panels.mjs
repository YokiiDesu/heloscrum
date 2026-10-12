import {ROLE_PACKS,ROLE_PACK_VERSION} from '../dist/role-pack-catalog.js';
import {canReviewTask} from './work-methods.mjs';
const clip=(s,n=420)=>String(s||'').slice(0,n);
const currentItems=plan=>plan.items.filter(item=>item.status!=='cancelled');
export function reviewEligibility(plan,actor,item){
  if(!plan.management)return 'No managed verification workflow';
  if(plan.status!=='active')return 'Plan is not active';
  if(item.status!=='needs_review')return 'Not awaiting review';
  if(item.ownerId===actor.id||item.contributors?.includes(actor.id))return 'Independent reviewer required';
  if(!canReviewTask(plan,actor,item))return 'Review authority not delegated';
  if((item.dependsOn||[]).some(id=>plan.items.find(i=>i.id===id)?.status!=='done'))return 'Dependencies are unfinished';
  return null;
}
export function accessibleRolePlans(plane,task){
  return (plane.work?.list(task)||[]).filter(p=>p.status==='active').slice(0,6).map(p=>plane.work.available(task,p.id));
}
const source=(p,t)=>({kind:'task',planId:p.id,itemId:t.id,revision:p.revision,at:t.updatedAt||p.updatedAt||null});
const row=(p,t,text=t.note,label='Author report')=>({title:clip(t.title,120),text:clip(text),label,status:t.status,source:source(p,t)});
const section=(title,items,empty)=>({title,items:items.slice(0,6),total:items.length,empty});
const criteria=(owned,label)=>section(label,owned.map(({p,t})=>row(p,t,t.acceptance||t.description,'Acceptance criteria')), 'No assigned task criteria are available. Add them to the shared plan.');
const reports=owned=>section('Recorded observations',owned.filter(({t})=>t.note).map(({p,t})=>row(p,t)), 'No author observations have been recorded. This is not a passing result.');
const verified=all=>section('Independent verification',all.filter(({t})=>t.verification).map(({p,t})=>({...row(p,t,t.verification.evidence,t.verification.passed?'Recorded PASS':'Recorded FAIL'),status:t.verification.passed?'passed':'failed',source:{...source(p,t),at:t.verification.at},by:t.verification.name||t.verification.by})), 'No independent verification is recorded.');
export async function rolePackPanels(plane,task,ids){
  if(!ids.length)return [];
  const plans=accessibleRolePlans(plane,task),all=plans.flatMap(p=>currentItems(p).map(t=>({p,t}))),owned=all.filter(({t})=>t.ownerId===task.id),review=all.filter(({t})=>t.status==='needs_review');
  const resources=plans.flatMap(p=>(p.resourceIds||[]).map(id=>{try{const r=plane.work.resource(id,task.project);return {title:clip(r.name,120),text:r.repoPath||'Attached project resource',label:'Reference · retrieval not verified',source:{kind:'resource',planId:p.id,resourceId:id,revision:p.revision,sha256:r.sha256,at:r.updatedAt||r.createdAt||null}};}catch{return null;}}).filter(Boolean));
  const base={version:ROLE_PACK_VERSION,at:new Date().toISOString(),sources:plans.map(p=>({id:p.id,title:clip(p.title,120),revision:p.revision,at:p.updatedAt})),scope:'Up to 6 active plans accessible to this agent; up to 6 records per section. Excerpts are not the full brief.'};
  const stats=(a,b,c)=>[a,b,c].map(([label,value])=>({label,value}));
  const outcomes=verified(owned),author=reports(owned);
  const reviewRows=review.map(({p,t})=>({...row(p,t,reviewEligibility(p,task,t)||'Eligible for independent review. Open the current board before taking action.',reviewEligibility(p,task,t)?'Review unavailable':'Eligible to review'),eligible:!reviewEligibility(p,task,t)}));
  const result=[];
  for(const id of ids){
    const pack=ROLE_PACKS.find(p=>p.id===id);if(!pack)continue;
    let metrics=[],sections=[];
    if(id==='orchestration'){
      const waiting=all.filter(({p,t})=>(t.dependsOn||[]).some(id=>p.items.find(d=>d.id===id)?.status!=='done'));
      metrics=stats(['Owners',new Set(all.map(({t})=>t.ownerId).filter(Boolean)).size],['Waiting on dependencies',waiting.length],['Ready for review',review.length]);
      sections=[section('Dependency map',waiting.map(({p,t})=>({...row(p,t,(t.dependsOn||[]).map(id=>{const d=p.items.find(x=>x.id===id);return (d?.title||'Missing task')+' · '+(d?.status||'unknown');}).join('\n'),'Depends on'),owner:plane.data.tasks.find(a=>a.id===t.ownerId)?.role||'Unassigned'})), 'No unfinished dependencies in the visible plans.'),section('Shared contracts & resources',resources,'No attached shared resources. A path mentioned in chat does not establish a shared contract.'),section('Handoffs awaiting review',review.map(({p,t})=>row(p,t)), 'No handoffs are awaiting review.')];
    }else if(id==='scrum-master'){
      const blocked=all.filter(({t})=>t.status==='blocked');
      metrics=stats(['Work in progress',all.filter(({t})=>['in_progress','blocked','needs_review'].includes(t.status)).length],['Blocked',blocked.length],['Eligible reviews',reviewRows.filter(t=>t.eligible).length]);
      sections=[section('Sprint & flow',plans.map(p=>{const s=p.flow?.sprints?.find(s=>s.id===p.flow?.activeSprintId);return {title:p.title,text:s?.goal||p.management?.goal||'No sprint goal recorded',label:s?.name||'No active sprint',source:{kind:'plan',planId:p.id,revision:p.revision,at:p.updatedAt},detail:p.management?.method==='kanban'?`WIP limit: ${p.management.wipLimit}`:'Definition of Done: '+clip(p.management?.definitionOfDone||'Not defined',250)};}),'No active shared plan.'),section('Blockers',blocked.map(({p,t})=>({...row(p,t),detail:t.updatedAt?'Task last updated '+t.updatedAt:'Blocker onset not recorded'})), 'No blocked tasks in the visible plans.'),section('Review queue',reviewRows,'Nothing is waiting for review.')];
    }else if(id==='qa-reviewer'){
      metrics=stats(['Awaiting review',review.length],['Eligible for you',reviewRows.filter(t=>t.eligible).length],['Recorded failures',all.filter(({t})=>t.verification?.passed===false).length]);
      sections=[section('Review eligibility',reviewRows,'No review requests in the visible plans.'),section('Author evidence to inspect',review.filter(({t})=>t.note).map(({p,t})=>row(p,t)), 'No author evidence recorded on pending reviews.'),verified(all)];
    }else if(id==='knowledge-manager'){
      const book=plane.notebooks?await plane.notebooks.read(task,{limit:6}):{entries:[],total:0,revision:0};
      const shared=plane.collaboration?.allowed(task,'memory_read')?(plane.collaboration.data.memory||[]).filter(n=>n.project===task.project):[];
      const documents=[...new Map(resources.map(r=>[r.source.resourceId,r])).values()].map(r=>({...r,label:'Saved reference · content not inspected',detail:'Location and content hash are recorded. Check the document or project register for its owner, classification, tags, template, document version, review date and retention rule.'}));
      metrics=stats(['Attached documents',documents.length],['Assigned tasks',owned.length],['Stale notes in sample',book.entries.filter(n=>n.freshness?.state==='stale').length]);
      sections=[criteria(owned,'Assigned work & criteria'),section('Document references',documents,'No documents are attached to the visible plans. This is not a complete inventory of the repository or website.'),section('Author reports',owned.filter(({t})=>t.note).map(({p,t})=>row(p,t)),'No governance observations have been recorded. Conformance has not been assessed.'),{...outcomes,title:'Recorded verification'},section('Notebook & source freshness',book.entries.map(n=>({title:clip(n.category,100),text:clip(n.text),label:(n.freshness?.state||'unknown')+' source · '+n.confidence,status:n.freshness?.state,detail:(n.freshness?.reasons||[]).join('; '),source:{kind:'notebook',noteId:n.id,revision:book.revision,at:n.updatedAt}})), 'No private working notes saved for this agent.'),section('Shared knowledge',shared.map(n=>({title:clip(n.key,120),text:clip(n.text),label:'Shared author report',source:{kind:'memory',key:n.key,revision:n.revision,at:n.at}})), 'No shared notes available in this agent’s toolbox.')];
    }else{
      const labels={'ui-ux':'Interaction & accessibility criteria','game-design':'Rules, balance & player goals','database-architect':'Data architecture & governance criteria',devsecops:'Security lifecycle & delivery criteria'};
      metrics=stats(['Assigned tasks',owned.length],['Author reports',author.total],['Verification records',outcomes.total]);
      sections=[criteria(owned,labels[id]),author,section(id==='database-architect'?'Data models, contracts & decisions':id==='devsecops'?'Security, pipeline & runtime references':id==='game-design'?'Rules & playtest resources':'Design & test resources',resources,'No supporting resources attached.'),outcomes];
    }
    result.push({...base,id:pack.id,name:pack.name,icon:pack.icon,color:pack.color,eyebrow:pack.eyebrow,description:pack.description,guide:pack.guide,metrics,sections});
  }
  return result;
}
