import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assert} from './adapters.mjs';
import {fingerprint} from './patch.mjs';
import {structuredProvider} from './providers.mjs';
import {CodexAppServer} from './codex-app-server.mjs';
import {codexItems} from './transcripts.mjs';

// Structured sessions drive a native provider over its own protocol instead of
// typing into a Herdr pane. Step 1 covers Codex through `codex app-server`.
// They present the same surface as ManagedAgents (list, prompt, interrupt,
// exit, request, choose, transcript), so the rest of the app is unchanged.
const knownId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const printable=value=>typeof value==='string'?value:JSON.stringify(value);
const extensionFor=mime=>({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'})[mime]||'bin';
export const CODEX_ENGINE_SOURCE='Codex app-server';

export class StructuredSessions {
  constructor(plane,{spawnProcess}={}){this.plane=plane;this.spawnProcess=spawnProcess;this.sessions=new Map();this.client=null;}
  file(task,id=task.providerSessionId){assert(uuid(task.id)&&knownId(id),'Invalid structured session ID');return path.join(this.plane.root,'.heloscrum/agents',task.id,'structured',id+'.json');}
  async load(task){const session=JSON.parse(await readFile(this.file(task),'utf8'));assert(session.taskId===task.id&&session.kind===task.kind,'Structured session identity mismatch',403);return session;}
  // Writes to one session file are serialized across session objects, since a
  // replaced session (after an app-server exit) may still be flushing.
  async persist(s){const file=this.file(s.task,s.id),body=JSON.stringify({id:s.id,taskId:s.task.id,kind:s.task.kind,engine:'app-server',events:s.events,usage:s.usage,usageRecords:s.usageRecords});this.saveQueues||=new Map();const queue=(this.saveQueues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{await mkdir(path.dirname(file),{recursive:true,mode:0o700});await writeFile(file+'.tmp',body,{mode:0o600});await rename(file+'.tmp',file);});this.saveQueues.set(file,queue);s.saveQueue=queue;return queue;}
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
  get(pane){const s=this.sessions.get(pane);assert(s,'The Codex app-server session is offline. Resume its saved session in Projects.',409);return s;}
  threadConfig(task,bridge){
    const config={'mcp_servers.heloscrum.command':bridge.command,'mcp_servers.heloscrum.args':bridge.args,'mcp_servers.heloscrum.enabled':true};
    if(task.nativeSetup?.profile)config.profile=task.nativeSetup.profile.split(':').slice(1).join(':');
    return config;
  }
  async start(task){
    assert(structuredProvider(task),'This task does not use the Codex app-server engine');
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
  list(){return [...this.sessions.entries()].map(([pane,s])=>({pane_id:pane,name:s.task.name,agent:s.task.kind,cwd:s.task.path,agent_status:s.status,engine:'app-server',interactive_ready:['idle','done'].includes(s.status),agent_session:{agent:s.task.kind,kind:'id',value:s.id}}));}
  async transcript(task,{full=false}={}){const s=this.sessions.get(task.pane)||await this.load(task);return {sessionId:s.id,source:CODEX_ENGINE_SOURCE,model:task.model||null,usage:s.usage,events:full?s.events:s.events.slice(-250)};}
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
    const s=this.get(pane);assert(['idle','done'].includes(s.status),'Wait for this agent to finish or interrupt it',409);assert(this.client?.connected,'Codex app-server is not connected',503);
    s.status='working';
    try{
      const input=[{type:'text',text},...await this.attachmentInputs(s,attachments)];
      const result=await this.client.rpc('turn/start',{threadId:s.id,input,...(s.task.effort?{effort:s.task.effort}:{})});
      assert(typeof result?.turn?.id==='string','Codex did not start a turn',502);s.turnId=result.turn.id;
      return {accepted:true,turnId:s.turnId,confirmation:'protocol'};
    }catch(error){if(s.status==='working'&&!s.turnId)s.status='idle';throw error;}
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
        const turn=params.turn||{};s.turnId=null;if(s.approval){const approval=s.approval;s.approval=null;approval.resolve({decision:'cancel'});}
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
    s.sequence=(s.sequence||Promise.resolve()).catch(()=>{}).then(sequence).catch(()=>{});return s.sequence;
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
      return {type:'question',title:q.header||'Codex asks a question',details:q.question,options,answer:choice=>{const index=Number(choice.replace('option-',''));const picked=q.options[index];return {answers:{[q.id]:{answers:[String(picked?.label??picked)]}}};}};
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
    if(s.approval){const approval=s.approval;s.approval=null;approval.resolve(approval.answer('cancel'));}
    if(s.turnId&&this.client?.connected)await this.client.rpc('turn/interrupt',{threadId:s.id,turnId:s.turnId});
    return {ok:true};
  }
  async exit(pane){const s=this.get(pane);assert(['idle','done'].includes(s.status),'Wait for this agent to finish or interrupt it before switching',409);await s.saveQueue;this.sessions.delete(pane);this.plane.collaboration?.connections?.delete(s.task.id);}
  read(pane){return this.get(pane).events.slice(-30).map(e=>e.text||`${e.name}: ${e.output||e.input||''}`).join('\n\n');}
  async close(){for(const s of this.sessions.values()){try{await s.saveQueue;}catch{}}this.sessions.clear();this.client?.close();this.client=null;}
}
