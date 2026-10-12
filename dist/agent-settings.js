import {mountConnectionIndicator} from '/connection-indicator.js';
import {openAIConnectionDialog} from '/ai-settings.js';
import {providerSetupLabel,endpointProviderIds} from '/providers.js';
import {NativeSetupFields} from '/native-setup.js';
import {agentColors,agentIcons,appearanceFor,appearanceStyle,libraryIcon,iconLabel} from '/agent-appearance.js';
import { modelName } from '/model-names.js';
import { effortOptions, effortName, effortHint } from '/effort.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeDialog;
export function openAgentSettingsDialog(button,task,options){
  if(activeDialog&&!activeDialog.closed){activeDialog.element.focus();return activeDialog;}
  activeDialog=new AgentSettingsDialog(button,{taskId:task.id,role:task.role||task.title},options);
  return activeDialog;
}
export class AgentSettingsDialog {
  constructor(button,details,{api,onSaved,onClose,onManage}){
    Object.assign(this,{button,details,api,onSaved,onClose,onManage});
    this.appearance=appearanceFor({...details,id:details.taskId});this.kind=details.kind;this.nativeSetup=details.nativeSetup;this.connectionId=details.connectionId||'';this.model=details.model||'';this.effort=details.effort||'';
    this.element=document.createElement('dialog');this.element.className='agent-settings-dialog';this.element.setAttribute('aria-label',details.role+' agent settings');
    document.body.append(this.element);this.render();this.element.showModal();
    this.element.addEventListener('cancel',event=>{event.preventDefault();if(!this.busy)this.close();});
    this.element.addEventListener('click',event=>{const action=event.target.closest('[data-setting-action]')?.dataset.settingAction;if(action==='availability'){if(this.busy)return;this.close();this.onManage?.(this.details);return;}if(action)this.action(action).catch(error=>this.error(error));});
    this.element.addEventListener('change',event=>{
      if(event.target.name==='appearance-color'||event.target.name==='appearance-icon'){this.appearance[event.target.name==='appearance-color'?'color':'icon']=event.target.value;this.updateAppearance();return;}
      if(event.target.name==='kind'){this.kind=event.target.value;this.nativeSetup={profile:null,files:[]};this.connectionId='';this.model='';this.effort='';this.custom=false;this.preview=null;this.render();this.loadModels();}
      if(event.target.name==='connectionId'){this.connectionId=event.target.value;this.model='';this.custom=false;this.preview=null;this.render();}
      if(event.target.name==='model-choice'){this.model=event.target.value==='custom'?'':event.target.value;this.custom=event.target.value==='custom';this.preview=null;this.render();}
      if(event.target.name==='effort'){this.effort=event.target.value;this.preview=null;this.updateEffort();}
      if(event.target.name==='acknowledge-history')this.updateStatus();
    });
    this.element.addEventListener('input',event=>{if(event.target.name==='model'){this.model=event.target.value;this.preview=null;this.updateEffort();}});
    this.element.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();this.action(this.preview?'apply':'preview').catch(error=>this.error(error));});
    if(!details.providers)this.load();else this.loadModels();
    this.statusTimer=setInterval(()=>this.refreshStatus(),3000);
  }
  async load(){
    if(this.loading)return;this.loading=true;this.loadError=null;this.render();
    try{
      const details=await this.api('agent-settings?task='+this.details.taskId);if(this.closed)return;
      this.details=details;this.kind=details.kind;this.nativeSetup=details.nativeSetup;this.connectionId=details.connectionId||'';this.model=details.model||'';this.effort=details.effort||'';this.appearance=appearanceFor({...details,id:details.taskId});
    }catch(error){this.loadError=error.message;}
    finally{this.loading=false;if(!this.closed){this.render();if(this.details.providers)this.loadModels();}}
  }
  async loadModels(){
    const kind=this.kind,provider=this.details.providers?.find(p=>p.id===kind);
    if(!provider?.catalogPending||this.closed)return;
    try{
      const {providers}=await this.api('providers?kind='+encodeURIComponent(kind));if(this.closed)return;
      this.details.providers=this.details.providers.map(p=>providers.find(next=>next.id===p.id)||p);
      // Update only the options. Never replace a draft, selection, or focus when
      // slow model discovery finishes after the user has started editing.
      if(this.kind!==kind||this.preview||this.busy)return;
      const field=this.element.querySelector('#agent-model');if(!field)return;
      const value=field.value,entry=providers.find(p=>p.id===kind);
      field.innerHTML=this.modelOptions(entry);field.value=value;
      this.element.querySelector('[data-catalog-note]').textContent=this.catalogNote(entry);this.updateEffort();
    }catch(error){if(!this.closed&&this.kind===kind){const note=this.element.querySelector('[data-catalog-note]');if(note)note.textContent=error.message+' You can still enter an exact model ID.';}}
  }
  catalogNote(provider){return provider.source+(provider.error?' · '+provider.error+'. You can enter an exact model ID.':provider.catalogPending?' · Loading model choices…':'');}
  modelOptions(provider){
    const custom=this.custom||!!this.model&&!provider.models.some(m=>m.id===this.model);
    return `<option value="" ${!this.model&&!custom?'selected':''}>Provider default</option>${provider.models.filter(m=>!m.connectionId||m.connectionId===this.connectionId).map(m=>`<option value="${esc(m.id)}" ${m.id===this.model&&!custom?'selected':''}>${esc(modelName(m.id,m.label))}</option>`).join('')}<option value="custom" ${custom?'selected':''}>Exact model ID…</option>`;
  }
  async refreshStatus(){
    if(this.closed||this.loading||this.refreshing||this.busy||!this.details.providers)return;
    this.refreshing=true;
    try{
      const next=await this.api('agent-settings?task='+this.details.taskId);if(this.closed||this.busy)return;
      if(next.revision!==this.details.revision||next.kind!==this.details.kind){this.stale=true;this.preview=null;}
      for(const key of ['canSwitch','canRecover','status','statusError','offline'])this.details[key]=next[key];
      this.updateStatus();
    }catch(error){if(!this.closed){this.details.statusError=error.message;this.details.canSwitch=false;this.updateStatus();}}
    finally{this.refreshing=false;}
  }
  updateStatus(){
    const d=this.details,node=this.element.querySelector('[data-session-status]');if(!node)return;
    const message=this.stale?'This session changed elsewhere. Reload settings before applying your change.':d.statusError?'Couldn’t check this agent’s status. '+d.statusError:d.offline&&d.canSwitch?'This agent is offline. You can review a replacement here; your files stay in place.':!d.canSwitch?`This agent is ${d.status}. ${['working','blocked'].includes(d.status)?'Interrupt it or wait for it to finish before changing models.':'Refresh its status or finish session setup before changing models.'}`:'';
    node.textContent=message;
    const form=this.element.querySelector('#pack-model-form');
    form?.querySelector('button[type=submit]')?.toggleAttribute('disabled',!d.canSwitch||!!this.busy||!!this.stale||!!this.preview?.historyUnavailable&&!form.elements['acknowledge-history']?.checked);
    const checkpoint=this.element.querySelector('[data-setting-action=checkpoint]');if(checkpoint)checkpoint.disabled=!d.canSwitch||!!this.busy||!!this.preview||!!d.offline||!!this.stale;
    const actions=this.element.querySelector('[data-status-actions]');
    if(actions)actions.innerHTML=message?`${d.canRecover?'<button type="button" data-setting-action="recover">Resume Saved Session</button>':''}${['working','blocked'].includes(d.status)?'<button type="button" data-setting-action="interrupt">Interrupt Current Work</button>':''}${this.stale?'<button type="button" data-setting-action="reload">Reload Settings</button>':!d.canSwitch?'<button type="button" data-setting-action="refresh">Refresh Status</button>':''}`:'';
  }
  appearanceHTML(){
    return `<section class="appearance-settings" aria-label="Agent appearance"><div class="appearance-preview" style="${appearanceStyle({appearance:this.appearance})}"><span class="roster-avatar">${libraryIcon(this.appearance.icon,24)}</span><div><strong>${esc(this.details.role)}</strong><small>Your agent, recognizable everywhere</small></div><button type="button" data-setting-action="appearance">Save appearance</button></div><fieldset class="color-options"><legend>Color</legend>${agentColors.map(c=>`<label title="${c.name}" style="--swatch:${c.hex}"><input type="radio" name="appearance-color" value="${c.id}" aria-label="${c.name}" ${this.appearance.color===c.id?'checked':''}><span></span></label>`).join('')}</fieldset><details class="icon-options"><summary>Icon <span class="chosen-icon">${iconLabel(this.appearance.icon)}</span></summary><div>${agentIcons.map(name=>`<label title="${iconLabel(name)}"><input type="radio" name="appearance-icon" value="${name}" aria-label="${iconLabel(name)}" ${this.appearance.icon===name?'checked':''}><span>${libraryIcon(name,22)}</span></label>`).join('')}</div></details><p class="appearance-feedback" role="status"></p></section>`;
  }
  updateAppearance(){const preview=this.element.querySelector('.appearance-preview');preview.style.cssText=appearanceStyle({appearance:this.appearance});preview.querySelector('.roster-avatar').innerHTML=libraryIcon(this.appearance.icon,24);this.element.querySelector('.chosen-icon').textContent=iconLabel(this.appearance.icon);this.element.querySelector('.appearance-feedback').textContent='Preview · save to apply';}
  updateEffort(){
    const provider=this.details.providers.find(p=>p.id===this.kind),options=effortOptions(provider,this.model);
    if(!options.some(o=>o.reasoningEffort===this.effort))this.effort='';
    const field=this.element.querySelector('#agent-effort');if(!field)return;
    field.innerHTML='<option value="">Inherit provider settings</option>'+options.map(o=>`<option value="${esc(o.reasoningEffort)}">${esc(effortName(o.reasoningEffort))}</option>`).join('');
    field.value=this.effort;field.disabled=!!this.preview||!!this.busy||!options.length;
    this.element.querySelector('#agent-effort-note').textContent=effortHint(provider,this.model,this.effort);
  }
  render(){
    if(this.closed)return;
    if(!this.details.providers){this.element.innerHTML=`<div class="dialog-head"><h2>Agent Settings</h2><button type="button" data-setting-action="close" aria-label="Close agent settings">×</button></div><div class="settings-body"><p role="${this.loadError?'alert':'status'}">${esc(this.loadError||'Loading agent settings…')}</p>${this.loadError?'<button type="button" data-setting-action="reload">Try Again</button>':''}</div>`;return;}
    const d=this.details,provider=d.providers.find(p=>p.id===this.kind),cross=this.kind!==d.kind,custom=this.custom||!!this.model&&!provider.models.some(m=>m.id===this.model);
    if(provider.connections?.length&&!this.connectionId)this.connectionId=provider.connections.find(c=>c.supportsTools)?.id||'';
    const selectedConnection=provider.connections?.find(c=>c.id===this.connectionId&&c.supportsTools);
    const fresh=cross||this.preview?.freshSession||(this.connectionId||null)!==(d.connectionId||null);
    const context=fresh?'A fresh session starts in the same worktree. We keep the old provider’s records and any conversation history we can read. The replacement receives the handoff you review below; it does not inherit the other provider’s internal context.':'The same saved provider session reopens with the selected model and effort. Its conversation and saved compaction summaries remain available; a smaller context window may require further compaction.';
    this.element.innerHTML=`<div class="dialog-head"><div><h2>${esc(d.role)}’s Settings</h2><p class="settings-current">${esc(modelName(d.reportedModel||d.model))}${d.reportedEffort?` · ${esc(effortName(d.reportedEffort))} effort`:''}</p></div><button type="button" data-setting-action="close" aria-label="Close agent settings" ${this.busy?'disabled':''}>×</button></div>
      <form id="pack-model-form"><div class="settings-body">${this.appearanceHTML()}${this.onManage?`<section class="agent-availability"><div><strong>${d.profileId?'Shared agent profile':'Project agent'}</strong><p>${d.profileId?'Appearance is shared across all linked sessions.':'Make this agent reusable in this project or every project.'}</p></div><button type="button" data-setting-action="availability">Manage availability →</button></section>`:''}<section class="settings-observed" aria-label="Recorded session settings"><p>Requested: <code>${esc(d.model||'Provider default')}</code> · ${esc(effortName(d.effort))}</p><p>Last observed: ${d.reportedModel?`<code>${esc(d.reportedModel)}</code> · ${d.reportedEffort?esc(effortName(d.reportedEffort))+' effort':'effort not reported'}${d.modelObservedAt?` · ${esc(new Date(d.modelObservedAt).toLocaleString())}`:''}`:'No model response recorded yet.'}</p>${d.observationError?`<p class="form-note">Latest observation unavailable: ${esc(d.observationError)}</p>`:''}</section><fieldset ${this.preview||this.busy?'disabled':''}><div class="form-pair"><div><label for="agent-provider">Provider</label><select id="agent-provider" name="kind">${d.providers.map(p=>`<option value="${p.id}" ${p.id===this.kind?'selected':''} ${!p.installed&&!endpointProviderIds.includes(p.id)?'disabled':''}>${esc(p.label)}${esc(providerSetupLabel(p.id,p.installed))}</option>`).join('')}</select></div><div><label for="agent-model">Model</label><select id="agent-model" name="model-choice">${this.modelOptions(provider)}</select></div></div>${provider.connections?`<label>AI connection<select name="connectionId">${provider.connections.filter(c=>c.supportsTools).map(c=>`<option value="${c.id}" ${c.id===this.connectionId?'selected':''}>${esc(c.name)} · ${esc(c.location||c.region)}</option>`).join('')}</select></label><button type="button" data-setting-action="connection" ${selectedConnection?'hidden':''}>Set Up A Connection</button><div data-connection-status></div>`:''}${custom?`<label for="agent-custom-model">Exact model ID</label><input id="agent-custom-model" name="model" maxlength="150" required value="${esc(this.model)}" placeholder="Model supported by your provider">`:''}<p class="form-note" data-catalog-note>${esc(this.catalogNote(provider))}</p><label for="agent-effort">Reasoning effort</label><select id="agent-effort" name="effort" aria-describedby="agent-effort-note"></select><p id="agent-effort-note" class="form-note"></p></fieldset>
      <div data-native-settings></div>${d.kind==='claude'?'<section class="context-inspector"><strong>Claude role packs</strong><p>Choose role workspaces yourself, or let Jev match the assigned duties. Changes do not restart this agent.</p><button type="button" data-setting-action="role-packs">Open role packs</button></section>':''}<section class="context-inspector"><strong>Working context</strong><p>Inspect accumulated history or prepare a reviewed checkpoint. A fresh session keeps the same agent, files, and retrievable records.</p>${this.contextInfo?`<small>${this.contextInfo.eventCount} recorded events · ~${this.contextInfo.transcriptEstimateTokens.toLocaleString()} transcript tokens<br>${esc(this.contextInfo.estimateNote)}</small><p>Recommendation: <strong>${this.contextInfo.recommendation==='checkpoint'?'Prepare a checkpoint':'Continue this session'}</strong> · ${esc(this.contextInfo.source)}${this.contextInfo.decision?` · Jev: ${esc(this.contextInfo.decision.choice)}${Number.isFinite(this.contextInfo.decision.selectedProbability)?` (${Math.round(this.contextInfo.decision.selectedProbability*100)}% option probability)`:''} · ${Math.round(this.contextInfo.decision.confidence*100)}% confidence`:''}</p>${this.contextInfo.decisionError?`<p>${esc(this.contextInfo.decisionError)}</p>`:''}`:''}<div class="context-actions"><button type="button" data-setting-action="context" ${this.busy||this.preview?'disabled':''}>Assess context</button><button type="button" data-setting-action="checkpoint" ${!d.canSwitch||this.busy||this.preview?'disabled':''}>Prepare checkpoint</button></div><small>Configure Jev and a summary model in Project settings → AI & context.</small></section><section class="context-transfer"><strong>${fresh?'Continue with a reviewed handoff':'Keep this conversation'}</strong><p>${context}</p><p>Files, branch, role, contacts, and scoped HeloScrum tools stay with this agent. Shared memory remains available through its toolbox. Provider caches, active processes, and session-only approvals may need to be rebuilt or granted again.</p></section>
      ${this.preview?`<section class="settings-preview">${this.preview.historyUnavailable?`<div class="settings-wait"><p>${esc(this.preview.historyWarning)}</p><label class="settings-history-ack"><input type="checkbox" name="acknowledge-history"> I’ve reviewed the handoff and want to start without the unreadable history.</label></div>`:''}<strong>${esc(this.preview.from)} → ${esc(this.preview.to)} · ${esc(modelName(this.preview.model))} · ${esc(effortName(this.preview.effort))}</strong>${this.preview.freshSession?`<label for="agent-handoff">Context sent to ${esc(this.preview.to)}</label><textarea id="agent-handoff" name="handoff" rows="9" maxlength="16000" required>${esc(this.preview.handoff)}</textarea><p class="form-note">This text is sent to the fresh session when you apply. It contains recent excerpts, not a complete transfer of the old context. Edit it to preserve the decisions and next steps that matter.</p>`:'<p>The native session resumes with its saved history. The original task will not be submitted again.</p>'}</section>`:''}
      </div><div class="settings-status"><p data-session-status role="status"></p><div data-status-actions></div></div><p class="form-error" role="alert"></p><p class="settings-progress" role="status">${esc(this.progress||'')}</p><div class="dialog-actions">${this.preview?'<button type="button" data-setting-action="back">Back</button>':'<button type="button" data-setting-action="close">Cancel</button>'}<button type="submit" class="primary" ${!d.canSwitch||this.busy?'disabled':''}>${this.preview?this.preview.freshSession?'Start fresh with this handoff':'Apply settings':'Review change'}</button></div></form>`;
    this.updateEffort();this.updateStatus();
    mountConnectionIndicator(this.element.querySelector('[data-connection-status]'),{api:this.api,connection:selectedConnection});
    new NativeSetupFields(this.element.querySelector('[data-native-settings]'),{api:this.api,kind:this.kind,project:d.project,taskId:d.taskId,value:this.nativeSetup,disabled:!!this.preview||!!this.busy,onChange:value=>{this.nativeSetup=value;this.preview=null;}});
  }
  error(error){if(this.closed)return;this.element.querySelector('.form-error').textContent=error.message;}
  async action(action){
    if(this.busy)return;
    if(action==='close')return this.close();
    if(action==='reload'){this.stale=false;return this.load();}
    if(action==='connection')return openAIConnectionDialog(this.element.querySelector('[data-setting-action=connection]'),{api:this.api,kind:this.kind,onSaved:connection=>{
      if(this.closed)return;
      const provider=this.details.providers.find(p=>p.id===connection.kind);this.kind=connection.kind;
      provider.connections=[...(provider.connections||[]).filter(c=>c.id!==connection.id),connection];provider.installed=provider.connections.some(c=>c.supportsTools);provider.models=provider.connections.filter(c=>c.model).map(c=>({id:c.model,label:c.model,connectionId:c.id}));
      this.connectionId=connection.id;this.model=connection.model||'';this.custom=false;this.preview=null;this.render();this.element.querySelector('.settings-progress').textContent=connection.reused?'Using the existing connection. Review the change to use it for this agent.':'Connection saved. Review the change to use it for this agent.';
    }});
    if(action==='role-packs'){const data=await this.api('role-packs?task='+this.details.taskId).catch(error=>{if(error.status===404)throw Error('Role packs need the updated server. Reload HeloScrum when active agents are idle.');throw error;});const {RolePackDialog}=await import('/role-packs.js');if(this.closed)return;this.close();new RolePackDialog(this.button,data,{api:this.api});return;}
    if(action==='appearance'){this.busy=true;const button=this.element.querySelector('[data-setting-action=appearance]');button.disabled=true;try{await this.api('agent-appearance',{id:this.details.taskId,...this.appearance});this.details.appearance={...this.appearance};await this.onSaved({appearanceOnly:true});this.element.querySelector('.appearance-feedback').textContent='Appearance saved';}finally{this.busy=false;button.disabled=false;}return;}
    if(action==='back'){this.preview=null;this.render();return;}
    if(action==='interrupt'||action==='refresh'){
      if(action==='refresh')return this.refreshStatus();
      this.busy=true;this.progress='Interrupting the current turn…';this.render();
      try{await this.api('tasks/interrupt',{id:this.details.taskId});}finally{this.busy=false;this.progress='';this.render();}
      return this.refreshStatus();
    }
    if(action==='recover'){this.busy=true;try{const result=await this.api('agent-settings/recover',{id:this.details.taskId});await this.onSaved(result);this.close();}finally{this.busy=false;}return;}
    if(action==='context'||action==='checkpoint'){this.busy=true;this.render();try{if(action==='context')this.contextInfo=await this.api('context/evaluate',{id:this.details.taskId});else this.preview=await this.api('context/checkpoint',{id:this.details.taskId});}finally{this.busy=false;this.render();}return;}
    if(action==='preview'){
      this.busy=true;this.progress='Preparing your change and checking the previous conversation…';this.render();
      try{this.preview=await this.api('agent-settings/preview',{id:this.details.taskId,kind:this.kind,model:this.model,effort:this.effort,connectionId:this.connectionId,nativeSetup:this.nativeSetup});}
      finally{this.busy=false;this.progress='';this.render();this.element.querySelector('.settings-preview')?.scrollIntoView({behavior:'smooth',block:'start'});}
      return;
    }
    if(action==='apply'){
      const handoff=this.element.querySelector('[name=handoff]')?.value,acknowledgeIncompleteHistory=!!this.element.querySelector('[name=acknowledge-history]')?.checked;
      this.busy=true;for(const b of this.element.querySelectorAll('button,input,select,textarea'))b.disabled=true;
      this.element.querySelector('.settings-progress').textContent='Saving the session and applying the selected model and effort…';
      try{const result=await this.api('agent-settings/change',{id:this.details.taskId,previewId:this.preview.previewId,handoff,acknowledgeIncompleteHistory});this.close();await this.onSaved(result);}
      finally{this.busy=false;if(!this.closed){this.preview=null;this.render();}}
    }
  }
  close(){if(this.closed)return;this.closed=true;clearInterval(this.statusTimer);this.element.close();this.element.remove();this.button?.focus({preventScroll:true});this.onClose?.();}
}
