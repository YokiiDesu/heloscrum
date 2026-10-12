import {CONVERSATION_STYLES,conversationSetting} from './conversation-style.mjs';
import {nativeSelection} from './native-setup.mjs';
import path from 'node:path';
import {builtInProfiles} from './agent-profiles.mjs';
import {randomUUID} from 'node:crypto';
import {assert,string} from './adapters.mjs';
import {providerIds,endpointProviderIds} from './providers.mjs';
import {mcpToolName} from './mcp-connections.mjs';
import {availableIn,accessSettings,grantAssignedTools} from './resource-access.mjs';
import {appearanceFor,agentColors,agentIcons} from '../dist/agent-appearance.js';

export class ProjectSettings {
  constructor(plane){
    this.plane=plane;plane.data.agentProfiles||=[];
    const templates=builtInProfiles();
    plane.data.agentProfiles.unshift(...templates.filter(template=>!plane.data.agentProfiles.some(p=>p.id===template.id)));
    // Built-ins are immutable templates. Upgrade them once; customized copies
    // and already-running sessions retain their own instructions and settings.
    for(const template of templates){
      const saved=this.profile(template.id);
      if(saved.builtIn&&(saved.templateVersion||0)<template.templateVersion)Object.assign(saved,template,{revision:(saved.revision||0)+1});
    }
  }
  directory(project){
    const p=this.plane;p.projects.project(project);
    return {project,conversation:conversationSetting(p.data,project),schedule:p.scheduler?.settings(project),current:p.data.project,projects:p.projects.known().map(id=>({id,name:path.basename(id)})),
      agents:p.data.tasks.filter(t=>!t.trashedAt).map(t=>({id:t.id,project:t.project,role:t.role||t.title,kind:t.kind,model:t.model||'',nativeSetup:t.nativeSetup,connectionId:t.connectionId||null,summary:t.summary,instructions:t.prompt,roleType:t.roleType,profileId:t.profileId||null,archived:!!t.archivedAt,appearance:appearanceFor(t)})),
      profiles:p.data.agentProfiles.map(profile=>({...profile,sessions:p.data.tasks.filter(t=>t.profileId===profile.id).map(t=>({id:t.id,project:t.project,role:t.role||t.title,archived:!!t.archivedAt,trashed:!!t.trashedAt}))})),
      tools:p.collaboration.data.tools.map(t=>({...t,scope:t.scope||'project',assignment:t.assignment||'all',revision:t.revision||0})),
      aiConnections:p.ai?.list().connections||[],mcps:p.data.mcpServers.map(s=>p.mcp.public(s)),providers:providerIds.map(id=>({id,installed:p.providerAvailable?p.providerAvailable(id):!!p.tools[id]}))};
  }
  async setConversation(input){
    const p=this.plane,project=input.project||p.data.project;p.projects.project(project);
    const old=conversationSetting(p.data,project);
    assert(input.expectedRevision===old.revision,'Conversation settings changed. Reload settings before saving.',409);
    assert(CONVERSATION_STYLES.includes(input.style),'Choose Concise, Conversational, or Expressive');
    p.data.conversationStyles||={};
    p.data.conversationStyles[project]={style:input.style,revision:old.revision+1};
    await p.save();return p.data.conversationStyles[project];
  }
  profile(id){const profile=this.plane.data.agentProfiles.find(p=>p.id===id);assert(profile,'Agent profile not found',404);return profile;}
  async saveProfile(input){
    const p=this.plane,old=input.id?this.profile(input.id):null;
    assert(!old||old.revision===input.expectedRevision,'This agent profile changed. Reload settings before saving.',409);
    assert(!old?.builtIn,'Duplicate the built-in profile to customize it');
    const template=input.sourceProfileId?this.profile(input.sourceProfileId):null;
    if(template){assert(!input.id&&!input.sourceTaskId,'Duplicate a profile independently of existing sessions');input={...template,...input,id:undefined,name:input.name||template.name+' copy'};}
    const source=input.sourceTaskId?p.data.tasks.find(t=>t.id===input.sourceTaskId&&!t.trashedAt):null;
    if(input.sourceTaskId)assert(source&&!source.profileId,'This agent is already linked to a profile, or no longer available',409);
    const name=string(input.name??old?.name??source?.role,'agent name',80),kind=input.kind??old?.kind??source?.kind;
    assert(providerIds.includes(kind),'Choose a supported agent provider');
    const model=input.model??old?.model??source?.model??'';
    assert(typeof model==='string'&&model.length<=150&&(!model||/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]*$/.test(model)),'Invalid model ID');
    const connectionId=input.connectionId??old?.connectionId??source?.connectionId??null;
    if(endpointProviderIds.includes(kind)){const connection=p.ai.get(connectionId);assert(connection.kind===kind&&connection.supportsTools,'Choose a tool-capable connection for this provider');}
    const scope=input.scope??old?.scope??'project',project=scope==='global'?null:input.project??old?.project??source?.project??p.data.project;
    assert(['project','global'].includes(scope),'Choose one project or all projects');if(project)p.projects.project(project);
    const nativeSetup=nativeSelection(kind,input.nativeSetup??((old||source)?.kind===kind?(old||source).nativeSetup:null));
    const profile={...old,nativeSetup,id:old?.id||randomUUID(),name,kind,model,connectionId:endpointProviderIds.includes(kind)?connectionId:null,scope,project,summary:string(input.summary??old?.summary??source?.summary??name,'agent summary',1000),instructions:string(input.instructions??old?.instructions??source?.prompt,'agent instructions',16000),roleType:input.roleType??old?.roleType??source?.roleType??'worker',revision:(old?.revision||0)+1,...(template?{sourceProfileId:template.id}:{})};
    assert(['worker','recovery'].includes(profile.roleType),'Choose a supported role type');
    profile.appearance=input.appearance??old?.appearance??appearanceFor(source||profile);
    assert(agentColors.some(c=>c.id===profile.appearance.color)&&agentIcons.includes(profile.appearance.icon),'Choose a supported color and icon');
    if(old)Object.assign(old,profile);else p.data.agentProfiles.push(profile);
    if(source)source.profileId=profile.id;
    // Existing sessions retain their working files, provider, brief and history.
    // Identity is shared, so appearance edits also reach prior sessions.
    for(const task of p.data.tasks.filter(t=>t.profileId===profile.id)){task.appearance={...profile.appearance};task.appearanceRevision=(task.appearanceRevision||0)+1;}
    if(source){
      for(const tool of p.collaboration.data.tools)grantAssignedTools(p,tool,[tool.name],source);
      for(const server of p.data.mcpServers)grantAssignedTools(p,server,server.tools.map(t=>mcpToolName(server.id,t.name)),source);
    }
    await p.collaboration.notify('scope',name,`${name} agent profile updated`,project);
    return {...profile,agentIdentities:p.projects.identities()};
  }
  prepareTask(input,project){
    if(!input.profileId)return input;
    const profile=this.profile(input.profileId);assert(availableIn(profile,project),'This agent profile is not available in this project',403);
    const brief=string(input.prompt,'task prompt',16000),prompt=brief===profile.instructions?brief:profile.instructions+'\n\nTask in this project:\n'+brief;
    assert(prompt.length<=16000,'Agent instructions plus this task must fit within 16,000 characters');
    return {...input,role:input.role||profile.name,summary:input.summary||profile.summary,kind:input.kind||profile.kind,model:input.model??profile.model,nativeSetup:input.nativeSetup??((input.kind||profile.kind)===profile.kind?profile.nativeSetup:null),connectionId:input.connectionId??profile.connectionId,roleType:input.roleType||profile.roleType,prompt,profileId:profile.id,appearance:{...profile.appearance}};
  }
  async updateTool(input){
    const p=this.plane,tool=p.collaboration.data.tools.find(t=>t.id===input.id);assert(tool,'Tool not found',404);
    assert(input.expectedRevision===(tool.revision||0),'This tool changed. Reload settings before saving.',409);
    const access=accessSettings(p,input,tool);
    assert(!p.collaboration.data.tools.some(t=>t.id!==tool.id&&t.name===tool.name&&(access.scope==='global'||t.scope==='global'||t.project===access.project)),'Another tool with this name is already available in the target scope',409);
    Object.assign(tool,access,{revision:(tool.revision||0)+1});grantAssignedTools(p,tool,[tool.name]);
    await p.collaboration.notify('tool',tool.name,`${tool.name} availability updated`,tool.project);
    return {...tool};
  }
}
