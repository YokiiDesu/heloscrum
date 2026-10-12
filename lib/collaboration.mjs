import {conversationSetting} from './conversation-style.mjs';
import {ROLE_PACK_TOOLS} from './role-packs.mjs';
import {ACTIVITY_TOOL} from './activity-events.mjs';
import {claudeModConfig} from './claude-mod.mjs';
import {ExternalContacts,EXTERNAL_CONTACT_TOOLS} from './external-contacts.mjs';
import {IMAGE_TOOL,ATTACHMENT_UPLOAD_TOOL} from './image-attachments.mjs';
import {approvalRules,nativeApprovalTools,validateApprovalRules} from './tool-approvals.mjs';
import {NOTEBOOK_TOOLS} from './working-memory.mjs';
import {WORK_TOOLS} from './work-management.mjs';
import {assignedTo,availableIn,accessSettings,grantAssignedTools} from './resource-access.mjs';
import {agentIdentityRecords} from '../dist/agent-appearance.js';
import { kiroLaunchConfig } from './kiro.mjs';
import {cursorLaunchConfig,cursorInteractiveArgs} from './cursor.mjs';
import {endpointProviderIds} from './providers.mjs';
import {CONTEXT_TOOLS} from './context-manager.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { assert, string } from './adapters.mjs';
import { messageEnvelope, chatThreads, directThreadId } from './chat-messages.mjs';
import { AGENT_STATES, validateState } from './agent-state.mjs';

import { GROUP_TOOLS, GroupChats, deliveryProperties } from './group-chats.mjs';
import { sessionKey } from './session-identity.mjs';
import { UserRequests } from './user-requests.mjs';

export const CORE_TOOLS = [...ROLE_PACK_TOOLS.map(t=>t.name),'activity_report','attachment_upload','attachment_read','contact_book','read_inbox','send_message','toolbox','invoke_tool','report_state','request_support',...NOTEBOOK_TOOLS.map(t=>t.name),...CONTEXT_TOOLS.map(t=>t.name),...GROUP_TOOLS.map(t=>t.name),...WORK_TOOLS.map(t=>t.name)];

const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,36)||'agent';
const objectSchema = {type:'object',properties:{},additionalProperties:false};
export class Collaboration {
  constructor(plane){
    this.plane=plane;this.root=plane.root;this.codeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));this.connections=new Map();this.listeners=new Set();this.delivering=new Set();this.executing=new Set();
    plane.data.collaboration ||= {revision:0,tools:[],messages:[],notifications:[],credentials:{}};
    this.data=plane.data.collaboration;this.data.threads ||= [];this.data.refreshRequests ||= {};this.data.conversationStates ||= {};this.external=new ExternalContacts(this);this.groups=new GroupChats(this);
    if(this.data.catalogVersion!==15){this.data.catalogVersion=15;this.data.revision=this.nextCatalogRevision();}this.data.memory ||= [];this.data.supportRequests ||= [];this.data.stateReports ||= [];this.userRequests=new UserRequests(this);
    for(const message of this.data.messages)if(message.delivery==='delivering')message.delivery='uncertain';
  }
  participants(project){return [...this.plane.data.tasks,...this.external.active()].filter(t=>!project||t.project===project);}
  participant(id,project){return this.participants(project).find(t=>t.id===id);}
  contacts(project){return this.participants(project).map(t=>({id:t.id,role:t.role||t.title,summary:t.summary||(t.prompt||'').slice(0,300),tool:'chat_'+slug(t.role||t.title)+'_'+t.id.slice(0,8),kind:t.kind,phase:t.phase,roleType:t.roleType||'worker',...(t.external?{external:true,deliveryMode:'pull',client:t.client}:{} )}));}
  async notify(type,name,detail,project,links={}){const event={...links,id:randomUUID(),type,name,detail,project,revision:type==='human-request'?this.data.revision:(this.data.revision=this.nextCatalogRevision()),at:new Date().toISOString()};this.data.notifications.unshift(event);this.data.notifications=this.data.notifications.slice(0,200);await this.plane.save();for(const listener of this.listeners)listener(event);return event;}
  async register(task){
    this.data.credentials[task.id] ||= randomBytes(32).toString('hex');
    await this.notify('contact',task.role||task.title,`${task.role||task.title} has been added as a contact`,task.project,{taskId:task.id});
    return this.launchConfig(task);
  }
  authenticate(token){const entry=Object.entries(this.data.credentials).find(([,value])=>typeof token==='string'&&createHash('sha256').update(value).digest('hex')===createHash('sha256').update(token).digest('hex'));const task=entry&&this.participant(entry[0]);assert(task,'Agent capability is invalid',401);return task;}
  async launchConfig(task,{resumeSessionId}={}){
    const dir=path.join(this.root,'.heloscrum/agents',task.id);await mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,'connection.json');await writeFile(file,JSON.stringify({url:this.plane.baseUrl||'http://127.0.0.1:4173',token:this.data.credentials[task.id],taskId:task.id}),{mode:0o600});
    const command=process.execPath,args=[path.join(this.codeRoot,'scripts/mcp-bridge.mjs'),file];
    const model=task.model?['--model',task.model]:[];
    if(task.kind==='codex')return [...(resumeSessionId?['resume',resumeSessionId]:[]),...model,...(task.nativeSetup?.profile?['--profile',task.nativeSetup.profile.split(':')[1]]:[]),...(task.effort?['-c','model_reasoning_effort='+JSON.stringify(task.effort)]:[]),'-c','mcp_servers.heloscrum.command='+JSON.stringify(command),'-c','mcp_servers.heloscrum.args='+JSON.stringify(args),'-c','mcp_servers.heloscrum.enabled=true'];
    if(task.kind==='kiro')return kiroLaunchConfig(task,{command,args},{resumeSessionId,profile:await this.plane.nativeSetup?.kiroProfile(task)});
    if(task.kind==='cursor'){await cursorLaunchConfig(task,{command,args});if(task.nativeSetup?.cursorMode!=='interactive')return [];
      const hookCommand=[process.execPath,path.join(this.codeRoot,'scripts/agent-hook.mjs'),file,'cursor'].map(v=>"'"+v.replaceAll("'","'\\''")+"'").join(' ');
      return cursorInteractiveArgs(task,{executable:this.plane.tools.cursor,resumeSessionId,hookCommand});
    }
    if(endpointProviderIds.includes(task.kind))return [];
    assert(task.kind==='claude','Unsupported agent');
    task.providerSessionId ||= randomUUID();
    const hookCommand=[process.execPath,path.join(this.codeRoot,'scripts/agent-hook.mjs'),file].map(v=>"'"+v.replaceAll("'","'\\''")+"'").join(' ');
    const mod=await claudeModConfig(task,this.plane.tools?.claude,this.codeRoot);
    const settings={...(mod.env?{env:mod.env,permissions:{allow:['mcp__heloscrum__activity_report','mcp__heloscrum__role_pack_view','mcp__heloscrum__role_pack_sync']}}:{}),hooks:{SessionStart:[{hooks:[{type:'command',command:hookCommand}]}]}};
    return [...(resumeSessionId?['--resume',resumeSessionId]:['--session-id',task.providerSessionId]),...model,...(task.nativeSetup?.profile?['--agent',task.nativeSetupSnapshot?.agentName||task.nativeSetup.profile.split(':')[1]]:[]),...(task.effort?['--effort',task.effort]:[]),...mod.args,'--mcp-config',JSON.stringify({mcpServers:{heloscrum:{command,args}}}),'--settings',JSON.stringify(settings)];
  }
  rawCatalog(task){
    const contacts=this.contacts(task.project).filter(c=>c.id!==task.id),tools=this.data.tools.filter(t=>assignedTo(t,task,this.plane.data.agentProfiles));
    return {revision:this.catalogRevision(task),contacts,tools:[...(task.external?[{name:'contact_identity',description:'Read your external-contact identity, project, and delivery mode. This contact reads its inbox; it has no managed runtime or automatic wake-up.',inputSchema:objectSchema,annotations:{readOnlyHint:true}}]:[]),...GROUP_TOOLS,...WORK_TOOLS,...CONTEXT_TOOLS,...NOTEBOOK_TOOLS,
      IMAGE_TOOL,ATTACHMENT_UPLOAD_TOOL,...(task.kind==='claude'&&!task.external?[ACTIVITY_TOOL,...ROLE_PACK_TOOLS]:[]),
      {name:'report_state',description:'Report an actionable blocker or recovery change with evidence and next step. Skip routine focused, progress and completion reports. Reuse request_support(state) when asking the Therapist. Omit unknown metrics.',inputSchema:{type:'object',properties:{state:{type:'string',enum:AGENT_STATES},reason:{type:'string',maxLength:1000},nextStep:{type:'string',maxLength:1000},metrics:{type:'object',properties:{contextPercent:{type:'number',minimum:0,maximum:100},compactionCount:{type:'integer',minimum:0},repeatedFailures:{type:'integer',minimum:0}},additionalProperties:false}},required:['state','reason','nextStep'],additionalProperties:false}},
      {name:'request_support',description:'Ask your assigned recovery coach (Therapist) to help with loops, context pressure, or a blocker. Send a concise goal, attempts, and summary. Repeated calls reuse a pending request. This returns a delivery receipt; read_inbox gets the coach reply.',inputSchema:{type:'object',properties:{goal:{type:'string',maxLength:2000},summary:{type:'string',maxLength:3000},attempts:{type:'array',maxItems:6,items:{type:'string',maxLength:1000}},state:{type:'string',enum:AGENT_STATES}},required:['goal','summary','attempts'],additionalProperties:false}},
      {name:'memory_read',description:'Read shared project memory. Returns named notes with author and revision. Use memory_write with expectedRevision to avoid overwriting a teammate’s update.',inputSchema:{type:'object',properties:{key:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true}},
      {name:'memory_write',description:'Write a shared project note. Keep status notes concise. For a small shared interface contract, store its complete text with version/source hash under a stable key; a local path or summary alone may be unreadable to teammates. Use attached resources for larger contracts. Previous revisions remain in project history. Use expectedRevision from memory_read; use 0 for a new note. Do not store credentials or secrets.',inputSchema:{type:'object',properties:{key:{type:'string',maxLength:120},text:{type:'string',maxLength:16000},expectedRevision:{type:'integer',minimum:0}},required:['key','text','expectedRevision'],additionalProperties:false}},
      {name:'contact_book',description:'Read current teammate IDs, roles and shared groups only when you need a contact not already in your brief.',inputSchema:objectSchema,annotations:{readOnlyHint:true}},
      {name:'read_inbox',description:'Read DMs and all messages addressed to you in groups you belong to. External contacts can use unreadOnly=true; after handling a message, call ack_inbox with its delivery ID. Reading records delivery, not successful handling. Use nextCursor to continue a page.',inputSchema:{type:'object',properties:{after:{type:'string'},unreadOnly:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:true}},
      ...(task.external?[{name:'ack_inbox',description:'Mark delivered inbox messages handled after inspecting their contents and attachments or reporting them to the user. This saves a checkpoint only; it sends no acknowledgement and wakes nobody. Retry the same IDs safely. Unhandled messages remain available with unreadOnly=true.',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'},minItems:1,maxItems:50,uniqueItems:true}},required:['ids'],additionalProperties:false}}]:[]),
      {name:'send_message',description:'Provide either to or threadId. Send a DM with to=agent ID. Start a group chat with to=[two or more contact IDs] and optional name. Reply to the whole group with threadId from its receipt or inbox message. Use create_group/list_groups/read_group for explicit group controls. Choose kind=request, result, or ack; set requiresReply=false for final results. Acks never wake agents. Do not acknowledge acknowledgements or send repeated closing statements. Use replyTo for a recorded message in that conversation. Returns delivery receipts; queued recipients receive input when ready. Read contact_book for IDs.',inputSchema:{type:'object',properties:{to:{oneOf:[{type:'string'},{type:'array',items:{type:'string'},minItems:2,maxItems:20,uniqueItems:true}]},threadId:{type:'string'},name:{type:'string',maxLength:100},message:{type:'string',maxLength:16000},...deliveryProperties},required:['message'],additionalProperties:false}},
      {name:'toolbox',description:'Discover allowed tools without loading the whole catalog. No arguments returns a paginated compact index. Use name for one exact schema, or query for up to 6 matching schemas, then invoke_tool. Discovery does not grant access.',inputSchema:{type:'object',properties:{name:{type:'string'},query:{type:'string',maxLength:200},offset:{type:'integer',minimum:0}},additionalProperties:false},annotations:{readOnlyHint:true}},
      {name:'invoke_tool',description:'Call a currently registered shared tool by name. This stable entry point supports tools added during your session.',inputSchema:{type:'object',properties:{name:{type:'string'},input:{type:'object'}},required:['name','input'],additionalProperties:false}},
      ...contacts.map(c=>({name:c.tool,description:`Chat directly with ${c.role}. ${c.summary} Agent ID: ${c.id}. Use kind=request for work, result for findings, ack for a quiet receipt. Acks never wake agents. Set requiresReply=false for final results; do not send repeated closing statements. Replies arrive in read_inbox and are delivered to your session. Return value is a delivery receipt, not an invented agent reply.`,inputSchema:{type:'object',properties:{message:{type:'string',maxLength:16000},...deliveryProperties},required:['message'],additionalProperties:false}})),
      ...tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema,source:{type:'local',id:t.id,name:'Local tools',toolName:t.name,scope:t.scope||'project'}})),
      ...(this.plane.mcp?.catalog(task)||[])
    ]};
  }
  allowed(task,name){if(name==='activity_report'||ROLE_PACK_TOOLS.some(t=>t.name===name))return task.kind==='claude'&&!task.external;if(task.external)return this.external.active(task.project).some(c=>c.id===task.id)&&EXTERNAL_CONTACT_TOOLS.has(name);return CORE_TOOLS.includes(name)||name.startsWith('chat_')||task.toolPolicy?.mode!=='selected'||task.toolPolicy.allowed.includes(name);}
  catalog(task,{compact=false}={}){const catalog=this.rawCatalog(task);return {...catalog,...(compact?{contacts:undefined,deferred:true}:{}),tools:catalog.tools.filter(tool=>this.allowed(task,tool.name)&&(!compact||task.external||['role_pack_view','role_pack_sync','activity_report','work_brief','work_update_task','notebook_read','notebook_write','memory_search','read_inbox','send_message','toolbox','invoke_tool','context_read'].includes(tool.name)))};}
  discover(task,input={}){
    const all=this.catalog(task).tools.filter(t=>!t.name.startsWith('chat_')),offset=input.offset??0;
    assert(Number.isInteger(offset)&&offset>=0,'Use a nonnegative tool offset');
    if(input.name){const tool=all.find(t=>t.name===input.name);assert(tool,'Tool is not available in your assigned toolbox',404);return {tools:[tool],revision:this.catalogRevision(task)};}
    assert(input.query===undefined||typeof input.query==='string'&&input.query.length<=200,'Use a query of at most 200 characters');const query=input.query?.trim().toLowerCase();
    const matches=query?all.filter(t=>(t.name+' '+t.description+' '+(t.source?.name||'')).toLowerCase().includes(query)):all,limit=query?6:30;
    return {tools:matches.slice(offset,offset+limit).map(t=>query?t:{name:t.name,description:t.description.slice(0,160),source:t.source}),total:matches.length,nextOffset:offset+limit<matches.length?offset+limit:null,revision:this.catalogRevision(task),next:'Request an exact schema with toolbox(name), then invoke_tool(name,input).'};
  }
  scope(task){const catalog=this.rawCatalog(task);const approvalSupport=['codex','cursor'].includes(task.kind)?'Recognizes MCP approval menus; other native prompt formats remain manual.':task.kind==='kiro'?'Recognizes Kiro V3 tool menus; V2 and unrecognized formats remain manual.':task.kind==='claude'?'Claude Code prompt formats currently need a manual response in the native terminal. Saved rules do not auto-approve them.':'Recognizes workspace command approval prompts.';return {approvalSupport,approvals:approvalRules(task),nativeTools:nativeApprovalTools(task),taskId:task.id,role:task.role||task.title,roleType:task.roleType||'worker',mode:task.toolPolicy?.mode||'all',revision:task.toolPolicy?.revision||0,supportAgentId:task.supportAgentId||null,tools:catalog.tools.map(tool=>({...tool,allowed:this.allowed(task,tool.name),locked:CORE_TOOLS.includes(tool.name)||tool.name.startsWith('chat_'),group:tool.name.startsWith('chat_')?'contact':CORE_TOOLS.includes(tool.name)?'core':tool.name.startsWith('memory_')?'memory':'tool'})),coaches:this.contacts(task.project).filter(c=>c.id!==task.id&&c.roleType==='recovery')};}
  async setScope(task,input){
    assert(input.expectedRevision===(task.toolPolicy?.revision||0),'Tool access changed. Reopen this toolbox before saving.',409);
    assert(['all','selected'].includes(input.mode),'Choose all tools or selected tools');
    const optional=this.rawCatalog(task).tools.filter(t=>!CORE_TOOLS.includes(t.name)&&!t.name.startsWith('chat_')).map(t=>t.name);
    assert(Array.isArray(input.allowed)&&input.allowed.every(name=>optional.includes(name)),'Unknown or non-configurable tool');
    if(input.supportAgentId){const coach=this.plane.data.tasks.find(t=>t.id===input.supportAgentId&&t.project===task.project&&t.id!==task.id&&t.roleType==='recovery');assert(coach,'Choose a recovery coach in this project');assert(task.roleType!=='recovery','Recovery coaches cannot request support from another coach');}
    const approvals=input.approvals===undefined?task.toolPolicy?.approvals:validateApprovalRules(input.approvals,task,this.rawCatalog(task));
    task.toolPolicy={mode:input.mode,allowed:[...new Set(input.allowed)],...(approvals?{approvals}:{}),revision:(task.toolPolicy?.revision||0)+1};task.supportAgentId=input.supportAgentId||null;
    await this.notify('scope',task.role||task.title,`${task.role||task.title}’s toolbox access has been updated`,task.project,{taskId:task.id});return this.scope(task);
  }
  async reportState(task,input){
    const next=validateState(input),old=task.agentState;
    const same=old&&old.state===next.state&&old.reason===next.reason&&old.nextStep===next.nextStep&&['contextPercent','compactionCount','repeatedFailures'].every(k=>old.metrics?.[k]===next.metrics?.[k]);
    if(same){await this.plane.save();return {state:old.state,source:'agent',recorded:false};}
    const report={...next,id:randomUUID(),taskId:task.id,project:task.project};task.agentState=report;
    this.data.stateReports.push(report);this.data.stateReports=this.data.stateReports.slice(-500);await this.plane.save();
    return {state:report.state,source:'agent',recorded:true};
  }
  async requestSupport(task,input){
    assert(task.roleType!=='recovery','Recovery coaches must reply directly, not chain support requests',409);
    const coach=this.plane.data.tasks.find(t=>t.id===task.supportAgentId&&t.project===task.project&&t.roleType==='recovery');assert(coach,'No recovery coach assigned. Ask the user to choose one in your Toolbox.',409);
    const goal=string(input.goal,'support goal',2000),summary=string(input.summary,'support summary',3000);assert(Array.isArray(input.attempts)&&input.attempts.length<=6&&input.attempts.every(v=>typeof v==='string'&&v.length<=1000),'Provide up to six short attempts');
    if(input.state!==undefined)validateState({state:input.state,reason:summary.slice(0,1000),nextStep:'Await the requested recovery plan'});
    const previous=this.data.supportRequests.findLast(r=>r.taskId===task.id&&r.coachId===coach.id);
    if(previous&&!previous.replyId){if(input.state!==undefined)await this.reportState(task,{state:input.state,reason:summary.slice(0,1000),nextStep:'Await the requested recovery plan'});return {...previous,reused:true,next:'Yield the turn or continue independent work. Do not poll the inbox in a tight loop.',receipt:this.data.messages.find(m=>m.id===previous.messageId)};}
    assert(!previous||Date.now()-Date.parse(previous.at)>60000,'Wait a minute before requesting another recovery review',429);
    // Reserve before awaiting persistence so concurrent calls cannot duplicate a request.
    const request={id:randomUUID(),taskId:task.id,coachId:coach.id,at:new Date().toISOString()};this.data.supportRequests.push(request);
    try{
      if(input.state!==undefined)await this.reportState(task,{state:input.state,reason:summary.slice(0,1000),nextStep:'Await the requested recovery plan'});
      const text=`Recovery request from ${task.role||task.title}.\nGoal: ${goal}\nBlocker: ${summary}\nAttempts:\n${input.attempts.map((a,i)=>`${i+1}. ${a}`).join('\n')||'None reported.'}\nReported work state: ${task.agentState?.state||'not reported'}.${task.agentState?.reason?'\nReported reason: '+task.agentState.reason:''}${task.agentState?.nextStep?'\nPlanned next step: '+task.agentState.nextStep:''}\nPlease reply with a brief reset plan and one concrete next check.`;
      const receipt=await this.send(task,coach.id,text,{requestId:request.id});request.messageId=receipt.id;await this.plane.save();return {...request,next:'Yield the turn or continue independent work. The reply is delivered to your session when ready; do not poll in a tight loop.',receipt};
    }catch(error){if(!request.messageId)this.data.supportRequests=this.data.supportRequests.filter(r=>r.id!==request.id);throw error;}
  }
  catalogRevision(task){return Math.max(this.data.revision,this.data.refreshRequests[task.id]?.revision||0);}
  nextCatalogRevision(){return Math.max(this.data.revision,...Object.values(this.data.refreshRequests).map(r=>r.revision))+1;}
  async refreshContacts(project,taskId){
    const tasks=this.participants(project).filter(t=>!taskId||t.id===taskId);
    assert(tasks.length,'Contact not found in this project',404);
    const revision=this.nextCatalogRevision(),at=new Date().toISOString();
    for(const task of tasks)this.data.refreshRequests[task.id]={revision,at};
    // Existing bridges already watch catalog revisions. Request discovery without
    // prompting/restarting a model or claiming the runtime has fetched the list.
    await this.plane.save();return {requested:tasks.map(t=>t.id),revision,at};
  }
  seen(task,revision){assert(Number.isInteger(revision)&&revision>=0&&revision<=this.catalogRevision(task),'Invalid catalog revision');const connection=this.connections.get(task.id)||{};this.connections.set(task.id,{...connection,seenRevision:Math.max(connection.seenRevision||0,revision),lastSeen:Date.now()});}
  heartbeat(task){this.connections.set(task.id,{...this.connections.get(task.id),lastSeen:Date.now()});}
  snapshot(project){return {prompts:this.data.messages.filter(m=>m.project===project&&m.sessionPrompt&&['queued','delivering','uncertain'].includes(m.delivery)),revision:this.data.revision,contacts:this.contacts(project).map(c=>({...c,catalogRevision:this.catalogRevision(c),refreshRequestedAt:this.data.refreshRequests[c.id]?.at||null,discovery:this.connections.get(c.id)||null,connected:Date.now()-(this.connections.get(c.id)?.lastSeen||0)<15000})),tools:[...this.data.tools.filter(t=>availableIn(t,project)).map(({executable,args,...tool})=>tool),...(this.plane.mcp?.list(project)||[]).flatMap(server=>(server.tools||[]).map(t=>({...t,enabled:server.enabled,sourceName:server.name,sourceId:server.id,scope:server.scope})))],mcpServers:this.plane.mcp?.list(project)||[],scopes:Object.fromEntries(this.plane.data.tasks.filter(t=>t.project===project).map(t=>[t.id,this.scope(t)])),builtinToolCount:9+GROUP_TOOLS.length+WORK_TOOLS.length+CONTEXT_TOOLS.length+NOTEBOOK_TOOLS.length,memory:this.data.memory.filter(m=>m.project===project),notifications:this.data.notifications.filter(n=>n.project===project||n.project===null),threadCount:this.threads(project).length,directoryThreadCount:this.chatProjects().reduce((count,p)=>count+this.threads(p.id).length,0),userRequests:this.data.userRequests.filter(q=>q.project===project),messages:this.data.messages.filter(m=>m.project===project).slice(-150)};}
  threads(project){return chatThreads(this.data.messages,this.data.threads,this.contacts(project),project,this.data.conversationStates).map(thread=>({...thread,projectName:path.basename(project)||project}));}
  chatProjects(){return [...new Set([this.plane.data.project,...this.participants().map(t=>t.project),...this.data.threads.map(t=>t.project),...this.data.messages.map(m=>m.project)].filter(Boolean))].map(id=>({id,name:path.basename(id)||id})).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));}
  // This directory is exposed only through the authenticated human API. Agent
  // tools continue to use their own project and group membership checks.
  threadDirectory(){const projects=this.chatProjects();return {agentIdentities:agentIdentityRecords(this.participants()),projects,threads:projects.flatMap(p=>this.threadList(p.id))};}
  chatProject(project=this.plane.data.project){assert(typeof project==='string'&&this.chatProjects().some(p=>p.id===project),'Chat project not found',404);return project;}
  threadList(project){return this.threads(project).map(({messages,...thread})=>({...thread,preview:thread.preview.slice(0,180)}));}
  threadPage(project,id,before){
    const thread=this.threads(project).find(t=>t.id===id);assert(thread,'Chat thread not found in this project',404);
    const end=before?thread.messages.findIndex(m=>m.id===before):thread.messages.length;assert(end>=0,'Message cursor not found in this thread',404);
    const start=Math.max(0,end-60),messages=thread.messages.slice(start,end);
    return {...thread,messages,userRequests:this.data.userRequests.filter(q=>q.project===project&&q.threadId===id),hasMore:start>0,before:messages[0]?.id||null};
  }
  messageOptions(sender,id,options){
    assert(this.data.conversationStates[id]?.status!=='closed','Conversation is closed. Reopen it explicitly for new evidence or requirements.',409);
    const kind=options.kind||'request';assert(['request','result','ack'].includes(kind),'Choose request, result, or ack');
    assert(options.requiresReply===undefined||typeof options.requiresReply==='boolean','requiresReply must be a boolean');
    assert(kind!=='ack'||options.requiresReply!==true,'Acknowledgements cannot require replies');
    if(kind==='ack'&&options.replyTo){const parent=this.data.messages.find(m=>m.id===options.replyTo||m.groupMessageId===options.replyTo);assert(parent?.kind!=='ack','Do not acknowledge an acknowledgement',409);}
    return {kind,requiresReply:kind==='ack'?false:options.requiresReply??(kind==='request'),delivery:kind==='ack'?'inbox':'queued',fromSessionKey:sessionKey(sender),envelopeVersion:3};
  }
  async sendGroup(sender,to,message,options={}){
    const question=sender.human&&options.replyTo&&options.kind!=='ack'&&this.data.userRequests.find(q=>q.id===options.replyTo&&q.project===sender.project);
    if(question){assert(!options.attachments?.length,'Send files as a new group message; answers to agent questions currently accept text only.');assert(options.threadId===question.threadId,'Reply does not belong to this group chat');return this.userRequests.answer(sender,{requestId:question.id,response:message});}
    if(options.attachments!==undefined){const attachments=await this.plane.images.selectFor(sender,options.attachments),group=options.threadId?this.groups.available(sender,options.threadId):this.groups.draft(sender,{name:options.name,participants:to});for(const member of group.participants){const id=typeof member==='string'?member:member.id,task=this.participant(id,sender.project);if(task&&task.id!==sender.id)this.plane.images.validateModel(task,attachments);}options={...options,attachments};message=message||(attachments.length?'Please inspect the attached files.':'');}
    const receipt=this.prepareGroup(sender,to,message,options);await this.plane.save();return receipt;
  }
  prepareGroup(sender,to,message,options={}){
    const {threadId,name,replyTo,requestId}=options;string(message,'message',16000);
    let group=threadId&&this.data.threads.find(g=>g.id===threadId&&g.project===sender.project);
    if(threadId)assert(group&&(sender.human||group.participants.includes(sender.id)),'Group chat is not available to this agent',403);
    else group=this.groups.draft(sender,{name,participants:to});
    if(replyTo)assert(this.data.messages.some(m=>(m.id===replyTo||m.groupMessageId===replyTo)&&m.project===sender.project&&m.threadId===group.id),'Reply does not belong to this group chat');
    if(requestId){string(requestId,'request ID',120);const old=this.data.messages.find(m=>m.from===sender.id&&m.project===sender.project&&m.requestId===requestId);if(old){assert(old.threadId&&(!threadId||old.threadId===threadId)&&this.data.threads.find(g=>g.id===old.threadId)?.participants.join()===group.participants.join()&&old.text===message&&JSON.stringify(old.attachments||[])===JSON.stringify(options.attachments||[])&&old.replyTo===(replyTo||null)&&old.kind===(options.kind||'request')&&old.requiresReply===(options.kind==='ack'?false:options.requiresReply??((options.kind||'request')==='request')),'Request ID belongs to another message',409);return this.groupReceipt(old.groupMessageId);}}
    const delivery=this.messageOptions(sender,group.id,options);
    const recipients=group.participants.filter(id=>id!==sender.id).map(id=>this.participant(id,sender.project));
    assert(recipients.every(Boolean),'A group contact is no longer available',409);
    for(const recipient of recipients)assert(this.data.messages.filter(m=>m.to===recipient.id&&['queued','delivering'].includes(m.delivery)).length<100,'Recipient inbox is full',429);
    const groupMessageId=randomUUID(),at=new Date().toISOString();
    if(!threadId)this.data.threads.push(group);
    for(const recipient of recipients)this.data.messages.push({id:randomUUID(),groupMessageId,threadId:group.id,threadName:group.name,project:sender.project,from:sender.id,to:recipient.id,fromRole:sender.role||sender.title,toRole:recipient.role||recipient.title,text:message,...(options.attachments?.length?{attachments:options.attachments}:{}),replyTo:replyTo||null,requestId:requestId||null,at,...delivery});
    return this.groupReceipt(groupMessageId);
  }
  groupReceipt(id){const messages=this.data.messages.filter(m=>m.groupMessageId===id);return {id,threadId:messages[0].threadId,kind:messages[0].kind,requiresReply:messages[0].requiresReply,receiptOnly:true,deliveries:messages.map(({id,to,toRole,delivery})=>({id,to,toRole,delivery}))};}
  async send(sender,to,message,options={}){
    const {replyTo,requestId}=options;
    if(options.schedule)assert(sender.human,'Only the backend schedules check-ins',403);
    if(Array.isArray(to)||options.threadId)return this.sendGroup(sender,to,message,options);
    assert(typeof to==='string'&&to.length>0,'Provide a recipient in to or a group threadId');
    const recipient=this.participant(to,sender.project);assert(recipient,'Contact is not in your project',404);assert(sender.id!==to,'Choose another agent');
    const attachments=options.attachments!==undefined?await this.plane.images.selectFor(sender,options.attachments):[];if(attachments.length)this.plane.images.validateModel(recipient,attachments);message=message||(attachments.length?'Please inspect the attached files.':'');string(message,'message',16000);
    if(replyTo)assert(this.data.messages.some(m=>m.id===replyTo&&!m.threadId&&m.project===sender.project&&[m.from,m.to].includes(sender.id)&&[m.from,m.to].includes(to)),'Reply does not belong to this conversation');
    if(requestId){string(requestId,'request ID',120);const old=this.data.messages.find(m=>m.from===sender.id&&m.requestId===requestId);if(old){assert(!old.threadId&&old.to===to&&old.text===message&&JSON.stringify(old.attachments||[])===JSON.stringify(attachments)&&old.kind===(options.kind||'request')&&old.replyTo===(replyTo||null)&&old.requiresReply===(options.kind==='ack'?false:options.requiresReply??((options.kind||'request')==='request')),'Request ID belongs to another conversation or message',409);await this.plane.save();return old;}}
    assert(this.data.messages.filter(m=>m.to===to&&['queued','delivering'].includes(m.delivery)).length<100,'Recipient inbox is full',429);
    const item={id:randomUUID(),conversationId:directThreadId(sender.id,to),project:sender.project,from:sender.id,to,fromRole:sender.role||sender.title,toRole:recipient.role||recipient.title,text:message,...(attachments.length?{attachments}:{}),replyTo:replyTo||null,requestId:requestId||null,at:new Date().toISOString(),...(options.schedule?{schedule:structuredClone(options.schedule)}:{}),...this.messageOptions(sender,directThreadId(sender.id,to),options)};
    this.data.messages.push(item);if(replyTo){const support=this.data.supportRequests.find(r=>r.messageId===replyTo&&r.coachId===sender.id&&r.taskId===to);if(support&&item.kind!=='ack')support.replyId=item.id;}await this.plane.save();return item;
  }
  async deliver(){return this.plane.work?this.plane.work.serial(()=>this.deliverReady()):this.deliverReady();}
  async queuePrompt(task,text,{mode='queue',requestId,attachments:ids=[]}={}){
    assert(['queue','steer'].includes(mode),'Choose queue or steer');
    const attachments=ids.length?await this.plane.images.select(task.project,ids):[];this.plane.images?.validateModel(task,attachments);
    text=string(text|| (attachments.length?'Please inspect the attached files.':''),'prompt',16000);
    if(requestId){
      string(requestId,'request ID',120);
      const old=this.data.messages.find(m=>m.sessionPrompt&&m.project===task.project&&m.requestId===requestId);
      if(old){assert(old.to===task.id&&old.text===text&&old.promptMode===mode&&JSON.stringify(old.attachments||[])===JSON.stringify(attachments),'Request ID belongs to another prompt',409);await this.plane.save();return old;}
    }
    assert(this.data.messages.filter(m=>m.to===task.id&&['queued','delivering'].includes(m.delivery)).length<100,'Recipient inbox is full',429);
    const item={id:randomUUID(),project:task.project,from:'human',to:task.id,fromRole:'You',toRole:task.role||task.title,text,at:new Date().toISOString(),delivery:'queued',kind:'request',requiresReply:false,envelopeVersion:3,sessionPrompt:true,...(attachments.length?{attachments}:{}),promptMode:mode,requestId:requestId||null};
    this.data.messages.push(item);await this.plane.save();return item;
  }
  async cancelPrompt(task,id){
    const action=async()=>{
      const item=this.data.messages.find(m=>m.id===id&&m.project===task.project&&m.to===task.id&&m.from==='human'&&m.sessionPrompt);
      assert(item,'Queued message not found',404);
      if(item.delivery==='cancelled'){await this.plane.save();return item;}
      assert(item.delivery==='queued','This message has already been sent or claimed for delivery. It cannot be edited.',409);
      item.delivery='cancelled';item.cancelledAt=new Date().toISOString();await this.plane.save();return item;
    };
    return this.plane.work?this.plane.work.serial(action):action();
  }
  async readInbox(task,input={}){
    assert(input.unreadOnly===undefined||typeof input.unreadOnly==='boolean','unreadOnly must be a boolean');
    const action=async()=>{
      const all=this.data.messages.filter(m=>m.to===task.id&&m.project===task.project),index=input.after?all.findIndex(m=>m.id===input.after):-1;
      assert(!input.after||index>=0,'Message cursor not found in your inbox',404);
      const eligible=all.slice(index+1).filter(m=>task.external?m.delivery!=='cancelled'&&(!input.unreadOnly||!m.inboxAcknowledgedAt):!m.sessionPrompt||(m.delivery==='delivered'||m.delivery==='queued'&&m.promptMode==='steer'));
      const messages=task.external?eligible.slice(0,50):eligible;
      const steering=messages.filter(m=>task.external?['queued','inbox'].includes(m.delivery):m.sessionPrompt&&m.delivery==='queued');
      for(const item of steering){item.delivery='delivered';item.deliveredAt=new Date().toISOString();item.toSessionKey=sessionKey(task);item.deliveryChannel='inbox';}
      if(steering.length)await this.plane.save();
      return {messages,...(task.external?{nextCursor:messages.at(-1)?.id||input.after||null,hasMore:eligible.length>messages.length,deliveryMode:'pull'}:{}),...(messages.some(m=>m.attachments?.length)?{attachmentInstructions:'Read each attached file using invoke_tool with name=attachment_read and input={id: attachment.id} before answering.'}:{}),replyWith:'send_message'};
    };
    return this.plane.work?this.plane.work.serial(action):action();
  }
  async acknowledgeInbox(task,{ids}={}){
    assert(task.external,'Inbox checkpoints are for external contacts',403);
    assert(Array.isArray(ids)&&ids.length>0&&ids.length<=50&&ids.every(id=>typeof id==='string')&&new Set(ids).size===ids.length,'Choose up to 50 distinct message delivery IDs');
    const action=async()=>{
      const messages=ids.map(id=>this.data.messages.find(m=>m.id===id&&m.to===task.id&&m.project===task.project));
      assert(messages.every(m=>m&&m.delivery==='delivered'),'Only delivered messages from your inbox can be acknowledged',403);
      const fresh=messages.filter(m=>!m.inboxAcknowledgedAt),at=new Date().toISOString();
      for(const m of fresh)m.inboxAcknowledgedAt=at;
      try{await this.plane.save();}catch(error){for(const m of fresh)delete m.inboxAcknowledgedAt;throw error;}
      return {acknowledged:ids,pendingCount:this.data.messages.filter(m=>m.to===task.id&&m.project===task.project&&m.delivery!=='cancelled'&&!m.inboxAcknowledgedAt).length};
    };
    return this.plane.work?this.plane.work.serial(action):action();
  }
  async deliverReady(){
    const scheduler=this.plane.scheduler;
    if(scheduler?.reconcileMessages(scheduler.clock()))await this.plane.save();
    let agents;try{agents=await this.plane.herdr.list();}catch{return;}
    for(const recipient of this.plane.data.tasks){
      if(this.delivering.has(recipient.id)||recipient.phase!=='launched'||recipient.archivedAt||recipient.trashedAt||recipient.organizing||!recipient.pane)continue;
      const live=agents.find(a=>a.pane_id===recipient.pane);if(!live?.interactive_ready||!['idle','done'].includes(live.agent_status))continue;
      const pending=[];let size=0,imageCount=0;for(const message of this.data.messages.filter(m=>m.to===recipient.id&&m.delivery==='queued'&&(!m.schedule||scheduler?.deliveryCheck(m.schedule,recipient.id).state==='ready'))){const length=message.text.length+400;if(pending.length&&(size+length>20000||pending.length>=8||imageCount+(message.attachments?.length||0)>4))break;pending.push(message);size+=length;imageCount+=message.attachments?.length||0;}if(!pending.length)continue;
      this.delivering.add(recipient.id);for(const item of pending){item.envelopeVersion=3;item.delivery='delivering';item.toSessionKey=sessionKey(recipient);}
      try{await this.plane.save();for(const item of pending){if(!item.schedule)continue;const check=scheduler.deliveryCheck(item.schedule,recipient.id);if(check.state!=='ready'){item.delivery=check.state==='hold'?'queued':'cancelled';if(check.state==='cancel')item.error=check.reason;}}const ready=pending.filter(m=>['delivering','delivered'].includes(m.delivery));if(!ready.length){await this.plane.save();continue;}ready[0].conversationStyle=conversationSetting(this.plane.data,recipient.project).style;await this.plane.save();const text=ready.map(message=>messageEnvelope(message)).join('\n\n');await this.plane.herdr.prompt(recipient.pane,text,{attachments:ready.flatMap(m=>m.attachments||[])});for(const item of ready){item.delivery='delivered';item.deliveredAt=new Date().toISOString();}await this.plane.save();}
      catch(error){for(const item of pending.filter(m=>['delivering','delivered'].includes(m.delivery))){item.delivery='uncertain';item.error='Delivery was not confirmed: '+error.message;}await this.plane.save();}
      finally{this.delivering.delete(recipient.id);}
    }
  }
  async addTool(input,project){
    const policy=this.plane.projects?accessSettings(this.plane,input,{project}):{project,scope:'project',assignment:'all',enabled:true};
    const conflict=t=>t.name===input.name?.trim()&&(policy.scope==='global'||t.scope==='global'||t.project===policy.project);
    const name=string(input.name,'tool name',64);assert(/^[a-z][a-z0-9_]{1,63}$/.test(name)&&![...CORE_TOOLS,'memory_read','memory_write'].includes(name)&&!name.startsWith('chat_')&&!name.startsWith('mcp_'),'Choose a unique tool name using lowercase letters and underscores');
    assert(!this.data.tools.some(conflict),'A tool already has this name',409);
    const description=string(input.description,'tool description',2000),executable=await realpath(string(input.executable,'executable',4096));await access(executable,constants.X_OK);
    const args=input.args||[];assert(Array.isArray(args)&&args.length<=64&&args.every(v=>typeof v==='string'&&v.length<=4096&&!v.includes('\0')),'Arguments must be an array of strings');
    const inputSchema=input.inputSchema||{type:'object',properties:{},additionalProperties:true};assert(inputSchema.type==='object'&&JSON.stringify(inputSchema).length<10000,'Provide an object JSON schema');
    const {default:Ajv}=await import('ajv');new Ajv({strict:false}).compile(inputSchema);assert(!this.data.tools.some(conflict),'A tool already has this name',409);
    const tool={id:randomUUID(),...policy,name,description,executable,args,inputSchema,revision:0};this.data.tools.push(tool);grantAssignedTools(this.plane,tool,[name]);await this.notify('tool',name,`${name} has been added to the Toolbox`,tool.project);return {...tool};
  }
  async call(task,name,input={}){
    const value=await this.callRaw(task,name,input);return this.plane.context?this.plane.context.bound(task,name,value):value;
  }
  async callRaw(task,name,input={}){
    string(name,'tool name',100);this.heartbeat(task);assert(input&&typeof input==='object'&&!Array.isArray(input),'Tool arguments must be an object');
    assert(this.allowed(task,name),'This tool is outside your assigned HeloScrum toolbox',403);
    if(name==='contact_identity'&&task.external)return this.external.public(task);
    if(name==='ack_inbox')return this.acknowledgeInbox(task,input);
    if(name==='attachment_upload')return this.plane.images.uploadFor(task,input);
    if(name==='attachment_read')return this.plane.images.tool(task,input.id,input);
    if(name==='notebook_read')return this.plane.notebooks.read(task,input);
    if(name==='notebook_write')return this.plane.notebooks.write(task,input);
    if(name==='memory_search')return this.plane.notebooks.search(task,input);
    if(name==='context_read'){assert(this.plane.context,'Context storage is unavailable',503);return this.plane.context.read(task,input);}
    if(name==='context_search'){assert(this.plane.context,'Context storage is unavailable',503);return this.plane.context.search(task,input);}
    if(WORK_TOOLS.some(t=>t.name===name))return this.plane.work.call(task,name,input);
    if(name==='create_group')return this.groups.create(task,input);
    if(name==='ask_user')return this.userRequests.ask(task,input);
    if(name==='list_groups')return {groups:this.groups.list(task)};
    if(name==='read_group')return this.groups.read(task,input);
    if(name==='send_group_message'){assert(typeof input.threadId==='string','Group threadId is required');return this.sendGroup(task,null,input.message,input);}
    if(name==='set_chat_status')return this.groups.status(task,input);
    if(name==='role_pack_view')return this.plane.rolePacks.read(task,input);
    if(name==='role_pack_sync')return this.plane.rolePacks.sync(task,input);
    if(name==='activity_report')return this.plane.activity.report(task,input);
    if(name==='report_state')return this.reportState(task,input);
    if(name==='request_support')return this.requestSupport(task,input);
    if(name==='memory_read')return {notes:this.data.memory.filter(m=>m.project===task.project&&(!input.key||m.key===input.key))};
    if(name==='memory_write'){const key=string(input.key,'memory key',120),text=string(input.text,'memory note',16000);const note=this.data.memory.find(m=>m.project===task.project&&m.key===key);assert(input.expectedRevision===(note?.revision||0),'Memory changed. Read it again before updating.',409);const next={key,text,project:task.project,author:task.role||task.title,authorTaskId:task.id,authorSessionKey:sessionKey(task),revision:(note?.revision||0)+1,at:new Date().toISOString()};if(note)Object.assign(note,next);else this.data.memory.push(next);await this.plane.save();return next;}
    if(name==='contact_book')return {contacts:this.contacts(task.project),groups:this.groups.list(task),revision:this.data.revision};
    if(name==='toolbox')return this.discover(task,input);
    if(name==='read_inbox')return this.readInbox(task,input);
    const contact=this.contacts(task.project).find(c=>c.tool===name);
    if(name==='send_message'||contact)return this.send(task,contact?.id||input.to,input.message,input);
    if(name==='invoke_tool'){assert(input.name!=='invoke_tool','Nested invoke_tool is not supported');return this.call(task,input.name,input.input);}
    if(this.plane.mcp?.catalog(task).some(t=>t.name===name))return this.plane.mcp.call(task,name,input);
    const tool=this.data.tools.find(t=>assignedTo(t,task,this.plane.data.agentProfiles)&&t.name===name);assert(tool,'Tool is not registered',404);
    assert(!this.executing.has(task.id),'This agent already has a shared tool running',409);this.executing.add(task.id);
    try{return await this.execute(tool,input,task);}finally{this.executing.delete(task.id);}
  }
  async execute(tool,input,task){
    const {default:Ajv}=await import('ajv');const validate=new Ajv({strict:false,allErrors:true}).compile(tool.inputSchema);assert(validate(input),'Input does not match the registered tool schema');
    const invocation={id:randomUUID(),at:new Date().toISOString(),taskId:task.id,tool:tool.name};
    await this.plane.record('Tool called',`${task.role||task.title} · ${tool.name}`);
    assert(assignedTo(tool,task,this.plane.data.agentProfiles)&&this.allowed(task,tool.name),'Tool access changed before this call',403);
    return new Promise((resolve,reject)=>{let stdout='',stderr='',settled=false;const child=spawn(tool.executable,tool.args,{cwd:task.path,stdio:['pipe','pipe','pipe'],shell:false,env:{...process.env,HELOSCRUM_AGENT_ID:task.id}});const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Shared tool exceeded its 60-second timeout'));},60000);
      child.on('error',error=>finish(error));child.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>1024*1024){child.kill();finish(new Error('Shared tool output exceeded 1 MiB'));}});child.stderr.on('data',b=>{stderr+=b;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>1024*1024){child.kill();finish(new Error('Shared tool output exceeded 1 MiB'));}});child.on('close',code=>finish(null,{...invocation,exitCode:code,stdout,stderr}));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input)+'\n');
    });
  }
}
