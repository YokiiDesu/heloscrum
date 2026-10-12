import {assert} from './adapters.mjs';

const modes=['ask','allow'];
const groups=['shared','native'];
const nativeDefinitions=[
  {name:'shell',label:'Shell commands',description:'Terminal commands the provider asks to run.',aliases:['shell','Bash','Shell','execute_bash','exec_command','workspace_run']},
  {name:'read',label:'Read files',description:'File reads and searches that require provider approval.',aliases:['read','Read','fs_read','ReadFile','Glob','Grep']},
  {name:'write',label:'Write and edit files',description:'File changes that require provider approval.',aliases:['write','Write','Edit','MultiEdit','fs_write','apply_patch','WriteFile','EditFile']},
  {name:'web',label:'Web access',description:'Web requests that require provider approval.',aliases:['web','WebFetch','WebSearch','web_search','web_fetch']}
];
export const approvalDefaults=()=>({shared:{default:'ask',tools:{}},native:{default:'ask',tools:{}}});
export function approvalRules(task){return task.toolPolicy?.approvals||approvalDefaults();}
export function nativeApprovalTools(task){
  const base=['ollama','llamacpp','lmstudio','bedrock','sagemaker'].includes(task.kind)?nativeDefinitions.slice(0,1):nativeDefinitions;
  return [...base,...(task.observedApprovalTools||[]).filter(t=>!base.some(b=>b.name===t.name))].map(({name,label,description})=>({name,label,description}));
}
export function validateApprovalRules(value,task,catalog){
  assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>groups.includes(k)),'Invalid tool approval settings');
  const names={shared:catalog.tools.map(t=>t.name),native:nativeApprovalTools(task).map(t=>t.name)};
  return Object.fromEntries(groups.map(group=>{
    const row=value[group];assert(row&&modes.includes(row.default)&&row.tools&&typeof row.tools==='object'&&!Array.isArray(row.tools)&&Object.keys(row).every(k=>['default','tools'].includes(k)),'Choose Always ask or Always allow');
    assert(Object.entries(row.tools).every(([name,mode])=>names[group].includes(name)&&modes.includes(mode)),'Unknown tool approval rule');
    return [group,{default:row.default,tools:Object.fromEntries(Object.entries(row.tools).filter(([,mode])=>mode!==row.default))}];
  }));
}
export function approvalMode(task,group,name){const rules=approvalRules(task)[group];return Object.hasOwn(rules.tools,name)?rules.tools[name]:rules.default;}
function nativeTarget(tool){
  if(!tool?.name)return null;
  if(tool.server)return {name:`mcp:${tool.server}/${tool.name}`,label:`${tool.server} / ${tool.name}`,description:'Provider-native MCP tool.'};
  const known=nativeDefinitions.find(t=>t.aliases.includes(tool.name));
  return known||{name:tool.name,label:tool.name,description:'Tool identified in a native provider permission request.'};
}
export function approvalTarget(task,request,collaboration){
  if(request.type!=='tool-approval'||!request.identity||request.currentSetupMenu||request.scope||!request.tool)return null;
  const tool=request.tool;
  if(tool.server==='heloscrum'){
    const catalog=collaboration.rawCatalog(task).tools;
    if(tool.name==='invoke_tool'){
      let name;try{name=JSON.parse(tool.arguments).name;}catch{}
      if(name!==undefined)return typeof name==='string'&&name!=='invoke_tool'&&catalog.some(t=>t.name===name)&&collaboration.allowed(task,name)?{group:'shared',name}:null;
      // A native menu may omit the wrapper's arguments. Only a blanket shared
      // rule with no ask exceptions can authorize that ambiguous wrapper.
      if(approvalRules(task).shared.default==='allow'&&catalog.filter(t=>collaboration.allowed(task,t.name)).every(t=>approvalMode(task,'shared',t.name)==='allow'))return {group:'shared',name:'invoke_tool'};
      return null;
    }
    return catalog.some(t=>t.name===tool.name)&&collaboration.allowed(task,tool.name)?{group:'shared',name:tool.name}:null;
  }
  const target=nativeTarget(tool);return target?{group:'native',...target}:null;
}
export function automaticChoice(task,request,collaboration){
  const target=approvalTarget(task,request,collaboration);
  if(!target||approvalMode(task,target.group,target.name)!=='allow')return null;
  // Never choose persistent/global trust or a question/setup answer. Native
  // denies and sandbox boundaries remain in effect; we answer one tool prompt.
  const option=request.options?.find(o=>/^(?:Allow|Allow once|Run once|Yes, proceed|Yes)$/.test(o.label));
  return option?{choice:option.id,target}:null;
}
export class ToolApprovals {
  constructor(plane){this.plane=plane;this.failed=new Map();this.pending=false;}
  async observe(task,request){
    if(request.type!=='tool-approval'||!request.identity||!request.tool||request.tool.server==='heloscrum')return;
    const target=nativeTarget(request.tool),known=nativeApprovalTools(task);
    if(!target||target.name.length>200||known.some(t=>t.name===target.name)||(task.observedApprovalTools||[]).length>=64)return;
    (task.observedApprovalTools||=[]).push({name:target.name,label:target.label,description:target.description});await this.plane.save();
  }
  async drain(){
    if(this.pending)return;this.pending=true;
    try{
      const tasks=this.plane.data.tasks.filter(t=>t.pane&&!t.archivedAt&&!t.trashedAt&&t.phase==='launched'&&groups.some(g=>{const r=approvalRules(t)[g];return r.default==='allow'||Object.values(r.tools).includes('allow');}));
      for(const task of tasks){
        let current,key;
        try{
          current=await this.plane.taskRequest(task.id,task.project);if(!current.pending)continue;
          const selected=automaticChoice(task,current.request,this.plane.collaboration);if(!selected)continue;
          const revision=task.toolPolicy?.revision||0;key=task.id+':'+revision+':'+current.fingerprint;if(this.failed.has(key))continue;
          const guard=()=>{assert((task.toolPolicy?.revision||0)===revision&&automaticChoice(task,current.request,this.plane.collaboration)?.choice===selected.choice,'Approval settings changed. Review this request.',409);};
          await this.plane.chooseTaskResponse(task.id,selected.choice,current.fingerprint,task.project,guard);
          await this.plane.record('Tool automatically allowed',`${task.role||task.title} · ${selected.target.name} · saved toolbox rule`,task.project);
        }catch(error){
          if(key&&!/already sent|already being sent|request changed|settings changed/i.test(error.message)){this.failed.set(key,true);if(this.failed.size>256)this.failed.delete(this.failed.keys().next().value);await this.plane.record('Tool approval needs review',`${task.role||task.title} · ${error.message}`,task.project).catch(()=>{});}
        }
      }
    }finally{this.pending=false;}
  }
}
