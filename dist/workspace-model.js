export const navigationTabs=['agents','tasks','conversations','changes'];
export const agentLayouts=['grid','focus','split','overview'];
export const chatThemes=['bubble','block'];
export const statusLabel=status=>({working:'Working',blocked:'Needs Review',idle:'Ready',done:'Finished',starting:'Starting',offline:'Offline','setup-error':'Needs Review'})[status]||status||'Unknown';
export const modelActivityLabel=(status,activity)=>status==='working'?({waiting:'Waiting For Model',receiving:'Receiving Response'}[activity?.phase]||statusLabel(status)):statusLabel(status);
export const workingEllipsis='<span class="working-ellipsis" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>';
export function workspacePreferences(saved={},narrow=false){
  return {tab:navigationTabs.includes(saved.tab)?saved.tab:'agents',layout:agentLayouts.includes(saved.layout)?saved.layout:narrow?'focus':'grid',theme:chatThemes.includes(saved.theme)?saved.theme:'bubble',selected:saved.selected||null,compare:saved.compare||null,railCollapsed:typeof saved.railCollapsed==='boolean'?saved.railCollapsed:narrow};
}
function toolTitle(value){
  const first=value.trim().split(/\r?\n/,1)[0].replace(/\s+/g,' '),call=first.match(/^([\w./:-]+)\s*\(/)?.[1];
  const title=call?call.split(/__|\//).filter(Boolean).at(-1):first+(value.trim().includes('\n')?' …':'');
  return title.length>110?title.slice(0,109).trimEnd()+'…':title||'Tool call';
}
function toolKind(event,name,input){
  const declared={execute:'command',edit:'edit',delete:'edit',move:'edit',read:'read',search:'read',fetch:'read',think:'tool',switch_mode:'tool',other:'tool'}[event.toolKind];
  if(['command','edit','read','tool'].includes(declared))return declared;
  if(event.edits?.length)return 'edit';
  let args;try{args=typeof input==='string'?JSON.parse(input):input;}catch{}
  // Older transcripts have no provider kind. Inspect the operation, never its
  // script body: a command mentioning "write" is still a command.
  const operation=name.trim().split(/[\s(]/,1)[0].split(/__|\/|[.:]/).filter(Boolean).at(-1)||'';
  if(typeof args?.command==='string'||/^(?:run_)?(?:command|terminal|exec|bash|shell)(?:\b|_)/i.test(operation)||/^(?:cat|python\d*|node|git|cargo|rustc|npm|npx|pnpm|yarn|bun|sh|zsh|fish|pwsh|powershell|cd|echo|printf|sed|awk|rg|grep|find|ls|mkdir|cp|mv|rm|curl|wget|make|cmake|go|ruby|perl|tee|shasum)$/i.test(operation))return 'command';
  if(/^(?:edit|write|patch|apply_patch)(?:\b|_)|^file changes\b/i.test(name)||/^(?:edit|write|patch|apply_patch)(?:\b|_)/i.test(operation))return 'edit';
  if(/^(?:read|search|find|glob|list|browse|fetch)(?:\b|_)/i.test(operation))return 'read';
  return 'tool';
}
export function toolPresentation(event){
  const rawName=event.name||'Tool call',call=rawName.split('(',1)[0].trim().split(/__|\/|\s/).filter(Boolean).at(-1),workUpdate=call==='work_update_task',notebookWrite=call==='notebook_write';
  let name=rawName,input=event.input||'',titleDetails='';
  const status=event.failed||event.exitCode!=null&&event.exitCode!==0||/fail|error/i.test(event.status||'')?'failed':/complete|success/i.test(event.status||'')||event.exitCode===0?'completed':/running|in.?progress/i.test(event.status||'')?'running':/cancel|interrupt|abort/i.test(event.status||'')?'cancelled':/block|approval|review/i.test(event.status||'')?'blocked':/queue|pending|wait/i.test(event.status||'')?'pending':'recorded';
  if(workUpdate){
    let args;try{args=JSON.parse(input);}catch{}
    const state=args?.status||rawName.match(/(?:\(|,\s*)status:\s*(todo|in_progress|needs_review|done|blocked)(?=\s*[,)]|$)/)?.[1];
    const label={todo:'To do',in_progress:'In progress',needs_review:'Needs review',done:'Done',blocked:'Blocked'}[state];
    name=status==='completed'?'Task updated':status==='failed'?'Task update failed':status==='cancelled'?'Task update cancelled':'Updating task';
    if(typeof label==='string'&&status==='completed')name+=' · '+label;
    if(!input&&rawName!==call)input=rawName;
  }
  if(notebookWrite){
    name={completed:'Notebook updated',running:'Updating notebook',failed:'Notebook update failed',cancelled:'Notebook update cancelled',blocked:'Notebook update needs approval',pending:'Notebook update queued'}[status]||'Notebook update';
    if(!input&&rawName!==call)input=rawName;
  }
  const kind=workUpdate||notebookWrite?'tool':toolKind(event,rawName,input);
  if(name===rawName){
    name=toolTitle(rawName);
    if(name!==rawName){if(!input)input=rawName;else if(input!==rawName)titleDetails=rawName;}
  }
  const duration=Number.isFinite(event.durationMs)?event.durationMs:Number.isFinite(event.duration)?event.duration:null;
  return {name,input,titleDetails,kind,status,duration:duration==null?null:duration<1000?Math.round(duration)+' ms':(duration/1000).toFixed(1)+' s'};
}
export function thinkingPresentation(event){
  const available=typeof event.text==='string'&&!!event.text.trim(),kind=event.textKind==='summary'?'summary':'text';
  return {...toolPresentation(event),available,kind,
    unavailable:event.redacted?'Text withheld by provider':`No ${kind} recorded`,
    explanation:event.redacted?'The provider withheld the text for this thinking entry.':`This session recorded thinking activity without readable ${kind}.`};
}
export function turnActivity(events=[]){
  let start=events.findLastIndex(e=>e.type==='message'&&e.role==='user');
  const tools=events.slice(Math.max(0,start)).filter(e=>e.type==='tool').map(toolPresentation);
  return {total:tools.length,completed:tools.filter(e=>e.status==='completed').length,failed:tools.filter(e=>e.status==='failed').length,running:tools.filter(e=>e.status==='running').length};
}
