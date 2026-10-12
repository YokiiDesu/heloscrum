import {sounds} from '/preferences.js';
import {installTooltips} from '/tooltips.js';
import {loadingState,loadFailure} from './loading-state.js';
import {NativeSetupFields} from '/native-setup.js';
import {changedFileHTML,fileStatus,fileLabelHTML,diffHTML} from './diff-view.js';
import {agentIdentities,refreshAgentAppearances,agentLabel} from '/agent-appearance.js';
import {ProjectLibraryDialog} from '/project-library.js';
import {ProjectSettingsDialog} from '/project-settings.js';
import {mountConnectionIndicator} from '/connection-indicator.js';
import {openAIConnectionDialog} from '/ai-settings.js';
import { providerIds, providerName, providerSetupLabel, endpointProviderIds } from '/providers.js';
import { openAgentSettingsDialog } from '/agent-settings.js';
import { PackBoard } from '/pack.js';
import { effortOptions, effortName, effortHint } from '/effort.js';
import { modelName } from '/model-names.js';
import {ApiClient,ConnectionError,RefreshLoop,RefreshFeedback} from '/connection.js';
import {createToasts} from '/toasts.js';
import {WorkspaceEvents} from '/api-events.js';
let board=null,projectLibrary=null,projectSettings=null;
const projectStates=new Map();
let refreshing=null;
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
installTooltips();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name, size=18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({plus:'<path d="M12 5v14M5 12h14"/>',branch:'<circle cx="6" cy="5" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="19" r="3"/><path d="M6 8v8m12-7a9 9 0 0 1-9 9"/>',code:'<path d="m8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18"/>',box:'<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M3 8l9 4v10M7 5.8l9 5"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>','chevron-down':'<path d="m6 9 6 6 6-6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',folder:'<path d="M3 7V4h6l3 3h9v13H3V7Z"/>',send:'<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>',pause:'<path d="M9 5v14m6-14v14"/>',refresh:'<path d="M20 7v5h-5m5 0a8 8 0 1 0-2 6"/>',command:'<path d="M8 8V5a3 3 0 1 0-3 3h14a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H5a3 3 0 1 0 3 3V8Z"/>',agent:'<path d="M5 8h14v12H5zM12 4v4M9 13h.01M15 13h.01M9 17h6M2 12v4m20-4v4"/><circle cx="12" cy="3" r="1"/>'})[name] || ''}</svg>`;
const state = {view:'pack',snapshot:null, selected:localStorage.getItem('heloscrum.selection'), file:null, staged:false, diff:null, review:null, handoff:null, logs:null, logId:null, busy:false, generation:0, loading:false};
const $ = selector => document.querySelector(selector);
const currentTree = () => state.snapshot?.worktrees.find(w => w.id === state.selected);
const currentTask = () => state.snapshot?.tasks.find(t => t.worktreeId === state.selected);
const badge = status => `<span class="status ${escape(status)}">${escape(({working:'Working',blocked:'Needs Review',idle:'Ready',done:'Finished',unknown:'Connected',starting:'Starting',offline:'Offline','setup-error':'Needs Review',running:'Running',exited:'Stopped'})[status] || status)}</span>`;
const button = (action,label,options='') => `<button type="button" data-action="${action}" ${options}>${label}</button>`;
const time = value => new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const pushToast=createToasts($('#toast'));
function toast(message,action,options){
  if(message instanceof ConnectionError&&!message.uncertain)return;
  if(message instanceof Error)sounds.play('error');
  pushToast(message instanceof Error?message.message:message,action,options||(message instanceof Error?{tone:'error'}:{}));
}
// An already-running server may still have the old static asset allowlist.
// Keep its workspace usable until the user can restart it for the new tour.
let guidedTour=null;
const tourLoaded=import('/guided-tour.js').then(({installGuidedTour})=>{
  guidedTour=installGuidedTour({
    currentTab:()=>board?.shell?.prefs.tab,
    selectTab:async tab=>{if(board?.shell?.prefs.tab!==tab)board?.shell?.setTab(tab);if(tab==='tasks')await board?.workView?.pending;},
    notify:message=>toast(message),
  });
  if(board)guidedTour.ready();return guidedTour;
}).catch(()=>null);
function requestTourBeforeLoad(){
  if(guidedTour)return;
  void tourLoaded.then(tour=>{if(tour)tour.start();else toast('Restart this local HeloScrum server to use the tour.');});
}
document.addEventListener('click',event=>{if(event.target.closest('[data-tour-start]'))requestTourBeforeLoad();});
document.addEventListener('heloscrum-tour-start',requestTourBeforeLoad);
const client=new ApiClient({onUnavailable:error=>connection.unavailable(error)});
const refreshFeedback=new RefreshFeedback({onChange:renderConnection});
let liveEvents;
const connection=new RefreshLoop({refresh:({manual})=>refresh({background:!manual}),paused:()=>document.hidden||state.busy,interval:()=>liveEvents?.connected?60000:state.snapshot?.tasks.some(task=>['working','starting'].includes(task.status))?15000:30000,onChange:value=>refreshFeedback.update(value),onRecovered:()=>toast('Reconnected. Your workspace is up to date.',null,{tone:'success',key:'reconnected'})});
liveEvents=new WorkspaceEvents({client,onChange:()=>connection.wake({force:true})});
let recoveryTimer;
function showRecovery(){
  if($('#connection-recovery'))return;
  app.innerHTML=`<main id="main" class="connection-recovery" aria-labelledby="recovery-title"><header class="recovery-brand"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><g stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 14v24c0 6.627 5.373 12 12 12h4" stroke="#ffab76"/><path d="M46 50V26c0-6.627-5.373-12-12-12h-4" stroke="#85d8c6"/></g><path d="M18 28h14v8H18z" fill="#ffab76"/><path d="M32 28h14v8H32z" fill="#85d8c6"/></svg><strong>HeloScrum</strong><span>Local workspace</span></header>
    <section id="connection-recovery" class="recovery-card"><div class="recovery-signal" aria-hidden="true"><span></span>${icon('activity',32)}</div><span class="recovery-eyebrow">CONNECTION PAUSED</span><h1 id="recovery-title">Reconnecting to your workspace</h1><p class="recovery-intro">Waiting for the local server. Your workspace will open automatically when the connection returns.</p>
    <div class="recovery-status" role="status"><i aria-hidden="true"></i><span>Checking the connection…</span></div><div class="recovery-actions">${button('refresh',icon('refresh')+'<span>Reconnect now</span>','class="recovery-retry" aria-busy="false"')}<span class="recovery-retry-note" aria-live="off">Automatic retry is on</span></div>
    <details class="recovery-help"><summary>Local server stopped?</summary><p>In a terminal, open your HeloScrum folder and run:</p><pre><code>npm start</code></pre><p>Leave the server running, then return here. No page reload is needed.</p></details><details class="recovery-details"><summary>Connection details</summary><p></p></details>
    <footer>${icon('folder',16)}<span>Your saved projects and sessions stay on disk.</span></footer></section><p class="recovery-tagline">Connected agents. Shared momentum.</p></main>`;
  renderConnection();
}
function renderConnection(){
  const {phase,lastSync,refreshing,error}=connection.state,unavailable=['disconnected','reconnecting','error'].includes(phase);
  const {busy,tone,pulsing}=refreshFeedback.state;
  const control=$('#connection-refresh'),banner=$('#connection-banner');
  clearTimeout(recoveryTimer);
  const recovery=$('#connection-recovery');
  if(recovery){
    recovery.dataset.phase=phase;recovery.dataset.busy=String(busy);
    const retry=recovery.querySelector('.recovery-retry');retry.disabled=busy||refreshing;retry.setAttribute('aria-busy',String(busy||refreshing));
    recovery.querySelector('.recovery-status span').textContent=phase==='error'?'The server needs attention':refreshing?'Checking the connection…':'Waiting for the local server';
    recovery.querySelector('.recovery-retry-note').textContent=document.hidden?'Retry resumes when this tab is active':refreshing?'Automatic retry is on':connection.state.retryAt?'Next check in '+Math.max(1,Math.ceil((connection.state.retryAt-Date.now())/1000))+'s':'Automatic retry is on';
    recovery.querySelector('.recovery-details p').textContent=error?.message||'The local server has not responded yet.';
    recoveryTimer=setTimeout(renderConnection,1000);
  }
  if(control){
    control.dataset.phase=phase;control.dataset.tone=tone;control.dataset.pulsing=String(pulsing);control.setAttribute('aria-busy',String(busy));control.disabled=busy;
    const title=busy?'Refreshing workspace':unavailable?'Reconnect workspace':'Refresh workspace';
    control.setAttribute('aria-label',title);control.title=({connected:'Connected',connecting:'Connecting',reconnecting:'Reconnecting',disconnected:'Disconnected',error:'Updates paused'})[phase]+' · '+title+' · Keeps open drafts';
  }
  if(banner){
    banner.hidden=!unavailable;
    banner.querySelector('strong').textContent=phase==='reconnecting'?'Reconnecting to HeloScrum…':phase==='error'?'Workspace updates paused':'Local server unavailable';
    banner.querySelector('p').textContent=(phase==='error'?error?.message+'. ':'Start HeloScrum’s local server if it has stopped. ')+(lastSync?'Last synced '+new Date(lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'. ':'')+'We retry automatically. Your open drafts stay in this tab.';
    const retry=banner.querySelector('button');retry.disabled=busy||refreshing;retry.textContent=busy||refreshing?'Connecting…':'Reconnect now';
  }
}
const seenUserRequests=new Set();
function notifyUserRequests(){
  const pending=(state.snapshot.collaboration?.userRequests||[]).filter(q=>q.status==='pending'&&!seenUserRequests.has(q.id));
  if(!pending.length)return;
  pending.forEach(q=>seenUserRequests.add(q.id));
  const question=pending[0],multiple=pending.length>1;
  toast(multiple?`${pending.length} new questions from your agents`:`${question.fromRole} needs your input: ${question.question.slice(0,220)}`,{label:multiple?'View requests':'Reply in group',run:()=>{state.view='pack';localStorage.setItem('heloscrum.view','pack');render();if(multiple){board.closeDrawer();board.drawer='notifications';board.renderDrawer();}else board.openThreads(question.threadId);}});
}
let seenReminderIds;try{seenReminderIds=new Set(JSON.parse(localStorage.getItem('heloscrum.seen-reminders')||'[]'));}catch{seenReminderIds=new Set();}
function notifyReminders(){
  const fresh=(state.snapshot.scheduler?.notices||[]).filter(n=>!n.readAt&&!n.obsolete&&n.toastEligible!==false&&!seenReminderIds.has(n.id));if(!fresh.length)return;
  fresh.forEach(n=>seenReminderIds.add(n.id));try{localStorage.setItem('heloscrum.seen-reminders',JSON.stringify([...seenReminderIds].slice(-1000)));}catch{}
  const first=fresh[0];toast(fresh.length>1?`${fresh.length} saved reminders are ready`:first.summary,{label:'View reminders',run:()=>{state.view='pack';render();board.shell.setTab('tasks');board.mountWork();board.workView.view='reminders';board.workView.refresh(true).catch(toast);}},{tone:'info',key:'schedule:'+first.id});
}
async function api(route, data) {
  const json=await client.request(route,{method:data?'POST':'GET',...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  if(json.agentIdentities&&agentIdentities.update(json.agentIdentities))refreshAgentAppearances(document);return json;
}
// Older running servers may not yet serve this module during an upgrade.
import('/file-preview.js').then(({installFilePreviews})=>installFilePreviews({api,project:()=>state.snapshot?.project.path})).catch(()=>{
  document.addEventListener('click',event=>{if(event.target.closest('a[data-file-link]')){event.preventDefault();toast('Restart HeloScrum to enable file previews.');}});
});
api.canPoll=()=>!document.hidden&&connection.state.phase==='connected';
api.upload=(route,file)=>client.request(route,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
api.blob=route=>client.request(route,{},'blob');
api.download=async(route,name)=>{const blob=await client.request(route,{},'blob'),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Download started: '+name,null,{tone:'success'});};
function showDialog(title,content) { modal.innerHTML=`<div class="dialog-head"><h2 id="modal-title">${title}</h2>${button('close',icon('close'),'aria-label="Close dialog" class="icon-button"')}</div>${content}`;modal.showModal(); }
function openProjectSettings(trigger,options={}) {
  if(projectSettings&&!projectSettings.closed)projectSettings.close();
  if(modal.open)modal.close();
  projectSettings=new ProjectSettingsDialog(trigger,{api,project:options.project||state.snapshot.project.path,onSaved:()=>refresh(),onUseProfile:async(profile,project)=>{if(state.snapshot.project.path!==project){await api('project',{path:project});await refresh({selection:true});}projectSettings.close();actions.new(profile);},...options});
}
function creationNative(value){const host=$('#new-native-setup');if(host)new NativeSetupFields(host,{api,kind:$('#kind').value,project:state.snapshot.project.path,value});}
async function creationModels(){
  const field=$('#new-model'),kind=$('#kind');if(!field||!kind)return;
  const providerId=kind.value,catalog=await api('providers');if(!field.isConnected||kind.value!==providerId)return;
  const selected=catalog.providers.find(p=>p.id===providerId),value=field.value;field.provider=selected;
  const connection=$('#new-connection'),connections=selected?.connections?.filter(c=>c.supportsTools)||[],previous=connection?.value;
  if(connection){$('#new-connection-field').hidden=!endpointProviderIds.includes(providerId);connection.disabled=!connections.length;connection.innerHTML=connections.length?connections.map(c=>`<option value="${c.id}">${escape(c.name)} · ${escape(c.location||c.region)}</option>`).join(''):'<option value="">Set Up A Connection First</option>';if(connections.some(c=>c.id===previous))connection.value=previous;}
  const savedConnection=connections.find(c=>c.id===connection?.value),setup=$('#new-connection-field [data-action=setup-agent-connection]');
  if(setup)setup.hidden=!!savedConnection;
  mountConnectionIndicator($('#new-connection-status'),{api,connection:savedConnection});
  field.innerHTML='<option value="">Provider default</option>'+(selected?.models||[]).filter(m=>!m.connectionId||m.connectionId===connection?.value).map(m=>`<option value="${escape(m.id)}">${escape(modelName(m.id,m.label))}</option>`).join('')+'<option value="__custom__">Exact model ID…</option>';
  if([...field.options].some(option=>option.value===value))field.value=value;
  creationEffort();
}
function creationEffort(){
  const field=$('#new-effort'),modelField=$('#new-model');if(!field||!modelField)return;
  const model=modelField.value==='__custom__'?$('#new-custom-model').value:modelField.value,provider=modelField.provider,options=effortOptions(provider,model),value=field.value;
  field.innerHTML='<option value="">Inherit provider settings</option>'+options.map(o=>`<option value="${escape(o.reasoningEffort)}">${escape(effortName(o.reasoningEffort))}</option>`).join('');
  if(options.some(o=>o.reasoningEffort===value))field.value=value;
  field.disabled=!options.length;$('#new-effort-note').textContent=effortHint(provider,model,field.value);
}
function toggleCreationModel(){
  const custom=$('#new-model')?.value==='__custom__',input=$('#new-custom-model');
  if(!input)return;$('#new-custom-model-field').hidden=!custom;input.disabled=!custom;input.required=custom;creationEffort();
}
async function refresh({selection=false,background=false}={}) {
  if(refreshing){await refreshing;if(!selection)return;}
  const operation=refreshSnapshot({selection,background});refreshing=operation;
  try{await operation;}finally{if(refreshing===operation)refreshing=null;}
}
async function refreshSnapshot({selection=false,background=false}={}) {
  if(state.loading)return;state.loading=true;
  try {
    if(background&&state.snapshot&&connection.state.phase==='connected'&&(modal.open||(projectLibrary&&!projectLibrary.closed))){await api('agent-identities');return;}
    state.snapshot=await api('state');
    liveEvents.select(state.snapshot.project.id);
    if(!currentTree())state.selected=state.snapshot.worktrees[0]?.id;
    if(selection){state.file=null;state.diff=null;state.logs=null;state.logId=null;}
    const files=currentTree()?.files || [];
    if(!files.some(f=>f.path===state.file)){state.file=files[0]?.path||null;state.diff=null;state.staged=!!files[0]?.staged&&!files[0]?.unstaged;}
    const selectedFile=files.find(f=>f.path===state.file);if(selectedFile){if(state.staged&&!selectedFile.staged)state.staged=false;else if(!state.staged&&!selectedFile.unstaged)state.staged=true;}
    render();
    if(board?.shell?.prefs.tab==='tasks'&&board.workView)await (board.workView.pending||board.workView.refresh(true));
    if(board?.shell?.prefs.tab==='conversations')await board.conversationsView?.refresh(true);
    await board?.refreshChats(true);if(board?.shell?.prefs.tab==='changes'||board?.drawer==='details')await loadDetails();
    notifyUserRequests();notifyReminders();
  } catch(error){if(!state.snapshot)showRecovery();throw error;}
  finally{state.loading=false;}
}
async function loadDetails() {
  const generation=++state.generation,tree=currentTree(),file=state.file,staged=state.staged,logId=state.logId,task=currentTask();
  const reviewRoute=tree&&board?.shell?.prefs.tab==='changes'?`change-review?worktree=${tree.id}${file?'&file='+encodeURIComponent(file)+'&staged='+staged:''}`:null;
  const results=await Promise.allSettled([reviewRoute?api(reviewRoute):null,logId?api(`logs?container=${logId}`):null,task&&reviewRoute?api('task-handoff?task='+task.id):null]);
  if(generation!==state.generation)return;
  if(reviewRoute){const r=results[0];state.review=r.status==='fulfilled'?r.value:{error:r.reason.message};state.diff=state.review?.preview||(state.review?.error?{error:state.review.error}:null);}
  // Large or changing workspaces can make a whole-tree review mark unavailable.
  // Keep the existing per-file Git workflow usable in that case.
  if(reviewRoute&&state.review?.error&&file&&!(results[0].reason instanceof ConnectionError)){
    let preview;try{preview=await api(`diff?worktree=${tree.id}&file=${encodeURIComponent(file)}&staged=${staged}`);}catch(error){preview={error:error.message};}
    if(generation!==state.generation)return;state.diff=preview;
  }
  state.logs=results[1].status==='fulfilled'?results[1].value:{error:results[1].reason.message};
  state.handoff=results[2].status==='fulfilled'?results[2].value:null;
  board?.shell?.refreshPanels();
}
function selectTree(id){
  if(state.selected===id)return;
  state.selected=id;localStorage.setItem('heloscrum.selection',id);state.file=currentTree()?.files[0]?.path||null;state.staged=!!currentTree()?.files[0]?.staged&&!currentTree()?.files[0]?.unstaged;
  state.diff=null;state.review=null;state.handoff=null;state.logs=null;state.logId=null;state.generation++;
  board?.shell?.refreshPanels();loadDetails();
}
function relatedContainers(w,task) {
  if(!w)return [];
  return state.snapshot.containers.filter(c=>c.worktreeId===w.id);
}
function render(){
  const snapshot=state.snapshot;if(!snapshot)return;
  if(board&&board.snapshot.project.path!==snapshot.project.path){projectStates.set(board.snapshot.project.path,board.captureWorkspace?.());board.dispose();board=null;state.review=null;state.handoff=null;state.diff=null;}
  if(board){board.update(snapshot);renderConnection();guidedTour?.ready();return;}
  board=new PackBoard(app,{snapshot,savedWorkspace:projectStates.get(snapshot.project.path),api,token:()=>client.token,toast,selectedWorktree:state.selected,onOpenWork:async(id,project)=>{try{if(state.snapshot.project.path!==project){await api('project',{path:project});await refresh({selection:true});}board.shell.setTab('tasks');board.mountWork();await board.workView.open(id);}catch(e){toast(e);}},onNewTask:()=>actions.new(),onAddTool:()=>openProjectSettings(null,{tab:'tools'}),onProjectSettings:options=>openProjectSettings(null,options),onSelect:selectTree,onTab:()=>loadDetails(),onDetails:()=>loadDetails(),renderChanges:changesPanel,renderDetails:taskDetails});
  const selected=board.shell.selectedWorktree;
  if(selected!==state.selected)selectTree(selected);
  if(board.shell.prefs.tab==='changes')loadDetails();
  renderConnection();guidedTour?.ready();
}
function changesPanel(){
  const s=state.snapshot,w=currentTree(),task=currentTask(),files=w?.files||[],staged=files.filter(f=>f.staged).length,review=state.review;
  const status=!files.length?'No changes':review?.reviewed?'Reviewed':review?.review?'Changed since review':'Needs Review';
  return `<div class="changes-workspace-selector"><label for="changes-worktree">Workspace</label><select id="changes-worktree"><button type="button" class="select-value"><selectedcontent></selectedcontent></button>${s.worktrees.map(tree=>`<option value="${escape(tree.id)}" ${tree.id===state.selected?'selected':''}>${escape(s.tasks.find(t=>t.worktreeId===tree.id)?.role|| (tree.path===s.project.path?'Project working copy':tree.branch))} · ${escape(tree.branch)}</option>`).join('')}</select></div>
  <section class="changes-panel"><header class="changes-heading"><div><h2>${escape(task?.title||'Project working copy')}</h2><p>${task?agentLabel(task):escape(w?.branch||'Workspace')} · ${files.length} ${files.length===1?'file':'files'} · ${staged} staged</p></div><span class="review-status ${review?.reviewed?'reviewed':''}">${icon(review?.reviewed?'check':'code',15)}${status}</span></header>
  <div class="changes-files" role="group" aria-label="Changed files" data-scroll="files">${files.map(f=>changedFileHTML(f,state.file)).join('')||'<span>No changed files</span>'}</div>
  <div id="evidence" class="evidence">${evidence()}</div>
  <footer class="changes-review-footer"><div><strong>${review?.reviewed?'Reviewed '+new Date(review.review.at).toLocaleString():review?.review?'Files changed after your last review.':'The task, branch, and conversation stay connected.'}</strong><small>${review?.error?escape(review.error):'Review marks apply to this exact set of changes.'}</small></div><div>${button('open-handoff','Open handoff',`title="${state.handoff?.threadId?'Open the agent’s latest result':'No handoff has been reported yet'}" ${!state.handoff?.threadId?'disabled':''}`)}${button('mark-reviewed',review?.reviewed?'Reviewed':'Mark reviewed',`class="primary" ${!files.length||!review?.fingerprint||review.reviewed||review.error||state.diff?.error?'disabled':''}`)}</div></footer></section>
  <div class="changes-git-actions"><span>${escape(w?.branch||'')} · ${escape(w?.path||s.project.path)}</span><div>${button('commit',`${icon('check')} Commit${staged?' · '+staged:''}`,`${!staged?'disabled':''}`)}${w&&w.path!==s.project.path?button('merge',`Merge ${icon('arrow')}`):''}</div></div>`;
}
function taskDetails(){
  const s=state.snapshot,w=currentTree(),task=currentTask(),containers=relatedContainers(w,task);
  return `<div class="drawer-heading"><h2>Task details</h2><button type="button" data-pack="close-drawer" aria-label="Close task details">×</button></div><div class="drawer-content task-details-content"><section class="task-details-summary"><span class="eyebrow">${task?'AGENT TASK':'PROJECT WORKSPACE'}</span><h3>${escape(task?.title||'Project working copy')}</h3>${task?agentLabel(task)+' '+badge(task.status):''}<dl><dt>Branch</dt><dd>${escape(w?.branch)}</dd><dt>Worktree</dt><dd>${escape(w?.path)}</dd>${task?`<dt>Provider / model</dt><dd>${button('agent-settings',escape(providerName(task.kind)+' · '+modelName(task.reportedModel||task.model||'Default'))+icon('chevron-down',14),'class="small-button"')}</dd>`:''}</dl>${task?`<details data-details="task-brief"><summary>Task brief</summary><p class="task-brief">${escape(task.prompt||task.summary||'No brief saved.')}</p></details>`:''}</section>
  <section class="runtime-panel panel"><div class="panel-title"><h2>${icon('box')} Services</h2>${task?button('attach',`${icon('plus',14)} Attach service`,'class="quiet"'):''}</div><p class="services-description">App containers and dependencies attached to this workspace.</p><div class="services">${containers.length?containers.map(containerCard).join(''):`<div class="empty-service"><div><strong>${s.health.docker.connected?'No services attached':'Docker is unavailable'}</strong><p>${s.health.docker.connected?'Matching Docker Compose services appear automatically. Attach an existing container to this task.':'Start Docker to see services, resource usage, and logs.'}</p></div></div>`}</div><div id="runtime-logs">${runtimeLogs()}</div></section>
  <details class="activity" data-details="activity"><summary>${icon('activity',16)} Recent activity</summary><ol>${s.events.filter(e=>!e.project||e.project===s.project.path).slice(0,12).map(e=>`<li><time>${time(e.at)}</time><div><strong>${escape(e.title)}</strong><p>${escape(e.detail)}</p></div></li>`).join('')||'<li>No activity yet.</li>'}</ol></details></div>`;
}
function evidence() {
  const f=currentTree()?.files.find(f=>f.path===state.file),d=state.diff;
  if(!f)return `<div class="empty-review">${icon('check',32)}<h3>Your workspace is clean</h3><p>Changes made by you or your agent appear here for review, one section at a time.</p>${!currentTask()?button('new','Start a task','class="primary"'):''}</div>`;
  const mode=state.staged?'Staged':'Unstaged';
  const header=`<div class="diff-toolbar"><strong class="file-change file-${fileStatus(f).kind}" title="${escape(fileStatus(f).title)}">${fileLabelHTML(f)}</strong><div class="diff-controls"><div class="segment" aria-label="Change selection"><button data-action="unstaged" aria-pressed="${!state.staged}" ${!f.unstaged?'disabled':''}>Unstaged</button><button data-action="staged" aria-pressed="${state.staged}" ${!f.staged?'disabled':''}>Staged</button></div>${button('stage',state.staged?'Unstage file':'Stage file',`class="small-button" ${f.conflict?'disabled':''}`)}</div></div>`;
  if(!d)return header+loadingState('Loading changes',{detail:'Reading the selected file and its diff.'});
  if(d.error)return header+loadFailure('Changes couldn’t load',{detail:d.error,retry:'data-action="refresh"'});
  const hunks=d.patch?.hunks||[];
  return header+`<div class="diff-content" data-scroll="diff">${f.conflict?'<p class="inline-error">Resolve the conflict markers before staging this file.</p>':''}${hunks.length?hunks.map(h=>`<section class="hunk"><div class="hunk-heading"><code>${escape(h.header)}</code>${d.patch.partial&&!f.conflict?button('hunk',`${state.staged?'Unstage':'Stage'} section`,`class="hunk-button" data-id="${h.id}"`):''}</div><div class="code-lines">${h.lines.map(l=>`<div class="code-line ${l.kind}"><span>${l.old??''}</span><span>${l.new??''}</span><b>${l.kind==='add'?'+':l.kind==='remove'?'-':' '}</b><code>${escape(l.text)}</code></div>`).join('')}</div></section>`).join(''):diffHTML(d.diff||`No ${mode.toLowerCase()} content in this file.`,{diff:true,plain:true,contentOnly:f.untracked})}</div>`;
}
function sparkline(history) {
  if(!history?.length)return '<span class="muted">Waiting for samples</span>';
  const max=Math.max(1,...history.map(h=>h.cpu));
  const points=history.map((h,i)=>`${history.length===1?140:i/(history.length-1)*140},${28-h.cpu/max*24}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 144 32" role="img" aria-label="CPU usage over the last five minutes"><path d="M0 29H144" stroke="var(--border)"/><polyline points="${points}" fill="none" stroke="var(--green)" stroke-width="2"/>${history.length===1?`<circle cx="140" cy="${28-history[0].cpu/max*24}" r="2" fill="var(--green)"/>`:''}</svg>`;
}
function containerCard(c) {
  return `<article class="service-card ${state.logId===c.id?'service-selected':''}"><div class="service-name"><strong>${escape(c.name)}</strong>${badge(c.status)}</div><span class="service-image">${escape(c.image)}</span><div class="service-metrics"><div><strong>${escape(c.cpu||'—')}</strong><span>CPU</span></div>${sparkline(c.history)}<div><strong>${escape(c.memory?.split(' / ')[0]||'—')}</strong><span>Memory</span></div></div><div class="service-footer"><span title="${escape(c.ports)}">${escape(c.ports||'No published ports')}</span><div>${button('logs','Logs',`data-id="${c.id}" class="quiet"`)}${button('container',c.status==='running'?'Restart':'Start',`data-id="${c.id}" data-operation="${c.status==='running'?'restart':'start'}" class="quiet"`)}${c.status==='running'?button('container','Stop',`data-id="${c.id}" data-operation="stop" class="quiet"`):''}</div></div></article>`;
}
function runtimeLogs() {
  if(!state.logId)return '';
  const c=state.snapshot.containers.find(c=>c.id===state.logId);
  if(!c)return '';
  return `<div class="logs-heading"><strong>${escape(c.name)} · Logs</strong>${button('close-logs',icon('close',14),'class="icon-button" aria-label="Close service logs"')}</div><pre class="runtime-output" data-scroll="logs">${escape(state.logs?.error||state.logs?.output||'No log output yet.')}</pre>`;
}
async function mutate(route,data,message) {
  if(state.busy)return;state.busy=true;document.body.classList.add('busy');
  try{const result=await api(route,data);if(message)toast(message,null,{tone:'success'});try{await refresh();}catch{}return result;}
  finally{state.busy=false;document.body.classList.remove('busy');}
}
const actions = {
  pack:()=>board?.shell?.setTab('agents'),
  'mark-reviewed':async()=>{const id=state.selected,expected=state.review?.fingerprint;await mutate('change-review',{worktreeId:id,expected},'Changes marked reviewed');},
  'open-handoff':()=>{if(state.handoff?.threadId)return board.openThreads(state.handoff.threadId,state.handoff.messageId);},
  'add-tool':el=>openProjectSettings(el,{tab:'tools'}),
  'project-settings':el=>openProjectSettings(el),
  'format-schema':()=>{const field=$('#tool-schema'),feedback=$('.schema-feedback');try{field.value=JSON.stringify(JSON.parse(field.value),null,2);feedback.textContent='JSON formatted';feedback.classList.remove('invalid');}catch(error){feedback.textContent='Could not format JSON: '+error.message;feedback.classList.add('invalid');}field.focus({preventScroll:true});},
  close:()=>modal.close(), refresh:()=>{if(!refreshFeedback.state.busy)return connection.run({manual:true});}, select:el=>selectTree(el.dataset.id),
  terminal:()=>{window.open('/cli?project='+encodeURIComponent(state.snapshot.project.path),'_blank','noopener');modal.close();},
  file:async el=>{state.file=el.dataset.file;state.review=null;const f=currentTree().files.find(f=>f.path===state.file);state.staged=!!f.staged&&!f.unstaged;state.diff=null;render();await loadDetails();},
  staged:async()=>{state.staged=true;state.diff=null;state.review=null;render();await loadDetails();},
  unstaged:async()=>{state.staged=false;state.diff=null;state.review=null;render();await loadDetails();},
  stage:()=>mutate('stage',{worktreeId:state.selected,file:state.file,unstage:state.staged},state.staged?`${state.file} unstaged`:`${state.file} staged for commit`),
  hunk:el=>mutate('stage-hunk',{worktreeId:state.selected,file:state.file,hunkId:Number(el.dataset.id),expected:state.diff.patch.fingerprint,unstage:state.staged},state.staged?`Section of ${state.file} unstaged`:`Section of ${state.file} staged for commit`),
  'start-engine':()=>mutate('herdr/start',{},'Agent sessions connected'),
  'retry-start':()=>mutate('tasks/retry',{id:currentTask().id},'Retrying this agent with its original task…'),
  interrupt:()=>mutate('tasks/interrupt',{id:currentTask().id},'Interrupt sent to the agent'),
  logs:async el=>{state.logId=state.logId===el.dataset.id?null:el.dataset.id;state.logs=null;render();await loadDetails();},
  'close-logs':()=>{state.logId=null;state.logs=null;render();},
  container:el=>mutate('container/action',{id:el.dataset.id,action:el.dataset.operation},'Service '+({start:'started',restart:'restarted',stop:'stopped'})[el.dataset.operation]),
  new:profile=>{profile=profile?.instructions&&profile?.id?profile:null;showDialog('Create a task',`<form id="task-form">${profile?`<input type="hidden" name="profileId" value="${escape(profile.id)}"><p class="profile-task-context">Using <strong>${escape(profile.name)}</strong> · ${profile.scope==='global'?'Global agent':'Project agent'}</p><details><summary>Shared agent instructions</summary><p class="task-brief">${escape(profile.instructions)}</p></details>`:button('project-settings','Choose a reusable agent →','class="profile-task-context"')}<p class="dialog-intro">One agent, an isolated branch, and a workspace for everything it produces.</p><label for="role-type">Role type</label><select id="role-type" name="roleType"><option value="worker">Coding teammate</option><option value="recovery">Recovery coach (Therapist)</option></select><label for="title">Task name</label><input id="title" name="title" required maxlength="120" placeholder="Refactor authentication"><div class="form-pair"><div><label for="role">Agent role</label><input id="role" name="role" maxlength="80" placeholder="QA"></div><div><label for="summary">Contact book summary</label><input id="summary" name="summary" maxlength="1000" placeholder="Tests, regressions, and release checks"></div></div><label for="instructions">What should the agent do?</label><textarea id="instructions" name="prompt" required maxlength="16000" rows="5" placeholder="Describe the outcome, constraints, and how to verify it."></textarea><div class="form-pair"><div><label for="kind">Agent</label><select id="kind" name="kind">${providerIds.map(kind=>`<option value="${kind}" ${!state.snapshot.tools[kind]&&!endpointProviderIds.includes(kind)?'disabled':''}>${escape(providerName(kind))}${escape(providerSetupLabel(kind,state.snapshot.tools[kind]))}</option>`).join('')}</select></div><div><label for="new-model">Model</label><select id="new-model" name="model"><option value="">Provider default</option><option value="__custom__">Exact model ID…</option></select></div></div><div id="new-connection-field" hidden><label for="new-connection">AI connection</label><select id="new-connection" name="connectionId" disabled></select><p class="form-note">Connect a local or AWS model server. This form stays open during setup.</p>${button('setup-agent-connection','Set Up A Connection')}<div id="new-connection-status"></div></div><label for="branch">New branch</label><input id="branch" name="branch" required maxlength="80" placeholder="feat/auth-refactor"><div id="new-custom-model-field" hidden><label for="new-custom-model">Exact model ID</label><input id="new-custom-model" name="customModel" maxlength="150" placeholder="Model supported by your provider" disabled></div><label for="new-effort">Reasoning effort</label><select id="new-effort" name="effort" aria-describedby="new-effort-note"><option value="">Inherit provider settings</option></select><p id="new-effort-note" class="form-note"></p><div id="new-native-setup"></div><p class="form-note">The agent starts from this project’s committed HEAD in its own Git worktree. It uses the selected CLI account or saved model connection.</p><p class="form-error" role="alert"></p><div class="dialog-actions">${button('close','Cancel')}<button type="submit" class="primary">${icon('plus')} Create & start</button></div></form>`);if(profile){$('#role').value=profile.name;$('#summary').value=profile.summary;$('#kind').value=profile.kind;$('#role-type').value=profile.roleType;}creationNative(profile?.nativeSetup);creationModels().then(async()=>{if(profile?.connectionId&&$('#new-connection')){$('#new-connection').value=profile.connectionId;await creationModels();}if(profile?.model){const field=$('#new-model');if(!field)return;if([...field.options].some(o=>o.value===profile.model))field.value=profile.model;else{field.value='__custom__';$('#new-custom-model').value=profile.model;}toggleCreationModel();}}).catch(error=>toast(error));},
  'setup-agent-connection':el=>openAIConnectionDialog(el,{api,kind:$('#kind').value,onSaved:async saved=>{await creationModels();if($('#new-connection')){$('#new-connection').value=saved.id;await creationModels();}const option=$('#kind')?.selectedOptions[0];if(option)option.textContent=providerName(saved.kind);}}),
  'agent-settings':async el=>{openAgentSettingsDialog(el,currentTask(),{api,onManage:details=>openProjectSettings(el,{project:details.project,sourceTaskId:details.taskId}),onSaved:async()=>{await refresh();toast('Agent session updated');}});},
  project:el=>{if(projectLibrary&&!projectLibrary.closed){projectLibrary.host.focus();return;}if(modal.open)modal.close();projectLibrary=new ProjectLibraryDialog(el,{api,onSettings:project=>{projectLibrary.close();openProjectSettings(el,{project});},onChange:()=>refresh(),onOpen:async(project,taskId,options={})=>{await api('project',{path:project,...options});await refresh({selection:true});if(taskId){board.shell.choose(taskId);board.shell.prefs.layout='focus';board.shell.setTab('agents');}}});},
  commit:async()=>{const preview=await api(`commit-preview?worktree=${state.selected}`);state.commitReview={id:state.selected,...preview};showDialog('Commit staged changes',`<form id="commit-form"><p class="dialog-intro">${preview.files.length} staged ${preview.files.length===1?'file':'files'} on <strong>${escape(preview.worktree.branch)}</strong></p><ul class="reviewed-files">${preview.files.map(f=>`<li>${icon('check',14)} ${escape(f.path)}</li>`).join('')}</ul><label for="commit-message">Commit message</label><input id="commit-message" name="message" required maxlength="500" placeholder="Describe the change"><p class="form-note">Only the staged changes will be committed.</p><p class="form-error" role="alert"></p><div class="dialog-actions">${button('close','Cancel')}<button type="submit" class="primary">Commit changes</button></div></form>`);},
  merge:async()=>{const preview=await api(`merge-preview?worktree=${state.selected}`);state.mergeReview={id:state.selected,...preview};showDialog('Merge completed work',`<form id="merge-form"><p class="dialog-intro">Fast-forward <strong>${escape(preview.target.branch)}</strong> to <strong>${escape(preview.source.branch)}</strong>.</p><p>Both workspaces are clean. This brings the task’s committed work into your project.</p><p class="form-error" role="alert"></p><div class="dialog-actions">${button('close','Cancel')}<button type="submit" class="primary">Merge into ${escape(preview.target.branch)}</button></div></form>`);},
  attach:()=>{const task=currentTask();showDialog('Attach a service',`<p class="dialog-intro">Choose a container for ${escape(task.title)}. Its health and logs will appear alongside this task’s code.</p><div class="attach-list">${state.snapshot.containers.map(c=>`<button data-action="link" data-id="${c.id}"><div><strong>${escape(c.name)}</strong><small>${escape(c.image)}</small></div>${badge(c.status)}</button>`).join('')||'<p>No containers found. Start a project service with Docker or Compose, then refresh this workspace.</p>'}</div>`);},
  link:async el=>{await mutate('container/link',{id:el.dataset.id,taskId:currentTask().id},'Service attached to this task');modal.close();},
  'work-new':()=>{modal.close();board.shell.setTab('tasks');board.mountWork();board.workView.compose();},
  commands:()=>showDialog('Quick actions',`<div class="command-list">${button('work-new',`${icon('plus')} Create a task or plan`)}${button('new',`${icon('agent')} Add an agent`)}${button('commit',`${icon('check')} Commit staged changes`)}${button('project',`${icon('folder')} Open a project`)}${button('terminal',`${icon('code')} Open terminal app`)}${button('refresh',`${icon('refresh')} Refresh workspace`)}</div>`)
};
document.addEventListener('click',async event=>{const el=event.target.closest('[data-action]');if(!el||el.disabled)return;if(state.busy&&!['open-handoff','close','commands','file','staged','unstaged','logs','close-logs','select','pack'].includes(el.dataset.action)){toast('Finishing the current update…');return;}try{await actions[el.dataset.action]?.(el);}catch(error){toast(error);}});
document.addEventListener('input',event=>{if(event.target.id==='title'){const branch=$('#branch');if(!branch.dataset.edited)branch.value='task/'+event.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65);}if(event.target.id==='branch')event.target.dataset.edited='true';});
document.addEventListener('change',event=>{if(event.target.id==='new-model')toggleCreationModel();if(event.target.id==='new-connection'){$('#new-model').value='';creationModels().catch(error=>toast(error));}if(event.target.id==='new-effort')creationEffort();if(event.target.id==='kind'){creationNative();$('#new-model').value='';$('#new-model').provider=null;$('#new-effort').value='';toggleCreationModel();creationModels().catch(error=>toast(error));}if(event.target.id==='role-type'&&event.target.value==='recovery'){for(const [id,value] of Object.entries({title:'Help the team recover and refocus',role:'Therapist',summary:'Helps with loops, context pressure, failed attempts, and focused recovery plans.',instructions:'Help teammates recover their task focus. Read incoming support requests and reply with a concise reset plan and a concrete next check.',branch:'team/recovery-coach'}))document.getElementById(id).value=value;}});
document.addEventListener('submit',async event=>{
  if(event.target.id?.startsWith('pack-'))return;
  event.preventDefault();if(state.busy)return;
  const form=event.target,data=Object.fromEntries(new FormData(form)),error=form.querySelector('.form-error'),submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;if(error)error.textContent='';
  try{
    if(form.id==='tool-form'){await mutate('toolbox',{name:data.name,description:data.description,executable:data.executable,args:JSON.parse(data.args),inputSchema:JSON.parse(data.schema)},data.name+' has been added to the Toolbox');modal.close();}
    if(form.id==='task-form'){data.nativeSetup=$('#new-native-setup')?.nativeSetup?.value();data.model=data.model==='__custom__'?data.customModel:data.model;delete data.customModel;const task=await mutate('tasks',data,'Task created. Preparing its agent…');modal.close();board?.shell?.choose(task.id);board?.shell?.setTab('agents');}
    if(form.id==='project-form'){await mutate('project',data);modal.close();await refresh({selection:true});}
    if(form.id==='commit-form'){const review=state.commitReview;await mutate('commit',{worktreeId:review.id,message:data.message,expected:{tree:review.tree,head:review.head}},'Changes committed');modal.close();}
    if(form.id==='merge-form'){const review=state.mergeReview;await mutate('merge',{worktreeId:review.id,expected:{sourceHead:review.source.head,targetHead:review.target.head}},'Task merged into the project');modal.close();}
  }catch(e){if(error)error.textContent=e.message;else toast(e);}finally{if(submit)submit.disabled=false;}
});
// A styled native picker lives in the page's top layer. Let its first Escape
// close just the picker, before card, toolbox, or conversation shortcuts run.
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&CSS.supports('selector(select:open)')&&event.target.closest('select')?.matches(':open'))event.stopImmediatePropagation();
},true);
document.addEventListener('keydown',event=>{
  if(event.target.closest('.native-terminal .xterm'))return;
  if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();actions.project();return;}
  if(projectLibrary&&!projectLibrary.closed)return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(modal.open)modal.close();else actions.commands();return;}
  if(board?.shell?.prefs.tab!=='changes'||modal.open||event.target.closest('.pack-card,input,textarea,select')||event.metaKey||event.ctrlKey||event.altKey)return;
  if(['j','k'].includes(event.key)){event.preventDefault();const files=currentTree()?.files||[],index=files.findIndex(f=>f.path===state.file),next=files[Math.max(0,Math.min(files.length-1,index+(event.key==='j'?1:-1)))];if(next)actions.file({dataset:{file:next.path}}).catch(e=>toast(e));}
  if(event.key==='s'&&state.file&&!state.busy)actions.stage().catch(e=>toast(e));
});
modal.addEventListener('click',event=>{if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)modal.close();}});
await connection.run();
document.addEventListener('visibilitychange',()=>{liveEvents.visibility();if(!document.hidden)connection.wake();});
window.addEventListener('focus',()=>connection.wake());
window.addEventListener('online',()=>connection.wake({force:true}));
window.addEventListener('pageshow',()=>connection.wake());

document.addEventListener('input',event=>{if(event.target.id==='new-custom-model')creationEffort();});
