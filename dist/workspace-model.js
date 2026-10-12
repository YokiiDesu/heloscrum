export const navigationTabs=['agents','tasks','conversations','changes'];
export const agentLayouts=['grid','focus','split','overview'];
export const chatThemes=['bubble','block'];
export const statusLabel=status=>({working:'Working',blocked:'Needs Review',idle:'Ready',done:'Finished',starting:'Starting',offline:'Offline','setup-error':'Needs Review'})[status]||status||'Unknown';
export const modelActivityLabel=(status,activity)=>status==='working'?({waiting:'Waiting For Model',receiving:'Receiving Response'}[activity?.phase]||statusLabel(status)):statusLabel(status);
export const workingEllipsis='<span class="working-ellipsis" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>';
export function workspacePreferences(saved={},narrow=false){
  return {tab:navigationTabs.includes(saved.tab)?saved.tab:'agents',layout:agentLayouts.includes(saved.layout)?saved.layout:narrow?'focus':'grid',theme:chatThemes.includes(saved.theme)?saved.theme:'bubble',selected:saved.selected||null,compare:saved.compare||null};
}
export function toolPresentation(event){
  const name=event.name||'Tool call';
  const kind=/edit|write|patch|file changes/i.test(name)?'edit':/read|search|find|glob|list|browse/i.test(name)?'read':/command|terminal|exec|bash|shell/i.test(name)?'command':'tool';
  const status=event.failed||event.exitCode!=null&&event.exitCode!==0||/fail|error/i.test(event.status||'')?'failed':/complete|success/i.test(event.status||'')||event.exitCode===0?'completed':/running|in.?progress/i.test(event.status||'')?'running':/cancel|interrupt|abort/i.test(event.status||'')?'cancelled':/block|approval|review/i.test(event.status||'')?'blocked':/queue|pending|wait/i.test(event.status||'')?'pending':'recorded';
  const duration=Number.isFinite(event.durationMs)?event.durationMs:Number.isFinite(event.duration)?event.duration:null;
  return {name,kind,status,duration:duration==null?null:duration<1000?Math.round(duration)+' ms':(duration/1000).toFixed(1)+' s'};
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
