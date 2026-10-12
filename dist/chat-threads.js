import {loadingState,loadFailure} from './loading-state.js';
import {AttachmentComposer,imageGallery,hydrateImages} from './image-attachments.js';
import {workMessage} from './work-message.js';
import {messageContent} from './message-content.js';
import {agentAttributes,agentAvatar,agentLabel} from './agent-appearance.js';
import {activityAt,chatTimestamp,filterChats,groupChats,ProjectVisibility} from './chat-directory.js';
let messageScope=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=chatTimestamp;
const timestamp=value=>`<time datetime="${esc(value||'')}" title="${esc(value?new Date(value).toLocaleString():'No activity yet')}">${esc(time(value))}</time>`;
const lucide=(name)=>`<svg class="lucide lucide-${name}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name==='message-square-reply'?'<path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="m10 8-3 3 3 3"/><path d="M7 11h6a2 2 0 0 1 2 2v1"/>':'<path d="M16 12H3"/><path d="M16 6H3"/><path d="M10 18H3"/><path d="M21 6v10a2 2 0 0 1-2 2h-5"/><path d="m16 16-2 2 2 2"/>'}</svg>`;

// Resolve both canonical message IDs and recipient-specific delivery IDs.
// Replies whose parent is not loaded remain visible until older history arrives.
export function replyThreads(messages){
  const aliases=new Map(),order=new Map(messages.map((m,i)=>[m.id,i]));
  for(const message of messages){aliases.set(message.id,message);for(const delivery of message.deliveries||[])aliases.set(delivery.id,message);}
  const rootById=new Map(),replies=new Map();
  for(const message of messages){
    let current=message;const visited=[];
    while(current){
      if(rootById.has(current.id)){current=aliases.get(rootById.get(current.id));break;}
      const cycle=visited.indexOf(current);
      if(cycle>=0){current=visited.slice(cycle).sort((a,b)=>order.get(a.id)-order.get(b.id))[0];break;}
      visited.push(current);const parent=aliases.get(current.replyTo);
      if(!parent)break;current=parent;
    }
    for(const item of visited)rootById.set(item.id,current.id);
  }
  for(const message of messages){const root=rootById.get(message.id);if(root!==message.id){if(!replies.has(root))replies.set(root,[]);replies.get(root).push(message);}}
  return {roots:messages.filter(m=>rootById.get(m.id)===m.id),replies,rootById,aliases};
}

// The question index includes unanswered items outside the current history page.
// Keep those actionable without fetching or caching the entire transcript.
export function conversationMessages(thread){
  const loaded=new Set(thread.messages.map(message=>message.id)),earlier=(thread.userRequests||[]).filter(question=>question.status==='pending'&&!loaded.has(question.id)).map(question=>({id:question.id,from:question.from,fromRole:question.fromRole,text:question.question,at:question.at,humanRequestId:question.id,kind:'request',requiresReply:true,earlierQuestion:true,deliveries:[{id:question.id,to:'human',toRole:'You',status:'awaiting-user'}]}));
  return [...earlier,...thread.messages].sort((a,b)=>a.at.localeCompare(b.at));
}

export class ChatThreads {
  constructor(host,{savedState,api,markdown,enhanceMarkdown=()=>{},onClose,onWork,contacts=[],project={path:'',name:'Current project'}}) {
    Object.assign(this,{host,api,markdown,enhanceMarkdown,onClose,onWork,contacts,project});this.imageDrafts=new Map(savedState?.imageDrafts||[]);this.imageObserver=new MutationObserver(()=>this.mountAttachments());this.imageObserver.observe(host,{childList:true,subtree:true});this.messageScope=++messageScope;this.projectFilter='all';this.dateFilter='all';this.statusFilter='all';this.sort='newest';this.projects=[];this.drafts=new Map(savedState?.drafts||[]);this.answerDrafts=new Map(savedState?.answerDrafts||[]);this.reopenReasons=new Map(savedState?.reopenReasons||[]);this.selected=savedState?.selected;this.filter='all';this.threads=[];this.pages=new Map();this.selectionVersion=0;this.loadVersion=0;
    let savedVisibility={};try{savedVisibility=JSON.parse(localStorage.getItem('heloscrum.chat-projects')||'{}');}catch{}this.projectVisibility=new ProjectVisibility(savedVisibility||{});
    host.hidden=false;host.classList.add('threads-drawer');host.classList.toggle('thread-selected',!!this.selected);
    host.innerHTML=`<div class="drawer-heading"><h2>Conversations</h2><div class="drawer-heading-actions"><button type="button" data-thread-action="new" class="small-button">+ New group</button><button type="button" data-thread-action="close" aria-label="Close chat threads">×</button></div></div>
      <div class="threads-layout"><section class="thread-sidebar" aria-label="Agent conversations"><div class="thread-filters" aria-label="Conversation type">${[['all','All'],['dm','DMs'],['group','Groups']].map(([key,label])=>`<button type="button" data-thread-filter="${key}" aria-pressed="${key==='all'}">${label}</button>`).join('')}</div><input type="search" class="thread-search" aria-label="Find a chat thread" placeholder="Find an agent or group…"><div class="thread-list-controls"><button type="button" data-thread-action="filters" class="thread-filter-toggle" aria-expanded="false" aria-controls="chat-filter-panel"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg> Filters <span class="thread-filter-count" hidden></span></button><label class="thread-sort-label"><span class="sr-only">Sort chats</span><select aria-label="Sort chats" data-chat-setting="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="project-asc">Project A–Z</option><option value="project-desc">Project Z–A</option></select></label></div><div id="chat-filter-panel" class="chat-filter-panel" hidden><label>Project<select aria-label="Filter by project" data-chat-setting="projectFilter"><option value="all">All projects</option></select></label><label>Activity date<select aria-label="Filter by date" data-chat-setting="dateFilter"><option value="all">All dates</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">Last 7 days</option></select></label><label>Status<select aria-label="Filter by status" data-chat-setting="statusFilter"><option value="all">Any status</option><option value="open">Open</option><option value="closed">Closed</option></select></label><button type="button" data-thread-action="clear-filters">Clear filters</button></div><form class="group-create" hidden></form><div class="thread-list" aria-label="Chats by project"></div><div class="thread-result-count" role="status" aria-live="polite"></div></section><section class="thread-conversation" aria-label="Selected conversation"><div class="thread-detail-head"></div><div class="thread-messages">${loadingState('Loading conversations',{variant:'chat',detail:'Finding your team’s messages.'})}</div><form class="group-composer" hidden><div class="group-reply-target"></div><textarea name="message" rows="2" maxlength="16000" aria-label="Message the group" placeholder="Message the group as yourself…" required></textarea><div class="group-send-controls"><select name="kind" aria-label="Message type"><option value="request">Request</option><option value="result">Result</option><option value="ack">Acknowledge quietly</option></select><label><input name="requiresReply" type="checkbox" checked> Reply needed</label><button class="primary" type="submit">Send to group</button></div></form></section></div><p class="thread-error" role="status"></p>`;
    this.click=event=>{
      const target=event.target.closest('button');if(!target)return;
      if(target.dataset.openWork){event.stopPropagation();this.onWork?.(target.dataset.openWork,target.dataset.workProject);return;}
      if(target.dataset.projectAction){const id=target.dataset.projectId;this.projectVisibility[target.dataset.projectAction](id);localStorage.setItem('heloscrum.chat-projects',JSON.stringify(this.projectVisibility.snapshot()));this.renderList(true);[...this.host.querySelectorAll('[data-project-action]')].find(b=>b.dataset.projectId===id&&b.dataset.projectAction===(target.dataset.projectAction==='hide'?'reveal':'toggle'))?.focus({preventScroll:true});return;}
      if(target.dataset.threadAction==='filters'){const panel=this.host.querySelector('.chat-filter-panel');panel.hidden=!panel.hidden;target.setAttribute('aria-expanded',String(!panel.hidden));return;}
      if(target.dataset.threadAction==='clear-filters'){this.projectFilter=this.dateFilter=this.statusFilter=this.filter='all';this.host.querySelector('.thread-search').value='';this.host.querySelectorAll('[data-chat-setting]:not([data-chat-setting=sort])').forEach(el=>el.value='all');this.renderList(true);return;}
      if(target.dataset.threadAction==='retry-load'){this.host.querySelector('.thread-messages').innerHTML=loadingState('Loading conversations',{variant:'chat'});return this.selected?this.load(this.selected,true):this.refresh(true);}
      if(target.dataset.threadAction==='new')return this.newGroup();
      if(target.dataset.threadAction==='cancel-new'){this.host.querySelector('.group-create').hidden=true;return;}
      if(target.dataset.threadAction==='status')return this.setStatus().catch(e=>this.error(e));
      if(target.dataset.threadAction==='next-question'){const pending=(this.pages.get(this.selected)?.userRequests||[]).filter(q=>q.status==='pending');if(pending.length){const question=pending[(this.questionCursor||0)%pending.length];this.questionCursor=(this.questionCursor||0)+1;return this.focusMessage(question.id);}return;}
      if(target.dataset.userChoice){const q=this.pages.get(this.selected)?.userRequests?.find(q=>q.id===target.dataset.userChoice);if(q)return this.answerUser(q.id,q.options[Number(target.dataset.choiceIndex)]).catch(e=>this.error(e));}
      if(target.dataset.reply||target.dataset.seeReplies)return this.openReplies(target.dataset.reply||target.dataset.seeReplies,!!target.dataset.reply);
      if(target.dataset.threadAction==='close-replies')return this.closeReplies();
      if(target.dataset.threadAction==='close')return this.onClose();
      if(target.dataset.threadAction==='back'){this.closeReplies(false);this.host.classList.remove('thread-selected');return;}
      if(target.dataset.threadAction==='older')return this.older();
      if(target.dataset.threadFilter){this.filter=target.dataset.threadFilter;this.renderList(true);return;}
      if(target.dataset.threadId)this.select(target.dataset.threadId);
    };
    this.submit=event=>{event.preventDefault();if(event.target.matches('.group-create'))this.createGroup().catch(e=>this.error(e));if(event.target.matches('.group-composer'))this.send().catch(e=>this.error(e));if(event.target.matches('.reply-composer'))this.sendReply().catch(e=>this.error(e));if(event.target.matches('.user-answer-form'))this.answerUser(event.target.dataset.requestId,new FormData(event.target).get('response')).catch(e=>this.error(e));};host.addEventListener('submit',this.submit);
    this.replyDrafts=new Map(savedState?.replyDrafts||[]);
    this.compose=event=>{if(event.target.matches('.group-composer textarea'))this.drafts.set(this.selected,event.target.value);if(event.target.matches('.reply-composer textarea'))this.replyDrafts.set(this.replyDraftKey(),event.target.value);if(event.target.matches('.user-answer-form textarea')){const id=event.target.closest('form').dataset.requestId;this.answerDrafts.set(id,event.target.value);this.host.querySelectorAll('.user-answer-form').forEach(form=>{if(form.dataset.requestId===id)form.querySelector('textarea').value=event.target.value;});}if(event.target.matches('.thread-reopen-reason'))this.reopenReasons.set(this.selected,event.target.value);if(event.target.name==='kind'){const check=event.target.closest('form').querySelector('[name=requiresReply]');check.checked=event.target.value==='request';check.disabled=event.target.value==='ack';}};host.addEventListener('input',this.compose);
    this.keydown=event=>{if(event.key==='Escape'&&this.replyRoot&&this.host.getClientRects().length&&(this.host.contains(document.activeElement)||document.activeElement===document.body)){event.preventDefault();event.stopPropagation();this.closeReplies();}};document.addEventListener('keydown',this.keydown);
    this.setting=event=>{const field=event.target.dataset.chatSetting;if(field){this[field]=event.target.value;this.renderList(true);}};host.addEventListener('change',this.setting);
    this.input=()=>this.renderList(true);host.addEventListener('click',this.click);host.querySelector('.thread-search').addEventListener('input',this.input);this.refresh(true);
  }
  newGroup(){
    this.closeReplies(false);
    this.host.classList.remove('thread-selected');
    const form=this.host.querySelector('.group-create');form.hidden=false;
    form.innerHTML=`<strong>New group in ${esc(this.project.name)}</strong><input name="name" aria-label="Group name" placeholder="Group name" maxlength="100" required><fieldset><legend>Choose at least two agents</legend>${this.contacts.map(c=>`<label><input type="checkbox" name="participants" value="${esc(c.id)}"> ${agentLabel(c)}</label>`).join('')}</fieldset><p>Creating a group does not start agent turns.</p><div><button type="button" data-thread-action="cancel-new">Cancel</button><button type="submit" class="primary">Create group</button></div>`;form.querySelector('[name=name]').focus();
  }
  async createGroup(){
    if(this.creating)return;const form=this.host.querySelector('.group-create'),data=new FormData(form),participants=data.getAll('participants');if(participants.length<2)throw Error('Choose at least two agents');
    const payload={name:data.get('name'),participants,project:this.project.path},key=JSON.stringify(payload);if(this.createRetry?.key!==key)this.createRetry={key,id:crypto.randomUUID()};
    this.creating=true;form.querySelector('[type=submit]').disabled=true;
    try{const group=await this.api('groups',{...payload,requestId:this.createRetry.id});if(this.disposed)return;form.hidden=true;this.createRetry=null;this.acceptDirectory(await this.api('chat-threads?scope=all'));this.filter='group';this.projectFilter='all';this.dateFilter='all';this.statusFilter='all';this.host.querySelector('.thread-search').value='';this.host.querySelectorAll('[data-chat-setting]:not([data-chat-setting=sort])').forEach(el=>el.value='all');await this.select(group.id);}
    finally{this.creating=false;form.querySelector('[type=submit]').disabled=false;}
  }
  async setStatus(){
    const page=this.pages.get(this.selected);if(!page||this.statusChanging)return;
    const status=page.status==='closed'?'open':'closed',reason=status==='open'?this.host.querySelector('.thread-reopen-reason').value.trim():'Closed by the user after the outcome was complete';
    if(!reason)throw Error('Describe the new evidence or requirements before reopening');
    this.statusChanging=page.id;this.host.querySelector('[data-thread-action=status]').disabled=true;
    try{await this.api('chat-status',{threadId:page.id,project:page.project,status,reason});this.reopenReasons.delete(page.id);await this.load(page.id);}
    finally{this.statusChanging=null;if(!this.disposed)this.host.querySelector('[data-thread-action=status]')?.removeAttribute('disabled');}
  }
  async answerUser(requestId,response){
    const page=this.pages.get(this.selected);if(this.answering||!page)return;this.answering=requestId;
    const buttons=this.host.querySelectorAll('.user-answer-choices button,.user-answer-form button');buttons.forEach(b=>b.disabled=true);
    try{await this.api('groups/respond',{requestId,response,project:page.project});this.answerDrafts.delete(requestId);await this.load(page.id);}
    finally{this.answering=null;if(!this.disposed)this.host.querySelectorAll('.user-answer-choices button,.user-answer-form button').forEach(b=>b.disabled=false);}
  }
  mountAttachments(){const form=this.host.querySelector('.group-composer'),page=this.pages.get(this.selected);hydrateImages(this.host);if(!form||!page||page.kind!=='group'||page.status==='closed')return;this.imageDrafts ||= new Map();if(this.attachmentComposer?.host===form&&this.attachmentThread===page.id)return;this.attachmentComposer?.dispose();this.attachmentThread=page.id;this.attachmentComposer=new AttachmentComposer(form,{project:page.project,get:()=>this.imageDrafts.get(page.id)||[],set:a=>this.imageDrafts.set(page.id,a),busy:()=>this.sending,onError:e=>this.error(e)});form.querySelector('textarea').required=false;}
  async send(){
    if(this.sending)return;const page=this.pages.get(this.selected);if(!page||page.kind!=='group'||page.status==='closed')return;
    const form=this.host.querySelector('.group-composer'),data=new FormData(form),draft=String(data.get('message')),message=draft.trim(),attachments=this.imageDrafts?.get(page.id)||[];if(this.attachmentComposer?.pending||(!message&&!attachments.length))return;
    const payload={threadId:page.id,project:page.project,message,attachments:attachments.map(a=>a.id),kind:data.get('kind'),requiresReply:data.get('kind')==='ack'?false:data.has('requiresReply'),...(this.replyTo?{replyTo:this.replyTo}:{})},key=JSON.stringify(payload);
    if(this.sendRetry?.key!==key)this.sendRetry={key,id:crypto.randomUUID()};
    this.sending=true;form.querySelector('[type=submit]').disabled=true;form.querySelector('[type=submit]').textContent='Sending…';this.error(null);
    try{await this.api('groups/message',{...payload,requestId:this.sendRetry.id});this.sendRetry=null;this.imageDrafts?.delete(page.id);this.attachmentComposer?.render();if(this.drafts.get(page.id)===draft)this.drafts.delete(page.id);if(this.disposed)return;if(this.selected===page.id&&form.querySelector('textarea').value===draft){form.querySelector('textarea').value='';this.replyTo=null;form.querySelector('.group-reply-target').textContent='';}await this.load(page.id);}
    finally{this.sending=false;this.attachmentComposer?.render();if(!this.disposed){form.querySelector('[type=submit]').disabled=false;form.querySelector('[type=submit]').textContent='Send to group';}}
  }
  error(error,source='action'){if(this.disposed||!error&&source==='load'&&this.errorSource==='action')return;this.errorSource=error?source:null;const messages=this.host.querySelector('.thread-messages');if(error&&source==='load'&&messages.querySelector('[data-loading-state]')){messages.innerHTML=loadFailure('Conversations couldn’t load',{detail:error.message,retry:'data-thread-action="retry-load"'});return;}this.host.querySelector('.thread-error').textContent=error?.message||'';}
  async refresh(force=false){
    if(this.disposed||this.loading||(!force&&this.api.canPoll?.()===false)||(!force&&Date.now()-(this.refreshedAt||0)<1800))return;
    this.loading=true;this.refreshedAt=Date.now();
    try{
      const result=await this.api('chat-threads?scope=all');if(this.disposed)return;this.acceptDirectory(result);this.renderList();
      if(this.selected)await this.load(this.selected);else if(!this.threads.length)this.empty('No agent conversations yet. DMs and group chats appear here as agents communicate.');
      else this.empty('Choose a conversation to read its messages.');
      this.error(null,'load');
    }catch(error){this.error(error,'load');}finally{this.loading=false;}
  }
  acceptDirectory(result){
    this.threads=result.threads.map(t=>({...t,project:t.project||this.project.path,projectName:t.projectName||this.project.name}));
    this.projects=result.projects||[this.project].map(p=>({id:p.path,name:p.name}));
    const field=this.host.querySelector('[data-chat-setting=projectFilter]'),duplicates=new Set(this.projects.filter((p,i,a)=>a.some((q,j)=>i!==j&&q.name===p.name)).map(p=>p.name));
    const html='<option value="all">All projects</option>'+this.projects.map(p=>`<option value="${esc(p.id)}">${esc(duplicates.has(p.name)?p.name+' · '+p.id:p.name)}</option>`).join('');
    if(field.innerHTML!==html){field.innerHTML=html;field.value=this.projectFilter;}
  }
  renderList(animate=false){
    if(this.disposed)return;
    const filtered=filterChats(this.threads,{kind:this.filter,project:this.projectFilter,date:this.dateFilter,status:this.statusFilter,query:this.host.querySelector('.thread-search').value}),groups=groupChats(filtered,this.sort);
    this.host.querySelectorAll('[data-thread-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.threadFilter===this.filter)));
    const filterCount=[this.projectFilter,this.dateFilter,this.statusFilter].filter(value=>value!=='all').length,count=this.host.querySelector('.thread-filter-count');count.textContent=filterCount;count.hidden=!filterCount;
    const key=JSON.stringify([groups,this.selected,this.projectVisibility.snapshot(),new Date().toDateString()]);
    if(key===this.listKey)return;this.listKey=key;
    const list=this.host.querySelector('.thread-list'),top=list.scrollTop,focused=document.activeElement?.dataset.threadId;
    const old=new Map([...list.querySelectorAll('[data-sort-key]')].map(el=>[el.dataset.sortKey,el.getBoundingClientRect()]));
    list.querySelectorAll('[data-sort-key]').forEach(el=>el.getAnimations().forEach(a=>a.cancel()));
    const sections=new Map([...list.querySelectorAll('.thread-project-group')].map(el=>[el.dataset.project,el])),buttons=new Map([...list.querySelectorAll('[data-thread-id]')].map(el=>[el.dataset.threadId,el]));
    const hiddenGroups=groups.filter(g=>this.projectVisibility.hidden.has(g.id));
    const nodes=groups.filter(g=>!this.projectVisibility.hidden.has(g.id)).map(group=>{
      let section=sections.get(group.id);if(!section){section=document.createElement('section');section.className='thread-project-group';section.dataset.project=group.id;section.innerHTML='<h3 class="thread-project-banner"></h3><div class="thread-project-chats"></div>';}
      section.setAttribute('aria-label',group.name+' chats');const heading=section.querySelector('h3');heading.dataset.sortKey='project:'+group.id;heading.title=group.id;const collapsed=this.projectVisibility.collapsed.has(group.id);heading.innerHTML=`<button type="button" class="project-collapse" data-project-action="toggle" data-project-id="${esc(group.id)}" aria-expanded="${!collapsed}" aria-label="${collapsed?'Expand':'Collapse'} ${esc(group.name)} conversations"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg><span>${esc(group.name)}</span><small>${group.threads.length}</small></button><button type="button" class="project-hide" data-project-action="hide" data-project-id="${esc(group.id)}" aria-label="Hide ${esc(group.name)} conversations" title="Hide project conversations">Hide</button>`;section.querySelector('.thread-project-chats').hidden=collapsed;
      section.querySelector('.thread-project-chats').replaceChildren(...group.threads.map(thread=>{
        let button=buttons.get(thread.id);if(!button){button=document.createElement('button');button.type='button';button.dataset.threadId=thread.id;}
        button.className='thread-item'+(thread.id===this.selected?' selected':'');button.dataset.sortKey='thread:'+thread.id;button.setAttribute('aria-pressed',String(thread.id===this.selected));
        const html=`<span class="thread-item-title"><span class="thread-name" title="${esc(thread.name)}">${esc(thread.name)}</span><small>${thread.status==='closed'?'Closed · ':''}${thread.kind==='group'?'Group':'DM'}</small></span><span class="thread-preview">${esc(thread.lastSender?thread.lastSender+': ':'')}${esc(thread.preview)}</span><span class="thread-participant-avatars" aria-hidden="true">${thread.participants.slice(0,4).map(p=>agentAvatar(p,13)).join('')}</span><span class="thread-item-meta"><span>${thread.count} message${thread.count===1?'':'s'}</span>${timestamp(activityAt(thread))}</span>`;
        // Tooltip accessibility attributes decorate the DOM; compare the authored content.
        if(button._contentHTML!==html){button.innerHTML=html;button._contentHTML=html;}return button;
      }));return section;
    });
    if(hiddenGroups.length){const hidden=document.createElement('section');hidden.className='hidden-chat-projects';hidden.setAttribute('aria-label','Hidden projects');hidden.innerHTML=`<h3><span>Hidden</span><small>${hiddenGroups.length}</small></h3>${hiddenGroups.map(group=>`<button type="button" data-project-action="reveal" data-project-id="${esc(group.id)}" title="Show and expand ${esc(group.name)}"><span>${esc(group.name)}</span><small>${group.threads.length}</small></button>`).join('')}`;nodes.push(hidden);}
    list.replaceChildren(...nodes);if(!nodes.length)list.innerHTML='<div class="drawer-empty">No chats match these filters.</div>';
    list.scrollTop=top;
    if(focused)[...list.querySelectorAll('[data-thread-id]')].find(el=>el.dataset.threadId===focused)?.focus({preventScroll:true});
    if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const moves=[...list.querySelectorAll('[data-sort-key]')].map(el=>({el,before:old.get(el.dataset.sortKey),after:el.getBoundingClientRect()}));
      for(const {el,before,after} of moves){const x=before?before.left-after.left:0,y=before?before.top-after.top:8;if(!before||Math.abs(x)+Math.abs(y)>1)el.animate([{transform:`translate(${x}px,${y}px)`,opacity:before?1:0},{transform:'translate(0,0)',opacity:1}],{duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});}
    }
    this.host.querySelector('.thread-result-count').textContent=`${filtered.length} of ${this.threads.length} chats · ${groups.length} ${groups.length===1?'project':'projects'}`;
  }
  threadRoute(id){const project=this.threads.find(t=>t.id===id)?.project||this.pages.get(id)?.project||this.project.path;return 'chat-thread?thread='+encodeURIComponent(id)+'&project='+encodeURIComponent(project);}

  empty(text){this.closeReplies(false);this.host.querySelector('.thread-messages').innerHTML=`<div class="drawer-empty">${esc(text)}</div>`;}
  async select(id){this.selectionVersion++;this.selected=id;this.questionCursor=0;this.replyTo=null;const composer=this.host.querySelector('.group-composer');composer.hidden=true;composer.dataset.threadId=id;composer.querySelector('textarea').value=this.drafts.get(id)||'';composer.querySelector('.group-reply-target').textContent='';this.host.classList.add('thread-selected');this.renderList();this.detailKey=null;this.headerKey=null;this.host.querySelector('.thread-detail-head').innerHTML='<button type="button" data-thread-action="back">← Conversations</button>';this.empty('');this.error(null);this.host.querySelector('.thread-messages').innerHTML=loadingState('Loading conversation',{variant:'chat'});await this.load(id,true);}
  async load(id,reset=false){
    if(this.disposed||this.selected!==id)return;const version=++this.loadVersion;
    try{
      const data=await this.api(this.threadRoute(id));if(this.disposed||this.selected!==id||version!==this.loadVersion)return;
      data.project ||= this.project.path;data.projectName ||= this.project.name;const {messages:pageMessages,...summary}=data;this.threads=this.threads.map(thread=>thread.id===id?summary:thread);this.renderList();
      const old=this.pages.get(id),messages=new Map((old?.messages||[]).map(m=>[m.id,m]));for(const message of pageMessages)messages.set(message.id,message);
      const combined={...data,messages:[...messages.values()].sort((a,b)=>a.at.localeCompare(b.at)),hasMore:old&&old.messages[0]?.id!==data.messages[0]?.id?old.hasMore:data.hasMore};
      combined.before=combined.messages[0]?.id;this.pages.set(id,combined);this.renderDetail(combined,reset);this.error(null,'load');
    }catch(error){if(!this.disposed&&this.selected===id&&version===this.loadVersion)this.error(error,'load');}
  }
  async focusMessage(id){
    const threadId=this.selected;
    for(let page=0;page<5&&this.selected===threadId;page++){
      const thread=this.pages.get(threadId);
      if(this.replyIndex?.aliases.has(id)||thread?.messages.some(m=>m.id===id))break;
      if(!thread?.hasMore)break;await this.older();
    }
    if(this.selected!==threadId||this.disposed)return;
    const root=this.replyIndex?.rootById.get(id);if(root&&root!==id)this.openReplies(root);
    const message=[...this.host.querySelectorAll('[data-message-id]')].find(e=>e.dataset.messageId===id);
    if(!message){this.error(new Error('The handoff is in earlier history. Load earlier messages to continue.'));return;}
    message.classList.add('handoff-highlight');message.tabIndex=-1;message.focus({preventScroll:true});message.scrollIntoView({block:'center',behavior:'instant'});
  }
  async older(){
    const id=this.selected,page=this.pages.get(id),selection=this.selectionVersion;if(!page?.hasMore||this.loadingOlder)return;
    this.loadingOlder=true;
    const button=this.host.querySelector('[data-thread-action=older]');if(button){button.disabled=true;button.textContent='Loading earlier messages…';}
    try{
      const data=await this.api(this.threadRoute(id)+'&before='+encodeURIComponent(page.before));if(this.disposed||this.selected!==id||selection!==this.selectionVersion)return;
      const latest=this.pages.get(id),messages=new Map([...data.messages,...latest.messages].map(m=>[m.id,m]));
      const combined={...latest,messages:[...messages.values()].sort((a,b)=>a.at.localeCompare(b.at)),hasMore:data.hasMore,before:data.before};
      this.pages.set(id,combined);this.renderDetail(combined,false,true);
    }catch(error){if(!this.disposed&&this.selected===id&&selection===this.selectionVersion)this.error(error);}finally{this.loadingOlder=false;if(button?.isConnected){button.disabled=false;button.textContent='Load earlier messages';}}
  }
  renderDetail(thread,reset=false,prepend=false){
    const key=JSON.stringify([thread,new Date().toDateString()]);if(key===this.detailKey)return;this.detailKey=key;
    const answerFocus=this.captureAnswerFocus();
    const body=this.host.querySelector('.thread-messages'),height=body.scrollHeight,top=body.scrollTop,follow=reset||height-top-body.clientHeight<45;
    const pending=(thread.userRequests||[]).filter(q=>q.status==='pending'),headerKey=JSON.stringify([thread.id,thread.name,thread.project,thread.projectName,thread.kind,thread.participants,thread.status,pending.length]);
    if(this.headerKey!==headerKey){this.headerKey=headerKey;this.host.querySelector('.thread-detail-head').innerHTML=`<button type="button" data-thread-action="back" class="thread-back">← Conversations</button><div class="thread-title-row"><strong>${esc(thread.name)}</strong><span class="thread-project-label" title="${esc(thread.project)}">${esc(thread.projectName||this.project.name)}</span></div><span class="thread-participants">${thread.kind==='group'?'Group chat · You':'Direct messages'} · ${thread.participants.map(p=>agentLabel(p,p.name)).join(' ')}</span><div class="thread-status-controls">${thread.status==='closed'?`<span class="state-pill lifecycle-done">Closed</span><input class="thread-reopen-reason" value="${esc(this.reopenReasons.get(thread.id)||'')}" placeholder="New evidence or requirements…" aria-label="Reason to reopen" maxlength="1000">`:''}<button type="button" data-thread-action="status" ${this.statusChanging===thread.id?'disabled':''}>${thread.status==='closed'?'Reopen chat':'Close completed chat'}</button>${pending.length?`<button type="button" class="thread-question-nav" data-thread-action="next-question">${pending.length} ${pending.length===1?'question':'questions'} waiting · View next</button>`:''}</div>`;}
    const composer=this.host.querySelector('.group-composer');composer.hidden=thread.kind!=='group'||thread.status==='closed';if(composer.dataset.threadId!==thread.id){composer.dataset.threadId=thread.id;composer.querySelector('textarea').value=this.drafts.get(thread.id)||'';}
    this.replyIndex=replyThreads(conversationMessages(thread));
    body.innerHTML=(thread.hasMore?'<button type="button" data-thread-action="older" class="thread-older">Load earlier messages</button>':'')+(this.replyIndex.roots.map(message=>this.messageBubble(message,thread)).join('')||'<div class="drawer-empty">No messages yet. Send the first message to this group.</div>');
    body.querySelectorAll('a').forEach(link=>{link.target='_blank';link.rel='noopener noreferrer';});
    body.scrollTop=prepend?top+body.scrollHeight-height:follow?body.scrollHeight:top;
    this.enhanceMarkdown(body,()=>{if(follow)body.scrollTop=body.scrollHeight;},{project:thread.project});
    if(this.replyRoot){this.replyRoot=this.replyIndex.rootById.get(this.replyRoot)||this.replyRoot;this.renderReplies();}
    this.restoreAnswerFocus(answerFocus);
  }
  captureAnswerFocus(){const input=document.activeElement;if(!this.host.contains(input)||!input.matches('.user-answer-form textarea'))return null;return {id:input.closest('form').dataset.requestId,replies:!!input.closest('.message-replies'),start:input.selectionStart,end:input.selectionEnd};}
  restoreAnswerFocus(focus){if(!focus)return;const area=this.host.querySelector(focus.replies?'.replies-messages':'.thread-messages'),input=[...area?.querySelectorAll('.user-answer-form')||[]].find(form=>form.dataset.requestId===focus.id)?.querySelector('textarea');input?.focus({preventScroll:true});input?.setSelectionRange(focus.start,focus.end);}
  questionForm(question){return `<div class="inline-user-question"><div class="user-answer-choices">${question.options.map((choice,i)=>`<button type="button" data-user-choice="${esc(question.id)}" data-choice-index="${i}" ${this.answering?'disabled':''}>${esc(choice)}</button>`).join('')}</div><form class="user-answer-form" data-request-id="${esc(question.id)}"><textarea name="response" rows="2" required maxlength="16000" aria-label="Answer ${esc(question.fromRole)}" placeholder="${question.options.length?'Or type your answer…':'Type your answer…'}">${esc(this.answerDrafts.get(question.id)||'')}</textarea><button type="submit" class="primary" ${this.answering?'disabled':''}>Send answer</button></form></div>`;}
  messageBubble(message,thread,inReplies=false){
      const question=(thread.userRequests||[]).find(q=>q.id===message.humanRequestId&&q.status==='pending');
      const delivered=message.deliveries.filter(d=>d.status==='delivered').length,issue=message.deliveries.find(d=>['uncertain','failed'].includes(d.status));
      const status=message.deliveries.some(d=>d.status==='awaiting-user')?'Waiting for your answer':message.deliveries.every(d=>d.status==='answered')?'Answered by you':message.deliveries.every(d=>d.status==='inbox')?'In inbox · no agent woken':message.deliveries.every(d=>d.status==='cancelled')?'Cancelled · chat closed':issue?'Delivery unconfirmed':delivered===message.deliveries.length?'Delivered':delivered?`${delivered}/${message.deliveries.length} delivered`:'Queued';
      const replies=this.replyIndex.replies.get(message.id)||[],names=[...new Set(replies.map(r=>r.fromRole))],parent=this.replyIndex.aliases.get(message.replyTo);
      const summary=!inReplies&&replies.length?`<button type="button" class="thread-replies-link" data-see-replies="${esc(message.id)}" aria-expanded="${this.replyRoot===message.id}"><span class="reply-avatars" aria-hidden="true">${[...new Set(replies.map(r=>r.from))].slice(0,3).map(id=>agentAvatar(id,13)).join('')}</span><span><strong>${lucide('list-end')}See all replies</strong><small>${replies.length} ${replies.length===1?'reply':'replies'} · ${esc(names.join(', '))} · ${time(replies.at(-1).at)}</small></span></button>`:'';
      const context=message.earlierQuestion?'<div class="reply-context">Unanswered question from earlier history</div>':inReplies&&parent&&message.id!==this.replyRoot?`<div class="reply-context">↳ Reply to ${agentLabel(parent.from,parent.fromRole)}</div>`:!parent&&message.replyTo?'<div class="reply-context">Reply to an earlier message</div>':'';
      return `<article class="thread-bubble ${message.from===thread.participants[0]?.id?'side-a':'side-b'}${question?' has-user-question':''}" data-message-id="${esc(message.id)}" ${agentAttributes(message.from)}><header><strong class="thread-message-sender">${agentLabel(message.from,message.fromRole)}${question?'<span class="question-addressee">asks you</span>':''}</strong>${timestamp(message.at)}</header>${context}${message.workBrief?workMessage(message.workBrief,`thread:${thread.id}:${message.id}`,`thread:${this.messageScope}:${inReplies?'reply':'main'}:${thread.id}:${message.id}`,this.markdown):messageContent(this.markdown(message.text),`thread:${thread.id}:${message.id}`,`thread:${this.messageScope}:${inReplies?'reply':'main'}:${thread.id}:${message.id}`)}${imageGallery(message.attachments,thread.project)}${question?this.questionForm(question):''}<footer>${esc(message.kind||'request')} · ${esc(status)}${message.humanRequestId?'':message.requiresReply?' · Reply requested':' · No reply needed'}${!question&&!inReplies&&thread.kind==='group'&&thread.status!=='closed'?`<button type="button" class="thread-reply" data-reply="${esc(message.id)}">${lucide('message-square-reply')}<span>Reply</span></button>`:''}</footer>${issue?.error?`<p class="thread-delivery-error">${esc(issue.error)}</p>`:''}${summary}</article>`;
  }
  replyDraftKey(){return this.selected+':'+this.replyRoot;}
  openReplies(id,compose=false){
    const page=this.pages.get(this.selected);if(!page)return;
    this.replyIndex=replyThreads(conversationMessages(page));const root=this.replyIndex.rootById.get(id);if(!root)return;
    if(this.replyRoot!==root)this.host.querySelector('.message-replies')?.remove();
    this.replyRoot=root;this.host.classList.add('replies-open');this.renderReplies(true);
    this.host.querySelectorAll('[data-see-replies]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.seeReplies===root)));
    this.host.querySelector(compose&&page.kind==='group'&&page.status!=='closed'?'.reply-composer textarea':'.replies-heading button')?.focus({preventScroll:true});
  }
  closeReplies(focus=true){
    const root=this.replyRoot;this.replyRoot=null;this.host.classList.remove('replies-open');this.host.querySelector('.message-replies')?.remove();
    this.host.querySelectorAll('[data-see-replies]').forEach(b=>b.setAttribute('aria-expanded','false'));
    if(focus)[...this.host.querySelectorAll('[data-see-replies],[data-reply]')].find(b=>b.dataset.seeReplies===root||b.dataset.reply===root)?.focus({preventScroll:true});
  }
  renderReplies(reset=false){
    const thread=this.pages.get(this.selected),root=this.replyIndex.aliases.get(this.replyRoot);if(!thread||!root)return this.closeReplies(false);
    const answerFocus=this.captureAnswerFocus();
    let panel=this.host.querySelector('.message-replies');
    if(!panel){
      panel=document.createElement('section');panel.className='message-replies';panel.setAttribute('aria-label','Message replies');
      panel.innerHTML=`<header class="replies-heading"><div><small>FOCUSED CONVERSATION</small><h3>Replies</h3><span></span></div><button type="button" data-thread-action="close-replies" aria-label="Close replies">×</button></header><div class="replies-messages" tabindex="0" aria-label="Reply history"></div><form class="reply-composer"><label for="reply-message">Reply in this thread</label><textarea id="reply-message" name="message" rows="2" maxlength="16000" required placeholder="Keep this conversation together…"></textarea><div class="group-send-controls"><select name="kind" aria-label="Reply type"><option value="result">Result</option><option value="request">Request</option><option value="ack">Acknowledge quietly</option></select><label><input name="requiresReply" type="checkbox"> Reply needed</label><button type="submit" class="primary">Send reply</button></div></form><p class="replies-readonly" hidden></p><p class="replies-error" role="status"></p>`;
      this.host.querySelector('.threads-layout').append(panel);panel.querySelector('textarea').value=this.replyDrafts.get(this.replyDraftKey())||'';
    }
    const replies=this.replyIndex.replies.get(root.id)||[],body=panel.querySelector('.replies-messages'),follow=reset||body.scrollHeight-body.scrollTop-body.clientHeight<45,top=body.scrollTop;
    panel.querySelector('.replies-heading span').textContent=`${root.fromRole} · ${replies.length} ${replies.length===1?'reply':'replies'}`;
    const content=`<div class="reply-root">${this.messageBubble(root,thread,true)}</div><div class="reply-chain">${replies.map(m=>this.messageBubble(m,thread,true)).join('')||'<p class="reply-empty">No replies yet. Start a focused conversation here.</p>'}</div>`;
    if(content!==this.repliesHTML||reset){body.innerHTML=content;this.repliesHTML=content;body.querySelectorAll('a').forEach(link=>{link.target='_blank';link.rel='noopener noreferrer';});body.scrollTop=follow?body.scrollHeight:top;this.enhanceMarkdown(body,()=>{if(follow)body.scrollTop=body.scrollHeight;},{project:thread.project});}
    const readOnly=thread.kind!=='group'||thread.status==='closed',replyForm=panel.querySelector('.reply-composer');replyForm.hidden=readOnly;panel.querySelector('.replies-readonly').hidden=!readOnly;panel.querySelector('.replies-readonly').textContent=thread.status==='closed'?'This conversation is closed. Its replies are preserved.':'Agent-to-agent replies appear here as they arrive.';replyForm.querySelector('[type=submit]').disabled=!!this.replySending;replyForm.querySelector('[type=submit]').textContent=this.replySending?'Sending…':'Send reply';
    this.restoreAnswerFocus(answerFocus);
  }
  async sendReply(){
    if(this.replySending)return;const thread=this.pages.get(this.selected),rootId=this.replyRoot;if(!thread||thread.status==='closed'||thread.kind!=='group'||!rootId)return;
    const form=this.host.querySelector('.reply-composer'),data=new FormData(form),draft=String(data.get('message')),message=draft.trim();if(!message)return;
    const payload={threadId:thread.id,project:thread.project,replyTo:rootId,message,kind:data.get('kind'),requiresReply:data.get('kind')==='ack'?false:data.has('requiresReply')},key=JSON.stringify(payload),draftKey=this.replyDraftKey();
    if(this.replyRetry?.key!==key)this.replyRetry={key,id:crypto.randomUUID()};
    this.replySending=true;form.querySelector('[type=submit]').disabled=true;form.querySelector('[type=submit]').textContent='Sending…';form.parentElement.querySelector('.replies-error').textContent='';this.error(null);
    try{await this.api('groups/message',{...payload,requestId:this.replyRetry.id});this.replyRetry=null;if(this.replyDrafts.get(draftKey)===draft)this.replyDrafts.delete(draftKey);if(this.disposed)return;const current=this.host.querySelector('.reply-composer');if(this.selected===thread.id&&this.replyRoot===rootId&&current?.querySelector('textarea').value===draft)current.querySelector('textarea').value='';await this.load(thread.id);}
    catch(error){if(form.isConnected)form.parentElement.querySelector('.replies-error').textContent=error.message;}
    finally{this.replySending=false;const submit=!this.disposed&&this.host.querySelector('.reply-composer [type=submit]');if(submit){submit.disabled=false;submit.textContent='Send reply';}}
  }
  capture(){return {...(this.imageDrafts?.size?{imageDrafts:[...this.imageDrafts]}:{}),drafts:[...this.drafts],replyDrafts:[...this.replyDrafts],answerDrafts:[...this.answerDrafts],reopenReasons:[...this.reopenReasons],selected:this.selected};}
  dispose(){this.disposed=true;this.imageObserver?.disconnect();this.attachmentComposer?.dispose();this.closeReplies(false);document.removeEventListener('keydown',this.keydown);this.host.removeEventListener('change',this.setting);this.host.removeEventListener('submit',this.submit);this.host.removeEventListener('input',this.compose);this.host.removeEventListener('click',this.click);this.host.querySelector('.thread-search')?.removeEventListener('input',this.input);this.host.classList.remove('threads-drawer','thread-selected');}
}
