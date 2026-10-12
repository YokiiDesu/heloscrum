import {assert} from './adapters.mjs';
import {claudeModConfig} from './claude-mod.mjs';
import {ROLE_PACKS,ROLE_PACK_MODES,ROLE_PACK_VERSION} from '../dist/role-pack-catalog.js';
import {ROLE_PACK_POLICY,rolePackRequest,rolePackAnswers,selectRolePacks,selectionFingerprint,roleHash} from './role-pack-selection.mjs';
import {accessibleRolePlans,rolePackPanels} from './role-pack-panels.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const codeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clip=(v,n)=>String(v||'').slice(0,n);
const schema={type:'object',properties:{sessionId:{type:'string'}},required:['sessionId'],additionalProperties:false};
export const ROLE_PACK_TOOLS=[
  {name:'role_pack_view',description:'Read the role workspaces and concise role guides enabled by the human for this Claude Code session. Source-backed excerpts are not full briefs or new authority. No inference, task changes or messages.',inputSchema:schema,annotations:{readOnlyHint:true}},
  {name:'role_pack_sync',description:'Refresh role selection at a session or turn boundary. Only human-enabled Jev Auto may make a bounded, cached decision. Cannot enable packs, change settings or grant permissions. Native Mod calls this; no polling needed.',inputSchema:schema}
];
export const packConfig=task=>task.claudeRolePacks||{mode:'off',pinned:[],revision:0};
export function validatePackConfig(input){
  assert(ROLE_PACK_MODES.includes(input.mode),'Choose Off, Manual or Jev Auto');
  assert(Array.isArray(input.pinned)&&input.pinned.length<=ROLE_PACK_POLICY.maxActive&&new Set(input.pinned).size===input.pinned.length&&input.pinned.every(id=>ROLE_PACKS.some(p=>p.id===id)),'Choose different packs from the installed role catalog');
  assert(input.mode!=='manual'||input.pinned.length>0,'Choose at least one manual pack');
  return {mode:input.mode,pinned:input.mode==='off'?[]:[...input.pinned]};
}
export function rolePackState(plane,task){
  const plans=accessibleRolePlans(plane,task),items=plans.flatMap(p=>p.items.filter(t=>t.ownerId===task.id&&!['done','cancelled'].includes(t.status)).map(t=>({p,t}))),owned=items.slice(0,10);
  const state={role:{title:clip(task.role||task.title,160),description:clip(task.prompt||task.summary,2400)},assignments:owned.map(({t})=>({id:t.id,title:clip(t.title,120),duties:clip(t.description,480),acceptance:clip(t.acceptance,320)})),coordination:plans.map(p=>({id:p.id,orchestrator:p.orchestratorId===task.id,processLead:p.management?.processLeadId===task.id,qaLead:p.management?.qaLeadId===task.id,delegatedReviewer:p.management?.reviewerIds?.includes(task.id)===true,goal:clip(p.management?.goal,180)})),sources:plans.map(p=>({id:p.id,revision:p.revision})),missing:[],excerpted:true};
  if(!state.role.description.trim()&&!items.length)state.missing.push('No role description or assigned duties');
  if(items.length>owned.length)state.missing.push('Additional assignments omitted from the bounded sample');
  return state;
}
export class RolePacks {
  constructor(plane,{compatible}={}){this.plane=plane;this.active=0;this.inflight=new Map();this.compatible=compatible|| (async task=>!!(await claudeModConfig({...task,path:task.path||task.project},plane.tools?.claude,codeRoot)).env);}
  async eligibility(task){
    if(task.kind!=='claude'||task.external)return {ok:false,reason:'Requires a Claude Code session'};
    if(!await this.compatible(task))return {ok:false,reason:'Claude Mods are disabled or this CLI version does not support them'};
    return {ok:true,reason:null};
  }
  connection(){try{const id=this.plane.data.contextSettings?.decisionConnectionId,c=id&&this.plane.ai.get(id);return c?.kind==='jev'&&c.enabled!==false?c:null;}catch{return null;}}
  input(task){const config=packConfig(task),state=rolePackState(this.plane,task),connection=config.mode==='auto'?this.connection():null;return {config,state,connection,fingerprint:selectionFingerprint(state,config,connection,task.kind)};}
  async configure(task,input){
    const next=validatePackConfig(input),old=packConfig(task);
    assert(input.expectedRevision===old.revision,'Role-pack settings changed. Refresh before saving.',409);
    if(next.mode!=='off')assert((await this.eligibility(task)).ok,'Role packs require enabled Claude Code Mods',409);
    // Recheck after the asynchronous version probe; two open dialogs cannot overwrite one another.
    assert(packConfig(task).revision===old.revision,'Role-pack settings changed. Refresh before saving.',409);
    task.claudeRolePacks={...next,revision:old.revision+1};delete task.rolePackSelection;
    await this.plane.save();await this.resolve(task);return this.view(task,{catalog:true});
  }
  async resolve(task,{retry=false}={}){
    const input=this.input(task),{config,state,connection,fingerprint}=input,eligible=await this.eligibility(task);
    if(this.input(task).fingerprint!==fingerprint)return null;
    const local=(status,reason,selected=[])=>({fingerprint,status,reason,selected,at:new Date().toISOString(),version:ROLE_PACK_VERSION,source:config.mode==='auto'?'Jev Auto':config.mode==='manual'?'Manual':'Off'});
    const save=async value=>{if(this.input(task).fingerprint!==fingerprint)return null;task.rolePackSelection=value;await this.plane.save();return value;};
    if(!eligible.ok)return save(local('unavailable',eligible.reason));
    if(config.mode==='off')return save(local('off','Role packs are off'));
    if(config.mode==='manual')return save(local('ready','Selected by you',config.pinned));
    const existing=task.rolePackSelection;
    if(existing?.fingerprint===fingerprint&&existing.status!=='unavailable'&&(!retry||existing.status==='ready'))return existing;
    if(this.inflight.has(task.id))return this.inflight.get(task.id);
    const fallback=reason=>save(local('fallback',reason,config.pinned));
    if(config.pinned.length===ROLE_PACK_POLICY.maxActive)return save(local('ready','All installed packs are pinned; no Jev call needed',config.pinned));
    if(!connection)return fallback('connection-unavailable');
    if(state.missing.includes('No role description or assigned duties'))return fallback('missing-evidence');
    if(JSON.stringify(state).length>ROLE_PACK_POLICY.maxStateChars)return fallback('input-limit');
    const now=Date.now(),attempts=(task.rolePackAttempts||[]).filter(at=>now-at<3600000);
    if(attempts.length>=ROLE_PACK_POLICY.maxAttemptsPerHour||attempts.some(at=>now-at<ROLE_PACK_POLICY.minAttemptIntervalMs))return fallback('rate-limit');
    if(this.active>=ROLE_PACK_POLICY.maxConcurrent)return fallback('service-busy');
    // Reserve before awaiting. No polling retries; failures wait for an explicit retry or changed duties.
    task.rolePackAttempts=[...attempts,now];this.active++;
    const promise=(async()=>{
      try{
        await this.plane.save();
        const {questions}=rolePackRequest(state),evaluation={policy:ROLE_PACK_POLICY,state,questions,fingerprint,configRevision:config.revision};
        const result=await this.plane.context.measuredCall(task,'role-pack-selection',connection.id,async()=>{
          const result=await this.plane.ai.decide(connection.id,state,questions,{signal:AbortSignal.timeout(ROLE_PACK_POLICY.timeoutMs)}),scores=rolePackAnswers(result);
          evaluation.validation=scores?'valid':'invalid-model-answer';evaluation.selected=scores?selectRolePacks(scores,config.pinned):config.pinned;evaluation.packVersion=ROLE_PACK_VERSION;evaluation.disposition=this.input(task).fingerprint===fingerprint?'current-candidate':'discarded-stale';
          return result;
        },evaluation);
        const scores=rolePackAnswers(result);if(!scores)return fallback('invalid-model-answer');
        const selected=selectRolePacks(scores,config.pinned);
        return save({...local('ready',selected.length?'Matched current duties':'no-confident-match',selected),scores,model:result.model||connection.model,usage:result.usage||null,policyVersion:ROLE_PACK_POLICY.version,threshold:ROLE_PACK_POLICY.threshold});
      }catch(error){return fallback(['AbortError','TimeoutError'].includes(error.name)?'service-timeout':['ENOSPC','EACCES','EROFS'].includes(error.code)?'audit-unavailable':error.status===401?'connection-rejected':error.status===422?'integration-error':'service-unavailable');}
      finally{this.active--;this.inflight.delete(task.id);}
    })();this.inflight.set(task.id,promise);return promise;
  }
  async sync(task,input){
    this.session(task,input);await this.resolve(task);
    task.rolePackNative={sessionId:task.providerSessionId,version:ROLE_PACK_VERSION,fingerprint:task.rolePackSelection?.fingerprint||null,at:new Date().toISOString()};await this.plane.save();return this.view(task);
  }
  session(task,input){assert(task.kind==='claude'&&!task.external&&input?.sessionId&&input.sessionId===task.providerSessionId,'Role packs belong to the current Claude Code session',403);}
  async read(task,input){this.session(task,input);return this.view(task);}
  async view(task,{catalog=false}={}){
    const eligible=await this.eligibility(task),{config,fingerprint}=this.input(task),stored=task.rolePackSelection,stale=stored?.fingerprint!==fingerprint;
    let selection=stored&&!stale?stored:{status:config.mode==='off'?'off':'pending',reason:config.mode==='off'?'Role packs are off':'Duties or settings changed; refresh selection',selected:config.mode==='off'?[]:config.pinned,source:config.mode==='auto'?'Jev Auto':config.mode==='manual'?'Manual':'Off'};
    if(!eligible.ok)selection={status:'unavailable',reason:eligible.reason,selected:[],source:selection.source};
    const panels=await rolePackPanels(this.plane,task,selection.selected),nativeCurrent=task.rolePackNative?.sessionId===task.providerSessionId&&task.rolePackNative?.fingerprint===fingerprint;
    return {schemaVersion:1,version:ROLE_PACK_VERSION,taskId:task.id,project:task.project,role:task.role||task.title,config,eligible,selection,panels,native:{current:!!nativeCurrent,at:task.rolePackNative?.at||null},...(catalog?{catalog:ROLE_PACKS,policy:ROLE_PACK_POLICY,jevAvailable:!!this.connection()}:{}),authority:'Read-only role views. Board permissions, independent verification and sponsor acceptance are unchanged.'};
  }
}
