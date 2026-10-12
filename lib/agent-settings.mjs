import {nativeSelection} from './native-setup.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, run, string } from './adapters.mjs';
import { effortOptions, cliEffortLevels } from './effort.mjs';
import { fingerprint } from './patch.mjs';

import { providerIds, providerName,endpointProviderIds,managedProvider } from './providers.mjs';
const selectedFields=['nativeSetup','nativeSetupSnapshot','kind','model','connectionId','resolvedModel','providerSessionId','transcriptPath','pane','workspace','name','phase','agentStartedAt','promptAttemptedAt','sessionStartedAt','sessionPrompt','resumeOnly','error','errorCode','agentState','reportedModel','effort','reportedEffort','modelObservedAt','contextRotation'];
async function within(promise,ms,message){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(message),{status:504})),ms);})]);}finally{clearTimeout(timer);}
}
function sessionState(task,agents){
  const live=agents.find(a=>a.pane_id===task.pane);
  const conflict=!live&&agents.some(a=>a.name===task.name||a.cwd===task.path);
  return {live,offline:!live&&!conflict,canSwitch:task.phase==='launched'&&!conflict&&(!live||live.interactive_ready&&['idle','done'].includes(live.agent_status))};
}
export function handoffText(task,history){
  const recent=[];let remaining=6000;
  for(const event of [...history.events].reverse()){
    if(event.type==='state'||event.type==='session')continue;
    const text=event.type==='tool'?`Tool ${event.name} (${event.status||'unknown'}):\n${event.input||''}\n${event.output||''}`:`${event.role==='user'?'User':'Agent'}: ${event.text||''}`;
    const excerpt=text.length>1800?text.slice(0,1100)+'\n[… excerpt shortened …]\n'+text.slice(-600):text;
    if(excerpt.length+2>remaining)break;recent.unshift(excerpt);remaining-=excerpt.length+2;
  }
  return `You are continuing the ${task.role||task.title} role in HeloScrum.\nTask: ${task.title}\nWorktree: ${task.path}\nBranch: ${task.branch}\n\nOriginal brief:\n${task.prompt.slice(0,4000)}${task.prompt.length>4000?'\n[Original brief shortened; consult the task record for the full instructions.]':''}\n\nRecent conversation excerpts (may omit older messages and long tool output):\n${recent.join('\n\n')}\n\nRead shared project memory and your inbox for current decisions. Verify the files before relying on older results. Do not repeat completed work. Acknowledge this handoff briefly, then wait for the user's next instruction.`;
}
export class AgentSettings {
  constructor(plane){this.plane=plane;this.previews=new Map();this.changing=new Set();this.providerCache=new Map();this.providerLoads=new Map();}
  async provider(kind,{quick=false}={}){
    const existing=this.cached&&Date.now()-this.cached.at<60000&&this.cached.value.providers.find(p=>p.id===kind);
    if(existing)return existing;
    const p=this.plane;
      const entry={id:kind,label:providerName(kind),installed:!!p.tools[kind],models:[],source:kind==='codex'?'Local Codex model catalog':kind==='kiro'?'Kiro CLI model catalog; availability depends on your account':'Claude Code model aliases; availability depends on your account'};
      if(endpointProviderIds.includes(kind)){entry.connections=await p.ai?.catalog(kind)||[];entry.installed=entry.connections.some(c=>c.supportsTools);entry.models=entry.connections.filter(c=>c.model).map(c=>({id:c.model,label:c.model,connectionId:c.id,isDefault:true}));entry.source='Configured AI connections; tool calling depends on the selected model';return entry;}
      if(kind==='cursor'){entry.source='Cursor CLI account; use Auto or an exact model from your Cursor account';entry.models=[{id:'auto',label:'Auto',isDefault:true}];return entry;}
      if(!entry.installed)return entry;
      const cached=this.providerCache.get(kind);if(cached&&Date.now()-cached.at<60000)return cached.value;
      if(quick)return {...entry,catalogPending:true};
      let loading=this.providerLoads.get(kind);
      if(!loading){loading=(async()=>{
      try{
        if(kind==='codex')entry.models=await p.transcripts.codex.models();
        else if(kind==='kiro')entry.models=await p.transcripts.kiro.models();
        else{
          const help=await run(p.tools.claude,['--help']);
          entry.effortLevels=cliEffortLevels(help);
          entry.models=[...(/\bfable\b/.test(help)?[{id:'fable',label:'Fable'}]:[]),{id:'opus',label:'Opus'},{id:'sonnet',label:'Sonnet'},{id:'haiku',label:'Haiku'}];
        }
      }catch(error){entry.error=error.message;}
      this.providerCache.set(kind,{at:Date.now(),value:entry});return entry;
      })().finally(()=>this.providerLoads.delete(kind));this.providerLoads.set(kind,loading);}
      try{return await within(loading,1500,'Model discovery is taking longer than expected');}
      catch(error){return {...entry,catalogPending:true,error:error.message};}
  }
  async catalog({quick=false,kind}={}){
    assert(!kind||providerIds.includes(kind),'Choose a supported agent provider');
    return {providers:await Promise.all((kind?[kind]:providerIds).map(id=>this.provider(id,{quick})))};
  }
  async selection(input){
    assert(providerIds.includes(input.kind),'Choose a supported agent provider');
    const provider=await this.provider(input.kind);
    assert(provider.installed,endpointProviderIds.includes(input.kind)?`Connect ${provider.label} in Settings → AI & Context and enable tool calling for agent sessions.`:`${provider.label} is not installed`,503);
    const connection=endpointProviderIds.includes(input.kind)?this.plane.ai.get(input.connectionId):null;
    if(connection)assert(connection.kind===input.kind&&connection.supportsTools,'Choose a tool-capable connection matching this provider');
    const model=input.model?string(input.model,'model',150):connection?.model||null;
    if(connection)assert(model,'Choose an exact model ID');
    assert(!model||/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]*$/.test(model),'Enter a model ID without spaces or command options');
    const nativeSetup=nativeSelection(input.kind,input.nativeSetup);
    const catalogDefault=['codex','kiro'].includes(input.kind)&&!nativeSetup.profile;
    const resolvedModel=model||(catalogDefault?provider.models.find(m=>m.isDefault)?.id:null);
    assert(!catalogDefault||model||resolvedModel,`The ${providerName(input.kind)} default model could not be determined. Choose an exact model ID.`,503);
    const effort=await this.validateEffort(input.kind,model,input.effort,provider);
    return {kind:input.kind,model,resolvedModel,effort,nativeSetup,connectionId:connection?.id||null};
  }
  async validateEffort(kind,model,value,provider){
    if(value===undefined||value===null||value==='')return null;
    assert(typeof value==='string','Choose a supported effort level');
    assert(kind!=='codex'||model,'Choose a model before setting an explicit effort level');
    provider ||= await this.provider(kind);
    assert(effortOptions(provider,model).some(o=>o.reasoningEffort===value),'This effort level is not supported by the selected model or local provider catalog');
    return value;
  }
  async details(id){
    const task=this.plane.task(id);let statusError;
    const agents=await this.plane.herdr.list({requireNative:!managedProvider(task)}).catch(error=>{statusError=error.message;return [];});
    const {live,offline,canSwitch}=sessionState(task,agents);
    return {nativeSetup:nativeSelection(task.kind,task.nativeSetup),connectionId:task.connectionId||null,profileId:task.profileId||null,project:task.project,appearance:task.appearance,effort:task.effort||null,reportedEffort:task.reportedEffort||null,modelObservedAt:task.modelObservedAt||null,statusError,taskId:task.id,role:task.role||task.title,kind:task.kind,model:task.model||null,revision:task.sessionRevision||0,status:statusError?'unknown':live?.agent_status||(offline?'offline':task.phase),offline:!statusError&&offline,
      canSwitch:!statusError&&canSwitch&&!this.changing.has(id),canRecover:!statusError&&!!task.sessionTransition?.from?.providerSessionId&&['setup-error','interrupted','awaiting-setup'].includes(task.phase)&&![task.pane,task.sessionTransition?.from?.pane].some(pane=>agents.some(a=>a.pane_id===pane)),sessionId:task.providerSessionId||null,reportedModel:task.reportedModel||null,
      archives:task.sessionArchives||[],...await this.catalog({quick:true})};
  }
  async switchHistory(task,state){
    // Opening settings never reads history. Read it only for the reviewed change.
    // An offline provider can be replaced even if its history service is gone,
    // but the user must explicitly acknowledge that gap before a fresh session.
    try{return await within(this.plane.transcripts.readCurrent(task,state.live,{full:true}),state.offline?2000:15000,'The previous provider did not return its conversation history in time');}
    catch(error){
      if(!state.offline||![404,409,503,504,undefined].includes(error.status))throw error;
      return {sessionId:task.providerSessionId||null,source:'Previous provider history unavailable',events:[],unavailable:true,warning:error.message};
    }
  }
  async preview(id,input){
    const p=this.plane,task=p.task(id),target=await this.selection({...input,nativeSetup:input.nativeSetup??(input.kind===task.kind?task.nativeSetup:null)});
    const nativeChanged=task.kind!==target.kind||JSON.stringify(nativeSelection(task.kind,task.nativeSetup))!==JSON.stringify(target.nativeSetup);
    const nativePlan=nativeChanged?await p.nativeSetup.inspect(target.kind,task.project,target.nativeSetup,{worktree:task.path,existing:task}):null;
    assert(!this.changing.has(id)&&task.phase==='launched','Finish session setup before changing providers or models',409);
    assert(input.restartSession===true&&!managedProvider(task)||nativeChanged||input.freshSession===true||task.kind!==target.kind||(task.connectionId||null)!==target.connectionId||(task.model||null)!==target.model||(task.effort||null)!==target.effort,'Choose different provider, model, effort, or native settings',409);
    const state=sessionState(task,await p.herdr.list({requireNative:!managedProvider(task)}));
    assert(state.canSwitch,'Wait for the agent to finish or interrupt it before switching',409);
    const history=await this.switchHistory(task,state),cross=target.kind!==task.kind,fresh=cross||nativeChanged||history.unavailable===true||input.freshSession===true||(task.connectionId||null)!==target.connectionId;
    const preview={id:randomUUID(),taskId:id,target,nativeChanged,nativeFingerprint:nativePlan?.fingerprint,revision:task.sessionRevision||0,sessionId:history.sessionId,historyUnavailable:!!history.unavailable,offline:state.offline,historyFingerprint:fingerprint(JSON.stringify(history.events)),createdAt:Date.now(),cross,fresh,
      handoff:fresh?handoffText(task,history):'',from:task.kind};
    for(const [key,value] of this.previews)if(Date.now()-value.createdAt>600000)this.previews.delete(key);
    this.previews.set(preview.id,preview);
    return {previewId:preview.id,crossProvider:cross,freshSession:fresh,handoff:preview.handoff,sessionId:history.sessionId,historyUnavailable:preview.historyUnavailable,historyWarning:history.unavailable?'The previous agent is offline and its conversation history could not be read. Its existing records and your files will be kept. The new session will receive only the handoff below. Review it and add any missing decisions before continuing.':null,from:providerName(task.kind),to:providerName(target.kind),model:target.model||'Provider default',effort:target.effort,eventCount:history.events.length};
  }
  async change(id,input){
    const p=this.plane,task=p.task(id),preview=this.previews.get(input.previewId);
    assert(preview&&preview.taskId===id&&Date.now()-preview.createdAt<600000,'Preview expired. Review the change again.',409);
    assert(!this.changing.has(id),'A session change is already in progress',409);
    assert(!p.promptingTasks?.has(id),'A message is being sent. Try again when it finishes.',409);
    assert(!p.collaboration.delivering.has(id),'A teammate message is arriving. Try again when it finishes.',409);
    assert(task.phase==='launched'&&(task.sessionRevision||0)===preview.revision&&task.kind===preview.from,'This session changed. Review it again.',409);
    assert(!preview.historyUnavailable||input.acknowledgeIncompleteHistory===true,'Confirm that the new session will start without the unreadable previous history.',409);
    this.changing.add(id);task.phase='switching'; // Pause message delivery before any await.
    let old,exited=false,installed=false;
    try{
      const handoff=preview.fresh?string(input.handoff,'handoff',16000):null;
      const state=sessionState({...task,phase:'launched'},await p.herdr.list({requireNative:!managedProvider(task)})),live=state.live;
      assert(state.canSwitch&&state.offline===preview.offline,'The agent status changed. Review the change again.',409);
      p.transcripts.cache.delete(task.id);
      const history=await this.switchHistory(task,state);
      assert(!!history.unavailable===preview.historyUnavailable&&history.sessionId===preview.sessionId&&fingerprint(JSON.stringify(history.events))===preview.historyFingerprint,'The conversation changed since preview. Review a fresh handoff.',409);
      old=Object.fromEntries(selectedFields.filter(k=>task[k]!==undefined).map(k=>[k,task[k]]));old.phase='launched';
      const candidate={...task,...preview.target,name:'wp-'+randomUUID().slice(0,8),phase:'starting',pane:null,workspace:null,sessionStartedAt:new Date().toISOString()};
      for(const key of ['agentStartedAt','promptAttemptedAt','error','errorCode','sessionPrompt','resumeOnly','agentState','reportedModel','reportedEffort','modelObservedAt'])delete candidate[key];
      if(preview.fresh){delete candidate.providerSessionId;delete candidate.transcriptPath;candidate.sessionPrompt=handoff;candidate.contextRotation=!preview.cross;if(preview.checkpoint)candidate.contextCheckpoint={...preview.checkpoint,reviewedHandoff:handoff};}
      else{candidate.providerSessionId=history.sessionId;candidate.resumeOnly=true;}
      if(preview.nativeChanged)await p.nativeSetup.prepare(candidate,{expected:preview.nativeFingerprint,existing:task});
      const args=await p.collaboration.launchConfig({...candidate,model:candidate.resolvedModel||candidate.model||(candidate.kind==='claude'&&!candidate.nativeSetup?.profile?'default':null)},{resumeSessionId:preview.fresh?undefined:history.sessionId});
      // Claude launchConfig allocates its ID; use an explicit candidate ID first.
      if(preview.fresh&&candidate.kind==='cursor'&&candidate.nativeSetup?.cursorMode==='interactive')candidate.providerSessionId=args[args.indexOf('--resume')+1];
      if(preview.fresh&&candidate.kind==='claude'){
        const index=args.indexOf('--session-id');candidate.providerSessionId=args[index+1];
      }
      if(!managedProvider(candidate)){const workspace=await p.herdr.createWorkspace(task.path,task.title);candidate.pane=workspace.root_pane.pane_id;candidate.workspace=workspace.workspace.workspace_id;}
      const archiveId=randomUUID(),at=new Date().toISOString(),dir=path.join(p.root,'.heloscrum/agents',id,'sessions');
      await mkdir(dir,{recursive:true,mode:0o700});
      await writeFile(path.join(dir,archiveId+'.json'),JSON.stringify({kind:task.kind,model:task.model||null,effort:task.effort||null,history,at}),{mode:0o600});
      if(p.history&&!history.unavailable)await p.history.captureTranscript(task,history,{messages:p.data.collaboration?.messages||[]});
      if(state.offline){
        const agents=(await p.herdr.list({requireNative:!managedProvider(task)})).filter(a=>a.pane_id!==candidate.pane);
        assert(sessionState({...task,phase:'launched'},agents).offline,'The previous agent reconnected. Review the change again.',409);
      }
      task.sessionTransition={id:archiveId,from:old,to:{kind:candidate.kind,model:candidate.model,effort:candidate.effort,pane:candidate.pane},at,status:'exiting'};await p.save();
      if(live)await p.herdr.exitAgent(old.pane);exited=true;
      for(const key of selectedFields)delete task[key];
      Object.assign(task,candidate,{sessionRevision:preview.revision+1,sessionTransition:{...task.sessionTransition,status:'starting'}});
      if(preview.fresh)task.sessionArchives=[...(task.sessionArchives||[]),{id:archiveId,kind:old.kind,toKind:task.kind,sessionId:history.sessionId,...(history.unavailable?{historyUnavailable:true}:{}),at}];
      task.previousPanes=[...(task.previousPanes||[]),{pane:old.pane,workspace:old.workspace,kind:old.kind,sessionId:history.sessionId}];
      installed=true;this.previews.delete(preview.id);p.transcripts.cache.delete(id);await p.save();
      try{await p.launch(task,args);task.sessionTransition.status='complete';await p.save();}
      catch(error){task.sessionTransition.status='needs-setup';await p.startupFailed(task,error);}
      await p.collaboration.notify('session',task.role||task.title,`${task.role||task.title}: ${providerName(task.kind)} · ${task.model||'provider default'} · effort ${task.effort||'inherited'}. ${task.phase!=='launched'?'Provider setup still needed.':preview.fresh?'Reviewed handoff saved in a fresh session.':'Same conversation resumed.'}`,task.project);
      return {ok:true,taskId:id,phase:task.phase,kind:task.kind,model:task.model||null,effort:task.effort||null,crossProvider:preview.cross,freshSession:preview.fresh};
    }catch(error){
      if(!installed){task.phase=exited?'setup-error':'launched';if(exited){task.error='The old session exited before the replacement was saved. Open model settings to resume the saved session.';task.errorCode='session_change_interrupted';}else if(task.sessionTransition?.status==='exiting')task.sessionTransition.status='cancelled';await p.save();}
      throw error;
    }finally{this.changing.delete(id);}
  }
  async recover(id){
    const p=this.plane,task=p.task(id);
    assert(!this.changing.has(id)&&!p.collaboration.delivering.has(id),'A session operation is in progress',409);
    assert((await this.details(id)).canRecover,'Resolve the running provider session before recovery',409);
    assert(!this.changing.has(id),'A session operation is in progress',409);this.changing.add(id);
    const transition=task.sessionTransition,previous=transition.from,phase=task.phase;task.phase='switching';let installed=false;
    try{
      const agents=await p.herdr.list({requireNative:!managedProvider(task)});assert(!agents.some(a=>a.pane_id===task.pane||a.pane_id===previous.pane),'An agent is still attached to this worktree',409);
      const candidate={...task,...previous,nativeSetup:previous.nativeSetup||{profile:null,files:[]},nativeSetupSnapshot:previous.nativeSetupSnapshot||null,effort:previous.effort||null,model:previous.model||null,resolvedModel:previous.resolvedModel||previous.model||null,name:'wp-'+randomUUID().slice(0,8),resumeOnly:true,phase:'starting'};
      for(const key of ['promptAttemptedAt','agentStartedAt','sessionPrompt','error','errorCode','agentState','reportedModel','reportedEffort','modelObservedAt'])delete candidate[key];
      const args=await p.collaboration.launchConfig(candidate,{resumeSessionId:previous.providerSessionId});
      if(!managedProvider(candidate)){const workspace=await p.herdr.createWorkspace(task.path,task.title);candidate.pane=workspace.root_pane.pane_id;candidate.workspace=workspace.workspace.workspace_id;}
      for(const key of selectedFields)delete task[key];
      Object.assign(task,candidate,{sessionRevision:(task.sessionRevision||0)+1,sessionTransition:{...transition,status:'recovering'},sessionArchives:(task.sessionArchives||[]).filter(a=>a.id!==transition.id)});
      p.transcripts.cache.delete(id);installed=true;await p.save();
      try{await p.launch(task,args);task.sessionTransition.status='recovered';await p.save();}catch(error){await p.startupFailed(task,error);}
      return {ok:true,phase:task.phase};
    }catch(error){if(!installed){task.phase=phase;await p.save();}throw error;}finally{this.changing.delete(id);}
  }
}
