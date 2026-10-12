import {atomicPrivateWrite} from './private-files.mjs';
import {readFile,mkdir,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assert,string,binary} from './adapters.mjs';
import {endpointProviderIds} from './providers.mjs';
import {ModelClient} from './model-client.mjs';

export const connectionDefaults={ollama:'http://127.0.0.1:11434/v1',llamacpp:'http://127.0.0.1:8080/v1',lmstudio:'http://127.0.0.1:1234/v1'};
export function connectionURL(value){
  let url;try{url=new URL(value);}catch{throw Error('Enter a complete http:// or https:// endpoint URL');}
  assert(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash,'Use an HTTP(S) URL without credentials, query, or fragment');
  assert(!['169.254.169.254','metadata.google.internal','0.0.0.0','[::]'].includes(url.hostname),'Use a reachable model server address');
  if(url.pathname==='/')url.pathname='/v1';
  return url.href.replace(/\/+$/,'');
}
const endpointIdentity=value=>{const url=new URL(connectionURL(value));if(url.hostname==='localhost')url.hostname='127.0.0.1';return url.href;};
const integer=(value,fallback,min,max,label)=>{value=value??fallback;assert(Number.isInteger(value)&&value>=min&&value<=max,`${label} must be between ${min} and ${max}`);return value;};
export class AIConnections {
  constructor(plane,{client=new ModelClient()}={}){this.plane=plane;this.client=client;this.secrets={};this.queue=Promise.resolve();plane.data.aiConnections||=[];plane.data.contextSettings||={memoryRankingEnabled:false,revision:0,decisionConnectionId:null,summaryConnectionId:null,budgetTokens:32000,toolResultChars:12000};}
  async init(){this.file=path.join(this.plane.root,'.heloscrum/ai-credentials.json');try{this.secrets=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}this.client.codex=await binary('codex',this.plane.root);this.client.claude=await binary('claude',this.plane.root);return this;}
  public(c){return {...c,hasKey:!!this.secrets[c.id],...(c.baseUrl?{location:['localhost','127.0.0.1','[::1]'].includes(new URL(c.baseUrl).hostname)?'This backend computer':'Network endpoint'}:{})};}
  list(){return {connections:this.plane.data.aiConnections.filter(c=>!c.archivedAt).map(c=>this.public(c)),archivedConnections:this.plane.data.aiConnections.filter(c=>c.archivedAt).map(c=>this.public(c)),settings:{...this.plane.data.contextSettings},summaryProviders:{codex:!!this.client.codex,claude:!!this.client.claude}};}
  get(id){const c=this.plane.data.aiConnections.find(c=>c.id===id);assert(c,'Choose an AI connection',404);assert(c.enabled!==false,'This AI connection is disabled',409);return c;}
  async keySave(){await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await atomicPrivateWrite(this.file,JSON.stringify(this.secrets));}
  serial(fn){const pending=this.queue.catch(()=>{}).then(fn);this.queue=pending;return pending;}
  configure(input){return this.serial(async()=>{
    const old=input.id?this.plane.data.aiConnections.find(c=>c.id===input.id):null;
    assert(!input.id||old,'AI connection not found',404);assert(!old||input.expectedRevision===old.revision,'Connection changed; reload before saving',409);
    const kind=input.kind??old?.kind;assert([...endpointProviderIds,'jev','codex-summary','claude-summary'].includes(kind),'Choose a supported AI service');assert(!old||old.kind===kind,'Create a separate connection to change service type');
    const c={id:old?.id||randomUUID(),revision:(old?.revision||0)+1,name:string(input.name??old?.name,'connection name',80),kind,enabled:input.enabled??old?.enabled??true,model:String(input.model??old?.model??(kind==='jev'?'jev-latest':'')),contextWindow:integer(input.contextWindow,old?.contextWindow||32768,4096,2000000,'Context window'),maxOutputTokens:integer(input.maxOutputTokens,old?.maxOutputTokens||4096,256,32768,'Output token limit'),supportsTools:input.supportsTools??old?.supportsTools??false,supportsImages:input.supportsImages??old?.supportsImages??false};
    assert(typeof c.enabled==='boolean'&&typeof c.supportsTools==='boolean'&&typeof c.supportsImages==='boolean','Connection flags must be booleans');
    if(['codex-summary','claude-summary'].includes(kind)){assert(kind==='claude-summary'?this.client.claude:this.client.codex,'Install the selected CLI and restart HeloScrum before configuring native summaries',503);assert(c.model,'Choose a model for native summaries');assert(!c.supportsTools,'Native summary connections cannot create agent sessions');assert(!input.apiKey&&!input.clearKey,'Native summaries use the signed-in CLI account');}
    assert(c.model.length<=150&&(!c.model||/^[\w][\w.:/\[\]-]*$/.test(c.model)),'Enter a model ID without spaces or command options');assert(c.maxOutputTokens<c.contextWindow,'Output limit must leave room for input');
    if(connectionDefaults[kind])c.baseUrl=connectionURL(input.baseUrl??old?.baseUrl??connectionDefaults[kind]);
    if(['bedrock','sagemaker'].includes(kind)){
      c.region=string(input.region??old?.region,'AWS region',40);assert(/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(c.region),'Enter a valid AWS region');
      c.profile=String(input.profile??old?.profile??'');assert(/^[\w.@+-]{0,100}$/.test(c.profile),'Enter an AWS profile name');
      if(kind==='sagemaker'){c.endpointName=string(input.endpointName??old?.endpointName,'SageMaker endpoint name',63);assert(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(c.endpointName),'Invalid SageMaker endpoint name');}
    }
    if(input.apiKey!==undefined)assert(typeof input.apiKey==='string'&&input.apiKey.length<=8192&&!/[\r\n\0]/.test(input.apiKey),'Invalid API key');
    if(!old&&connectionDefaults[kind]){
      const duplicate=this.plane.data.aiConnections.find(saved=>!saved.archivedAt&&saved.kind===kind&&saved.model===c.model&&endpointIdentity(saved.baseUrl)===endpointIdentity(c.baseUrl)&&(this.secrets[saved.id]||'')===(input.apiKey?.trim()||''));
      if(duplicate){
        assert(['contextWindow','maxOutputTokens','supportsTools','supportsImages','enabled'].every(key=>duplicate[key]===c[key]),'This model already has a connection. Use Manage in Settings → AI & Context to change its settings.',409);
        return {...this.public(duplicate),reused:true};
      }
    }
    if(input.apiKey?.trim())this.secrets[c.id]=input.apiKey.trim();
    if(input.clearKey)delete this.secrets[c.id];
    // Secrets are written first, excluded from state/history and all browser responses.
    await this.keySave();if(old)Object.assign(old,c);else this.plane.data.aiConnections.push(c);
    this.plane.agentSettings&&(this.plane.agentSettings.cached=null);await this.plane.save();return this.public(c);
  });}
  configureContext(input){return this.serial(async()=>{
    const old=this.plane.data.contextSettings;assert(input.expectedRevision===old.revision,'Context settings changed; reload before saving',409);
    const decisionConnectionId=input.decisionConnectionId||null,summaryConnectionId=input.summaryConnectionId||null;
    if(decisionConnectionId)assert(this.get(decisionConnectionId).kind==='jev','Choose Jev for context decisions');
    if(summaryConnectionId)assert(this.get(summaryConnectionId).kind!=='jev','Summaries need a language model, not Jev');
    assert(input.memoryRankingEnabled===undefined||typeof input.memoryRankingEnabled==='boolean','Memory ranking must be enabled or disabled');
    const memoryRankingEnabled=input.memoryRankingEnabled??old.memoryRankingEnabled??false;assert(!memoryRankingEnabled||decisionConnectionId,'Choose a Jev connection for memory ranking');
    Object.assign(old,{memoryRankingEnabled,revision:old.revision+1,decisionConnectionId,summaryConnectionId,budgetTokens:integer(input.budgetTokens,old.budgetTokens,4096,256000,'Working context budget'),toolResultChars:integer(input.toolResultChars,old.toolResultChars,2000,24000,'Tool result character limit')});
    await this.plane.save();return {...old};
  });}
  archive(input){return this.serial(async()=>{
    const c=this.plane.data.aiConnections.find(c=>c.id===input.id);
    assert(c&&connectionDefaults[c.kind],'Choose a saved local model connection',404);
    assert(input.expectedRevision===c.revision,'Connection changed; reload before saving',409);
    if(input.restore===true)delete c.archivedAt;
    else{
      const inUse=this.plane.data.tasks.some(t=>t.connectionId===c.id)||(this.plane.data.agentProfiles||[]).some(p=>p.connectionId===c.id)||this.plane.data.contextSettings.summaryConnectionId===c.id;
      assert(!inUse,'This connection is still used by an agent, profile, or summary setting. Choose another connection there first.',409);
      c.archivedAt=new Date().toISOString();
    }
    c.revision++;this.plane.agentSettings&&(this.plane.agentSettings.cached=null);await this.plane.save();return this.public(c);
  });}
  async catalog(kind){return this.plane.data.aiConnections.filter(c=>!c.archivedAt&&c.kind===kind&&c.enabled!==false).map(c=>this.public(c));}
  async discover(input){
    if(typeof input==='string')input={id:input};
    const saved=input.id?this.get(input.id):null,kind=input.kind??saved?.kind;
    assert(connectionDefaults[kind],'Choose a local model service to discover models');
    const baseUrl=connectionURL(input.baseUrl??saved?.baseUrl??connectionDefaults[kind]);
    assert(input.apiKey===undefined||typeof input.apiKey==='string'&&input.apiKey.length<=8192&&!/[\r\n\0]/.test(input.apiKey),'Invalid API key');
    // A draft may point to another server. Never forward a saved key to that new address.
    const key=input.apiKey?.trim()||(!input.clearKey&&saved?.baseUrl===baseUrl?this.secrets[saved.id]:undefined);
    const models=await this.client.models({kind,baseUrl,model:input.model??saved?.model},key);
    return {connectionId:saved?.id||null,models};
  }
  async test(id){const c=this.get(id);if(c.kind==='jev'){const result=await this.decide(id,{purpose:'connection check'},{connected:{type:'choice',instructions:'Select ready.',criteria:{ready:'Connection check',other:'Not ready'}}});assert(result.answers?.connected?.choice==='ready','Jev returned an unexpected answer',502);return {ok:true,model:result.model};}const result=await this.complete(id,{messages:[{role:'user',content:'Reply with OK.'}],maxTokens:256});return {ok:true,model:result.model||c.model,reply:result.message.content.slice(0,240),usage:result.usage};}
  complete(id,input){const c=this.get(id);return this.client.complete(c,this.secrets[id],input);}
  decide(id,state,questions,options){const c=this.get(id);return this.client.decide(c,this.secrets[id],state,questions,options);}
}
