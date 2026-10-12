import {libraryIcon,agentAttributes,agentAvatar,agentLabel} from '/agent-appearance.js';
import {workspacePreferences,agentLayouts,chatThemes,statusLabel,turnActivity,workingEllipsis} from '/workspace-model.js';
import {providerName} from '/providers.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const glyph=name=>`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({refresh:'<path d="M20 7v5h-5m5 0a8 8 0 1 0-2 6"/>',disconnected:'<path d="m3 3 18 18M5 8a12 12 0 0 0-3 3m7 1a6 6 0 0 0-4 2m3 3a6 6 0 0 1 4-1m0 5h.01M9 5a16 16 0 0 1 13 6m-8-1a11 11 0 0 1 5 4"/>',activity:'<path d="M3 12h4l3-7 4 14 3-7h4"/>',agents:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M10 9v12"/>',conversations:'<path d="M4 3h12a2 2 0 0 1 2 2v9H8l-5 4V5a2 2 0 0 1 1-2Z"/><path d="M9 18h8l4 3V9"/>',changes:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-9a9 9 0 0 1-10 9"/>',focus:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/>',split:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',overview:'<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="15" width="18" height="5" rx="1"/>',agent:'<rect x="4" y="7" width="16" height="14" rx="3"/><path d="M12 3v4M8 12h.1M16 12h.1M8 17h8"/>',read:'<path d="M4 3h12l4 4v14H4Z M8 11h8M8 15h6"/>',edit:'<path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5"/>',command:'<path d="m4 6 6 6-6 6m9 0h7"/>',tool:'<path d="M14 5a6 6 0 0 0-7 8L2 18l4 4 5-5a6 6 0 0 0 8-7l-4 4-5-5Z"/>',check:'<path d="m4 12 5 5L20 6"/>',thinking:'<path d="M9 18h6m-5 3h4M8 15a7 7 0 1 1 8 0l-1 3H9Z"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'})[name]||''}</svg>`;

export function workspaceShellHTML(snapshot){
  return `<div class="pack-shell unified-shell"><header class="pack-topbar"><div class="pack-brand"><span class="brand-mark heloscrum-mark"><img src="/brand/heloscrum-icon.svg" alt="" width="34" height="34"></span><strong class="heloscrum-wordmark">HeloScrum</strong><button type="button" data-action="project" class="shell-project" title="Switch projects and manage sessions · ⌘⇧P" aria-label="Projects and sessions"><span class="project-label">${esc(snapshot.project.name)}</span>${libraryIcon('chevron-down',16)}</button></div><div class="pack-top-actions"><button type="button" id="connection-refresh" class="connection-refresh" data-action="refresh" aria-label="Refresh workspace" title="Refresh workspace · Keeps open drafts" data-phase="connecting"><i class="connection-dot" aria-hidden="true"></i>${glyph('refresh')}<span class="connection-label">Refresh</span></button><button type="button" data-action="project-settings" aria-label="Project settings" title="Project settings">${libraryIcon('settings-2',18)}<span>Settings</span></button><button type="button" data-pack="contacts">Contacts <span id="contact-count"></span></button><button type="button" data-pack="toolbox">Toolbox <span id="tool-count"></span></button><button type="button" data-pack="memory">Memory</button><button type="button" data-pack="history">History</button><button type="button" data-pack="notifications">Activity <span id="notification-count"></span></button><button type="button" data-tour-start aria-label="Take a tour">${libraryIcon('book-open',18)}Tour</button><button type="button" data-action="commands" aria-label="Quick actions" title="Quick actions · ⌘K">⌘ K</button></div></header>
  <nav class="workspace-tabs" aria-label="Workspace" role="tablist">${[['agents','Agents'],['tasks','Tasks'],['conversations','Conversations'],['changes','Changes']].map(([id,name])=>`<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" data-shell="tab" data-tab="${id}">${id==='tasks'?libraryIcon('clipboard-list',18):glyph(id)}${name}${id==='tasks'?'<span class="tab-count" id="work-count">0</span>':''}${id==='changes'?'<span class="tab-count" id="changes-count">0</span>':''}</button>`).join('')}<button type="button" class="review-attention" data-shell="needs-review" id="review-attention"></button></nav>
  <section id="connection-banner" class="connection-banner" aria-label="Workspace connection" hidden>${glyph('disconnected')}<div role="status"><strong></strong><p></p></div><button type="button" data-action="refresh">Reconnect now</button></section><main class="unified-main" id="main"><div class="workspace-heading"><div><span class="eyebrow">CONNECTED WORKSPACE</span><h1 id="workspace-title">Your team</h1></div><div class="workspace-view-controls"><div class="layout-switch" role="group" aria-label="Agent layout">${agentLayouts.map(id=>`<button type="button" data-shell="layout" data-layout="${id}" title="${({grid:'Original four-agent grid',focus:'One selected agent',split:'Two selected agents',overview:'Compact summaries for every agent'})[id]}">${glyph(id)}<span>${id[0].toUpperCase()+id.slice(1)}</span></button>`).join('')}</div><button type="button" class="primary" data-pack="new">+ Add agent</button></div></div>
  <div class="agent-switcher" aria-label="Select an agent" id="agent-switcher"></div>
  <div class="workspace-context"><div id="workspace-context"></div><div class="context-actions"><div class="chat-theme-switch" role="group" aria-label="Chat theme"><span>Chat theme</span>${chatThemes.map(theme=>`<button type="button" data-shell="theme" data-theme="${theme}" aria-pressed="false">${theme[0].toUpperCase()+theme.slice(1)}</button>`).join('')}</div><button type="button" data-shell="assign-work">${libraryIcon('clipboard-list',16)} Assign task</button><button type="button" data-shell="details">${glyph('focus')} Task details</button></div></div>
  <section role="tabpanel" id="panel-agents" aria-labelledby="tab-agents"><div class="agent-view-toolbar"><label class="compare-control" hidden>Compare with <select aria-label="Second agent in Split" id="compare-agent"></select></label></div><div class="overview-grid" id="agent-overview" hidden></div><div class="pack-grid" id="pack-grid"></div></section>
  <section role="tabpanel" id="panel-conversations" aria-labelledby="tab-conversations" hidden></section>
  <section role="tabpanel" id="panel-tasks" aria-labelledby="tab-tasks" hidden></section>
  <section role="tabpanel" id="panel-changes" aria-labelledby="tab-changes" hidden></section>
  </main><footer class="pack-footer"><span id="pack-health"></span><div id="shell-connections"></div></footer><aside class="pack-drawer" id="pack-drawer" aria-label="Workspace details" hidden></aside></div>`;
}

export class WorkspaceShell {
  constructor(board){
    this.board=board;this.root=board.root;this.storageKey='heloscrum.workspace:'+board.snapshot.project.path;
    let saved;try{saved=JSON.parse(localStorage.getItem(this.storageKey)||'{}');}catch{}
    this.prefs=workspacePreferences(saved,matchMedia('(max-width:1200px)').matches);
    const tasks=board.snapshot.tasks;
    if(!tasks.some(t=>t.id===this.prefs.selected))this.prefs.selected=tasks.find(t=>t.worktreeId===board.options.selectedWorktree)?.id||tasks[0]?.id||null;
    this.selectedWorktree=tasks.find(t=>t.id===this.prefs.selected)?.worktreeId||board.options.selectedWorktree||board.snapshot.worktrees[0]?.id;
    this.click=e=>this.onClick(e).catch(error=>board.options.toast(error));
    this.change=e=>{if(e.target.id==='compare-agent'){this.prefs.compare=e.target.value;this.update();}if(e.target.id==='changes-worktree')this.chooseWorktree(e.target.value);};
    this.key=e=>{const tab=e.target.closest('[role=tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...this.root.querySelectorAll('[role=tab]')],i=tabs.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;this.setTab(tabs[next].dataset.tab);tabs[next].focus();};
    this.root.addEventListener('click',this.click);this.root.addEventListener('change',this.change);this.root.addEventListener('keydown',this.key);
  }
  persist(){localStorage.setItem(this.storageKey,JSON.stringify(this.prefs));}
  selectedTask(){return this.board.snapshot.tasks.find(t=>t.id===this.prefs.selected);}
  setTab(tab){
    if(!['agents','tasks','conversations','changes'].includes(tab))return;
    if(tab==='agents'&&!this.selectedTask()&&this.board.snapshot.tasks.length)this.choose(this.board.snapshot.tasks[0].id);
    for(const slot of this.board.slots)if(slot.expanded)this.board.setExpanded(slot,false);
    this.prefs.tab=tab;this.update();this.board.options.onTab?.(tab);
    if(tab==='conversations')this.board.mountConversations();
    if(tab==='agents')this.board.slots.forEach(s=>{this.board.resizeComposer(s);this.board.renderHistory(s);});
  }
  chooseWorktree(id){
    this.selectedWorktree=id;this.prefs.selected=this.board.snapshot.tasks.find(t=>t.worktreeId===id)?.id||null;
    this.board.options.onSelect?.(id);this.update();
  }
  choose(id){const task=this.board.snapshot.tasks.find(t=>t.id===id);if(!task)return;this.chooseWorktree(task.worktreeId);}
  async onClick(event){
    const button=event.target.closest('[data-shell]');if(!button)return;
    const action=button.dataset.shell;
    if(action==='assign-work'){const id=this.selectedTask()?.id;this.setTab('tasks');this.board.mountWork();this.board.workView.compose(id);}
    if(action==='tab')this.setTab(button.dataset.tab);
    if(action==='select'){
      const fromConversations=this.prefs.tab==='conversations';
      if(fromConversations)this.prefs.layout='focus';
      this.choose(button.dataset.agent);
      if(fromConversations)this.setTab('agents');
    }
    if(action==='layout'){this.prefs.layout=button.dataset.layout;this.update();}
    if(action==='theme'){
      this.prefs.theme=button.dataset.theme;
      for(const slot of this.board.slots){slot.chatKey=null;this.board.renderHistory(slot);}
      this.update();
    }
    if(action==='focus'){this.choose(button.dataset.agent);this.prefs.layout='focus';this.setTab('agents');}
    if(action==='agent-changes'){this.choose(button.dataset.agent);this.setTab('changes');}
    if(action==='details'){this.board.closeDrawer();this.board.drawer='details';this.board.drawerHTML=null;this.board.renderDrawer();this.board.options.onDetails?.();}
    if(action==='needs-review'){
      const task=this.board.snapshot.tasks.find(t=>['blocked','setup-error'].includes(t.status));
      if(task){this.choose(task.id);this.prefs.layout='focus';this.setTab('agents');}
      else if(this.board.snapshot.work?.review){this.setTab('tasks');await this.board.workView.openReview();}
      else{this.board.drawer='notifications';this.board.renderDrawer();}
    }
  }
  update(){
    const {board,prefs}=this,s=board.snapshot,tasks=s.tasks;
    if(!s.worktrees.some(w=>w.id===this.selectedWorktree))this.selectedWorktree=tasks[0]?.worktreeId||s.worktrees[0]?.id;
    prefs.selected=tasks.find(t=>t.worktreeId===this.selectedWorktree)?.id||null;
    if(!tasks.some(t=>t.id===prefs.compare)||prefs.compare===prefs.selected)prefs.compare=tasks.find(t=>t.id!==prefs.selected)?.id||null;
    const selected=this.selectedTask(),selectedId=prefs.selected||tasks[0]?.id;
    const ensure=id=>{let slot=board.slots.find(s=>s.taskId===id);if(!slot&&id){slot=board.slots.find(s=>!s.taskId)||board.slots.find(s=>![selectedId,prefs.compare].includes(s.taskId))||board.slots.at(-1);board.assignSlot(slot,id);}return slot;};
    if(prefs.layout!=='grid')ensure(selectedId);
    if(prefs.layout==='split')ensure(prefs.compare);
    this.root.querySelectorAll('[role=tab]').forEach(b=>{const active=b.dataset.tab===prefs.tab;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
    for(const tab of ['agents','tasks','conversations','changes'])this.root.querySelector('#panel-'+tab).hidden=prefs.tab!==tab;
    this.root.querySelector('.layout-switch').hidden=prefs.tab!=='agents';
    this.root.querySelector('#agent-switcher').hidden=prefs.tab==='tasks';this.root.querySelector('.workspace-context').hidden=prefs.tab==='tasks';
    this.root.querySelector('[data-pack=new]').hidden=prefs.tab==='tasks';
    this.root.querySelectorAll('[data-shell=layout]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===prefs.layout)));
    this.root.querySelectorAll('[data-shell=theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===prefs.theme)));
    this.root.querySelector('#panel-conversations').classList.toggle('block-conversations',prefs.theme==='block');
    board.setText('#workspace-title',prefs.tab==='tasks'?'Project tasks':prefs.tab==='changes'?'Changes':prefs.tab==='conversations'?'Conversations':({grid:'Your team, working together.',focus:selected?.role||selected?.title||'Your team',split:'Side by side',overview:'Team overview'})[prefs.layout]);
    const attention=tasks.filter(t=>['blocked','setup-error'].includes(t.status)).length+(s.collaboration?.userRequests||[]).filter(q=>q.status==='pending').length+(s.work?.review||0);
    board.setText('#work-count',s.work?.active||0);
    board.setText('#review-attention','Needs Review · '+attention);this.root.querySelector('#review-attention').classList.toggle('has-attention',attention>0);
    const tree=s.worktrees.find(w=>w.id===this.selectedWorktree);board.setText('#changes-count',tree?.files.length||0);
    const roster=tasks.map((task,i)=>`<button type="button" data-shell="select" data-agent="${esc(task.id)}" aria-pressed="${task.id===prefs.selected}" class="agent-switcher-item" ${agentAttributes(task)}>${agentAvatar(task)}<span><strong>${esc(task.role||task.title)}</strong><small class="roster-status status-${esc(task.status)}"><i aria-hidden="true"></i>${esc(statusLabel(task.status))}${task.status==='working'?workingEllipsis:''}</small></span>${task.status==='working'?'<span class="working-indicator" aria-label="Working"></span>':''}</button>`).join('')||'<p class="muted">Add an agent to begin. Your project changes remain available.</p>';
    this.patch('#agent-switcher',roster);
    this.patch('#workspace-context',`${glyph('changes')}<span>${esc(s.project.name)}</span><span class="context-divider">/</span><strong>${selected?agentLabel(selected):'Project working copy'}</strong><span class="context-divider">/</span><span title="${esc(selected?.title||tree?.branch)}">${esc(selected?.title||tree?.branch||'No repository')}</span>`);
    const compare=this.root.querySelector('#compare-agent'),compareHTML=tasks.filter(t=>t.id!==selectedId).map(t=>`<option value="${esc(t.id)}">${esc(t.role||t.title)}</option>`).join('');
    if(compare._optionsHTML!==compareHTML){compare.innerHTML='<button type="button" class="select-value"><selectedcontent></selectedcontent></button>'+compareHTML;compare._optionsHTML=compareHTML;}compare.value=prefs.compare||'';
    compare.closest('label').hidden=prefs.layout!=='split';
    this.root.querySelector('.agent-view-toolbar').hidden=prefs.layout!=='split';
    this.root.querySelector('.chat-theme-switch').hidden=!['agents','conversations'].includes(prefs.tab);
    const grid=this.root.querySelector('#pack-grid');grid.dataset.layout=prefs.layout;grid.hidden=prefs.layout==='overview';
    for(const slot of board.slots){const visible=prefs.layout==='grid'||prefs.layout==='focus'&&slot.taskId===selectedId||prefs.layout==='split'&&[selectedId,prefs.compare].includes(slot.taskId);slot.host.hidden=!visible;slot.host.classList.toggle('selected-agent',slot.taskId===prefs.selected);if(visible&&prefs.tab==='agents'){board.resizeComposer(slot);board.updateChatJump(slot);}}
    this.root.querySelector('#agent-overview').hidden=prefs.layout!=='overview';this.updateOverview();
    this.patch('#shell-connections',`<span class="engine-health ${s.health.herdr.connected?'connected':''}"><i></i>${s.health.herdr.connected?'Agents connected':'Agents offline'}</span>${!s.health.herdr.connected?'<button type="button" data-action="start-engine">Start engine</button>':''}<span>Docker ${s.health.docker.connected?'connected':'unavailable'}</span>`);
    this.refreshPanels();this.persist();
    if(prefs.tab==='conversations')board.mountConversations();
    if(prefs.tab==='tasks')board.mountWork();
  }
  patch(selector,html){
    const host=this.root.querySelector(selector);if(!host||host._html===html)return;
    const focused=host.contains(document.activeElement)?document.activeElement:null,identity=focused?{...focused.dataset}:null;
    const positions=[host,...host.querySelectorAll('[data-scroll]')].map(e=>[e.dataset.scroll||'root',e.scrollTop,e.scrollLeft]);
    const open=[...host.querySelectorAll('details[open]')].map(d=>d.dataset.details);
    host._html=html;host.innerHTML=html;
    for(const [id,top,left] of positions){const el=id==='root'?host:[...host.querySelectorAll('[data-scroll]')].find(e=>e.dataset.scroll===id);if(el){el.scrollTop=top;el.scrollLeft=left;}}
    host.querySelectorAll('details[data-details]').forEach(d=>d.open=open.includes(d.dataset.details));
    if(identity&&Object.keys(identity).length)[...host.querySelectorAll('button,select,input')].find(e=>Object.entries(identity).every(([k,v])=>e.dataset[k]===v))?.focus({preventScroll:true});
  }
  refreshPanels(){
    if(this.prefs.tab==='changes')this.patch('#panel-changes',this.board.options.renderChanges?.()||'');
    if(this.board.drawer==='details')this.board.renderDrawer();
  }
  updateOverview(){
    if(this.prefs.layout!=='overview')return;
    this.patch('#agent-overview',this.board.snapshot.tasks.map((task,i)=>{
      const slot=this.board.slots.find(s=>s.taskId===task.id),events=slot?.transcript?.events||[],last=events.findLast(e=>e.type==='message'&&e.role==='assistant'),activity=turnActivity(events);
      return `<article class="overview-card" ${agentAttributes(task)}><header>${agentAvatar(task)}<div><h2>${esc(task.role||task.title)}</h2><small>${esc(providerName(task.kind))}</small></div><span class="roster-status status-${esc(task.status)}"><i aria-hidden="true"></i>${esc(statusLabel(task.status))}${task.status==='working'?workingEllipsis:''}</span></header><h3>${esc(task.title)}</h3><p>${esc(task.agentState?.reason||last?.text?.slice(0,240)||task.summary||'No update reported yet.')}</p>${activity.total?`<div class="overview-activity">${activity.completed}/${activity.total} tool calls completed${activity.failed?' · '+activity.failed+' failed':''}</div>`:''}<footer><button type="button" data-shell="focus" data-agent="${esc(task.id)}">Open chat →</button><button type="button" data-shell="agent-changes" data-agent="${esc(task.id)}">${task.changes||0} changed files</button></footer></article>`;
    }).join('')||'<div class="drawer-empty">Your agents will appear here.</div>');
  }
  dispose(){this.root.removeEventListener('click',this.click);this.root.removeEventListener('change',this.change);this.root.removeEventListener('keydown',this.key);}
}
