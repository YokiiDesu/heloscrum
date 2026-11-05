const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Number.isFinite(value)?value.toLocaleString():'Not reported';
export function geminiUsageHTML(usage,{compact=false,mode}={}){
  const u=usage||{},context=u.context;
  if(compact)return `<span title="Last confirmed Gemini mode">${esc(mode||'Mode pending')}</span><span title="Latest context occupancy reported by Gemini">Context ${context?context.percent+'%':'not reported'}</span><span title="Sum of reported turn totals; this is not context occupancy">${Number.isFinite(u.totalTokens)?num(u.totalTokens)+' tokens':'Usage not reported'}</span>`;
  return `<div class="gemini-metrics"><div><span>Context occupied</span><strong>${context?context.percent+'%':'Not reported'}</strong><small>${context?num(context.used)+' / '+num(context.size)+' tokens':'Waiting for Gemini context telemetry'}</small>${context?`<meter min="0" max="${context.size}" value="${context.used}" aria-label="Context tokens used"></meter>`:''}</div><div><span>Reported turn totals</span><strong>${num(u.totalTokens)}</strong><small>${u.measuredTurns||0} measured / ${u.turns||0} completed responses</small></div><div><span>Input / output</span><strong>${num(u.inputTokens)} / ${num(u.outputTokens)}</strong><small>Cached input ${num(u.cachedReadTokens)} · Thinking ${num(u.thoughtTokens)}</small></div></div><p class="gemini-note">Token totals sum reported responses, including repeated context. Missing measurements are not counted as zero. Context is the latest provider report${context?.at?' ('+esc(new Date(context.at).toLocaleString())+')':''}; costs and account quota are not estimated.${u.models?.length?' Models reported for the last response: '+u.models.map(esc).join(', ')+'.':''}</p>`;
}
export function planTaskTitles(plan){
  if(plan?.entries?.length)return plan.entries.map(e=>e.content.slice(0,160)).slice(0,100);
  return (plan?.text||'').split('\n').filter(line=>/^(?:[-*+] |\d+[.)] )/.test(line)).map(line=>line.replace(/^(?:[-*+] |\d+[.)] )(?:\[[ x]\] )?/i,'').replace(/\*\*/g,'').trim().slice(0,160)).filter(Boolean).slice(0,100);
}
export class GeminiControlsDialog {
  constructor(opener,task,options){
    Object.assign(this,{opener,task,options});this.dialog=document.createElement('dialog');this.dialog.className='gemini-controls-dialog';this.dialog.setAttribute('aria-label','Gemini controls for '+(task.role||task.title));
    this.dialog.innerHTML='<p>Loading Gemini controls…</p><div class="gemini-error" role="alert"></div><button type="button" data-gemini="refresh">Retry</button><button type="button" data-gemini="close">Close</button>';document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.closed=true;this.dialog.remove();opener?.focus();options.onClose?.();});
    this.dialog.addEventListener('click',event=>{const action=event.target.closest('[data-gemini]')?.dataset.gemini;if(action==='close')this.close();if(action==='refresh'&&!this.busy)this.load();if(action==='latest-plan'){this.draft=null;this.render();}});
    this.dialog.addEventListener('submit',event=>{event.preventDefault();this.submit(event.target).catch(error=>this.error(error));});
    this.dialog.addEventListener('change',event=>{if(event.target.name==='modeId')this.modeDescription();});this.dialog.showModal();this.load();
  }
  close(){this.dialog.close();}
  error(error){const el=this.dialog.querySelector('.gemini-error');if(el)el.textContent=error.message||String(error);else this.options.toast(error);}
  capture(){const form=this.dialog.querySelector('[data-form="plan"]');if(form)this.draft={...this.draft,...Object.fromEntries(new FormData(form))};}
  async load(){try{this.capture();this.report=await this.options.api('gemini/session?task='+this.task.id);if(!this.closed)this.render();}catch(error){this.error(error);}}
  modeDescription(){const select=this.dialog.querySelector('[name="modeId"]'),el=this.dialog.querySelector('.gemini-mode-description');if(el)el.textContent=this.report.modes.find(m=>m.id===select.value)?.description||'';}
  render(){
    const r=this.report,disabled=!r.ready?'disabled':'',source=r.plan;
    if(!this.draft&&source)this.draft={sessionId:r.sessionId,expectedPlan:source.expected,title:(this.task.title+' plan').slice(0,160),planText:source.text,items:planTaskTitles(source).join('\n'),ownerId:this.task.id};
    const d=this.draft,stale=d&&(d.expectedPlan!==source?.expected||d.sessionId!==r.sessionId),imported=source&&r.imports[source.expected];
    this.dialog.innerHTML=`<header><div><h2>Gemini controls</h2><p>${esc(r.role)} · ${esc(r.status)}</p></div><button type="button" data-gemini="close">Close</button></header><div class="gemini-error" role="alert"></div><section><div class="gemini-section-title"><h3>Usage</h3><button type="button" data-gemini="refresh">Refresh</button></div>${geminiUsageHTML(r.usage)}</section><section><h3>Session mode</h3><p class="gemini-note">Last confirmed mode: ${esc(r.modes.find(m=>m.id===r.mode)?.name||r.mode||'Not reported')}. Plan mode investigates without ordinary workspace edits; Gemini may write its plan file. Mode changes apply to future turns.</p><form data-form="mode"><label>Gemini mode<select name="modeId" ${disabled}>${r.modes.map(m=>`<option value="${esc(m.id)}" ${m.id===r.mode?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><p class="gemini-mode-description"></p><button type="submit" ${disabled}>Apply mode</button></form>${!r.ready?'<p class="gemini-note">Mode and command changes are available when this connected session is idle.</p>':''}</section><section><h3>Native commands</h3><p class="gemini-note">Commands advertised by this Gemini session. Results appear in Chat. Some commands may use model tokens or change native settings.</p>${r.commands.length?`<form data-form="command"><label>Command<select name="name" ${disabled}>${r.commands.map(c=>`<option value="${esc(c.name)}">${esc(c.name+' — '+c.description)}</option>`).join('')}</select></label><label>Arguments (optional)<input name="args" maxlength="4000" autocomplete="off"></label><button type="submit" ${disabled}>Run command</button></form>`:'<p>Gemini has not advertised commands yet. Refresh after connecting.</p>'}</section><section><h3>Plan → board draft</h3><p class="gemini-note">Ask Gemini to plan in Plan mode, then review its response and task breakdown here. Imported tasks start as To do. The board’s Review &amp; start step begins execution. Switch executing Gemini agents to Default mode before starting.</p>${d?`<form data-form="plan">${stale?'<p role="status">A newer plan or session is available. Your edits are preserved; load the latest plan before importing.</p><button type="button" data-gemini="latest-plan">Load latest plan</button>':''}<label>Board plan title<input name="title" value="${esc(d.title)}" maxlength="160" required></label><label>Review plan<textarea name="planText" rows="8" maxlength="28000" required>${esc(d.planText)}</textarea></label><label>Board tasks (one per line, up to 100)<textarea name="items" rows="5" required>${esc(d.items)}</textarea></label><label>Initial task owner<select name="ownerId"><option value="">Assign on board</option>${r.agents.map(a=>`<option value="${esc(a.id)}" ${a.id===d.ownerId?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label><button type="submit" ${disabled} ${stale?'disabled':''}>${imported?'Open existing board draft':'Save board draft'}</button></form>`:'<p>No plan captured yet. Select Plan mode and send a planning request in Chat.</p>'}</section>`;
    this.modeDescription();
  }
  async submit(form){
    if(this.busy)return;this.capture();const values=Object.fromEntries(new FormData(form)),r=this.report,controls=[...this.dialog.querySelectorAll('input,textarea,select,button:not([data-gemini="close"])')].map(el=>[el,el.disabled]);this.busy=true;for(const [el] of controls)el.disabled=true;
    try{
      this.dialog.querySelector('.gemini-error').textContent='';
      if(form.dataset.form==='mode'){await this.options.api('gemini/mode',{taskId:this.task.id,expected:r.expected,modeId:values.modeId});this.options.toast('Gemini mode changed');await this.load();}
      if(form.dataset.form==='command'){
        const catalog=await this.options.api('native-commands?task='+this.task.id);if(!catalog.ready)throw Error(catalog.reason);
        const signature=JSON.stringify([catalog.expected,values]);if(this.pending?.signature!==signature)this.pending={signature,requestId:crypto.randomUUID()};
        await this.options.api('native-commands',{taskId:this.task.id,...values,expected:catalog.expected,requestId:this.pending.requestId});this.pending=null;this.options.toast(values.name+' sent to Gemini');await this.options.onCommand?.();this.close();
      }
      if(form.dataset.form==='plan'){
        this.capture();const items=values.items.split('\n').map(s=>s.trim()).filter(Boolean);
        const result=await this.options.api('gemini/plan',{taskId:this.task.id,...this.draft,...values,items});this.options.toast('Board draft saved. Review assignments and start it from the board.');this.close();this.options.onWork?.(result.planId,result.project);
      }
    }finally{this.busy=false;for(const [el,disabled] of controls)if(el.isConnected)el.disabled=disabled;}
  }
}
