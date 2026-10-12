import {assert} from './adapters.mjs';

export const availableIn=(resource,project)=>resource.scope==='global'||resource.project===project;
export function assignedTo(resource,task,profiles=[]){
  if(resource.enabled===false||!availableIn(resource,task.project))return false;
  if(resource.assignment!=='selected')return true;
  return (resource.agentIds||[]).includes(task.id)||(resource.profileIds||[]).some(id=>id===task.profileId&&profiles.some(p=>p.id===id&&availableIn(p,task.project)));
}
export function accessSettings(plane,input,previous={}){
  const scope=input.scope??previous.scope??'project';
  assert(input.enabled===undefined||typeof input.enabled==='boolean','Enabled must be a boolean');
  assert(['project','global'].includes(scope),'Choose This project or All projects');
  const project=scope==='global'?null:(input.project??previous.project??plane.data.project);
  if(project)plane.projects.project(project);
  const assignment=input.assignment??previous.assignment??'all';
  assert(['all','selected'].includes(assignment),'Choose all agents or selected agents');
  const agentIds=assignment==='all'?[]:input.agentIds??previous.agentIds??[];
  const profileIds=assignment==='all'?[]:input.profileIds??previous.profileIds??[];
  assert(Array.isArray(agentIds)&&agentIds.length<=200&&agentIds.every(id=>plane.data.tasks.some(t=>t.id===id&&!t.trashedAt&&(scope==='global'||t.project===project))),'Choose agents within this availability');
  assert(Array.isArray(profileIds)&&profileIds.length<=200&&profileIds.every(id=>(plane.data.agentProfiles||[]).some(p=>p.id===id&&(scope==='global'||availableIn(p,project)))),'Choose available agent profiles');
  return {scope,project,assignment,agentIds:[...new Set(agentIds)],profileIds:[...new Set(profileIds)],enabled:input.enabled??previous.enabled??true};
}
export function grantAssignedTools(plane,resource,names,targetTask){
  if(resource.assignment!=='selected')return;
  for(const task of targetTask?[targetTask]:plane.data.tasks){
    if(!assignedTo(resource,task,plane.data.agentProfiles)||task.toolPolicy?.mode!=='selected')continue;
    const allowed=[...new Set([...task.toolPolicy.allowed,...names])];
    if(allowed.length!==task.toolPolicy.allowed.length)task.toolPolicy={...task.toolPolicy,allowed,revision:(task.toolPolicy.revision||0)+1};
  }
}
