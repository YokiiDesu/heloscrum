import {NativeTerminal} from './native-terminal.js';
import {isSlashDraft,slashSuggestions,resolveSlashCommand} from './slash-commands.js';
import {loadingState} from './loading-state.js';
import {permissionHTML,permissionKey,permissionIdentity,permissionAnswered,observePermission} from './provider-request.js';
import {diffHTML} from './diff-view.js';
import {MemoryView} from '/memory.js';
import {workMessage} from '/work-message.js';
import {WorkBoard} from '/work-board.js';
import {appearanceFor,appearanceStyle,libraryIcon,agentAttributes,agentAvatar,agentLabel,agentIdentities,refreshAgentAppearances} from '/agent-appearance.js';
import { providerName,hostedProvider } from '/providers.js';
import { markdown, enhanceMarkdown } from '/rich-text.js';
import {messageContent} from '/message-content.js';
import {thinkingBlock} from '/thinking-block.js';
// A running older backend may not serve the optional activity renderer yet.
const {activityCard}=await import('./activity-card.js').catch(()=>({activityCard:event=>`<details class="chat-tool"><summary>Claude activity · server update pending</summary><p>The visual view will be available after HeloScrum is reloaded when agents are idle.</p><pre>${esc(JSON.stringify(event,null,2))}</pre></details>`}));
import { WorkspaceShell, workspaceShellHTML, glyph } from '/workspace-shell.js';
import { statusLabel, modelActivityLabel, toolPresentation, turnActivity, workingEllipsis } from '/workspace-model.js';
import { openAgentSettingsDialog } from '/agent-settings.js';
import { modelName } from '/model-names.js';
import { effortName } from '/effort.js';
import { AgentToolMenu } from '/agent-tools.js';
import { HistoryView } from '/history.js';
import {observeWorkspaceSounds} from '/preferences.js';
import {AttachmentComposer,imageGallery,hydrateImages} from '/image-attachments.js';
import {InputHistory} from '/input-history.js';
import { ChatThreads } from '/chat-threads.js';
import { TranscriptTUI } from '/transcript-tui.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=statusLabel;
const nativeTerminalFor=task=>!!task&&['codex','claude','kiro','cursor'].includes(task.kind)&&!hostedProvider(task);
const statePill=report=>`<span class="state-pill state-${esc(report?.state||'unknown')}" title="${esc(report?'Agent-reported: '+report.reason+' Next: '+report.nextStep:'No operational state reported for this response')}">${esc(report?report.state[0].toUpperCase()+report.state.slice(1):'Not reported')}</span>`;
const sessionPill=(status,activity)=>`<span class="state-pill lifecycle-pill lifecycle-${esc(status||'unknown')}" title="Session status: ${esc(label(status)||'Unknown')}">${esc(modelActivityLabel(status,activity))}${status==='working'?workingEllipsis:''}</span>`;
const expandIcon=expanded=>`<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${expanded?'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6':'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'}"/></svg>`;
const dropdownIcon='<svg class="control-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const contactSynced=(contact,registry)=>contact.connected&&contact.discovery?.seenRevision>=(contact.catalogRevision??registry.revision);
const modelLabel=task=>providerName(task.kind)+' · '+modelName(task.reportedModel||task.model||'Default');
const effortLabel=task=>task.reportedEffort||task.effort?effortName(task.reportedEffort||task.effort):'Inherit';
const effortTitle=task=>task.reportedEffort?'Last observed reasoning effort: '+effortName(task.reportedEffort):task.effort?'Requested reasoning effort: '+effortName(task.effort)+'; not yet reported by the provider.':'Reasoning effort inherited from provider settings; no level reported.';
const modelTitle=task=>modelLabel(task)+' · '+effortLabel(task)+' — '+effortTitle(task);
const shortTime=time=>new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function tuiSessionMeta(task){
  const location=(task.path||'').replace(/^\/Users\/[^/]+/,'~'),context=task.agentState?.metrics?.contextPercent;
  return `<span class="tui-provider">${esc(providerName(task.kind))}</span><span class="tui-meta-state">· ${esc(label(task.status))}</span>${Number.isFinite(context)?`<span class="tui-context" title="Context usage reported by the agent">◔ ${context}% reported</span>`:''}<span class="tui-location" title="${esc(task.path)}">${esc(location)}</span><span class="tui-branch" title="${esc(task.branch)}">(${esc(task.branch)})</span>`;
}

export class PackBoard {
  constructor(root,options){this.root=root;this.options=options;this.imageObserver=new MutationObserver(()=>hydrateImages(root));this.imageObserver.observe(root,{childList:true,subtree:true});this.slots=[];this.sessionCache=new Map(options.savedWorkspace?.sessions||[]);this.disposed=false;this.refreshing=false;this.lastNotifications=new Set();this.initial=true;this.draw(options.snapshot);this.timer=setInterval(()=>this.refreshChats(),1300);}
  draw(snapshot){
    this.snapshot=snapshot;agentIdentities.update(snapshot.agentIdentities||snapshot.tasks);
    let saved;try{saved=JSON.parse(localStorage.getItem('heloscrum.grid:'+snapshot.project.path)||localStorage.getItem('heloscrum.grid')||'null');}catch{}
    const selected=this.options.taskId?[this.options.taskId]:(Array.isArray(saved)?saved:[]).map(id=>snapshot.tasks.some(t=>t.id===id)?id:null);
    if(!this.options.taskId)for(const task of snapshot.tasks)if(!selected.includes(task.id)&&selected.filter(Boolean).length<4){const empty=selected.indexOf(null);if(empty>=0)selected[empty]=task.id;else selected.push(task.id);}
    this.root.innerHTML=this.options.taskId?`<div class="workspace-pack"><div class="pack-grid" id="pack-grid"></div><aside class="pack-drawer" id="pack-drawer" aria-label="Collaboration details" hidden></aside></div>`:workspaceShellHTML(snapshot);
    for(let index=0;index<(this.options.taskId?1:4);index++){const host=document.createElement('article');host.className='pack-card';host.dataset.slot=index;this.root.querySelector('#pack-grid').append(host);const slot={index,host,taskId:selected[index]||null,mode:'chat',generation:0,cleanup:null,chatKey:null,draft:'',...this.sessionCache.get(selected[index])};this.slots.push(slot);this.renderSlot(slot);}
    this.click=event=>this.onClick(event).catch(e=>this.options.toast(e));this.change=event=>{const slot=this.slots[Number(event.target.dataset.selectSlot)];if(slot){const previous=slot.taskId,next=event.target.value||null,other=next&&this.slots.find(s=>s!==slot&&s.taskId===next);this.rememberSlot(slot);if(other)this.rememberSlot(other);this.assignSlot(slot,next);if(other)this.assignSlot(other,previous);this.persist();this.update(this.snapshot);if(next)this.shell?.choose(next);}};
    this.input=event=>{const slot=this.slots[Number(event.target.dataset.promptSlot)];if(slot){slot.draft=event.target.value;slot.slashIndex=-1;slot.slashDismissed=null;this.resizeComposer(slot);this.renderPromptQueue(slot);this.renderSlashCommands(slot);}};
    this.submit=event=>{const form=event.target.closest('form[data-slot-form]');if(!form)return;event.preventDefault();this.send(this.slots[Number(form.dataset.slotForm)]).catch(e=>this.options.toast(e));};
    this.root.addEventListener('click',this.click);this.root.addEventListener('change',this.change);this.root.addEventListener('input',this.input);this.root.addEventListener('submit',this.submit);this.key=event=>{if(event.target.closest('.native-terminal .xterm'))return;if(this.slashKey(event))return;const expanded=this.slots.find(slot=>slot.expanded);if(event.key==='Escape'&&this.drawer&&!this.toolMenu&&!this.settingsDialog){event.preventDefault();event.stopPropagation();if(this.drawer==='memory'&&this.memoryExpanded)this.toggleMemoryExpanded();else this.closeDrawer();return;}if(event.key==='Escape'&&expanded&&!this.toolMenu){event.preventDefault();event.stopPropagation();this.setExpanded(expanded,false);expanded.host.querySelector('.agent-expand')?.focus();return;}const index=event.target.dataset.promptSlot;if(index===undefined)return;const slot=this.slots[Number(index)];if(slot?.mode==='tui'&&event.key==='Escape'&&this.task(slot)?.status==='working'){event.preventDefault();this.options.api('tasks/interrupt',{id:slot.taskId}).then(()=>this.options.toast('Interrupt sent')).catch(e=>this.options.toast(e));return;}if(slot?.inputHistory?.handle(event,event.target)){slot.draft=event.target.value;this.resizeComposer(slot);this.renderSlashCommands(slot);return;}if(slot&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();this.send(slot).catch(e=>this.options.toast(e));}};this.root.addEventListener('keydown',this.key,true);
    this.onScroll=event=>{if(event.target.matches('.pack-chat'))this.updateChatJump(this.slots[Number(event.target.dataset.chat)]);};
    this.onToggle=event=>{const host=event.target.closest('.pack-chat');if(host)this.updateChatJump(this.slots[Number(host.dataset.chat)]);};
    this.root.addEventListener('scroll',this.onScroll,true);this.root.addEventListener('toggle',this.onToggle,true);this.root.addEventListener('message-content-resize',this.onToggle);
    this.chatResize=new ResizeObserver(()=>this.slots.forEach(slot=>this.updateChatJump(slot)));this.chatResize.observe(this.root);
    if(!this.options.taskId)this.shell=new WorkspaceShell(this);
    this.update(snapshot);this.refreshChats();
  }
  setText(selector,text){const element=this.root.querySelector(selector);if(element)element.textContent=text;}
  task(slot){return this.snapshot.tasks.find(t=>t.id===slot.taskId);}
  chatPosition(chat){
    const bounds=chat.getBoundingClientRect(),anchor=[...chat.querySelectorAll('.transcript-entry')].find(e=>e.getBoundingClientRect().bottom>bounds.top+1);
    return {top:chat.scrollTop,follow:chat.scrollHeight-chat.scrollTop-chat.clientHeight<40,anchor:anchor?.dataset.transcriptId,offset:anchor?anchor.getBoundingClientRect().top-bounds.top:0};
  }
  rememberSlot(slot){
    if(!slot?.taskId)return;
    const chat=slot.host.querySelector('.pack-chat');if(chat){this.captureTools(slot,chat);slot.chatScroll=this.chatPosition(chat);}
    this.sessionCache.set(slot.taskId,Object.fromEntries(['draft','attachments','mode','transcript','historyTaskId','historyError','expandedTools','chatScroll','tuiState','request','requestError','requestNotice','requestSent','requestSequence','deliveryMode','pendingCommand'].map(key=>[key,slot[key]])));
  }
  assignSlot(slot,id){
    this.rememberSlot(slot);if(slot.expanded)this.setExpanded(slot,false);slot.cleanup?.();slot.host.replaceChildren();
    Object.assign(slot,{taskId:id,draft:'',attachments:[],mode:'chat',transcript:null,historyTaskId:null,historyError:'',expandedTools:new Set(),chatScroll:null,tuiState:{top:0,follow:true,selected:null},request:null,requestError:'',requestNotice:'',requestSent:null,requestSequence:0,requestKey:null,responding:false,commandReport:null,commandLoading:false,slashDismissed:null,pendingCommand:null,nativeCompose:false},this.sessionCache.get(id)||{});
    this.renderSlot(slot);this.refreshChat(slot);
  }
  captureWorkspace(){
    this.slots.forEach(slot=>this.rememberSlot(slot));
    return {work:this.workView?.capture()||this.options.savedWorkspace?.work,sessions:[...this.sessionCache],conversations:this.conversationsView?.capture()||this.options.savedWorkspace?.conversations};
  }
  mountWork(){
    if(!this.workView)this.workView=new WorkBoard(this.root.querySelector('#panel-tasks'),{api:this.options.api,project:this.snapshot.project,savedState:this.options.savedWorkspace?.work,toast:this.options.toast,onAddAgent:()=>this.options.onNewTask(),onScheduleSettings:()=>this.options.onProjectSettings?.({tab:'schedule'}),onProfiles:()=>this.options.onProjectSettings?.({tab:'agents'}),onChat:(thread,id)=>{if(id){this.shell.choose(id);this.shell.prefs.layout='focus';this.shell.setTab('agents');}else{this.shell.setTab('conversations');this.openThreads(thread);}}});
    else this.workView.refresh().catch(e=>this.options.toast(e));
  }
  mountConversations(){
    const host=this.root.querySelector('#panel-conversations');if(!host)return;
    if(!this.conversationsView)this.conversationsView=new ChatThreads(host,{onWork:this.options.onOpenWork,savedState:this.options.savedWorkspace?.conversations,api:this.options.api,markdown,enhanceMarkdown,contacts:this.snapshot.collaboration?.contacts||[],project:this.snapshot.project,onClose:()=>this.shell.setTab('agents')});
    else this.conversationsView.refresh();
  }
  persist(){if(!this.options.taskId)localStorage.setItem('heloscrum.grid:'+this.snapshot.project.path,JSON.stringify(this.slots.map(s=>s.taskId)));}
  renderSlot(slot){
    const previousChat=slot.host.querySelector('.pack-chat');if(previousChat){slot.chatScroll=this.chatPosition(previousChat);this.captureTools(slot,previousChat);}
    this.toolMenu?.close(false);slot.generation++;slot.attachmentComposer?.dispose();slot.cleanup?.();slot.cleanup=null;slot.tui=null;slot.native=null;slot.chatKey=null;slot.requestKey=null;slot.promptQueueKey=null;
    const task=this.task(slot);if(!task){slot.host.innerHTML=`<div class="empty-slot"><span class="slot-number">0${slot.index+1}</span><div class="slot-cross">+</div><h2>Add a teammate</h2><p>Give an agent a role and a focused task.</p><button type="button" class="primary" data-pack="new">Add agent</button>${this.snapshot.tasks.length?`<select aria-label="Agent in slot ${slot.index+1}" data-select-slot="${slot.index}"><option value="">Choose an existing agent</option>${this.snapshot.tasks.map(t=>`<option value="${t.id}">${esc(t.role||t.title)}</option>`).join('')}</select>`:''}</div>`;return;}
    slot.renderedSessionRevision=task.sessionRevision||0;
    const historyKey=task.id+':'+(task.sessionRevision||0);if(slot.historyTaskId!==historyKey){slot.historyTaskId=historyKey;slot.commandReport=null;slot.commandLoading=false;slot.transcript=null;slot.historyError='';slot.expandedTools=new Set();slot.tuiState={top:0,follow:true,selected:null};slot.chatScroll=null;slot.request=null;slot.requestError='';slot.requestNotice='';slot.requestSent=null;slot.requestSequence=0;}
    slot.host.innerHTML=`<header class="agent-card-head"><div class="agent-identity"><button type="button" class="agent-initial agent-appearance-button" data-pack="agent-settings" data-slot="${slot.index}" aria-label="Customize ${esc(task.role||task.title)} appearance">${libraryIcon(appearanceFor(task).icon)}</button><div>${this.options.taskId?`<strong class="slot-role">${esc(task.role||task.title)}</strong>`:`<select data-select-slot="${slot.index}" aria-label="Agent in slot ${slot.index+1}">${this.snapshot.tasks.map(t=>`<option value="${t.id}" ${t.id===task.id?'selected':''}>${esc(t.role||t.title)}</option>`).join('')}</select>`}</div></div><div class="agent-card-controls"><button type="button" class="agent-model-button" data-pack="agent-settings" data-slot="${slot.index}" aria-label="Change ${esc(task.role||task.title)} model or provider" title="${esc(modelTitle(task))}"><span class="slot-model">${esc(modelLabel(task))}</span><span class="slot-effort" title="${esc(effortTitle(task))}">· ${esc(effortLabel(task))}</span>${dropdownIcon}</button><button type="button" class="agent-tools-button" data-pack="agent-tools" data-slot="${slot.index}" aria-label="${esc(task.role||task.title)} toolbox" aria-expanded="false"><span>Tools</span><span class="slot-tool-count">${this.snapshot.collaboration?.scopes?.[task.id]?.tools.filter(t=>t.allowed).length??'—'}</span>${dropdownIcon}</button><div class="mode-toggle"><button type="button" data-pack="chat" data-slot="${slot.index}" aria-pressed="${slot.mode==='chat'}">Chat</button><button type="button" data-pack="tui" data-slot="${slot.index}" aria-pressed="${slot.mode==='tui'}">${nativeTerminalFor(task)?'TUI':'Transcript'}</button></div><button type="button" class="agent-expand" data-pack="expand" data-slot="${slot.index}" title="${slot.expanded?(this.options.taskId?'Restore workspace':'Restore grid'):'Expand agent view'}" aria-label="${slot.expanded?'Restore':'Expand'} ${esc(task.role||task.title)} view" aria-expanded="${!!slot.expanded}">${expandIcon(slot.expanded)}</button></div></header><div class="agent-task-line"><span title="${esc(task.title)}">${esc(task.title)}</span><span class="slot-status" role="status" aria-label="Agent session status">${sessionPill(task.status,task.live?.modelActivity)}</span><span class="slot-contact-state"></span></div><div class="pack-session"><div class="pack-chat" data-chat="${slot.index}" tabindex="0" aria-label="${esc(task.role||task.title)} conversation"><div class="chat-placeholder">Connecting to this session’s message history…</div></div><button type="button" class="chat-jump" data-pack="chat-latest" data-slot="${slot.index}" aria-label="Scroll ${esc(task.role||task.title)} chat to bottom" hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6"/></svg><span>Scroll to bottom</span></button><div class="pack-tui" data-tui="${slot.index}" hidden></div><section class="slot-request" aria-label="${esc(task.role||task.title)} request" aria-live="polite" hidden></section></div><footer class="agent-card-foot ${slot.mode==='tui'?'tui-composer':''}"><div class="tui-session-meta" hidden>${tuiSessionMeta(task)}</div><section class="prompt-queue" aria-label="${esc(task.role||task.title)} queued messages" aria-live="polite" hidden></section><div class="prompt-delivery-controls"><div class="prompt-delivery-options" role="group" aria-label="Message delivery for ${esc(task.role||task.title)}"><button type="button" class="prompt-delivery-mode" data-pack="prompt-mode" data-slot="${slot.index}" data-mode="queue" aria-pressed="${slot.deliveryMode!=='steer'}" title="Wait until the agent is free">Queue</button><button type="button" class="prompt-delivery-mode" data-pack="prompt-mode" data-slot="${slot.index}" data-mode="steer" aria-pressed="${slot.deliveryMode==='steer'}" title="Available at the next inbox check; active commands are not interrupted">Steer</button></div><span class="prompt-delivery-note"></span></div><div class="slash-command-list" id="slash-commands-${slot.index}" role="listbox" aria-label="${esc(providerName(task.kind))} commands" hidden></div><form data-slot-form="${slot.index}" id="pack-prompt-${slot.index}"><span class="tui-prompt-mark" aria-hidden="true" hidden>❯</span><textarea data-prompt-slot="${slot.index}" placeholder="Message ${esc(task.role||task.title)}…" aria-label="Message ${esc(task.role||task.title)}" rows="1">${esc(slot.draft)}</textarea><button type="submit" aria-label="Send to ${esc(task.role||task.title)}">↑</button></form><div class="tui-controls" hidden><button type="button" data-pack="latest" data-slot="${slot.index}">↓ Latest</button><span>Enter send · Shift+Enter newline</span><button type="button" data-pack="expand" data-slot="${slot.index}" aria-pressed="${!!slot.expanded}">${slot.expanded?(this.options.taskId?'Restore workspace':'Restore grid'):'Expand transcript ⛶'}</button></div><div class="agent-card-meta"><span class="slot-branch" title="${esc(task.branch)}">⑂ ${esc(task.branch)}</span><span class="slot-changes">${task.changes||0} files</span>${nativeTerminalFor(task)?`<button type="button" class="agent-native-commands" data-pack="native-commands" data-slot="${slot.index}" aria-label="${esc(task.role||task.title)} native commands">/ Commands</button>`:''}${task.kind==='claude'?`<button type="button" class="agent-role-packs" data-pack="role-packs" data-slot="${slot.index}" aria-label="${esc(task.role||task.title)} role packs">${libraryIcon('layers',14)} Role packs</button>`:''}<button type="button" data-pack="interrupt" data-slot="${slot.index}">Interrupt</button></div></footer>`;
    slot.inputHistory=new InputHistory(this.snapshot.project.path,task.id);
    slot.attachmentComposer=new AttachmentComposer(slot.host.querySelector('footer'),{project:this.snapshot.project.path,get:()=>slot.taskId===task.id?slot.attachments||[]:this.sessionCache.get(task.id)?.attachments||[],set:images=>{if(slot.taskId===task.id)slot.attachments=images;else this.sessionCache.set(task.id,{...this.sessionCache.get(task.id),attachments:images});},busy:()=>slot.sending,onError:e=>this.options.toast(e)});
    const composer=slot.host.querySelector('textarea[data-prompt-slot]');composer.title='Up/Down: sent text history · Enter: send · Shift+Enter: newline';composer.dataset.tooltipKind='shortcuts';
    this.setMode(slot,slot.mode,{focus:false});
    slot.host.classList.remove('agent-color-0','agent-color-1','agent-color-2','agent-color-3');slot.host.setAttribute('style',appearanceStyle(task));
    this.renderHistory(slot);this.renderRequest(slot);this.resizeComposer(slot);this.renderPromptQueue(slot);this.renderSlashCommands(slot);
  }
  resizeComposer(slot){const input=slot.host.querySelector('textarea[data-prompt-slot]');if(input){input.style.height='auto';input.style.height=Math.min(96,Math.max(30,input.scrollHeight))+'px';}}
  captureTools(slot,host){if(!slot.expandedTools)return;for(const detail of host.querySelectorAll('details[data-event]')){if(detail.open)slot.expandedTools.add(detail.dataset.event);else slot.expandedTools.delete(detail.dataset.event);}}
  mountTUI(slot){
    const host=slot.host.querySelector('.pack-tui'),task=this.task(slot);
    if(nativeTerminalFor(task)){
      const native=new NativeTerminal(host,{taskId:task.id,label:task.role||task.title,onCompose:()=>{slot.nativeCompose=!slot.nativeCompose;this.setMode(slot,'tui',{focus:false});if(slot.nativeCompose)slot.host.querySelector('textarea[data-prompt-slot]')?.focus();}});
      slot.native=native;slot.cleanup=()=>native.dispose();
    }else{
      const tui=new TranscriptTUI(host,{task,transcript:slot.transcript,state:slot.tuiState,expanded:slot.expandedTools,onCompose:()=>slot.host.querySelector('textarea[data-prompt-slot]')?.focus(),onInterrupt:()=>this.options.api('tasks/interrupt',{id:slot.taskId}).then(()=>this.options.toast('Interrupt sent')).catch(e=>this.options.toast(e))});
      slot.tui=tui;slot.cleanup=()=>tui.dispose();
    }
  }
  setMode(slot,mode,{focus=true}={}){
    slot.mode=mode;const native=mode==='tui'&&nativeTerminalFor(this.task(slot)),transcript=mode==='tui'&&!native;
    slot.host.classList.toggle('native-tui-view',native);slot.host.querySelector('.pack-session').classList.toggle('tui-mode',mode==='tui');
    slot.host.querySelector('.pack-chat').hidden=mode!=='chat';slot.host.querySelector('.pack-tui').hidden=mode!=='tui';
    const footer=slot.host.querySelector('.agent-card-foot');footer.hidden=native&&!slot.nativeCompose;footer.classList.toggle('tui-composer',mode==='tui');
    for(const el of slot.host.querySelectorAll('.tui-session-meta,.tui-controls,.tui-prompt-mark'))el.hidden=!transcript;
    for(const button of slot.host.querySelectorAll('.mode-toggle button'))button.setAttribute('aria-pressed',String(button.dataset.pack===mode));
    if(mode==='tui'&&!slot.native&&!slot.tui)this.mountTUI(slot);
    if(mode==='tui')slot.host.querySelector('.chat-jump').hidden=true;
    this.renderRequest(slot);this.renderHistory(slot);this.resizeComposer(slot);
    if(native&&focus)slot.native.whenReady().then(()=>{if(slot.mode==='tui'&&!this.disposed)slot.native?.focus();}).catch(()=>{});
  }

  update(snapshot){
    observeWorkspaceSounds(snapshot);
    if(this.disposed)return;const choices=JSON.stringify(snapshot.tasks.map(t=>[t.id,t.role||t.title])),choicesChanged=this.choices!==choices;this.choices=choices;this.snapshot=snapshot;for(const view of [this.conversationsView,this.threadsView])if(view)view.contacts=snapshot.collaboration?.contacts||[];if(agentIdentities.update(snapshot.agentIdentities||snapshot.tasks))refreshAgentAppearances(document);
    for(const task of snapshot.tasks)if(!this.slots.some(s=>s.taskId===task.id)){const slot=this.slots.find(s=>!s.taskId);if(slot){slot.taskId=task.id;this.renderSlot(slot);}}
    for(const slot of this.slots){const task=this.task(slot);if(!task){if(slot.taskId){this.assignSlot(slot,null);}continue;}slot.host.style.cssText=appearanceStyle(task);const avatar=slot.host.querySelector('.agent-appearance-button');if(avatar)avatar.innerHTML=libraryIcon(appearanceFor(task).icon);if(slot.renderedSessionRevision!==(task.sessionRevision||0))this.renderSlot(slot);const model=slot.host.querySelector('.slot-model');if(model){model.textContent=modelLabel(task);model.parentElement.title=modelTitle(task);}const effort=slot.host.querySelector('.slot-effort');if(effort){effort.textContent='· '+effortLabel(task);effort.title=effortTitle(task);}if(choicesChanged){const select=slot.host.querySelector('select[data-select-slot]');if(select)select.innerHTML=snapshot.tasks.map(t=>`<option value="${t.id}" ${t.id===task.id?'selected':''}>${esc(t.role||t.title)}</option>`).join('');}const status=slot.host.querySelector('.slot-status'),statusHTML=sessionPill(task.status,task.live?.modelActivity);if(status&&status.innerHTML!==statusHTML)status.innerHTML=statusHTML;const changes=slot.host.querySelector('.slot-changes');if(changes)changes.textContent=(task.changes||0)+' files';
      const contact=snapshot.collaboration?.contacts.find(c=>c.id===task.id),discovered=contact&&contactSynced(contact,snapshot.collaboration);const discovery=slot.host.querySelector('.slot-contact-state');if(discovery){discovery.textContent=discovered?'Toolbox synced':contact?.connected?'Sync pending':'Toolbox disconnected';discovery.classList.toggle('synced',!!discovered);}
      const count=slot.host.querySelector('.slot-tool-count');if(count)count.textContent=snapshot.collaboration?.scopes?.[task.id]?.tools.filter(t=>t.allowed).length??'';
      slot.tui?.update(task,slot.transcript,slot.historyError);const tuiMeta=slot.host.querySelector('.tui-session-meta');if(tuiMeta)tuiMeta.innerHTML=tuiSessionMeta(task);
      this.renderRequest(slot);this.renderPromptQueue(slot);this.updateChatJump(slot);if(task.status==='blocked')this.refreshRequest(slot);
    }
    const registry=snapshot.collaboration||{contacts:[],tools:[],notifications:[],messages:[],memory:[]};
    this.setText('#contact-count',registry.contacts.length);
    this.setText('#thread-count',registry.directoryThreadCount??registry.threadCount??0);
    this.setText('#tool-count',registry.tools.length+(registry.builtinToolCount||9));
    this.setText('#notification-count',registry.notifications.length+(snapshot.scheduler?.unread||0));
    const synced=registry.contacts.filter(c=>contactSynced(c,registry)).length;
    this.setText('#pack-health',`Shared toolbox · ${synced}/${registry.contacts.length} contacts synced · ${registry.messages.filter(m=>m.delivery==='queued').length} messages queued`);
    for(const notice of registry.notifications){if(notice.type!=='human-request'&&!this.initial&&!this.lastNotifications.has(notice.id))this.options.toast(notice.detail);this.lastNotifications.add(notice.id);}this.initial=false;
    if(this.drawer)this.renderDrawer();this.shell?.update();this.persist();
  }
  eventHTML(event,task){
    if(event.type==='activity')return activityCard(event);
    if(event.type==='session')return `<div class="session-boundary">${esc(event.text)}</div>`;
    if(event.type==='reasoning'||event.type==='thinking')return thinkingBlock(event,{markdown,scope:`task:${task.id}`});
    if(event.type==='state')return `<div class="state-report">${statePill(event.report)}<span>${esc(event.report.reason)}</span></div>`;
    if(event.type==='tool'){const tool=toolPresentation(event);return `<details class="chat-tool tool-${tool.kind} tool-${tool.status}" data-event="${esc(event.id)}"><summary><span class="tool-glyph">${glyph(tool.kind)}</span><strong>${esc(tool.name)}</strong><span class="tool-status">${esc(tool.status)}</span></summary>${event.input?`<div class="tool-section"><span>INPUT</span><pre>${esc(event.input)}</pre></div>`:''}${event.output?`<div class="tool-section"><span>OUTPUT</span>${tool.kind==='edit'?diffHTML(event.output,{diff:true}):`<pre>${esc(event.output)}</pre>`}</div>`:''}</details>`;}
    if(event.communication){const message=event.communication;return `<article class="chat-message from-contact" ${agentAttributes(message.from)}><div class="dm-route">${agentAvatar(message.from)}<span><strong>${esc(message.fromRole)}</strong> ${message.kind==='group'?'in '+esc(message.threadName||'Group chat'):'messaged '+esc(message.toRole)}</span>${event.at?`<time>${shortTime(event.at)}</time>`:''}</div><div class="dm-bubble">${event.communication?.workBrief?workMessage(event.communication.workBrief,`task:${task.id}:${event.id}`,undefined,markdown):messageContent(markdown(event.text),`task:${task.id}:${event.id}`)}${imageGallery(event.attachments,this.snapshot.project.path)}</div><button type="button" class="dm-thread-link" data-pack="open-thread" data-thread-id="${esc(message.threadId)}">View ${message.kind==='group'?'group chat':'conversation'} →</button></article>`;}
    return `<article class="chat-message ${event.role==='user'?'from-user':'from-agent'}"><div class="message-role"><span class="message-author">${agentLabel(event.role==='user'?'human':task,event.role==='user'?'You':task.role||task.title)}${event.label?` · ${esc(event.label)}`:''}</span><span class="message-meta">${event.role==='assistant'&&event.agentState?statePill(event.agentState):''}${event.at?`<time>${shortTime(event.at)}</time>`:''}</span></div>${event.communication?.workBrief?workMessage(event.communication.workBrief,`task:${task.id}:${event.id}`,undefined,markdown):messageContent(markdown(event.text),`task:${task.id}:${event.id}`)}${imageGallery(event.attachments,this.snapshot.project.path)}</article>`;
  }
  blockEventHTML(event,task){
    if(event.type==='activity')return activityCard(event);
    if(event.type==='session')return this.eventHTML(event,task);
    if(event.type==='tool'){
      const tool=toolPresentation(event);
      const output=tool.kind==='edit'?diffHTML(event.output,{diff:true}):`<pre>${esc(event.output)}</pre>`;
      return `<details class="chat-tool block-tool tool-${tool.kind} tool-${tool.status}" data-event="${esc(event.id)}"><summary><span class="block-icon">${glyph(tool.kind)}</span><span class="block-tool-name"><small>${({edit:'FILE CHANGE',read:'READ / SEARCH',command:'COMMAND',tool:'TOOL CALL'})[tool.kind]}</small><strong>${esc(tool.name)}</strong></span><span class="tool-status">${tool.status==='completed'?'✓ ':tool.status==='failed'?'! ':''}${esc(tool.status)}</span>${tool.duration?`<time>${esc(tool.duration)}</time>`:event.at?`<time>${shortTime(event.at)}</time>`:''}<span class="disclosure-chevron" aria-hidden="true">⌄</span></summary>${event.input?`<div class="tool-section"><span>INPUT</span><pre>${esc(event.input)}</pre></div>`:''}${event.output?`<div class="tool-section"><span>OUTPUT${event.exitCode!=null?' · EXIT '+event.exitCode:''}</span>${output}</div>`:'<p class="tool-empty">No output reported yet.</p>'}</details>`;
    }
    if(event.type==='state')return `<details class="block-state" data-event="${esc(event.id)}"><summary>${glyph('thinking')} ${statePill(event.report)}<span>Reported activity</span></summary>${messageContent(markdown(event.report.reason),`task:${task.id}:${event.id}`)}${event.report.nextStep?`<p class="reported-next">Next: ${esc(event.report.nextStep)}</p>`:''}</details>`;
    if(event.type==='reasoning'||event.type==='thinking')return thinkingBlock(event,{markdown,scope:`task:${task.id}`});
    if(event.communication)return `<div class="block-communication">${this.eventHTML(event,task)}</div>`;
    const user=event.role==='user';
    return `<article class="chat-message block-message ${user?'from-user':'from-agent'}"><div class="block-message-head">${agentAvatar(user?'human':task)}<strong>${esc(user?'You':task.role||task.title)}</strong>${user?'<span class="message-direction">→ '+esc(task.role||task.title)+'</span>':''}${event.label?`<span class="block-label">${esc(event.label)}</span>`:''}<span class="message-meta">${!user&&event.agentState?statePill(event.agentState):''}${event.at?`<time>${shortTime(event.at)}</time>`:''}</span></div>${event.communication?.workBrief?workMessage(event.communication.workBrief,`task:${task.id}:${event.id}`,undefined,markdown):messageContent(markdown(event.text),`task:${task.id}:${event.id}`)}${imageGallery(event.attachments,this.snapshot.project.path)}</article>`;
  }
  activityHTML(slot){
    const task=this.task(slot),activity=turnActivity(slot.transcript?.events),metrics=task.agentState?.metrics;
    if(!activity.total&&!task.agentState)return '';
    return `<section class="block-activity" aria-label="Latest turn activity"><div>${glyph('activity')}<strong>${task.agentState?esc(task.agentState.reason):'Latest turn'}</strong>${activity.total?`<span>${activity.completed} / ${activity.total} tool calls completed</span>`:''}</div>${activity.total?`<progress max="${activity.total}" value="${activity.completed}" aria-label="Completed tool calls in the latest turn"></progress>`:''}${activity.failed?`<small class="activity-failed">${activity.failed} tool call${activity.failed===1?'':'s'} failed</small>`:''}${Number.isFinite(metrics?.contextPercent)?`<small>Context ${metrics.contextPercent}% · agent reported</small>`:''}${task.agentState?.nextStep?`<small>Next: ${esc(task.agentState.nextStep)}</small>`:''}</section>`;
  }
  renderHistory(slot){
    if(slot.mode==='tui'){slot.tui?.update(this.task(slot),slot.transcript,slot.historyError);return;}
    const host=slot.host.querySelector('.pack-chat');if(!host)return;
    const theme=this.shell?.prefs.theme||'bubble';host.classList.toggle('block-theme',theme==='block');
    const transcript=slot.transcript,key=JSON.stringify([transcript,slot.historyError,theme,this.task(slot)?.agentState]);if(key===slot.chatKey)return;
    const visibleEvents=transcript?.events.filter(e=>e.type!=='message'||e.text?.trim()||e.agentState)||[];
    const position=host.querySelector('.transcript-entry')?this.chatPosition(host):slot.chatScroll||{follow:true,top:0},follow=position.follow;this.captureTools(slot,host);slot.chatKey=key;
    const error=slot.historyError?`<div class="history-error">${esc(slot.historyError)} <button type="button" data-pack="refresh-session" data-slot="${slot.index}">Refresh session</button></div>`:'';
    host.innerHTML=error+(theme==='block'?this.activityHTML(slot):'')+(transcript?(visibleEvents.length?visibleEvents.map(e=>`<div class="transcript-entry" data-transcript-id="${esc(e.id)}">${theme==='block'?this.blockEventHTML(e,this.task(slot)):this.eventHTML(e,this.task(slot))}</div>`).join(''):'<div class="chat-placeholder">No messages yet. Send a message below.</div>')+`<div class="history-source">${esc(transcript.source)} · ${esc(transcript.sessionId.slice(0,8))}</div>`:slot.historyError?'':loadingState('Loading conversation',{variant:'compact'}));
    for(const detail of host.querySelectorAll('details'))detail.open=slot.expandedTools.has(detail.dataset.event);
    const restore=()=>{if(follow)host.scrollTop=host.scrollHeight;else{host.scrollTop=position.top;const anchor=[...host.querySelectorAll('.transcript-entry')].find(e=>e.dataset.transcriptId===position.anchor);if(anchor)host.scrollTop+=anchor.getBoundingClientRect().top-host.getBoundingClientRect().top-position.offset;}this.updateChatJump(slot);};
    restore();enhanceMarkdown(host,restore,{project:this.snapshot.project.path,taskId:this.task(slot).id});this.shell?.updateOverview();
  }
  updateChatJump(slot){
    const chat=slot?.host.querySelector('.pack-chat'),button=slot?.host.querySelector('.chat-jump');if(!chat||!button)return;
    button.hidden=chat.clientHeight<60||chat.scrollHeight-chat.scrollTop-chat.clientHeight<45||slot.host.classList.contains('has-request');
  }
  scrollChatToBottom(slot){
    const chat=slot.host.querySelector('.pack-chat');if(!chat)return;
    chat.scrollTo({top:chat.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  renderRequest(slot){
    const task=this.task(slot),host=slot.host.querySelector('.slot-request');if(!host||!task)return;
    const visible=!(slot.mode==='tui'&&nativeTerminalFor(task))&&['blocked','setup-error'].includes(task.status);host.hidden=!visible;
    const actionable=visible&&!!slot.request?.pending;
    slot.host.classList.toggle('has-request',actionable);
    host.classList.toggle('request-compact',!actionable);
    host.setAttribute('aria-busy',String(visible&&!actionable&&task.status==='blocked'&&!slot.requestError));
    if(!visible){if(!['blocked','setup-error'].includes(task.status))observePermission(slot,null);slot.requestKey=null;return;}
    const data=slot.request,request=data?.request,key=permissionKey(slot,task);if(key===slot.requestKey)return;slot.requestKey=key;
    const disabled=slot.responding?'disabled':'';
    if(task.canRetryStart){host.innerHTML=`<strong>Agent did not start</strong><p>${esc(task.error)}</p><button type="button" data-pack="retry-start" data-slot="${slot.index}">Retry start</button>`;return;}
    if(!data?.pending){host.innerHTML=`${task.status==='setup-error'?'<strong>Agent needs setup</strong>':slot.requestError?'<strong>Permission details couldn’t load</strong>':loadingState('Loading permission details',{variant:'compact'})}${task.error?`<p>${esc(task.error)}</p>`:''}${slot.requestError?`<p class="request-error">${esc(slot.requestError)}</p><button type="button" data-pack="refresh-session" data-slot="${slot.index}">Refresh request</button>`:''}`;return;}
    host.innerHTML=permissionHTML({request,slot:slot.index,role:task.role,provider:providerName(task.kind),expanded:slot.expanded,workspace:!!this.options.taskId,disabled:slot.responding||permissionAnswered(slot),sequence:slot.requestSequence,notice:slot.requestNotice,error:slot.requestError});
  }
  async refreshRequest(slot){
    const task=this.task(slot);if(!task||task.status!=='blocked'||slot.requestLoading||slot.responding)return;
    slot.requestLoading=true;
    try{const data=await this.options.api('request?task='+task.id);if(this.disposed||slot.taskId!==task.id||this.task(slot)?.status!=='blocked')return;observePermission(slot,data);this.renderRequest(slot);}
    catch(error){if(!this.disposed&&slot.taskId===task.id){slot.requestError=error.message;this.renderRequest(slot);}}
    finally{slot.requestLoading=false;}
  }
  async respond(slot,answer){
    if(slot.responding||!slot.request?.pending||permissionAnswered(slot))return;
    const taskId=slot.taskId,expected=slot.request.fingerprint,identity=permissionIdentity(slot.request),sequence=slot.requestSequence||1,navigation=['up','down'].includes(answer.key);slot.responding=true;slot.requestError='';slot.requestNotice='Sending your response…';this.renderRequest(slot);
    try{await this.options.api(answer.choice?'tasks/decision':'tasks/respond',{id:taskId,...answer,expected});if(this.disposed||slot.taskId!==taskId)return;slot.requestSent=navigation?null:identity;slot.requestNotice=navigation?'Selection moved. Review the highlighted native option.':`Response sent for request ${sequence}. Waiting for the provider to continue…`;const snapshot=await this.options.api('state');if(!this.disposed)this.update(snapshot);}
    catch(error){if(slot.taskId===taskId){slot.requestNotice='';slot.requestError=error.message;}}
    finally{slot.responding=false;slot.requestKey=null;this.renderRequest(slot);await this.refreshRequest(slot);}
  }
  async refreshChat(slot){
    const task=this.task(slot),generation=slot.generation;if(!task||slot.loading)return;slot.loading=true;
    try{const transcript=await this.options.api('chat?task='+task.id);if(this.disposed||slot.taskId!==task.id||slot.generation!==generation)return;slot.transcript=transcript;slot.historyError=transcript.warning||'';this.renderHistory(slot);}
    catch(error){if(!this.disposed&&slot.taskId===task.id){slot.historyError=error.message;this.renderHistory(slot);}}
    finally{slot.loading=false;}
  }
  async refreshChats(force=false){if(this.disposed||(!force&&this.options.api.canPoll?.()===false)||document.hidden||this.shell?.prefs.tab==='tasks')return;await Promise.allSettled(this.slots.flatMap(slot=>[this.refreshChat(slot),this.refreshRequest(slot)]));}
  async send(slot){
    if(slot.sending||slot.attachmentComposer?.pending||(!slot.draft.trim()&&!slot.attachments?.length))return;
    if(isSlashDraft(slot.draft)){if(slot.attachments?.length)throw Error('Send files with a message, rather than a slash command.');return this.sendNativeCommand(slot);}
    if(['setup-error','starting'].includes(this.task(slot)?.status))throw new Error('Choose a response in this card’s request first. Your message draft is saved.');
    const taskId=slot.taskId,text=slot.draft.trim(),attachments=[...(slot.attachments||[])],mode=slot.deliveryMode||'queue',inputHistory=slot.inputHistory,submit=slot.host.querySelector('[type=submit]'),form=submit?.form;
    slot.sending=true;if(submit){submit.disabled=true;submit.textContent='…';}form?.setAttribute('aria-busy','true');
    const signature=JSON.stringify([taskId,text,mode,attachments.map(a=>a.id)]);if(slot.pendingPrompt?.signature!==signature)slot.pendingPrompt={signature,requestId:crypto.randomUUID()};
    try{const receipt=await this.options.api('tasks/prompt',{id:taskId,text,attachments:attachments.map(a=>a.id),mode,requestId:slot.pendingPrompt.requestId});inputHistory.remember(text);slot.pendingPrompt=null;if(receipt.message?.delivery==='queued')this.options.toast(mode==='steer'?'Steering message waiting for the next inbox check':'Message queued until the agent is free');if(slot.taskId===taskId){if(slot.draft.trim()===text){slot.draft='';slot.attachments=(slot.attachments||[]).filter(a=>!attachments.some(sent=>sent.id===a.id));slot.attachmentComposer?.render();slot.deliveryMode='queue';this.renderPromptQueue(slot);const input=slot.host.querySelector('textarea[data-prompt-slot]');if(input)input.value='';}this.resizeComposer(slot);await this.refreshChat(slot);}else{const cached=this.sessionCache.get(taskId);if(cached?.draft?.trim()===text){cached.draft='';cached.attachments=(cached.attachments||[]).filter(a=>!attachments.some(sent=>sent.id===a.id));}}const snapshot=await this.options.api('state');if(!this.disposed)this.update(snapshot);}
    finally{slot.sending=false;slot.attachmentComposer?.render();if(submit?.isConnected){submit.disabled=false;submit.textContent='↑';}form?.removeAttribute('aria-busy');}
  }

  async renderSlashCommands(slot){
    const host=slot.host.querySelector('.slash-command-list'),input=slot.host.querySelector('textarea[data-prompt-slot]');if(!host||!input)return;
    const visible=isSlashDraft(slot.draft)&&slot.slashDismissed!==slot.draft;host.hidden=!visible;input.setAttribute('aria-expanded',String(visible));
    if(!visible){input.removeAttribute('aria-activedescendant');input.removeAttribute('role');return;}
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',host.id);
    if(!slot.commandReport){
      host.innerHTML='<p>Loading provider commands…</p>';if(slot.commandLoading)return;
      slot.commandLoading=true;const taskId=slot.taskId,revision=this.task(slot)?.sessionRevision;
      try{const report=await this.options.api('native-commands?task='+taskId);if(slot.taskId===taskId&&this.task(slot)?.sessionRevision===revision)slot.commandReport=report;}
      catch(error){if(slot.taskId===taskId)host.innerHTML=`<p>${esc(error.message)}</p>`;return;}
      finally{slot.commandLoading=false;}
      if(this.disposed||slot.taskId!==taskId)return;return this.renderSlashCommands(slot);
    }
    const report=slot.commandReport,choices=report.supported?slashSuggestions(slot.draft,report.commands):[];slot.slashChoices=choices;
    host.innerHTML=choices.length?choices.map((c,i)=>`<button type="button" role="option" id="slash-${slot.index}-${i}" aria-selected="${i===slot.slashIndex}" data-pack="choose-command" data-slot="${slot.index}" data-command="${esc(c.name)}"><strong>${esc(c.name)}</strong><span>${esc(c.description)}${c.usesModel?' · May use model tokens':''}</span></button>`).join(''):`<p>${report.supported?'Not in this provider’s library. Type custom commands in the native TUI.':'This session has no native command terminal.'}</p>`;
    if(slot.slashIndex>=0&&choices[slot.slashIndex]){input.setAttribute('aria-activedescendant',`slash-${slot.index}-${slot.slashIndex}`);host.children[slot.slashIndex]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
  }
  slashKey(event){
    if(event.target.dataset.promptSlot===undefined||event.isComposing)return false;
    const slot=this.slots[Number(event.target.dataset.promptSlot)],host=slot?.host.querySelector('.slash-command-list');if(!host||host.hidden)return false;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();slot.slashDismissed=slot.draft;this.renderSlashCommands(slot);return true;}
    if(['ArrowDown','ArrowUp'].includes(event.key)&&slot.slashChoices?.length){event.preventDefault();const n=slot.slashChoices.length;slot.slashIndex=((slot.slashIndex??-1)+(event.key==='ArrowDown'?1:-1)+n)%n;this.renderSlashCommands(slot);return true;}
    if(event.key==='Enter'&&slot.slashIndex>=0&&slot.slashChoices?.[slot.slashIndex]){event.preventDefault();this.chooseCommand(slot,slot.slashChoices[slot.slashIndex].name);return true;}
    return false;
  }
  chooseCommand(slot,name){
    const command=slot.commandReport?.commands.find(c=>c.name===name);if(!command)return;
    slot.draft=name+(command.args?' ':'');slot.slashDismissed=slot.draft;slot.slashIndex=-1;
    const input=slot.host.querySelector('textarea[data-prompt-slot]');input.value=slot.draft;input.focus();this.renderSlashCommands(slot);this.renderPromptQueue(slot);this.resizeComposer(slot);
  }
  async sendNativeCommand(slot){
    if(slot.sending)return;const taskId=slot.taskId,text=slot.draft.trim(),revision=this.task(slot)?.sessionRevision;
    slot.sending=true;
    try{
      const report=await this.options.api('native-commands?task='+taskId),command=resolveSlashCommand(text,report);
      if(!report.ready)throw Error(report.reason+' Your command draft is saved.');
      if(this.disposed||slot.taskId!==taskId||this.task(slot)?.sessionRevision!==revision)return;
      slot.commandReport=report;
      const signature=JSON.stringify([taskId,text,revision]);if(slot.pendingCommand?.signature!==signature)slot.pendingCommand={signature,requestId:crypto.randomUUID(),expected:report.expected};
      this.setMode(slot,'tui',{focus:false});await slot.native.whenReady();
      if(this.disposed||slot.taskId!==taskId||this.task(slot)?.sessionRevision!==revision)return;
      await this.options.api('native-commands',{taskId,...command,requestId:slot.pendingCommand.requestId,expected:slot.pendingCommand.expected});
      slot.pendingCommand=null;
      if(slot.taskId===taskId&&slot.draft.trim()===text){slot.draft='';slot.slashDismissed=null;slot.nativeCompose=false;slot.host.querySelector('textarea[data-prompt-slot]').value='';this.renderSlashCommands(slot);this.renderPromptQueue(slot);this.setMode(slot,'tui',{focus:false});}
      slot.native?.latest();slot.native?.focus();this.options.toast(command.name+' sent to the native TUI.');
    }catch(error){if(!this.disposed&&slot.taskId===taskId&&slot.mode==='tui'){slot.nativeCompose=true;this.setMode(slot,'tui',{focus:false});}throw error;}finally{slot.sending=false;}
  }

  renderPromptQueue(slot){
    const host=slot.host.querySelector('.prompt-queue'),note=slot.host.querySelector('.prompt-delivery-note');if(!host)return;
    for(const button of slot.host.querySelectorAll('.prompt-delivery-mode')){button.setAttribute('aria-pressed',String(button.dataset.mode===(slot.deliveryMode||'queue')));button.disabled=isSlashDraft(slot.draft);}
    if(note)note.textContent=isSlashDraft(slot.draft)?'Native command · runs when idle; output and controls in TUI.':slot.deliveryMode==='steer'?'Available at the next inbox check. Active commands are not interrupted.':'Delivered when this agent is free.';
    const messages=(this.snapshot.collaboration?.prompts||[]).filter(m=>m.to===slot.taskId),key=JSON.stringify(messages);if(slot.promptQueueKey===key)return;slot.promptQueueKey=key;host.hidden=!messages.length;
    host.innerHTML=messages.map(m=>`<div class="queued-prompt"><div><strong>${m.delivery==='queued'?(m.promptMode==='steer'?'Steering · awaiting inbox check':'Queued · waiting until free'):m.delivery==='uncertain'?'Delivery unconfirmed':'Sending…'}</strong><p>${esc(m.text)}</p>${imageGallery(m.attachments,this.snapshot.project.path)}${m.delivery==='uncertain'?'<small>Check the agent history before sending again.</small>':''}</div><div class="queued-prompt-actions">${m.delivery==='queued'?`<button type="button" data-pack="edit-prompt" data-slot="${slot.index}" data-message="${m.id}">Edit</button><button type="button" data-pack="cancel-prompt" data-slot="${slot.index}" data-message="${m.id}">Cancel</button>`:''}</div></div>`).join('');
  }
  async cancelPrompt(slot,id,edit){
    if(edit&&(slot.draft.trim()||slot.attachments?.length||slot.attachmentComposer?.pending))throw new Error('Clear or send your current draft before editing a queued message.');
    const taskId=slot.taskId,result=await this.options.api('tasks/prompt/cancel',{id:taskId,messageId:id});
    if(edit){if(slot.taskId===taskId){slot.draft=result.text;slot.attachments=result.attachments||[];slot.attachmentComposer?.render();slot.deliveryMode=result.promptMode||'queue';const input=slot.host.querySelector('textarea[data-prompt-slot]');if(input){input.value=slot.draft;input.focus();}this.renderPromptQueue(slot);this.resizeComposer(slot);}else this.sessionCache.set(taskId,{...this.sessionCache.get(taskId),draft:result.text,attachments:result.attachments||[],deliveryMode:result.promptMode||'queue'});}
    const snapshot=await this.options.api('state');if(!this.disposed)this.update(snapshot);this.options.toast(edit?'Message ready to edit. Send to requeue it.':'Queued message cancelled');
  }

  setExpanded(slot,expanded){
    if(expanded)for(const other of this.slots)if(other!==slot&&other.expanded)this.setExpanded(other,false);
    const chat=slot.host.querySelector('.pack-chat');
    if(expanded&&chat)slot.gridScroll={top:chat.scrollTop,follow:chat.scrollHeight-chat.scrollTop-chat.clientHeight<40};
    const scroll=expanded?slot.gridScroll:slot.gridScroll&&chat?.scrollTop===slot.expandedScrollTop?slot.gridScroll:chat?{top:chat.scrollTop,follow:chat.scrollHeight-chat.scrollTop-chat.clientHeight<40}:null;
    slot.expanded=expanded;slot.host.classList.toggle('expanded',expanded);
    document.body.classList.toggle('pack-focused',this.slots.some(s=>s.expanded));
    for(const control of slot.host.querySelectorAll('[data-pack="expand"]')){
      if(control.classList.contains('agent-expand')){control.innerHTML=expandIcon(expanded);control.setAttribute('aria-expanded',String(expanded));control.setAttribute('aria-label',`${expanded?'Restore':'Expand'} ${this.task(slot).role||this.task(slot).title} view`);control.title=expanded?(this.options.taskId?'Restore workspace':'Restore grid'):'Expand agent view';}
      else{control.setAttribute('aria-pressed',String(expanded));control.textContent=expanded?(this.options.taskId?'Restore workspace':'Restore grid'):control.classList.contains('request-expand')?'Expand card':'Expand TUI ⛶';}
    }
    if(chat&&scroll){chat.scrollTop=scroll.follow?chat.scrollHeight:scroll.top;slot.expandedScrollTop=chat.scrollTop;}this.updateChatJump(slot);
  }
  async onClick(event){const work=event.target.closest('[data-open-work]');if(work){this.options.onOpenWork?.(work.dataset.openWork,work.dataset.workProject);return;}const button=event.target.closest('[data-pack]');if(!button)return;const action=button.dataset.pack,slot=this.slots[Number(button.dataset.slot)];
    if(action==='workspace')return this.shell?.setTab('changes');if(action==='new')return this.options.onNewTask();
    if(action==='choose-command'){this.chooseCommand(slot,button.dataset.command);return;}
    if(action==='native-commands'){this.setMode(slot,'tui');await slot.native?.whenReady();slot.native?.showCommands();return;}
    if(action==='prompt-mode'){slot.deliveryMode=button.dataset.mode;this.renderPromptQueue(slot);return;}
    if(action==='edit-prompt'||action==='cancel-prompt')return this.cancelPrompt(slot,button.dataset.message,action==='edit-prompt');
    if(action==='chat-latest'){this.scrollChatToBottom(slot);return;}
    if(action==='latest'){slot.tui?.latest();return;}
    if(action==='expand'){this.setExpanded(slot,!slot.expanded);return;}
    if(action==='role-packs'){this.rolePackDialog?.close();const data=await this.options.api('role-packs?task='+slot.taskId).catch(error=>{if(error.status===404)throw Error('Role packs need the updated server. Reload HeloScrum when active agents are idle.');throw error;});const {RolePackDialog}=await import('/role-packs.js');if(this.disposed)return;this.rolePackDialog=new RolePackDialog(button,data,{api:this.options.api,onClose:()=>{this.rolePackDialog=null;}});return;}
    if(action==='agent-settings'){this.settingsDialog=openAgentSettingsDialog(button,this.task(slot),{api:this.options.api,onManage:details=>this.options.onProjectSettings?.({project:details.project,sourceTaskId:details.taskId}),onSaved:async result=>{this.options.toast(result.appearanceOnly?'Appearance saved':result.phase==='launched'?'Agent session updated':'Session saved. Complete provider setup in this card.');this.update(await this.options.api('state'));await this.refreshChat(slot);},onClose:()=>{this.settingsDialog=null;}});return;}
    if(action==='agent-tools'){if(this.toolMenu?.button===button){this.toolMenu.close();return;}this.toolMenu?.close(false);const task=this.task(slot),scope=await this.options.api('agent-tools?task='+task.id);if(this.disposed||!button.isConnected)return;this.toolMenu=new AgentToolMenu(button,scope,{api:this.options.api,onManage:serverId=>this.options.onProjectSettings?.({tab:'tools',serverId}),onSaved:async()=>{this.options.toast(task.role+'’s toolbox access has been updated');const snapshot=await this.options.api('state');this.update(snapshot);},onClose:()=>{this.toolMenu=null;}});return;}
    if(action==='refresh-session'){await Promise.allSettled([this.refreshChat(slot),this.refreshRequest(slot)]);return;}
    if(action==='request-choice'||action==='request-key'){await this.respond(slot,action==='request-choice'?{choice:button.dataset.choice}:{key:button.dataset.key});return;}
    if(['chat','tui'].includes(action)){this.setMode(slot,action);await this.refreshChat(slot);return;}
    if(action==='retry-start'){await this.options.api('tasks/retry',{id:slot.taskId});this.options.toast('Retrying this agent with its original task…');return;}
    if(action==='interrupt'){await this.options.api('tasks/interrupt',{id:slot.taskId});this.options.toast('Interrupt sent');return;}
    if(action==='refresh-contacts'){await this.refreshContacts(button.dataset.contact);return;}
    if(action==='expand-memory'){this.toggleMemoryExpanded();return;}
    if(action==='open-thread'){await this.openThreads(button.dataset.threadId);return;}
    if(action==='threads'&&this.shell){this.openThreads();return;}
    if(['contacts','threads','toolbox','notifications','memory','history'].includes(action)){this.memoryView?.dispose();this.memoryView=null;this.threadsView?.dispose();this.threadsView=null;this.historyView?.dispose();this.historyView=null;this.drawer=action;this.drawerHTML=null;this.renderDrawer();return;}
    if(action==='close-drawer'){this.closeDrawer();return;}
    if(action==='add-tool')this.options.onAddTool();
  }
  closeDrawer(){this.memoryView?.dispose();this.memoryView=null;this.threadsView?.dispose();this.threadsView=null;this.historyView?.dispose();this.historyView=null;this.drawer=null;this.drawerHTML=null;this.root.querySelector('#pack-drawer').hidden=true;}
  async openThreads(id,messageId){if(this.shell){this.closeDrawer();this.shell.setTab('conversations');if(id){await this.conversationsView?.select(id);if(messageId)await this.conversationsView?.focusMessage(messageId);}return;}if(this.drawer!=='threads')this.closeDrawer();this.drawer='threads';this.renderDrawer();if(id)this.threadsView.select(id);}
  async refreshContacts(taskId){
    const key=taskId||'all';this.refreshingContacts ||= new Set();if(this.refreshingContacts.has(key))return;
    this.refreshingContacts.add(key);this.renderDrawer();
    try{await this.options.api('contacts/refresh',taskId?{taskId}:{});this.update(await this.options.api('state'));this.options.toast('Tool refresh requested. Waiting for the runtime to acknowledge it.');}
    finally{this.refreshingContacts.delete(key);if(this.drawer)this.renderDrawer();}
  }
  toggleMemoryExpanded(){
    const drawer=this.root.querySelector('#pack-drawer'),anchor=[...drawer.querySelectorAll('.registry-item')].find(e=>e.getBoundingClientRect().bottom>drawer.getBoundingClientRect().top+90),index=anchor?[...drawer.querySelectorAll('.registry-item')].indexOf(anchor):-1,offset=anchor?.getBoundingClientRect().top;
    this.memoryExpanded=!this.memoryExpanded;drawer.classList.toggle('drawer-expanded',this.memoryExpanded);if(this.memoryView){this.memoryView.setExpanded(this.memoryExpanded);return;}this.renderDrawer();
    const next=drawer.querySelectorAll('.registry-item')[index];if(next)drawer.scrollTop+=next.getBoundingClientRect().top-offset;
    drawer.querySelector('[data-pack="expand-memory"]')?.focus({preventScroll:true});
  }
  renderDrawer(){
    const registry=this.snapshot.collaboration||{contacts:[],tools:[],notifications:[],messages:[],memory:[]},drawer=this.root.querySelector('#pack-drawer');drawer.hidden=false;drawer.classList.toggle('drawer-expanded',this.drawer==='memory'&&!!this.memoryExpanded);
    if(this.drawer==='details'){const html=this.options.renderDetails?.()||'';drawer._html=this.drawerHTML;this.shell?.patch('#pack-drawer',html);this.drawerHTML=html;return;}
    if(this.drawer==='memory'){if(!this.memoryView)this.memoryView=new MemoryView(drawer,{api:this.options.api,registry,onClose:()=>this.closeDrawer(),onExpand:()=>this.toggleMemoryExpanded(),expanded:!!this.memoryExpanded});else this.memoryView.registry=registry;return;}
    if(this.drawer==='history'){if(!this.historyView)this.historyView=new HistoryView(drawer,{api:this.options.api,markdown,enhanceMarkdown,onClose:()=>this.closeDrawer()});return;}
    if(this.drawer==='threads'){if(!this.threadsView)this.threadsView=new ChatThreads(drawer,{onWork:this.options.onOpenWork,api:this.options.api,markdown,enhanceMarkdown,contacts:registry.contacts,project:this.snapshot.project,onClose:()=>this.closeDrawer()});else this.threadsView.refresh();return;}
    const names={contacts:'Contact book',toolbox:'Shared Toolbox',notifications:'Collaboration activity',memory:'Shared project memory'};
    let content='';
    if(this.drawer==='contacts')content=`<div class="contact-refresh-intro"><p>Each role is a callable contact. External contacts read messages from their inbox; they are not launched or woken by HeloScrum. Refresh requests the latest tool list.</p><button type="button" data-pack="refresh-contacts" class="contact-refresh-all" ${this.refreshingContacts?.size?'disabled':''}>${this.refreshingContacts?.has('all')?'Requesting…':'Refresh all contacts'}</button></div>${registry.contacts.map(c=>{
      const synced=contactSynced(c,registry),pending=c.connected&&!synced;
      return `<article class="registry-item"><div><strong>${agentLabel(c)}${c.external?' · External':''}</strong><span class="contact-sync-status ${synced?'synced':pending?'pending':''}">${synced?'Tools up to date':c.connected?c.refreshRequestedAt?'Refresh requested':'Tool sync pending':c.external?'Inbox available':'Runtime disconnected'}</span></div><p>${esc(c.summary)}</p>${c.external?'<p><small>Inbox delivery · messages wait until this contact reads them</small></p>':''}<code>${esc(c.tool)}</code><div class="contact-refresh-row"><small>${synced?'Confirmed by the runtime':c.connected?'Waiting for the runtime to fetch its tool list.':'Refresh will be picked up when the runtime reconnects.'}</small><button type="button" data-pack="refresh-contacts" data-contact="${esc(c.id)}" aria-label="Refresh ${esc(c.role)} tools" ${this.refreshingContacts?.has(c.id)||this.refreshingContacts?.has('all')?'disabled':''}>${this.refreshingContacts?.has(c.id)?'Requesting…':'Refresh tools'}</button></div></article>`;
    }).join('')||'<div class="drawer-empty">Add an agent to create the first contact.</div>'}`;
    if(this.drawer==='toolbox')content=`<p>Tools available to this project. MCP tools stay grouped under their source, with access assigned in Project settings.</p><button type="button" class="primary" data-pack="add-tool">${libraryIcon('settings-2',16)} Manage tools & MCPs</button>${(registry.mcpServers||[]).map(s=>`<details class="mcp-group" style="margin-top:14px"><summary><span class="resource-icon">${libraryIcon('plug')}</span><span class="mcp-title"><strong>${esc(s.name)}</strong><small>${s.tools.length} tools · ${s.scope==='global'?'Global':'Project'} · ${s.enabled===false?'Disabled':s.assignment==='selected'?'Selected agents':'All agents'}</small></span>${libraryIcon('chevron-down',16)}</summary><div class="mcp-tool-rows">${s.tools.map(t=>`<div><code>${esc(t.name)}</code><p>${esc(t.description)}</p></div>`).join('')||'<p>Connect in settings to discover tools.</p>'}</div></details>`).join('')}<h3>Local tools</h3>${registry.tools.filter(t=>!t.sourceId).map(t=>`<article class="registry-item"><strong>${esc(t.name)}</strong><p>${esc(t.description)}</p><span>${t.scope==='global'?'Global':'Project'} · ${t.enabled?'Enabled':'Disabled'}</span></article>`).join('')||'<p>No local tools registered.</p>'}<details class="core-tool-list"><summary>Built-in coordination tools</summary><div class="builtin-tools">${['work_brief','work_read_brief','notebook_read','notebook_write','memory_search','contact_book','send_message','read_inbox','toolbox','invoke_tool','report_state','request_support','memory_read','memory_write','create_group','list_groups','read_group','send_group_message','set_chat_status','ask_user','work_list','work_get','work_create_task','work_update_task','work_verify_task','work_read_resource','work_schedule','work_update_schedule'].map(name=>`<code>${name}</code>`).join('')}</div></details>`;
    if(this.drawer==='notifications')content=`${(this.snapshot.scheduler?.notices||[]).slice(0,20).map(n=>`<article class="registry-item"><div><span class="notice-type">${n.obsolete?'PAST REMINDER':n.readAt?'REMINDER':'NEW REMINDER'}</span><time>${shortTime(n.at)}</time></div><strong>${esc(n.title)}</strong><p>${esc(n.summary)}</p><button type="button" data-open-work="${n.planId}" data-work-project="${esc(n.project)}">Open plan</button></article>`).join('')}${registry.notifications.map(n=>n.type==='human-request'?`<article class="registry-item user-request-notice"><div><span class="notice-type">${registry.userRequests?.find(q=>q.id===n.requestId)?.status==='answered'?'ANSWERED':registry.userRequests?.find(q=>q.id===n.requestId)?.status==='cancelled'?'CANCELLED':'NEEDS REVIEW'}</span><time>${shortTime(n.at)}</time></div><strong>${agentLabel(registry.userRequests?.find(q=>q.id===n.requestId)?.from||{},n.name)} asks you</strong><p>${esc(n.detail)}</p><span>${esc(registry.userRequests?.find(q=>q.id===n.requestId)?.status||'pending')}</span><button type="button" data-pack="open-thread" data-thread-id="${esc(n.threadId)}">${registry.userRequests?.find(q=>q.id===n.requestId)?.status==='pending'?'Answer in group':'View conversation'}</button></article>`:`<article class="registry-item"><div><span class="notice-type">${n.type==='contact'?'CONTACT':n.type==='scope'?'ACCESS':n.type==='group'?'GROUP':'TOOL'}</span><time>${shortTime(n.at)}</time></div><strong>${n.taskId?agentAvatar(n.taskId):''}${esc(n.detail)}</strong><p>Registry revision ${n.revision}. Check Contacts for each runtime’s discovery status.</p></article>`).join('')||'<p>No collaboration changes yet.</p>'}<h3>Direct messages</h3>${registry.messages.filter(m=>!m.threadId).toReversed().slice(0,30).map(m=>`<article class="registry-item"><div><strong>${agentLabel(m.from,m.fromRole)} → ${agentLabel(m.to,m.toRole)}</strong><span>${esc(m.delivery)}</span></div><p>${esc(m.text)}</p>${imageGallery(m.attachments,this.snapshot.project.path)}${m.error?`<p class="form-error">${esc(m.error)}</p>`:''}</article>`).join('')||'<p>No direct messages yet.</p>'}`;
    if(this.drawer==='memory')content=`<p>Agents share named notes through <code>memory_read</code> and <code>memory_write</code>. Revision checks protect teammates’ updates.</p>${registry.memory.map(m=>`<article class="registry-item"><strong>${esc(m.key)}</strong><div class="markdown">${markdown(m.text)}</div><small>${m.authorTaskId?agentLabel(m.authorTaskId,m.author):esc(m.author)} · revision ${m.revision}</small></article>`).join('')||'<div class="drawer-empty">Shared findings and decisions will appear here when an agent saves a note.</div>'}`;
    const top=drawer.scrollTop,html=`<div class="drawer-heading"><h2>${names[this.drawer]}</h2><div class="drawer-heading-actions">${this.drawer==='memory'?`<button type="button" class="drawer-expand" data-pack="expand-memory" aria-label="${this.memoryExpanded?'Restore shared memory panel':'Expand shared memory'}" title="${this.memoryExpanded?'Restore panel':'Expand memory'}" aria-expanded="${!!this.memoryExpanded}">${expandIcon(this.memoryExpanded)}</button>`:''}<button type="button" data-pack="close-drawer" aria-label="Close collaboration details">×</button></div></div><div class="drawer-content">${content}</div>`;
    if(html!==this.drawerHTML){const focused=drawer.contains(document.activeElement)?document.activeElement.dataset:null;drawer.innerHTML=html;this.drawerHTML=html;drawer.scrollTop=top;if(focused?.pack)[...drawer.querySelectorAll('[data-pack]')].find(e=>e.dataset.pack===focused.pack&&e.dataset.contact===focused.contact)?.focus({preventScroll:true});}
  }
  dispose(){this.imageObserver?.disconnect();this.slots.forEach(s=>s.attachmentComposer?.dispose());this.memoryView?.dispose();this.workView?.dispose();this.shell?.dispose();this.conversationsView?.dispose();this.chatResize?.disconnect();this.root.removeEventListener('scroll',this.onScroll,true);this.root.removeEventListener('toggle',this.onToggle,true);this.root.removeEventListener('message-content-resize',this.onToggle);this.threadsView?.dispose();this.historyView?.dispose();this.rolePackDialog?.close();this.settingsDialog?.close();document.body.classList.remove('pack-focused');this.toolMenu?.close(false);this.disposed=true;clearInterval(this.timer);this.slots.forEach(slot=>{slot.generation++;slot.cleanup?.();});this.root.removeEventListener('click',this.click);this.root.removeEventListener('change',this.change);this.root.removeEventListener('input',this.input);this.root.removeEventListener('submit',this.submit);this.root.removeEventListener('keydown',this.key,true);}
}
