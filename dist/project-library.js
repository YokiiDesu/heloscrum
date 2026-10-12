import {loadingState,loadFailure} from './loading-state.js';
import {libraryIcon,agentAttributes,agentAvatar} from '/agent-appearance.js';
import {providerName} from '/providers.js';
import {statusLabel} from '/workspace-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,extra='')=>`<button type="button" data-library="${action}" ${extra}>${label}</button>`;
const external=(url,label)=>`<a class="library-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ${libraryIcon('external-link',14)}</a>`;
export class ProjectLibraryDialog {
  constructor(trigger,{api,onOpen,onChange,onSettings}){
    Object.assign(this,{trigger,api,onOpen,onChange,onSettings});this.filter='active';this.tab='sessions';this.query='';this.generation=0;
    this.host=document.createElement('dialog');this.host.className='project-library-dialog';this.host.setAttribute('aria-label','Projects and sessions');document.body.append(this.host);
    this.host.innerHTML=`<header class="library-header"><div>${libraryIcon('folder',22)}<h2>Projects</h2><kbd>⌘⇧P</kbd></div>${button('close','×','aria-label="Close Projects"')}</header><div class="library-layout"><aside class="library-sidebar"><input type="search" aria-label="Find a project or session" placeholder="Jump to a project or session…"><div class="library-projects">${loadingState('Loading projects',{variant:'compact'})}</div><footer>${button('local',libraryIcon('folder')+' Open Local Folder')}${button('clone',libraryIcon('git-branch')+' Clone Repository')}</footer></aside><section class="library-main" aria-label="Selected project"><p class="library-empty">Your work, ready to continue.</p></section></div><p class="library-feedback" role="status"></p>`;
    this.host.addEventListener('click',event=>{const target=event.target.closest('[data-library]');if(target)this.action(target).catch(e=>this.error(e));});
    this.host.addEventListener('input',event=>{if(event.target.type==='search'){this.query=event.target.value;this.renderProjects();this.renderMain();}if(event.target.name==='path'){this.needsGitPath=null;this.host.querySelector('.library-git-setup')?.setAttribute('hidden','');const submit=this.host.querySelector('[data-library-form="local"] button[type="submit"]');if(submit)submit.textContent='Open Project';this.error(null);}});
    this.host.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();this.submit(event.target).catch(e=>this.error(e));});
    this.host.addEventListener('cancel',event=>{event.preventDefault();if(!this.busy)this.close();});
    this.host.addEventListener('change',event=>{if(event.target.name==='request-worktree'){this.requestTree=event.target.value;this.preparedRequest=null;this.pushReview=null;this.renderMain();}});
    this.host.showModal();this.refresh().catch(e=>this.error(e));
  }
  error(error){if(this.closed)return;const pending=this.host.querySelector('[data-loading-state]');if(error instanceof Error&&pending){pending.outerHTML=loadFailure('Project details couldn’t load',{detail:error.message,retry:`data-library="${this.data?'refresh-repository':'retry-load'}"`});return;}this.host.querySelector('.library-feedback').textContent=error?.message||'';}
  async refresh(){const result=await this.api('projects');if(this.closed)return;this.data=result;if(!result.projects.some(p=>p.id===this.selected))this.selected=result.current;this.renderProjects();this.renderMain();}
  project(){return this.data?.projects.find(p=>p.id===this.selected);}
  matches(session){return [session.title,session.role,session.branch].join(' ').toLocaleLowerCase().includes(this.query.trim().toLocaleLowerCase());}
  renderProjects(){
    const query=this.query.trim().toLocaleLowerCase();
    this.host.querySelector('.library-projects').innerHTML=(this.data?.projects||[]).filter(p=>[p.name,p.path].join(' ').toLocaleLowerCase().includes(query)||p.sessions.some(s=>this.matches(s))).map(p=>{
      const active=p.sessions.filter(s=>s.state==='active'),working=active.filter(s=>s.status==='working').length,needs=active.filter(s=>['blocked','setup-error'].includes(s.status)).length;
      return `<button type="button" class="library-project" data-library="select" data-project="${esc(p.id)}" aria-pressed="${p.id===this.selected}" title="${esc(p.path)}"><span class="library-project-mark">${libraryIcon(p.pinned?'pin':'folder',20)}</span><span><strong>${esc(p.name)}</strong><small>${active.length} session${active.length===1?'':'s'}${working?' · '+working+' working':needs?' · '+needs+' need review':''}</small></span>${p.id===this.data.current?'<i title="Open project"></i>':''}</button>`;
    }).join('')||'<p class="library-empty">No matching projects or sessions.</p>';
  }
  renderMain(){
    if(this.form)return;const p=this.project();if(!p)return;
    const counts=Object.fromEntries(['active','archived','trash'].map(key=>[key,p.sessions.filter(s=>s.state===key).length]));
    this.host.querySelector('.library-main').innerHTML=`<div class="library-project-heading"><div><span class="eyebrow">${p.id===this.data.current?'CURRENT PROJECT':'PICK UP WHERE YOU LEFT OFF'}</span><h3>${esc(p.name)}</h3><p title="${esc(p.path)}">${esc(p.path)}</p></div>${button('pin',libraryIcon('pin',17),`aria-label="${p.pinned?'Unpin':'Pin'} ${esc(p.name)}" aria-pressed="${p.pinned}"`)}</div><div class="library-project-actions">${button('open','Open project','class="primary"')}${button('settings',libraryIcon('settings-2',16)+' Settings')}${button('tab-sessions','Sessions',`aria-pressed="${this.tab==='sessions'}"`)}${button('tab-repository',libraryIcon('git-pull-request',16)+' Repository & PRs',`aria-pressed="${this.tab==='repository'}"`)}</div>${this.tab==='sessions'?`<div class="session-filters" role="group" aria-label="Session state">${[['active','Active'],['archived','Archived'],['trash','Trash']].map(([id,label])=>button('filter',`${label} <span>${counts[id]}</span>`,`data-filter="${id}" aria-pressed="${this.filter===id}"`)).join('')}</div><p class="library-note">${this.filter==='active'?'Open a session to return to its conversation and branch.':this.filter==='archived'?'Archived sessions retain their history and files. Restore one to continue.':'Deleted sessions stay in Trash. Restore recovers their history, branch, and files.'}</p><div class="library-sessions">${p.sessions.filter(s=>s.state===this.filter&&([p.name,p.path].join(' ').toLocaleLowerCase().includes(this.query.toLocaleLowerCase())||this.matches(s))).map(s=>this.sessionHTML(s)).join('')||'<div class="library-empty">No sessions here.</div>'}</div>`:this.repositoryHTML()}`;
  }
  sessionHTML(s){
    return `<article class="library-session" ${agentAttributes(s)}>${agentAvatar(s)}<div class="session-description"><h4>${esc(s.role)}</h4><p>${esc(s.title)}</p><small>${esc(providerName(s.kind))} · ${esc(s.branch)}</small>${s.summary?`<p class="session-summary">${esc(s.summary)}</p>`:''}<time>${esc(s.createdAt?new Date(s.createdAt).toLocaleDateString():'')}</time></div><div class="session-actions"><span class="roster-status status-${esc(s.status)}"><i></i>${esc(statusLabel(s.status))}</span>${s.state==='active'?`${button('session-open','Open session →',`data-session="${esc(s.id)}"`)}${s.canResume?button('resume','Resume saved session',`data-session="${esc(s.id)}"`):''}${button('archive',libraryIcon('archive',14)+' Archive',`data-session="${esc(s.id)}" ${['working','blocked','starting'].includes(s.status)?'disabled title="Finish or interrupt this session first"':''}`)}`:button('restore',libraryIcon('rotate-ccw',14)+' Restore',`data-session="${esc(s.id)}"`)}${s.state!=='trash'?button('trash',libraryIcon('trash-2',14),'data-session="'+esc(s.id)+'" aria-label="Move '+esc(s.role)+' to Trash" '+(['working','blocked','starting'].includes(s.status)?'disabled':'')):''}</div></article>`;
  }
  repositoryHTML(){
    const r=this.repository;if(!r)return loadingState('Loading repository',{detail:'Reading branches and review requests.'});
    const identity=r.identity,tree=r.worktrees.find(w=>w.id===this.requestTree)||r.worktrees[0];this.requestTree=tree?.id;
    return `<div class="repository-panel"><div class="repository-connection"><strong>${identity?esc(identity.host+' / '+identity.repository):'Local Git repository'}</strong><p>${r.remoteName?esc(r.remoteName+' · '+r.remote):'No remote connected yet'}</p>${identity?external(identity.web,'Open repository'):''}${button('connect',libraryIcon('plus',14)+' Add remote')}</div>${r.remotes.length?`<form data-library-form="configure" class="repository-config"><label>Remote<select name="remote">${r.remotes.map(name=>`<option ${name===r.remoteName?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label>Hosting<select name="hosting">${[['auto','Detect host'],['github','GitHub / Enterprise'],['gitlab','GitLab / self-hosted'],['git','Git server']].map(([id,label])=>`<option value="${id}" ${id===this.project().hosting?'selected':''}>${label}</option>`).join('')}</select></label><button type="submit">Apply</button></form>`:''}<div class="requests-heading"><h4>${identity?.provider==='gitlab'?'Merge requests':'Pull requests'}</h4>${identity?.requestsUrl?external(identity.requestsUrl,'View all'):''}${button('refresh-repository','Refresh')}</div>${r.notice?`<p class="repository-notice">${esc(r.notice)}</p>`:''}<div class="repository-requests">${r.requests.map(pr=>`<a href="${esc(pr.url)}" target="_blank" rel="noopener noreferrer">${libraryIcon('git-pull-request')}<span><strong>#${pr.number} ${esc(pr.title)}</strong><small>${pr.draft?'Draft · ':''}${esc(pr.branch)} → ${esc(pr.base)}</small></span>${libraryIcon('external-link',14)}</a>`).join('')||(!r.notice?'<p class="library-empty">No open requests.</p>':'')}</div>${r.remoteName&&tree?`<section class="new-request"><label>Branch / workspace<select name="request-worktree">${r.worktrees.map(w=>`<option value="${w.id}" ${w.id===tree.id?'selected':''}>${esc(w.branch)}</option>`).join('')}</select></label><div>${button('publish','Publish branch…')}${identity?.requestsUrl?button('prepare-request','Prepare '+(identity.provider==='gitlab'?'MR':'PR')):''}</div>${this.pushReview?`<div class="publish-review"><strong>Publish ${esc(this.pushReview.branch)}</strong><p>Commit <code>${esc(this.pushReview.head.slice(0,10))}</code> → ${esc(this.pushReview.remote)}</p><p>Pushes committed changes. Existing remote history is preserved.</p>${button('confirm-publish','Push this branch','class="primary"')}${button('cancel-publish','Cancel')}</div>`:''}${this.preparedRequest?external(this.preparedRequest.url,'Continue on '+(identity.provider==='gitlab'?'GitLab':'GitHub')):''}<small>PR creation finishes on your Git host, where you can review the title, description, and target branch.</small></section>`:''}</div>`;
  }
  showForm(kind){
    if(kind==='local'){this.showLocalForm();return;}
    this.form=kind;const p=this.project();
    this.host.querySelector('.library-main').innerHTML=`<div class="library-form"><h3>${({local:'Open a local project',clone:'Clone a repository',connect:'Connect a Git remote'})[kind]}</h3><p>${kind==='local'?'Open an existing Git folder. It will appear in your project list.':'Private repositories use your existing Git credentials or SSH agent. Sign in locally before connecting.'}</p><form data-library-form="${kind}">${kind==='local'?'<label>Repository folder<input name="path" placeholder="/path/to/my-app" required autofocus></label>':`<label>Repository URL<input name="remote" placeholder="git@github.com:owner/repository.git" required></label>${kind==='clone'?'<label>New local folder<input name="destination" placeholder="/path/to/my-app" required></label>':'<label>Remote name<input name="name" value="origin" required></label><label>Hosting<select name="hosting"><option value="auto">Detect host</option><option value="github">GitHub / Enterprise</option><option value="gitlab">GitLab / self-hosted</option><option value="git">Git server</option></select></label>'}`}${kind==='clone'?'<p>The destination must be a new folder inside an existing directory.</p>':''}<div>${button('cancel-form','Back')}<button type="submit" class="primary">${kind==='local'?'Open project':kind==='clone'?'Clone & open':'Connect remote'}</button></div></form>${kind!=='local'?'<p class="library-note">No passwords or tokens are stored in HeloScrum.</p>':''}</div>`;
  }
  showLocalForm(value='',needsGit=false){
    this.form='local';this.needsGitPath=needsGit?value.trim():null;
    const picker=typeof window.heloscrumDesktop?.chooseProjectFolder==='function';
    this.host.querySelector('.library-main').innerHTML=`<div class="library-form"><h3>Open Local Folder</h3><p>Choose a project folder. If it doesn't use Git yet, we'll help you set it up.</p><form data-library-form="local"><label>Project Folder<span class="library-folder-field"><input name="path" value="${esc(value)}" placeholder="/path/to/my-app" required autocomplete="off" spellcheck="false">${picker?button('browse',libraryIcon('folder',16)+' Browse…'):''}</span></label>${picker?'':'<p class="library-note">Enter the full folder path on the computer running HeloScrum. The desktop app also includes a system folder chooser.</p>'}<section class="library-git-setup" ${needsGit?'':'hidden'} role="status"><h4>Set Up Git In This Folder</h4><p>HeloScrum uses Git to keep each agent's changes separate. We'll create a local repository and an empty starting commit. Your existing files will stay unchanged and untracked. Nothing will be uploaded.</p></section><div>${button('cancel-form','Back')}<button type="submit" class="primary">${needsGit?'Initialize Git & Open':'Open Project'}</button></div></form></div>`;
  }
  async browse(){
    const picker=window.heloscrumDesktop?.chooseProjectFolder;if(!picker)return;
    let selected;
    await this.working('Choose a folder in the system dialog…',async()=>{selected=await picker();});
    if(this.closed||!selected)return;
    this.showLocalForm(selected);await this.submit(this.host.querySelector('[data-library-form="local"]'));
  }
  async loadRepository(){const selected=this.selected,generation=++this.generation;this.repository=null;this.renderMain();const data=await this.api('project-repository?project='+encodeURIComponent(selected));if(this.closed||this.selected!==selected||generation!==this.generation)return;this.repository=data;this.renderMain();}
  async working(label,fn){if(this.busy)return;this.busy=true;this.host.setAttribute('aria-busy','true');this.error({message:label});try{await fn();if(!this.closed)this.error(null);}finally{this.busy=false;if(!this.closed)this.host.removeAttribute('aria-busy');}}
  async action(target){
    const action=target.dataset.library;if(action==='retry-load'){this.host.querySelector('.library-projects').innerHTML=loadingState('Loading projects',{variant:'compact'});return this.refresh();}if(action==='close'){if(!this.busy)this.close();return;}if(this.busy)return;this.error(null);
    if(action==='settings'){this.onSettings?.(this.selected);return;}
    if(action==='select'){this.selected=target.dataset.project;this.form=null;this.repository=null;this.preparedRequest=null;this.pushReview=null;this.renderProjects();this.renderMain();if(this.tab==='repository')await this.loadRepository();return;}
    if(action==='filter'){this.filter=target.dataset.filter;this.renderMain();return;}
    if(action==='local'){this.showForm(action);await this.browse();return;}
    if(action==='browse'){await this.browse();return;}
    if(['clone','connect'].includes(action)){this.showForm(action);return;}
    if(action==='cancel-form'){this.form=null;this.renderMain();return;}
    if(action==='tab-sessions'){this.tab='sessions';this.renderMain();return;}
    if(action==='tab-repository'||action==='refresh-repository'){this.tab='repository';await this.loadRepository();return;}
    if(action==='cancel-publish'){this.pushReview=null;this.renderMain();return;}
    const project=this.selected,id=target.dataset.session;
    await this.working(({clone:'Cloning repository…',resume:'Resuming the saved provider session…','confirm-publish':'Publishing branch…'})[action]||'Updating…',async()=>{
      if(action==='open'||action==='session-open'){await this.onOpen(project,id);this.close();}
      if(action==='pin'){await this.api('projects/pin',{project,pinned:!this.project().pinned});await this.refresh();}
      if(['archive','trash','restore'].includes(action)){await this.api('sessions/state',{project,id,state:{archive:'archived',trash:'trash',restore:'active'}[action]});await this.onChange();await this.refresh();}
      if(action==='resume'){await this.api('sessions/resume',{project,id});await this.onOpen(project,id);this.close();}
      if(action==='publish'){this.pushReview=await this.api(`project-push-preview?project=${encodeURIComponent(project)}&worktree=${this.requestTree}`);this.renderMain();}
      if(action==='confirm-publish'){await this.api('projects/push',{project,worktreeId:this.requestTree,expected:this.pushReview});this.pushReview=null;await this.loadRepository();}
      if(action==='prepare-request'){this.preparedRequest=await this.api(`project-request?project=${encodeURIComponent(project)}&worktree=${this.requestTree}`);this.renderMain();}
    });
  }
  async submit(form){
    const kind=form.dataset.libraryForm;if(!kind)return;const data=Object.fromEntries(new FormData(form));
    try{await this.working(kind==='clone'?'Cloning repository… this can take a moment.':'Connecting…',async()=>{
      if(kind==='local'){await this.onOpen(data.path,undefined,{initialize:this.needsGitPath===data.path.trim()});this.close();return;}
      if(kind==='clone'){const result=await this.api('projects/clone',data);await this.onOpen(result.path);this.close();return;}
      if(kind==='connect'||kind==='configure'){await this.api('projects/'+kind,{project:this.selected,...data});this.form=null;await this.refresh();await this.loadRepository();}
    });}catch(error){if(kind==='local'&&error.code==='PROJECT_NEEDS_GIT'){this.error(null);this.showLocalForm(data.path,true);this.host.querySelector('[data-library-form="local"] button[type="submit"]').focus();return;}throw error;}
  }
  close(){if(this.closed)return;this.closed=true;this.host.close();this.host.remove();this.trigger?.focus({preventScroll:true});}
}
