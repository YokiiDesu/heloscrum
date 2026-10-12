import {messageContent} from './message-content.js';
import {thinkingBlock} from './thinking-block.js';
// A running older backend may not serve the optional activity renderer yet.
const {activityCard}=await import('./activity-card.js').catch(()=>({activityCard:event=>`<details class="chat-tool"><summary>Claude activity · server update pending</summary><p>The visual view will be available after HeloScrum is reloaded when agents are idle.</p><pre>${esc(JSON.stringify(event,null,2))}</pre></details>`}));
import {agentAttributes,agentLabel} from './agent-appearance.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString():'Not captured yet';
export class HistoryView {
  constructor(host,{api,markdown,enhanceMarkdown=()=>{},onClose}){
    Object.assign(this,{host,api,markdown,enhanceMarkdown,onClose});this.mode='sessions';this.generation=0;host.classList.add('history-drawer');
    host.innerHTML=`<div class="drawer-heading"><h2>Project history</h2><div class="drawer-heading-actions"><button data-history="capture">Capture now</button><button data-history="export">Export</button><button data-history="close" aria-label="Close project history">×</button></div></div><div class="history-summary"></div><nav class="history-tabs" aria-label="History type">${[['sessions','Sessions'],['memory','Memory revisions'],['commit','Commits'],['artifact','Files']].map(([id,name])=>`<button data-history-mode="${id}">${name}</button>`).join('')}</nav><div class="history-browser"><div class="history-list"></div><section class="history-detail" aria-label="Archived record"></section></div><p class="history-error" role="status"></p>`;
    this.click=async event=>{const b=event.target.closest('button');if(!b)return;try{
      if(b.dataset.history==='close')return this.onClose();
      if(b.dataset.history==='export'){b.disabled=true;this.download(await this.api('history/export'),'heloscrum-history.json');}
      if(b.dataset.history==='capture'){b.disabled=true;await this.api('history/capture',{});await this.load();}
      if(b.dataset.history==='older')await this.showSession(this.sessionId,this.page.before);
      if(b.dataset.historyMode){this.mode=b.dataset.historyMode;await this.load();}
      if(b.dataset.historySession)await this.showSession(b.dataset.historySession);
      if(b.dataset.historyRecord!==undefined)this.showRecord(Number(b.dataset.historyRecord));
    }catch(e){this.error(e);}finally{b.disabled=false;}};host.addEventListener('click',this.click);this.load().catch(e=>this.error(e));
  }
  error(e){if(!this.disposed)this.host.querySelector('.history-error').textContent=e?.message||'';}
  download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async load(){
    const generation=++this.generation;
    this.host.querySelectorAll('[data-history-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyMode===this.mode)));
    const summary=await this.api('history');if(this.disposed||generation!==this.generation)return;
    const count=kind=>summary.counts.find(c=>c.kind===kind)?.count||0;
    this.host.querySelector('.history-summary').innerHTML=`<strong>DuckDB · saved on this machine</strong><span>${summary.sessions.length} sessions · ${count('transcript')} conversation events · ${count('message')} message deliveries · ${count('memory')} memory revisions</span><small>Last collection: ${esc(date(summary.lastCapturedAt))}. Live messages and memory save immediately; provider history is collected every 30 seconds.</small>`;
    this.error(summary.error||summary.collectionErrors?.length?new Error([summary.error,...(summary.collectionErrors||[]).map(e=>`${e.area}: ${e.error}`)].filter(Boolean).join(' · ')):null);
    this.host.querySelector('.history-detail').innerHTML='<p>Select a record to inspect its contents.</p>';
    const list=this.host.querySelector('.history-list');
    if(this.mode==='sessions'){list.innerHTML=summary.sessions.map(s=>`<button data-history-session="${esc(s.id)}"><strong>${agentLabel(s.task_id,s.role||s.title)}</strong><span>${esc(s.provider)} · ${s.event_count} events</span><code>${esc(s.provider_session_id)}</code><small>${esc(date(s.started_at))}</small>${s.last_error?'<span>Capture needs attention</span>':''}</button>`).join('')||'<p>No provider sessions captured yet.</p>';return;}
    const {records}=await this.api('history/records?kind='+this.mode);if(this.disposed||generation!==this.generation)return;this.records=records.sort((a,b)=>(b.occurred_at||b.captured_at).localeCompare(a.occurred_at||a.captured_at)||Number(BigInt(b.seq)-BigInt(a.seq)));
    list.innerHTML=this.records.map((r,i)=>`<button data-history-record="${i}"><strong>${esc(r.body.key||r.body.path||r.body.subject||r.kind)}</strong><small>${r.kind==='memory'?'Revision '+r.body.revision+' · ':''}${esc(date(r.occurred_at||r.captured_at))}</small><code>${esc(r.body.sha?.slice(0,12)||r.body.sha256?.slice(0,12)||r.body.author||'')}</code></button>`).join('')||'<p>No records captured yet.</p>';
  }
  async showSession(id,before){
    const generation=++this.generation,page=await this.api('history/session?id='+encodeURIComponent(id)+(before?'&before='+encodeURIComponent(before):''));if(this.disposed||generation!==this.generation)return;
    const events=before&&this.sessionId===id?[...page.events,...this.page.events]:page.events;this.sessionId=id;this.page={...page,events};
    this.host.querySelector('.history-detail').innerHTML=`<h3>${agentLabel(page.session.task_id,page.session.role)}</h3><p>${esc(page.session.provider)} session <code>${esc(page.sessionId)}</code></p><small>${esc(page.session.worktree)} · ${esc(page.session.branch)}</small>${page.hasMore?'<button data-history="older">Load earlier events</button>':''}<div class="history-transcript">${events.map(e=>{
      if(e.type==='activity')return activityCard(e);
      if(e.type==='tool')return `<details><summary>${esc(e.name)} · ${esc(e.status||'completed')}</summary><pre>${esc(typeof e.input==='string'?e.input:JSON.stringify(e.input,null,2))}</pre><pre>${esc(e.output)}</pre></details>`;
      if(e.type==='thinking'||e.type==='reasoning')return thinkingBlock(e,{markdown:this.markdown,scope:`history:${id}`});
      if(e.type==='state')return `<article><strong>${agentLabel(page.session.task_id,page.session.role)} · ${esc(e.report?.state||'State report')}</strong><time>${esc(date(e.at))}</time>${messageContent(this.markdown(e.report?.reason||e.summary||''),`history:${id}:${e.id}`)}</article>`;
      const sender=e.communication?.from||(e.role==='assistant'?page.session.task_id:e.role==='user'?'human':null),name=e.communication?.fromRole||(e.role==='assistant'?page.session.role:e.role==='user'?'You':e.role||e.type);
      return `<article ${sender?agentAttributes(sender):''}><strong>${sender?agentLabel(sender,name):esc(name)}</strong><time>${esc(date(e.at))}</time>${messageContent(this.markdown(e.text||e.summary||''),`history:${id}:${e.id}`)}</article>`;
    }).join('')}</div>`;
    this.enhanceMarkdown(this.host.querySelector('.history-transcript'),()=>{},{taskId:page.session.task_id});
  }
  showRecord(index){const r=this.records[index],b=r.body;this.host.querySelector('.history-detail').innerHTML=`<h3>${esc(b.key||b.path||b.subject)}</h3><p>${esc(r.provenance)} · ${esc(date(r.captured_at))}</p><small>Task: ${r.task_id?agentLabel(r.task_id):'Unattributed'}<br>Session: ${esc(r.session_id||'Not recorded in source')}</small>${r.kind==='memory'?`<p>${b.authorTaskId?agentLabel(b.authorTaskId,b.author):esc(b.author)} · revision ${b.revision}</p><div class="markdown">${this.markdown(b.text)}</div>`:r.kind==='artifact'?`<p>${b.bytes??0} bytes · SHA-256 <code>${esc(b.sha256||'unavailable')}</code></p><p>${esc(b.omitted||'The file snapshot is included in the history export.')}</p>`:`<pre>${esc(JSON.stringify(b,null,2))}</pre>`}`;}
  dispose(){this.disposed=true;this.generation++;this.host.removeEventListener('click',this.click);this.host.classList.remove('history-drawer');}
}
