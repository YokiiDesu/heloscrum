import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assert} from './adapters.mjs';
import {fingerprint} from './patch.mjs';
import {codexAppServerProvider,claudeStreamProvider} from './providers.mjs';
import {CodexAppServer} from './codex-app-server.mjs';
import {ClaudeStream} from './claude-stream.mjs';
import {codexItems,claudeItems,textContent,readClaudeSession} from './transcripts.mjs';

// Structured sessions drive a native provider over its own protocol instead of
// typing into a Herdr pane: Codex through `codex app-server` (one shared
// process, one thread per task) and Claude Code through `claude --print`
// stream-json (one process per task, the user's own login).
// They present the same surface as ManagedAgents (list, prompt, interrupt,
// exit, request, choose, transcript), so the rest of the app is unchanged.
const knownId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const printable=value=>typeof value==='string'?value:JSON.stringify(value);
const extensionFor=mime=>({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'})[mime]||'bin';
export const CODEX_ENGINE_SOURCE='Codex app-server';
export const CLAUDE_ENGINE_SOURCE='Claude Code stream-json';
const CLAUDE_ACK_TIMEOUT_MS=15000;
const clip=(value,limit)=>{const text=printable(value??'');return text.length>limit?text.slice(0,limit)+'…':text;};

export class StructuredSessions {
  constructor(plane,{spawnProcess}={}){this.plane=plane;this.spawnProcess=spawnProcess;this.sessions=new Map();this.notifications=new Set();this.client=null;}
  file(task,id=task.providerSessionId){assert(uuid(task.id)&&knownId(id),'Invalid structured session ID');return path.join(this.plane.root,'.heloscrum/agents',task.id,'structured',id+'.json');}
  async load(task){const session=JSON.parse(await readFile(this.file(task),'utf8'));assert(session.taskId===task.id&&session.kind===task.kind,'Structured session identity mismatch',403);return session;}
  // Writes to one session file are serialized across session objects, since a
  // replaced session (after an app-server exit) may still be flushing.
  async persist(s){const file=this.file(s.task,s.id),body=JSON.stringify({id:s.id,taskId:s.task.id,kind:s.task.kind,engine:s.engine||'app-server',model:s.model||null,events:s.events,usage:s.usage,usageRecords:s.usageRecords});this.saveQueues||=new Map();const queue=(this.saveQueues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{await mkdir(path.dirname(file),{recursive:true,mode:0o700});await writeFile(file+'.tmp',body,{mode:0o600});await rename(file+'.tmp',file);});this.saveQueues.set(file,queue);s.saveQueue=queue;return queue;}
  // One app-server process serves every structured Codex thread. If it exits,
  // its sessions go offline and can be resumed from Projects, like managed ones.
  async connect(){
    if(this.client?.connected)return this.client;
    const client=this.client=new CodexAppServer(this.plane.tools.codex,{spawnProcess:this.spawnProcess||undefined});
    client.onNotification((method,params)=>this.notification(method,params));
    client.onRequest((method,params)=>this.serverRequest(method,params));
    client.onClose(reason=>{if(this.client!==client)return;for(const [pane,s] of this.sessions){this.sessions.delete(pane);this.plane.collaboration?.connections?.delete(s.task.id);if(s.approval){const approval=s.approval;s.approval=null;approval.reject(reason);}s.status='idle';s.turnId=null;this.event(s,{type:'message',role:'system',text:'Codex app-server exited: '+reason.message+' Resume this session from Projects to continue.'}).catch(()=>{});}});
    await client.connect();return client;
  }
  session(threadId){for(const s of this.sessions.values())if(s.id===threadId)return s;return null;}
  get(pane){const s=this.sessions.get(pane);assert(s,'The structured session is offline. Resume its saved session in Projects.',409);return s;}
  claude(s){return s.engine==='stream-json';}
  threadConfig(task,bridge){
    const config={'mcp_servers.heloscrum.command':bridge.command,'mcp_servers.heloscrum.args':bridge.args,'mcp_servers.heloscrum.enabled':true};
    if(task.nativeSetup?.profile)config.profile=task.nativeSetup.profile.split(':').slice(1).join(':');
    return config;
  }
  async start(task,args=null){
    if(claudeStreamProvider(task))return this.startClaude(task,args);
    assert(codexAppServerProvider(task),'This task does not use a structured engine');
    if(task.resumeOnly)assert(knownId(task.providerSessionId),'No saved Codex session to resume');
    const client=await this.connect(),bridge=await this.plane.collaboration.mcpBridge(task);
    const common={cwd:task.path,approvalPolicy:'on-request',sandbox:'workspace-write',config:this.threadConfig(task,bridge),...(task.model?{model:task.model}:{})};
    let thread;
    if(task.resumeOnly){const result=await client.rpc('thread/resume',{threadId:task.providerSessionId,excludeTurns:true,...common});thread=result.thread;assert(thread?.id===task.providerSessionId,'Codex resumed a different thread',502);}
    else{const result=await client.rpc('thread/start',common);thread=result.thread;assert(knownId(thread?.id),'Codex did not return a thread ID',502);task.providerSessionId=thread.id;}
    let saved={};if(task.resumeOnly)try{saved=await this.load(task);}catch(error){if(error.code!=='ENOENT')throw error;}
    const s={id:thread.id,task,events:saved.events||[],usage:saved.usage||null,usageRecords:saved.usageRecords||[],status:thread.status?.type==='active'?'working':'idle',turnId:null,approval:null,saveQueue:Promise.resolve()};
    task.pane='structured:'+task.id+':'+s.id;task.workspace=null;this.sessions.set(task.pane,s);
    if(task.resumeOnly&&!s.events.length)await this.hydrate(s).catch(()=>{});
    await this.persist(s);await this.plane.save();return s;
  }
  // Earlier turns of a resumed thread, read through the same connection.
  async hydrate(s){
    const turns=[];let cursor;const seen=new Set();
    do{const page=await this.client.rpc('thread/turns/list',{threadId:s.id,limit:30,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});turns.push(...(page.data||[]));cursor=page.nextCursor;if(cursor){if(seen.has(cursor)||seen.size>=20)break;seen.add(cursor);}}while(cursor);
    turns.reverse();s.events=codexItems(turns).map(e=>({at:new Date().toISOString(),...e}));
  }
  list(){return [...this.sessions.entries()].map(([pane,s])=>({pane_id:pane,name:s.task.name,agent:s.task.kind,cwd:s.task.path,agent_status:s.status,engine:s.engine||'app-server',interactive_ready:['idle','done'].includes(s.status),agent_session:{agent:s.task.kind,kind:'id',value:s.id}}));}
  async transcript(task,{full=false}={}){const s=this.sessions.get(task.pane)||await this.load(task);return {sessionId:s.id,source:s.engine==='stream-json'?CLAUDE_ENGINE_SOURCE:CODEX_ENGINE_SOURCE,model:s.model||task.model||null,usage:s.usage,events:full?s.events:s.events.slice(-250)};}
  async event(s,event){event={id:randomUUID(),at:new Date().toISOString(),...event};const old=s.events.find(e=>e.id===event.id);if(old)Object.assign(old,event);else s.events.push(event);await this.persist(s);this.plane.transcripts?.cache.delete(s.task.id);}
  async attachmentInputs(s,attachments){
    const inputs=[];
    for(const a of attachments){
      if(a.kind&&a.kind!=='image')continue;
      const image=await this.plane.images.readFor(s.task,a.id),dir=path.join(this.plane.root,'.heloscrum/agents',s.task.id,'structured','attachments');
      await mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,a.id+'.'+extensionFor(image.mimeType));
      const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(Buffer.from(image.base64,'base64'));}finally{await handle.close();}
      inputs.push({type:'localImage',path:file});
    }
    return inputs;
  }
  async prompt(pane,text,{attachments=[]}={}){
    const s=this.get(pane);assert(['idle','done'].includes(s.status),'Wait for this agent to finish or interrupt it',409);
    if(this.claude(s))return this.promptClaude(s,text,attachments);
    assert(this.client?.connected,'Codex app-server is not connected',503);
    s.status='working';
    try{
      const input=[{type:'text',text},...await this.attachmentInputs(s,attachments)];
      const result=await this.client.rpc('turn/start',{threadId:s.id,input,...(s.task.effort?{effort:s.task.effort}:{})});
      assert(typeof result?.turn?.id==='string','Codex did not start a turn',502);s.turnId=result.turn.id;
      return {accepted:true,turnId:s.turnId,confirmation:'protocol'};
    }catch(error){if(s.status==='working'&&!s.turnId)s.status='idle';throw error;}
  }
  async steer(pane,text,{attachments=[]}={}){
    const s=this.get(pane);
    if(['idle','done'].includes(s.status))return this.prompt(pane,text,{attachments});
    // Claude Code headless has no steering call; a message sent mid-turn would
    // start a new turn afterwards, so it waits for the model boundary instead.
    if(this.claude(s))throw Object.assign(Error('Steering waits for Claude Code to finish its current turn.'),{code:'steering_deferred'});
    const deferred=()=>Object.assign(Error('Steering waits for Codex to accept input on its active turn.'),{code:'steering_deferred'});
    if(s.status!=='working'||!s.turnId)throw deferred();
    assert(this.client?.connected,'Codex app-server is not connected',503);
    const expectedTurnId=s.turnId,input=[{type:'text',text},...await this.attachmentInputs(s,attachments)];
    // Attachment I/O can overlap a turn ending or an approval opening. Never
    // redirect this input into a different active turn or bypass that approval.
    if(s.status!=='working'||s.turnId!==expectedTurnId)throw deferred();
    let result;
    try{result=await this.client.rpc('turn/steer',{threadId:s.id,expectedTurnId,input});}
    catch(error){
      // Explicit precondition rejections did not consume the input. Transport
      // failures/timeouts remain uncertain and must never be replayed blindly.
      if([-32600,-32602].includes(error.code)&&/(?:no active turn|active turn.*(?:match|mismatch)|expected.*turn)/i.test(error.message))throw deferred();
      throw error;
    }
    assert(result?.turnId===expectedTurnId,'Codex did not confirm the expected steering turn',502);
    return {accepted:true,turnId:result.turnId,confirmation:'protocol'};
  }
  cancelApproval(s){
    const approval=s.approval;if(!approval)return;s.approval=null;
    approval.resolve(approval.cancel?approval.cancel():approval.answer('cancel'));
  }
  notification(method,params){
    const s=params?.threadId?this.session(params.threadId):null;if(!s)return;
    const sequence=async()=>{
      if(method==='turn/started'){s.turnId=params.turn?.id||s.turnId;if(s.status!=='blocked')s.status='working';return;}
      if(method==='item/started'||method==='item/completed'){
        for(const event of codexItems([{id:params.turnId,status:method==='item/started'?'inProgress':'completed',items:[params.item]}])){
          const live=s.events.find(e=>e.id===event.id);
          // A completed agent message replaces the streamed deltas.
          await this.event(s,{...(live||{}),...event,...(event.type==='message'&&method==='item/started'&&live?.text&&!event.text?{text:live.text}:{}),status:event.status==='inProgress'?'running':event.status});
        }
        return;
      }
      if(method==='item/agentMessage/delta'){const live=s.events.find(e=>e.id===params.itemId);await this.event(s,{...(live||{type:'message',role:'assistant',turnId:params.turnId,status:'running'}),id:params.itemId,text:(live?.text||'')+(params.delta||'')});return;}
      if(method==='turn/completed'){
        const turn=params.turn||{};s.turnId=null;this.cancelApproval(s);
        s.status=turn.status==='completed'?'done':'idle';
        if(turn.error?.message)await this.event(s,{type:'message',role:'system',text:(turn.status==='interrupted'?'Turn interrupted. ':'Turn failed. ')+turn.error.message});
        else if(turn.status==='interrupted')await this.event(s,{type:'message',role:'system',text:'Turn interrupted. Review any completed tool actions before continuing.'});
        await this.persist(s);return;
      }
      if(method==='error'){if(!params.willRetry)await this.event(s,{type:'message',role:'system',text:'Codex error: '+(params.error?.message||'unknown')});return;}
      if(method==='thread/tokenUsage/updated'){s.usage=params.tokenUsage?.total||null;(s.usageRecords||=[]).push({at:new Date().toISOString(),purpose:'agent',connectionId:null,model:s.task.model||null,usage:params.tokenUsage||null,turnId:params.turnId});if(s.usageRecords.length>500)s.usageRecords=s.usageRecords.slice(-500);await this.persist(s);return;}
      if(method==='thread/status/changed'){if(params.status?.type==='idle'&&s.status==='working'&&!s.turnId)s.status='idle';return;}
      if(method==='thread/closed'){this.sessions.delete(s.task.pane);this.plane.collaboration?.connections?.delete(s.task.id);await this.event(s,{type:'message',role:'system',text:'Codex closed this thread. Resume it from Projects to continue.'});}
    };
    return this.enqueue(s,sequence);
  }
  // Protocol messages for one session are applied in order; each may persist.
  enqueue(s,fn){
    s.sequence=(s.sequence||Promise.resolve()).catch(()=>{}).then(fn).catch(()=>{});
    const pending=s.sequence;this.notifications.add(pending);pending.finally(()=>this.notifications.delete(pending));return pending;
  }
  // Approvals arrive as server requests. They stay open until the user, or a
  // saved toolbox rule through ToolApprovals, answers through choose().
  serverRequest(method,params){
    const s=params?.threadId?this.session(params.threadId):null;
    if(!s)throw Object.assign(Error('Unknown thread'),{code:-32602});
    if(method==='mcpServer/elicitation/request')return {action:'decline'};
    const approval=this.describe(method,params,s);
    if(!approval)throw Object.assign(Error('HeloScrum does not answer '+method),{code:-32601});
    assert(!s.approval,'A request is already pending',409);
    return new Promise((resolve,reject)=>{s.status='blocked';s.approval={id:randomUUID(),method,params,...approval,resolve,reject};});
  }
  describe(method,params,s){
    if(method==='item/commandExecution/requestApproval'){
      const command=params.command||s.events.find(e=>e.id===params.itemId)?.input||'(command unavailable)';
      return {title:'Run command?',details:`Codex wants to run this command in ${params.cwd||s.task.path}:\n\n${command}${params.reason?'\n\nReason: '+params.reason:''}`,tool:{name:'shell',arguments:command},
        options:[{id:'allow',label:'Allow',description:'Run this command once'},{id:'allow-session',label:'Allow for session',description:'Run it now and skip this prompt for the same command in this session'},{id:'deny',label:'Deny',description:'Do not run this command'}],
        answer:choice=>({decision:choice==='allow'?'accept':choice==='allow-session'?'acceptForSession':choice==='deny'?'decline':'cancel'})};
    }
    if(method==='item/fileChange/requestApproval'){
      const item=s.events.find(e=>e.id===params.itemId),paths=item?.input||params.grantRoot||'';
      return {title:'Apply file changes?',details:`Codex wants to change files${params.grantRoot?' under '+params.grantRoot:''}:\n\n${paths}${params.reason?'\n\nReason: '+params.reason:''}`,tool:{name:'apply_patch',arguments:paths||null},
        options:[{id:'allow',label:'Allow',description:'Apply these changes'},{id:'allow-session',label:'Allow for session',description:'Apply and skip this prompt for the rest of this session'},{id:'deny',label:'Deny',description:'Do not apply these changes'}],
        answer:choice=>({decision:choice==='allow'?'accept':choice==='allow-session'?'acceptForSession':choice==='deny'?'decline':'cancel'})};
    }
    if(method==='item/permissions/requestApproval'){
      const requested=printable(params.permissions||{});
      return {title:'Grant additional permissions?',details:`Codex asks for extra sandbox permissions in ${params.cwd||s.task.path}:\n\n${requested}${params.reason?'\n\nReason: '+params.reason:''}`,tool:{name:'permissions',arguments:requested},
        options:[{id:'allow',label:'Allow',description:'Grant exactly the requested permissions for this turn'},{id:'deny',label:'Deny',description:'Keep the current sandbox'}],
        answer:choice=>({permissions:choice==='allow'?params.permissions||{}:{},scope:'turn'})};
    }
    if(method==='item/tool/requestUserInput'){
      const questions=Array.isArray(params.questions)?params.questions:[];const single=questions.length===1&&Array.isArray(questions[0].options)&&questions[0].options.length;
      if(!single)return null; // Free-text answers need a composer; Codex receives an error and continues.
      const q=questions[0],options=q.options.map((o,i)=>({id:'option-'+i,label:String(o?.label??o),description:String(o?.description??'')}));
      return {type:'question',title:q.header||'Codex asks a question',details:q.question,options,cancel:()=>({answers:{}}),answer:choice=>{const index=/^option-(\d+)$/.exec(choice)?.[1],picked=index===undefined?undefined:q.options[Number(index)];assert(picked!==undefined,'This choice is not available',409);return {answers:{[q.id]:{answers:[String(picked?.label??picked)]}}};}};
    }
    return null;
  }
  request(pane){
    const s=this.get(pane),a=s.approval;if(!a)return {pending:false};
    const request={type:a.type||'tool-approval',title:a.title,details:a.details,identity:a.id,tool:a.tool,options:a.options};
    return {pending:true,output:a.details,fingerprint:fingerprint(a.id+a.details),request};
  }
  choose(pane,choice,expected){
    const s=this.get(pane),current=this.request(pane);assert(current.pending&&current.fingerprint===expected,'The request changed. Review it again.',409);
    assert(s.approval.options.some(o=>o.id===choice),'This choice is not available',409);
    const approval=s.approval;s.approval=null;s.status='working';approval.resolve(approval.answer(choice));
    this.event(s,{type:'message',role:'system',text:`${approval.title} ${approval.options.find(o=>o.id===choice).label}.`}).catch(()=>{});
    return {ok:true};
  }
  async interrupt(pane){
    const s=this.get(pane);
    if(this.claude(s))return this.interruptClaude(s);
    this.cancelApproval(s);
    if(s.turnId&&this.client?.connected)await this.client.rpc('turn/interrupt',{threadId:s.id,turnId:s.turnId});
    return {ok:true};
  }
  // Notifications are applied in order per thread and each one may persist.
  // Wait for everything already received, and for the writes it queued, so a
  // session leaves (or the process stops) with its file complete and no write
  // landing after the caller has moved on.
  async drain(s){for(let i=0;i<10;i++){const sequence=s.sequence,saveQueue=s.saveQueue;try{await sequence;}catch{}try{await saveQueue;}catch{}if(s.sequence===sequence&&s.saveQueue===saveQueue)return;}}
  async exit(pane){const s=this.get(pane);assert(['idle','done'].includes(s.status),'Wait for this agent to finish or interrupt it before switching',409);this.sessions.delete(pane);this.plane.collaboration?.connections?.delete(s.task.id);if(this.claude(s))await s.client?.close();await this.drain(s);}
  read(pane){return this.get(pane).events.slice(-30).map(e=>e.text||`${e.name}: ${e.output||e.input||''}`).join('\n\n');}
  async close(){
    // Stop accepting events before draining. A notification may still be
    // queued behind an earlier write, including one for a now-closed thread.
    const sessions=[...this.sessions.values()];this.sessions.clear();
    const client=this.client;this.client=null;
    for(const s of sessions){this.cancelApproval(s);this.plane.collaboration?.connections?.delete(s.task.id);}
    client?.close();
    // Claude Code processes end with their stdin; a running turn is interrupted first.
    await Promise.allSettled(sessions.filter(s=>this.claude(s)&&s.client?.connected).map(async s=>{if(['working','blocked'].includes(s.status))await s.client.request('interrupt',{},{timeoutMs:3000}).catch(()=>{});await s.client.close();}));
    await Promise.allSettled([...this.notifications]);
    await Promise.allSettled([...(this.saveQueues?.values()||[])]);
  }

  // --- Claude Code over stream-json -------------------------------------
  // One `claude --print` process per task. The launch arguments come from
  // collaboration.launchConfig, the same ones the terminal engine uses (model,
  // agent, effort, activity mod, HeloScrum MCP toolbox, SessionStart hook), so
  // the user's login, settings and hooks apply unchanged.
  async startClaude(task,args){
    assert(this.plane.tools.claude,'Claude Code is not installed',503);
    if(task.resumeOnly)assert(knownId(task.providerSessionId),'No saved Claude Code session to resume');
    args??=await this.plane.collaboration.launchConfig(task,{resumeSessionId:task.resumeOnly?task.providerSessionId:undefined});
    assert(Array.isArray(args)&&!args.includes('--bare'),'Claude Code stream-json launch arguments are invalid');
    const flag=task.resumeOnly?'--resume':'--session-id',index=args.indexOf(flag);
    assert(index>=0&&knownId(args[index+1]),'Claude Code launch arguments carry no session ID');
    if(task.resumeOnly)assert(args[index+1]===task.providerSessionId,'Claude Code would resume a different session',409);else task.providerSessionId=args[index+1];
    let saved={};if(task.resumeOnly)try{saved=await this.load(task);}catch(error){if(error.code!=='ENOENT')throw error;}
    const s={id:task.providerSessionId,task,engine:'stream-json',model:saved.model||null,events:saved.events||[],usage:saved.usage||null,usageRecords:saved.usageRecords||[],status:'idle',turnId:null,approval:null,pendingSend:null,saveQueue:Promise.resolve()};
    const client=s.client=new ClaudeStream(this.plane.tools.claude,args,{cwd:task.path,spawnProcess:this.spawnProcess||undefined});
    client.onMessage(message=>this.claudeMessage(s,message));
    client.onRequest((request,id)=>this.claudeRequest(s,request,id));
    client.onClose(reason=>this.claudeClosed(s,reason));
    client.start();
    task.pane='structured:'+task.id+':'+s.id;task.workspace=null;this.sessions.set(task.pane,s);
    // A resumed session that was last driven from a terminal has no saved
    // events here; its registered transcript carries the earlier turns.
    if(task.resumeOnly&&!s.events.length&&task.transcriptPath)try{s.events=(await readClaudeSession(task,undefined,{full:true})).events.map(e=>({at:new Date().toISOString(),...e}));}catch{}
    await this.persist(s);await this.plane.save();return s;
  }
  claudeClosed(s,reason){
    if(this.sessions.get(s.task.pane)!==s)return; // Left on purpose through exit() or close().
    this.sessions.delete(s.task.pane);this.plane.collaboration?.connections?.delete(s.task.id);
    if(s.approval){const approval=s.approval;s.approval=null;approval.reject(reason);}
    if(s.pendingSend){clearTimeout(s.pendingSend.timer);s.pendingSend.reject(reason);s.pendingSend=null;}
    s.status='idle';s.turnId=null;
    this.enqueue(s,()=>this.event(s,{type:'message',role:'system',text:'Claude Code exited: '+reason.message+' Resume this session from Projects to continue.'}));
  }
  async claudeAttachments(s,attachments){
    const blocks=[];
    for(const a of attachments){
      if(a.kind&&a.kind!=='image')continue;
      const image=await this.plane.images.readFor(s.task,a.id);
      blocks.push({type:'image',source:{type:'base64',media_type:image.mimeType,data:image.base64}});
    }
    return blocks;
  }
  async promptClaude(s,text,attachments){
    assert(s.client?.connected,'Claude Code is not running',503);
    s.status='working';
    try{
      const blocks=await this.claudeAttachments(s,attachments);
      assert(s.client?.connected&&s.status==='working'&&!s.pendingSend,'Claude Code is not ready for a message',409);
      // The receipt is Claude Code replaying the message with its record ID.
      const receipt=new Promise((resolve,reject)=>{s.pendingSend={resolve,reject,timer:setTimeout(()=>{s.pendingSend=null;reject(Object.assign(Error('Claude Code did not acknowledge the message'),{status:504}));},CLAUDE_ACK_TIMEOUT_MS)};});
      s.client.send({type:'user',message:{role:'user',content:blocks.length?[{type:'text',text},...blocks]:text}});
      const turnId=await receipt;
      return {accepted:true,turnId,confirmation:'protocol'};
    }catch(error){if(s.status==='working'&&!s.turnId)s.status='idle';throw error;}
  }
  async interruptClaude(s){
    this.cancelApproval(s);
    if(s.client?.connected&&['working','blocked'].includes(s.status)){
      await s.client.request('interrupt');
      s.turnId=null;s.status='idle';
      await this.event(s,{type:'message',role:'system',text:'Turn interrupted. Review any completed tool actions before continuing.'});
    }
    return {ok:true};
  }
  claudeMessage(s,m){
    if(m.parent_tool_use_id)return; // Subagent traffic stays out of the main transcript, as in the session file.
    return this.enqueue(s,async()=>{
      if(m.type==='system'){
        if(m.subtype==='init'){if(m.model)s.model=m.model;if(m.session_id&&m.session_id!==s.id)await this.event(s,{type:'message',role:'system',text:'Claude Code reported session '+m.session_id+' instead of '+s.id+'. Its history may be incomplete here.'});}
        return;
      }
      if(m.type==='user'){
        if(m.isReplay&&s.pendingSend){const pending=s.pendingSend;s.pendingSend=null;clearTimeout(pending.timer);s.turnId=m.uuid||randomUUID();if(s.status!=='blocked')s.status='working';pending.resolve(s.turnId);}
        await this.claudeRecord(s,m);return;
      }
      if(m.type==='assistant'){
        for(const live of s.events.filter(e=>typeof e.id==='string'&&e.id.startsWith('live:'+(m.message?.id||'')+':')))s.events.splice(s.events.indexOf(live),1);
        await this.claudeRecord(s,m);return;
      }
      if(m.type==='stream_event'){
        const e=m.event||{},id='live:'+(m.api_message_id||e.message?.id||'')+':'+(e.index??0);
        if(e.type==='content_block_start'&&e.content_block?.type==='text')await this.event(s,{id,type:'message',role:'assistant',status:'running',turnId:s.turnId,text:e.content_block.text||''});
        else if(e.type==='content_block_delta'&&e.delta?.type==='text_delta'){const live=s.events.find(x=>x.id===id);await this.event(s,{...(live||{type:'message',role:'assistant',status:'running',turnId:s.turnId}),id,text:(live?.text||'')+(e.delta.text||'')});}
        return;
      }
      if(m.type==='result'){
        const ok=m.subtype==='success'&&!m.is_error;
        s.turnId=null;this.cancelApproval(s);s.status=ok?'done':'idle';
        if(!ok)await this.event(s,{type:'message',role:'system',text:'Turn failed: '+(m.subtype||'error')+(m.result?' · '+clip(m.result,500):'')});
        const u=m.usage;
        if(u){const cached=u.cache_read_input_tokens||0,input=(u.input_tokens||0)+cached+(u.cache_creation_input_tokens||0),output=u.output_tokens||0;
          s.usage={inputTokens:input,cachedInputTokens:cached,outputTokens:output,reasoningOutputTokens:u.output_tokens_details?.thinking_tokens||0,totalTokens:input+output};
          (s.usageRecords||=[]).push({at:new Date().toISOString(),purpose:'agent',connectionId:null,model:s.model||s.task.model||null,usage:u,costUsd:typeof m.total_cost_usd==='number'?m.total_cost_usd:null,turnId:m.uuid||null});if(s.usageRecords.length>500)s.usageRecords=s.usageRecords.slice(-500);}
        await this.persist(s);return;
      }
      if(m.type==='control_cancel_request'){
        // The CLI withdrew a prompt (for example when its turn ended). Nothing to answer.
        if(s.approval?.requestId===m.request_id){s.approval=null;if(s.status==='blocked')s.status='working';await this.event(s,{type:'message',role:'system',text:'Claude Code withdrew its request.'});}
      }
    });
  }
  // One stream-json record is the same shape as a line of Claude's session
  // file, so the history mapping applies; tool results update their calls.
  async claudeRecord(s,record){
    const content=record.message?.content;
    if(Array.isArray(content)){
      for(const [index,item] of content.entries())if(item.type==='tool_result'){
        const output=textContent(item.content)||printable(item.content),status=item.is_error?'failed':'completed',call=s.events.find(e=>e.id===item.tool_use_id);
        await this.event(s,call?{...call,output,status}:{id:(record.uuid||randomUUID())+':'+index,type:'tool',name:'Tool result',input:'',output,status});
      }
      const rest=content.filter(item=>item.type!=='tool_result');if(!rest.length)return;
      record={...record,message:{...record.message,content:rest}};
    }
    for(const event of claudeItems([record]))await this.event(s,{...(s.events.find(e=>e.id===event.id)||{}),...event,...(event.at?{}:{at:new Date().toISOString()})});
  }
  // Permission prompts arrive as control requests. They stay open until the
  // user, or a saved toolbox rule through ToolApprovals, answers through choose().
  claudeRequest(s,request,id){
    if(request.subtype!=='can_use_tool')throw Error('HeloScrum does not answer '+(request.subtype||'this request'));
    const approval=this.describeClaude(request,s);
    if(!approval)return {behavior:'deny',message:'HeloScrum cannot answer this question yet: ask one question with a list of options, or continue without the answer.'};
    assert(!s.approval,'A request is already pending',409);
    return new Promise((resolve,reject)=>{s.status='blocked';s.approval={id:randomUUID(),requestId:id,method:'can_use_tool',params:request,...approval,resolve,reject};});
  }
  describeClaude(request,s){
    const name=request.tool_name||'tool',input=request.input&&typeof request.input==='object'?request.input:{},suggestions=Array.isArray(request.permission_suggestions)?request.permission_suggestions:[];
    if(name==='AskUserQuestion'){
      const questions=Array.isArray(input.questions)?input.questions:[];const single=questions.length===1&&Array.isArray(questions[0].options)&&questions[0].options.length&&!questions[0].multiSelect;
      if(!single)return null; // Free-text and multi-select answers need a composer; Claude is told to continue.
      const q=questions[0],options=q.options.map((o,i)=>({id:'option-'+i,label:String(o?.label??o),description:String(o?.description??'')}));
      return {type:'question',title:q.header||'Claude asks a question',details:q.question,options,cancel:()=>({behavior:'deny',message:'The question was cancelled.'}),answer:choice=>{const index=/^option-(\d+)$/.exec(choice)?.[1],picked=index===undefined?undefined:q.options[Number(index)];assert(picked!==undefined,'This choice is not available',409);return {behavior:'allow',updatedInput:{...input,answers:{[q.question]:String(picked?.label??picked)}}};}};
    }
    const where=s.task.path;let details;
    if(name==='Bash'||name==='PowerShell')details=`Claude wants to run this command in ${where}:\n\n${input.command||'(command unavailable)'}${input.description?'\n\n'+input.description:''}`;
    else if(['Write','Edit','MultiEdit','NotebookEdit'].includes(name))details=`Claude wants to change ${input.file_path||input.notebook_path||'a file'}:\n\n${clip(input.new_string??input.content??input.new_source??input.edits??'',2000)}`;
    else if(['Read','Glob','Grep'].includes(name))details=`Claude wants to read ${input.file_path||input.path||where}${input.pattern?' matching '+input.pattern:''}`;
    else if(name==='WebFetch'||name==='WebSearch')details=`Claude wants web access:\n\n${input.url||input.query||''}`;
    else details=`Claude wants to use ${name}:\n\n${clip(input,4000)}`;
    if(request.description&&!details.includes(request.description))details+=`\n\n${request.description}`;
    return {title:`Allow ${request.display_name||name}?`,details,tool:{name,arguments:typeof input.command==='string'?input.command:printable(input)},
      options:[{id:'allow',label:'Allow',description:'Allow this tool call once'},...(suggestions.length?[{id:'allow-session',label:'Allow for session',description:'Allow it now and keep Claude Code’s suggested permission for the rest of this session'}]:[]),{id:'deny',label:'Deny',description:'Do not run this tool call'}],
      cancel:()=>({behavior:'deny',message:'Interrupted in HeloScrum.'}),
      answer:choice=>choice==='allow'?{behavior:'allow',updatedInput:input}:choice==='allow-session'?{behavior:'allow',updatedInput:input,updatedPermissions:suggestions}:{behavior:'deny',message:'Denied in HeloScrum.'}};
  }
}
