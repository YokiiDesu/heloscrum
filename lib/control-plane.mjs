import {privateDirectory,atomicPrivateWrite} from './private-files.mjs';
import {RolePacks} from './role-packs.mjs';
import {ActivityEvents} from './activity-events.mjs';
import {ImageAttachments} from './image-attachments.mjs';
import {ToolApprovals} from './tool-approvals.mjs';
import {NativeSetup,nativeSelection} from './native-setup.mjs';
import {WorkingMemory} from './working-memory.mjs';
import {WorkScheduler} from './scheduler.mjs';
import {WorkManagement} from './work-management.mjs';
import {grantAssignedTools} from './resource-access.mjs';
import {mcpToolName} from './mcp-connections.mjs';
import {ProjectSettings} from './project-settings.mjs';
import {McpConnections} from './mcp-connections.mjs';
import {ProjectLibrary} from './project-library.mjs';
import {appearanceFor} from '../dist/agent-appearance.js';
import { providerIds, nativeProviderIds, endpointProviderIds, managedProvider, structuredProvider, hostedProvider } from './providers.mjs';
import {StructuredSessions} from './structured-sessions.mjs';
import {AIConnections} from './ai-connections.mjs';
import {ManagedAgents,withManagedAgents} from './managed-agents.mjs';
import {ContextManager} from './context-manager.mjs';
import { readFile, writeFile, rename, mkdir, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GitAdapter, DockerAdapter, HerdrAdapter, binary, assert, string, herdrError, idFor } from './adapters.mjs';

import { fingerprint } from './patch.mjs';
import { Collaboration } from './collaboration.mjs';
import { Transcripts } from './transcripts.mjs';
import {conversationInstruction,conversationSetting} from './conversation-style.mjs';
import { RECOVERY_BRIEF, STATE_INSTRUCTIONS } from './agent-state.mjs';
import { ResourceHistory } from './resource-history.mjs';
import { agentRequest,nativePromptReady,requestFingerprint } from './agent-requests.mjs';
import { AgentSettings } from './agent-settings.mjs';
import { HistoryStore } from './history-store.mjs';
import { HistoryCollector } from './history-collector.mjs';

const startupStillPending=error=>error.code==='agent_not_ready'||error.code==='agent_start_timeout'||(error.code==='timeout'&&/waiting for agent startup/i.test(error.message||''));

export class ControlPlane {
  constructor(root){this.root=root;this.images=new ImageAttachments(this);this.approvals=new ToolApprovals(this);this.nativeSetup=new NativeSetup(this);this.git=new GitAdapter(root);this.data={project:root,tasks:[],events:[]};this.saveQueue=Promise.resolve();this.busy=false;this.dockerCache=null;this.resources=new ResourceHistory();this.projects=new ProjectLibrary(this);}
  async init({history=false}={}){await privateDirectory(path.join(this.root,'.heloscrum'));
    let stateError;
    try{this.data=JSON.parse(await readFile(path.join(this.root,'.heloscrum/state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')stateError=e;}
    if(history){
      this.history=await new HistoryStore(path.join(this.root,'.heloscrum/history/archive.duckdb')).init();
      const saved=await this.history.loadState();
      if(saved)this.data=saved;
      else{if(stateError){await this.history.close();throw Error('Cannot import HeloScrum state.json; restore a valid copy before starting.');}await copyFile(path.join(this.root,'.heloscrum/state.json'),path.join(this.root,'.heloscrum/state.pre-duckdb.json'),1).catch(e=>{if(!['ENOENT','EEXIST'].includes(e.code))throw e;});}
    }else if(stateError)throw Error('Cannot read HeloScrum state; restore .heloscrum/state.json before starting.');
    this.tools=Object.fromEntries(await Promise.all(['herdr','docker','aws',...nativeProviderIds,'cursor'].map(async n=>[n,await binary(n,this.root)])));
    this.herdr=new HerdrAdapter(this.tools.herdr,this.root);
    // Each desktop workspace has its own engine namespace. Persist it so later
    // browser and CLI launches reconnect to the same sessions.
    if(!this.data.herdrSession&&process.env.HELOSCRUM_DESKTOP_ENGINE==='1')this.data.herdrSession='heloscrum-'+idFor(this.root);
    if(this.data.herdrSession){assert(/^[a-zA-Z0-9_-]{1,64}$/.test(this.data.herdrSession),'Invalid saved Herdr session');this.herdr.session=this.data.herdrSession;}
    this.herdr.env.PATH=[path.join(this.root,'.heloscrum/bin'),...providerIds.map(k=>this.tools[k]?path.dirname(this.tools[k]):'').filter(Boolean),process.env.PATH||''].join(path.delimiter);this.docker=new DockerAdapter(this.tools.docker);
    for(const task of this.data.tasks){
      delete task.organizing;
      if(['starting','switching'].includes(task.phase)){task.phase='interrupted';task.error='HeloScrum restarted during setup. Inspect the agent output before sending the task again.';}
      else if(task.phase==='setup-error'&&task.error){const error=herdrError(new Error(task.error));if(error.code){task.errorCode=error.code;task.error=this.startupMessage(error);}}
      if(task.phase==='setup-error'&&startupStillPending({code:task.errorCode,message:task.error})&&!task.promptAttemptedAt){task.phase='awaiting-setup';task.error=this.startupMessage({code:task.errorCode,message:task.error});}
    }
    this.ai=await new AIConnections(this).init();this.ai.client.aws=this.tools.aws||'aws';this.managed=new ManagedAgents(this);this.structured=new StructuredSessions(this);this.herdr=withManagedAgents(this.herdr,this.managed,this.structured);this.context=new ContextManager(this);this.notebooks=new WorkingMemory(this);
    this.projectSettings=new ProjectSettings(this);this.mcp=await new McpConnections(this).init();this.collaboration=new Collaboration(this);this.work=new WorkManagement(this);this.scheduler=new WorkScheduler(this);this.activity=new ActivityEvents(this);this.rolePacks=new RolePacks(this);this.transcripts=new Transcripts(this);this.agentSettings=new AgentSettings(this);
    if(this.history){await this.save();this.historyCollector=new HistoryCollector(this);}
    return this;
  }
  save(){this.apiEvents?.prepare();const snapshot=structuredClone(this.data),body=JSON.stringify(snapshot,null,2);this.saveQueue=this.saveQueue.catch(()=>{}).then(async()=>{
    if(this.history)await this.history.saveState(snapshot);
    try{const file=path.join(this.root,'.heloscrum/state.json');await atomicPrivateWrite(file,body);this.stateMirrorError=null;}
    catch(error){if(!this.history)throw error;this.stateMirrorError=error.message;}
    this.apiEvents?.committed(snapshot.api?.events||[]);
  });return this.saveQueue;}

  providerAvailable(kind){return endpointProviderIds.includes(kind)?!!this.data.aiConnections?.some(c=>c.kind===kind&&c.enabled!==false&&c.supportsTools):!!this.tools[kind];}

  async record(title,detail,project=this.data.project){this.data.events.unshift({id:randomUUID(),project,at:new Date().toISOString(),title,detail});this.data.events=this.data.events.slice(0,300);await this.save();}
  task(id,project=this.data.project){const task=this.data.tasks.find(t=>t.id===id&&t.project===project);assert(task,'Task not found in this project',404);assert(!task.archivedAt&&!task.trashedAt&&!task.organizing,'Restore this session from Projects before using it',409);return task;}
  async dockerState(force=false){if(!force&&this.dockerCache&&Date.now()-this.dockerCache.at<10000)return this.dockerCache.result;try{const result={connected:true,...await this.docker.list()};result.containers=this.resources.record(result.containers);this.dockerCache={at:Date.now(),result};return result;}catch(e){const result={connected:false,error:e.message,containers:[]};this.dockerCache={at:Date.now(),result};return result;}}
  async snapshot(){
    const results=await Promise.allSettled([this.git.worktrees(this.data.project),this.herdr.list(),this.dockerState()]);
    const worktrees=results[0].status==='fulfilled'?results[0].value:[],agents=results[1].status==='fulfilled'?results[1].value:[],docker=results[2].status==='fulfilled'?results[2].value:{connected:false,containers:[],error:results[2].reason.message};
    const rows=await Promise.all(worktrees.map(async w=>{try{return {...w,files:await this.git.status(w.path)};}catch(e){return {...w,files:[],error:e.message};}}));
    const tasks=this.data.tasks.filter(t=>t.project===this.data.project&&!t.archivedAt&&!t.trashedAt).map(t=>{const live=agents.find(a=>a.pane_id===t.pane),w=rows.find(w=>w.id===t.worktreeId);return {...t,appearance:appearanceFor(t),canRetryStart:this.canRetryStart(t)&&!live,status:['starting','switching'].includes(t.phase)?'starting':live?.agent_status||(t.phase==='setup-error'?'setup-error':'offline'),live:live||null,changes:w?.files.length??0};});
    return {scheduler:this.scheduler?.summary(this.data.project),work:{...this.work?.list(this.work.human(this.data.project)).filter(p=>p.status==='active').reduce((v,p)=>({active:v.active+1,review:v.review+p.review}),{active:0,review:0}),plans:(this.data.workPlans||[]).filter(p=>p.project===this.data.project).map(p=>({id:p.id,kind:p.kind,status:p.status,revision:p.revision,items:p.items.map(t=>({id:t.id,status:t.status}))}))},agentIdentities:this.projects.identities(),history:{engine:this.history?'DuckDB':null,error:this.history?.lastError||this.stateMirrorError||null,collectionErrors:this.historyCollector?.errors||[]},project:{id:'prj_'+idFor(this.data.project),path:this.data.project,name:path.basename(this.data.project)},tasks,worktrees:rows,containers:docker.containers.map(c=>{const explicit=this.data.tasks.find(t=>t.containerIds?.includes(c.id));const labelled=this.data.tasks.find(t=>t.id===c.taskId);const owner=explicit||labelled;return {...c,worktreeId:owner?.worktreeId||(!c.taskId?rows.find(w=>w.path===c.workingDir)?.id:null),ownerTaskId:owner?.id||c.taskId||null};}),events:this.data.events,collaboration:this.collaboration?.snapshot(this.data.project),tools:{...Object.fromEntries(Object.entries(this.tools).map(([k,v])=>[k,!!v])),...Object.fromEntries(providerIds.map(k=>[k,this.providerAvailable(k)]))},health:{git:{connected:results[0].status==='fulfilled',error:results[0].reason?.message},herdr:{connected:results[1].status==='fulfilled',error:results[1].reason?.message},docker:{connected:docker.connected,error:docker.error,statsError:docker.statsError}},updatedAt:new Date().toISOString()};
  }
  async selectProject(candidate,options={}){assert(!this.busy,'Wait for task setup to finish',409);this.data.project=await this.projects.resolveLocal(candidate,options);this.scheduler?.ensureSettings(this.data.project);this.projects.remember(this.data.project).lastOpenedAt=new Date().toISOString();await this.record('Project opened',this.data.project);return {path:this.data.project};}
  async createTask(input,requestedProject=this.data.project){this.projects.project(requestedProject);input=this.projectSettings?.prepareTask(input,requestedProject)||input;assert(!this.busy,'Another task is being prepared',409);const title=string(input.title,'task title',120),role=string(input.role||input.title,'agent role',80),summary=string(input.summary||input.prompt?.slice(0,300),'role summary',1000),prompt=string(input.prompt,'task prompt',16000),branch=string(input.branch,'branch',80),kind=input.kind;
    const roleType=input.roleType||'worker';assert(['worker','recovery'].includes(roleType),'Choose a supported role type');
    assert(providerIds.includes(kind),'Choose a supported agent provider');assert(endpointProviderIds.includes(kind)?this.providerAvailable(kind):this.tools[kind],`${kind} is unavailable. Configure its CLI or a tool-capable AI connection.`,503);if(!hostedProvider(input)){assert(this.tools.herdr,'Herdr is not installed',503);await this.herdr.list();}
    assert(!this.busy,'Another task is being prepared',409);const project=requestedProject;assert(!this.data.tasks.some(t=>t.project===project&&t.branch===branch),'A task already uses this branch',409);this.busy=true;
    let task,agentArgs;
    try{
      const model=input.model?string(input.model,'model',150):null;assert(!model||/^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]*$/.test(model),'Invalid model ID');
      const effort=await this.agentSettings.validateEffort(kind,model,input.effort);
      const connection=endpointProviderIds.includes(kind)?this.ai.get(input.connectionId):null;
      if(connection){assert(connection.kind===kind&&connection.supportsTools,'Choose a tool-capable connection matching this provider');assert(model||connection.model,'Choose an exact model ID');}
      const nativeSetup=nativeSelection(kind,input.nativeSetup);
      const nativePlan=await this.nativeSetup.inspect(kind,project,nativeSetup);
      const w=await this.git.create(project,branch);
      task={id:randomUUID(),name:'wp-'+randomUUID().slice(0,8),title,role,summary,prompt,branch,kind,model,effort,nativeSetup,roleType,project,worktreeId:w.id,path:w.path,createdAt:new Date().toISOString(),phase:'starting',pane:null};
      if(connection){task.connectionId=connection.id;task.model=model||connection.model;}
      if(input.profileId){task.profileId=input.profileId;task.appearance=input.appearance;}
      if(roleType==='recovery')task.toolPolicy={mode:'selected',allowed:['memory_read','memory_write'],revision:0};
      this.data.tasks.push(task);
      for(const tool of this.collaboration.data.tools)grantAssignedTools(this,tool,[tool.name],task);
      for(const server of this.data.mcpServers||[])grantAssignedTools(this,server,server.tools.map(t=>mcpToolName(server.id,t.name)),task);
      await this.record('Task created',title+' · '+branch,project);
      try{await this.nativeSetup.prepare(task,{expected:nativePlan.fingerprint});}catch(error){error.code='native_setup_failed';throw error;}
      agentArgs=await this.collaboration.register(task);await this.save();
    }catch(error){
      if(task){task.phase='setup-error';task.error=error.message;if(error.code)task.errorCode=error.code;await this.save().catch(()=>{});}
      throw error;
    }finally{this.busy=false;}
    // Setup of another worktree may proceed while this provider starts.
    this.dispatch(task,agentArgs);return task;
  }
  startupMessage(error){return error.code==='agent_pane_busy'?'The agent could not start because its shell was unavailable. Retry start to use the existing task and worktree.':error.code==='agent_not_ready'?'Complete the provider’s setup request below. Your original task is queued and will be sent when the agent is ready.':startupStillPending(error)?'Provider startup is taking longer than expected. Your original task is still queued and will be sent once this session is ready.':error.message;}
  canRetryStart(task){return task.phase==='setup-error'&&!task.agentStartedAt&&!task.promptAttemptedAt&&((task.errorCode==='agent_pane_busy'&&!!task.pane)||(task.errorCode==='native_setup_failed'&&!!task.nativeSetup));}
  async startupFailed(task,error){task.phase=startupStillPending(error)&&!task.promptAttemptedAt?'awaiting-setup':'setup-error';task.errorCode=error.code;task.error=this.startupMessage(error);await this.record('Task needs setup',task.title+' · '+task.error,task.project);}
  dispatch(task,args){this.launch(task,args).catch(error=>this.startupFailed(task,error)).catch(error=>console.error('Unable to persist task startup failure:',error.message));}
  async retryTask(id){
    const task=this.task(id);assert(this.canRetryStart(task),'This startup cannot be safely retried. Inspect the session output first.',409);
    task.phase='starting'; // Claim this task before awaiting, preventing duplicate starts.
    try{
      const agents=await this.herdr.list();assert(!agents.some(a=>a.pane_id===task.pane||a.name===task.name),'An agent already exists for this task. Inspect its session first.',409);
      if(task.nativeSetup&&!task.nativeSetupSnapshot)await this.nativeSetup.prepare(task);
      const args=!this.collaboration.data.credentials[task.id]?await this.collaboration.register(task):await this.collaboration.launchConfig({...task,model:task.resolvedModel||task.model},{resumeSessionId:task.resumeOnly?task.providerSessionId:undefined}); // Reuse its existing contact and credential, or finish registration after configuration setup failed.
      if(task.pane&&await this.herdr.wrappedShell(task.pane,task.path)){
        const workspace=await this.herdr.createWorkspace(task.path,task.title);
        task.previousPanes=[...(task.previousPanes||[]),{pane:task.pane,workspace:task.workspace}];
        task.pane=workspace.root_pane.pane_id;task.workspace=workspace.workspace.workspace_id;
      }
      delete task.error;delete task.errorCode;await this.record('Retrying agent start',task.title,task.project);
      this.dispatch(task,args);return task;
    }catch(error){task.phase='setup-error';await this.save();throw error;}
  }
  async launch(task,agentArgs=[]){
    if(managedProvider(task)){await this.managed.start(task);if(task.resumeOnly)return this.finishResume(task);return this.submitInitialPrompt(task);}
    if(structuredProvider(task)){await this.structured.start(task);if(task.resumeOnly)return this.finishResume(task);return this.submitInitialPrompt(task);}
    if(!task.pane){const workspace=await this.herdr.createWorkspace(task.path,task.title);task.pane=workspace.root_pane.pane_id;task.workspace=workspace.workspace.workspace_id;await this.save();}
    await this.herdr.startAgent(task.name,task.kind,task.pane,agentArgs);
    if(task.resumeOnly)return this.finishResume(task);
    await this.submitInitialPrompt(task);
  }
  async finishResume(task){task.phase='launched';task.agentStartedAt=new Date().toISOString();delete task.error;delete task.errorCode;await this.record('Session resumed',task.title+' · '+(task.model||'provider default'),task.project);}
  async resumePendingStarts(){
    if(this.resumingStarts)return;
    const pending=this.data.tasks.filter(t=>t.phase==='awaiting-setup'&&!t.archivedAt&&!t.trashedAt&&!t.promptAttemptedAt);if(!pending.length)return;
    this.resumingStarts=true;
    try{
      const agents=await this.herdr.list();
      for(const task of pending){
        const live=agents.find(a=>a.pane_id===task.pane&&(!a.name||a.name===task.name)&&a.agent===task.kind);
        if(!live?.interactive_ready||!['idle','done'].includes(live.agent_status)||task.phase!=='awaiting-setup'||task.promptAttemptedAt)continue;
        // Timed-out starts may lose their Herdr name. In that case the detected
        // provider must still be in this exact, isolated task worktree.
        if(!live.name){try{if(!live.cwd||await realpath(live.cwd)!==await realpath(task.path))continue;}catch{continue;}}
        task.phase='starting';
        try{if(task.resumeOnly)await this.finishResume(task);else await this.submitInitialPrompt(task);}catch(error){await this.startupFailed(task,error);}
      }
    }finally{this.resumingStarts=false;}
  }
  async submitInitialPrompt(task){
    if(task.kind==='kiro'&&task.nativeSetup?.kiroEngine==='v3'||task.kind==='cursor'&&!managedProvider(task)){
      const output=await this.herdr.read(task.pane),request=agentRequest(output);
      if(request.currentSetupMenu||request.currentTrustMenu||!nativePromptReady(task.kind,output))throw Object.assign(new Error('Waiting for the native chat prompt'),{code:'agent_not_ready',status:409});
    }
    task.agentStartedAt=new Date().toISOString();task.promptAttemptedAt=new Date().toISOString();await this.save();
    const continuation=await this.work?.focused(task)||{notebook:await this.notebooks?.capsule(task)};
    const brief=(task.contextRotation?'Original user constraints (still apply; discovery is supplied below):\n'+task.prompt+'\n\n':'')+(task.sessionPrompt||task.prompt);
    const recovery=task.roleType==='recovery'&&!brief.includes(RECOVERY_BRIEF)?RECOVERY_BRIEF+'\n\n':'';
    await this.herdr.prompt(task.pane,recovery+brief+'\n\n'+conversationInstruction(conversationSetting(this.data,task.project).style)+'\n\n'+STATE_INSTRUCTIONS+'\n\n[Current HeloScrum brief — supplied by the backend, not a summary]\n'+JSON.stringify(continuation)+'\n\nUse the supplied assignments, teammates and notebook; do not rediscover unchanged contacts, groups or tools. If a brief lists several plans, choose one with work_brief. Read requiredRead continuations before acting. Use work_brief(planId, sinceRevision) at task boundaries and before mutations; writes still enforce the exact board revision. Notebook notes are private to your agent and the project owner, survive session changes, and never grant task permissions. Save concise decisions/reasons, failed approaches, files, questions and a next step with notebook_write when they change. Keep accepted project decisions in shared memory. Use memory_search for missing rationale, exact resource tools for referenced files, toolbox(name or query) for a needed schema, and invoke_tool to call it. Deferred tools retain their normal access checks. Send substantive evidence or actionable requests to relevant teammates; quiet receipts use kind=ack and do not wake agents. Do not poll, rediscover everything, or reply just to acknowledge completion. At a reviewed checkpoint, wait for the next instruction.');task.phase='launched';delete task.error;delete task.errorCode;await this.record('Task dispatched',task.title,task.project);
  }
  async taskOutput(id,project=this.data.project){const t=this.task(id,project);assert(t.pane,'Agent session is still being created',409);const output=await this.herdr.read(t.pane);return {output,fingerprint:fingerprint(output)};}
  async taskRequest(id,project=this.data.project){
    const task=this.task(id,project);if(managedProvider(task))return this.managed.request(task.pane);if(structuredProvider(task)){const current=this.structured.request(task.pane);if(current.pending)await this.approvals.observe(task,current.request);else this.lastDecisions?.delete(id);return current;}const live=(await this.herdr.list()).find(a=>a.pane_id===task.pane);
    const probeTrust=['kiro','cursor'].includes(task.kind)&&['idle','done'].includes(live?.agent_status);
    if(live?.agent_status!=='blocked'&&!probeTrust){this.lastDecisions?.delete(id);return {pending:false};}
    const output=await this.taskOutput(id,project),request=agentRequest(output.output);
    if(live.agent_status!=='blocked'&&!request.currentTrustMenu&&!request.currentSetupMenu){this.lastDecisions?.delete(id);return {pending:false};}
    await this.approvals.observe(task,request);
    return {pending:true,...output,fingerprint:requestFingerprint(request,output.output),request};
  }
  async chooseTaskResponse(id,choice,expected,project=this.data.project,beforeSend){
    const task=this.task(id,project);if(managedProvider(task)){beforeSend?.();return this.managed.choose(task.pane,choice,expected);}if(structuredProvider(task)){beforeSend?.();return this.structured.choose(task.pane,choice,expected);}
    this.respondingTasks ||= new Set();assert(!this.respondingTasks.has(id),'A response is already being sent',409);this.respondingTasks.add(id);
    try{
      this.lastDecisions ||= new Map();assert(this.lastDecisions.get(id)!==expected,'This response was already sent. Wait for the provider to continue.',409);
      let current=await this.taskRequest(id,project);assert(current.pending&&(current.fingerprint===expected||fingerprint(current.output)===expected),'The request changed. Review its latest choices first.',409);
      assert(this.lastDecisions.get(id)!==current.fingerprint,'This response was already sent. Wait for the provider to continue.',409);
      const identity=current.request.identity;assert(identity&&current.request.options.some(o=>o.id===choice),'This choice is not available',409);
      const option=current.request.options.find(o=>o.id===choice);
      if(option.key){
        await this.respondTask(id,option.key,current.fingerprint,true,project,beforeSend);this.lastDecisions.set(id,current.fingerprint);return {ok:true};
      }
      // Navigate only a recognized, unchanged menu. Re-read after every key and
      // confirm the requested option is selected before submitting Enter.
      for(let step=0;step<4;step++){
        const selected=current.request.options.find(o=>o.selected);assert(selected,'The selected option is unavailable',409);
        if(selected.id===choice){await this.respondTask(id,'enter',current.fingerprint,true,project,beforeSend);this.lastDecisions.set(id,current.fingerprint);return {ok:true};}
        await this.respondTask(id,Number(selected.id)<Number(choice)?'down':'up',current.fingerprint,true,project,beforeSend);
        let moved=false;
        for(let attempt=0;attempt<12;attempt++){
          await new Promise(resolve=>setTimeout(resolve,50));current=await this.taskRequest(id,project);
          assert(current.pending&&current.request.identity===identity,'The request changed. Review it before responding.',409);
          if(current.request.options.find(o=>o.selected)?.id!==selected.id){moved=true;break;}
        }
        assert(moved,'The provider did not update its selection. Try again.',409);
      }
      throw Object.assign(new Error('Unable to select this response'),{status:409});
    }finally{this.respondingTasks.delete(id);}
  }
  async promptTask(id,text,project=this.data.project,options={}){
    const t=this.task(id,project);this.promptingTasks ||= new Set();assert(!this.promptingTasks.has(id),'A message is already being sent to this agent',409);
    assert(t.pane,'Task has no agent session',409);assert(!['starting','switching','awaiting-setup'].includes(t.phase),'Wait for provider setup and the original task to finish dispatching',409);
    this.promptingTasks.add(id);
    try{
      const agent=(await this.herdr.list()).find(a=>a.pane_id===t.pane);assert(agent,'The agent is not running. Resolve startup before sending a message.',409);
      assert(!['starting','switching','awaiting-setup'].includes(t.phase),'The agent session is changing. Wait before sending a message.',409);
      const action=async()=>{const message=await this.collaboration.queuePrompt(t,text,options);await this.collaboration.deliverReady();if(message.delivery==='uncertain')throw Object.assign(new Error(message.error),{status:503});return {ok:true,message:structuredClone(message)};};
      return this.work?await this.work.serial(action):await action();
    }finally{this.promptingTasks.delete(id);}
  }
  async interruptTask(id,project=this.data.project){const t=this.task(id,project);assert(t.pane,'Task has no agent session',409);await this.herdr.interrupt(t.pane);await this.record('Interrupt requested',t.title,project);return {ok:true};}
  async linkContainer(id,taskId){await this.docker.validate(id);const t=this.task(taskId);for(const task of this.data.tasks)task.containerIds=(task.containerIds||[]).filter(x=>x!==id);t.containerIds=[...(t.containerIds||[]),id];await this.record('Runtime assigned',t.title+' · '+id.slice(0,12));return {ok:true};}
  async respondTask(id,key,expected,internal=false,project=this.data.project,beforeSend){
    this.respondingTasks ||= new Set();assert(internal||!this.respondingTasks.has(id),'A response is already being sent',409);
    if(!internal)this.respondingTasks.add(id);
    try{
      const t=this.task(id,project),agent=(await this.herdr.list()).find(a=>a.pane_id===t.pane);
      assert(agent,'Agent is no longer available',409);
      assert(agent.agent_status!=='working','Interrupt the agent before sending a selection key',409);
      const output=await this.taskOutput(id,project);
      assert(output.fingerprint===expected||requestFingerprint(agentRequest(output.output),output.output)===expected,'The agent output changed. Review its latest request first.',409);
      beforeSend?.();await this.herdr.key(t.pane,key);await this.record('Agent response',t.title+' · '+key,project);return {ok:true};
    }finally{if(!internal)this.respondingTasks.delete(id);}
  }
}
