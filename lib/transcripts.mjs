import {mergeActivity} from './activity-events.mjs';
import {KiroV3Reader,kiroV3Id} from './kiro-v3.mjs';
import {readCursorSession,validateCursorTranscript} from './cursor.mjs';
import { KiroReader } from './kiro.mjs';
import { providerName,managedProvider } from './providers.mjs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assert, inside } from './adapters.mjs';
import { messageEvents } from './chat-messages.mjs';
import { readCodexRollout } from './codex-rollout.mjs';
import { sessionKey } from './session-identity.mjs';
import { responseStates } from './agent-state.mjs';
import {thinkingEvent,reasoningSummary} from './thinking-events.mjs';

const textContent = content => typeof content==='string'?content:(content||[]).filter(c=>['text','input_text','output_text'].includes(c.type)).map(c=>c.text).join('\n');
const printable = value => typeof value==='string'?value:JSON.stringify(value,null,2);
export function codexItems(turns){
  const events=[];
  for(const turn of turns)for(const item of turn.items||[]){
    const base={id:item.id,turnId:turn.id,status:item.status||turn.status,...(Number.isFinite(item.durationMs)?{durationMs:item.durationMs}:{})};
    if(item.type==='userMessage')events.push({...base,type:'message',role:'user',text:textContent(item.content)});
    else if(item.type==='agentMessage')events.push({...base,type:'message',role:'assistant',text:item.text});
    else if(item.type==='plan')events.push({...base,type:'message',role:'assistant',text:item.text,label:'Plan'});
    // A turn interruption does not cancel every earlier reasoning item. The
    // history schema usually omits item status, so retain only observed status.
    else if(item.type==='reasoning')events.push(thinkingEvent({...base,status:item.status||'recorded'},reasoningSummary(item.summary),{summary:true}));
    else if(item.type==='commandExecution')events.push({...base,type:'tool',name:'Terminal command',input:item.command,output:item.aggregatedOutput||'',exitCode:item.exitCode});
    else if(['mcpToolCall','dynamicToolCall'].includes(item.type))events.push({...base,type:'tool',name:[item.server,item.tool].filter(Boolean).join(' / '),failed:!!item.error||!!item.result?.isError,input:printable(item.arguments),output:printable(item.result||item.error||item.contentItems||'')});
    else if(item.type==='fileChange')events.push({...base,type:'tool',name:'File changes',input:(item.changes||[]).map(c=>c.path).join('\n'),output:(item.changes||[]).map(c=>c.diff||'').join('\n')});
    else if(item.type==='webSearch')events.push({...base,type:'tool',name:'Web search',input:item.query,output:printable(item.results||'')});
    else if(item.type==='functionCallOutput')events.push({...base,type:'tool',name:item.name,input:'',output:printable(item.output)});
  }
  return responseStates(events);
}
export function claudeItems(records){
  const events=[],calls=new Map(),seen=new Set();
  for(const row of records){
    if(!['user','assistant'].includes(row.type)||!row.message)continue;
    const key=row.uuid||JSON.stringify(row);if(seen.has(key))continue;seen.add(key);
    const content=row.message.content,observed=row.type==='assistant'&&row.message.model&&row.message.model!=='<synthetic>'?{model:row.message.model,effort:row.effort||null}:{};
    if(typeof content==='string')events.push({id:key,type:'message',role:row.type,...observed,text:content,at:row.timestamp});
    else for(const [index,item] of (content||[]).entries()){
      if(item.type==='text')events.push({id:key+':'+index,type:'message',role:row.type,...observed,text:item.text,at:row.timestamp});
      if(row.type==='assistant'&&['thinking','redacted_thinking'].includes(item.type))events.push(thinkingEvent({id:key+':'+index,...observed,at:row.timestamp,status:'completed'},item.thinking,{redacted:item.type==='redacted_thinking'}));
      if(item.type==='tool_use'){const event={...observed,id:item.id,type:'tool',name:item.name,input:printable(item.input),output:'',status:'running',at:row.timestamp};events.push(event);calls.set(item.id,event);}
      if(item.type==='tool_result'){const event=calls.get(item.tool_use_id);if(event){event.output=textContent(item.content)||printable(item.content);event.status=item.is_error?'failed':'completed';}else events.push({id:key+':'+index,type:'tool',name:'Tool result',input:'',output:textContent(item.content)||printable(item.content),status:item.is_error?'failed':'completed'});}
    }
  }
  return responseStates(events);
}
export class CodexReader {
  constructor(executable){this.executable=executable;this.pending=new Map();this.next=0;this.client=null;this.starting=null;}
  async connect(){if(this.starting)return this.starting;if(this.client)return;this.starting=(async()=>{
    assert(this.executable,'Codex is not installed',503);
    // A read-only protocol client. It never resumes a thread or starts a model turn.
    const child=spawn(this.executable,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],env:{...process.env}});this.client=child;child.stderr.on('data',()=>{});
    const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const message=JSON.parse(line),pending=this.pending.get(message.id);if(pending){this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);}}catch{}});
    const closed=()=>{if(this.client!==child)return;this.client=null;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('Codex history connection closed'));}this.pending.clear();};child.on('error',closed);child.on('close',closed);child.stdin.on('error',()=>{});
    try{await this.rpc('initialize',{clientInfo:{name:'heloscrum_history',version:'0.4.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');}catch(error){closed();child.kill();throw error;}
  })();try{await this.starting;}finally{this.starting=null;}}
  rpc(method,params){return new Promise((resolve,reject)=>{const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex history request timed out'));},12000);this.pending.set(id,{resolve,reject,timer});this.client.stdin.write(JSON.stringify({id,method,params})+'\n');});}
  async findSession(cwd,createdAt){
    const directory=await realpath(cwd),since=Date.parse(createdAt);
    assert(Number.isFinite(since),'Task creation time is missing; cannot identify its Codex session.',409);
    await this.connect();
    // Herdr does not report a session ID for every Codex version. Query only this
    // task's isolated worktree, never the user's unfiltered conversation history.
    const page=await this.rpc('thread/list',{cwd:directory,sourceKinds:['cli'],archived:false,sortKey:'created_at',sortDirection:'desc',limit:2});
    const matches=[];
    for(const thread of page.data||[]){
      if(!Number.isFinite(thread.createdAt)||thread.createdAt*1000<since-1000)continue;
      assert(await realpath(thread.cwd)===directory,'Session discovery returned a different worktree',403);
      assert(typeof thread.id==='string'&&/^[a-f0-9-]{36}$/.test(thread.id),'Unexpected Codex session identifier',502);
      matches.push(thread.id);
    }
    assert(matches.length,'Waiting for Codex to save its first message. The conversation will appear here when it is available.',409);
    assert(matches.length===1,'More than one Codex session matches this worktree; cannot choose its history safely.',409);
    return matches[0];
  }
  async models(){
    await this.connect();const models=[];let cursor;
    do{const page=await this.rpc('model/list',{limit:100,includeHidden:false,...(cursor?{cursor}:{})});models.push(...(page.data||[]));cursor=page.nextCursor;}while(cursor&&models.length<500);
    return models.filter(m=>!m.hidden).map(m=>({id:m.model||m.id,label:m.displayName||m.model||m.id,description:m.description||'',isDefault:!!m.isDefault,supportedReasoningEfforts:m.supportedReasoningEfforts||[],defaultReasoningEffort:m.defaultReasoningEffort||null}));
  }
  async read(id,cwd,{full=false}={}){
    if(full)try{return await readCodexRollout({providerSessionId:id,path:cwd});}catch(error){if(![404].includes(error.status)&&error.code!=='ENOENT')throw error;}
    await this.connect();const metadata=await this.rpc('thread/read',{threadId:id,includeTurns:false});assert(await realpath(metadata.thread.cwd)===await realpath(cwd),'Session does not belong to this worktree',403);
    let turns=[];try{let cursor;const seen=new Set();do{const page=await this.rpc('thread/turns/list',{threadId:id,limit:30,sortDirection:'desc',itemsView:'full',...(cursor?{cursor}:{})});turns.push(...page.data);cursor=full?page.nextCursor:null;if(cursor){assert(!seen.has(cursor),'Provider repeated its history cursor');seen.add(cursor);}}while(cursor);turns.reverse();}catch{turns=(await this.rpc('thread/read',{threadId:id,includeTurns:true})).thread.turns;}
    const events=codexItems(turns);return {sessionId:id,source:'Codex session history',events:full?events:events.slice(-250)};
  }
  close(){this.client?.kill();}
}
export async function readClaudeSession(task,projects=path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'projects'),{full=false}={}){
  assert(typeof task.providerSessionId==='string'&&/^[a-f0-9-]{36}$/.test(task.providerSessionId),'Claude session identifier is missing',409);
  const cwd=await realpath(task.path);
  // A startup hook can be missed while the local server is restarting. Recover
  // only the exact session launched for this worktree; never scan other chats.
  const candidate=task.transcriptPath||path.join(projects,cwd.replace(/[^a-zA-Z0-9]/g,'-'),task.providerSessionId+'.jsonl');
  let transcript,base;
  try{transcript=await realpath(candidate);base=await realpath(projects);}catch(error){if(error.code==='ENOENT')throw Object.assign(new Error('Waiting for Claude to save this session. Check session setup in Agents or Task details.'),{status:409});throw error;}
  assert(inside(base,transcript)&&path.basename(transcript)===task.providerSessionId+'.jsonl','Unexpected transcript path',403);
  const size=(await stat(transcript)).size;assert(size<32*1024*1024,'Session history exceeds the current 32 MiB reader limit',413);
  const text=await readFile(transcript,'utf8'),records=text.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  assert(records.every(r=>!r.sessionId||r.sessionId===task.providerSessionId),'Transcript session mismatch',403);
  const first=records.find(r=>['user','assistant'].includes(r.type)&&r.sessionId===task.providerSessionId&&r.cwd);
  assert(first,'Waiting for Claude’s first message.',409);
  assert(await realpath(first.cwd)===cwd,'Session does not belong to this worktree',403);
  const observed=records.findLast(r=>r.type==='assistant'&&r.message?.model&&r.message.model!=='<synthetic>');
  return {transcriptPath:transcript,sessionId:task.providerSessionId,source:'Claude session history',...(observed?{model:observed.message.model,effort:observed.effort||null,modelObservedAt:observed.timestamp||null}:{}),events:full?claudeItems(records):claudeItems(records).slice(-250)};
}
export class Transcripts {
  constructor(plane){this.plane=plane;this.codex=new CodexReader(plane.tools.codex);this.kiro=new KiroReader(plane.tools.kiro);this.kiroV3=new KiroV3Reader(plane.tools.kiro);this.cache=new Map();}
  async register(task,input){if(task.kind==='cursor'){assert(!managedProvider(task),'Only native Cursor sessions register transcripts');assert(input.sessionId===task.providerSessionId,'Unexpected Cursor session',403);assert(await realpath(input.cwd)===await realpath(task.path),'Session worktree mismatch',403);assert(typeof input.transcriptPath==='string'&&path.isAbsolute(input.transcriptPath),'Unexpected transcript path');task.transcriptPath=await validateCursorTranscript(task,input.transcriptPath);await this.plane.save();return;}assert(task.kind==='claude','Only Claude registers transcript hooks');assert(input.sessionId===task.providerSessionId,'Unexpected agent session',403);assert(await realpath(input.cwd)===await realpath(task.path),'Session worktree mismatch',403);assert(typeof input.transcriptPath==='string'&&path.isAbsolute(input.transcriptPath),'Unexpected transcript path');const file=path.join(await realpath(path.dirname(input.transcriptPath)),path.basename(input.transcriptPath));const base=await realpath(path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'projects'));assert(inside(base,file)&&path.basename(file)===input.sessionId+'.jsonl','Unexpected transcript path',403);task.transcriptPath=file;await this.plane.save();}
  async readCurrent(task,live,{full=false}={}){
    const original=task,revision=task.sessionRevision||0;task={...task};
    if(!task.providerSessionId&&!task.promptAttemptedAt&&['starting','switching','awaiting-setup','setup-error','interrupted'].includes(task.phase))throw Object.assign(new Error(task.error||'The provider is starting. Your initial task has not been sent yet.'),{status:409});
    const cached=this.cache.get(task.id);if(!full&&cached&&cached.revision===revision&&Date.now()-cached.at<900)return cached.value;
    let value;
    if(managedProvider(task)){
      value=await this.plane.managed.transcript(task,{full});
    }else if(task.kind==='codex'){
      const ref=live?.agent_session;
      const reported=ref&&ref.agent==='codex'&&ref.kind==='id'&&/^[a-f0-9-]{36}$/.test(ref.value)?ref.value:null;
      const id=reported||task.providerSessionId||await this.codex.findSession(task.path,task.sessionStartedAt||task.createdAt);
      value=await this.codex.read(id,task.path,{full});
      task.providerSessionId=id;
    }else if(task.kind==='cursor'){
      value=await readCursorSession(task,{full});
    }else if(task.kind==='kiro'){
      const ref=live?.agent_session,reader=task.nativeSetup?.kiroEngine==='v3'?this.kiroV3:this.kiro;
      const reported=ref?.agent==='kiro'&&ref.kind==='id'&&(task.nativeSetup?.kiroEngine==='v3'?kiroV3Id(ref.value):/^[a-f0-9-]{36}$/.test(ref.value))?ref.value:null;
      const id=task.providerSessionId||reported||await reader.findSession(task.path,task.sessionStartedAt||task.createdAt);
      value=await reader.read(id,task.path,{full});task.providerSessionId=id;
    }else{
      assert(task.kind==='claude','Unsupported transcript provider');
      const activity=await this.plane.activity?.read(task)||[];
      try{const {transcriptPath,...history}=await readClaudeSession(task,undefined,{full});value=history;task.transcriptPath=transcriptPath;}
      catch(error){if(error.status!==409||!activity.length)throw error;value={sessionId:task.providerSessionId,source:'Claude activity bridge',events:[],warning:error.message};}
      value={...value,events:mergeActivity(value.events,activity)};
    }
    assert((original.sessionRevision||0)===revision&&original.kind===task.kind,'The session changed while history was loading. Refresh it.',409);
    let changed=false;for(const key of ['providerSessionId','transcriptPath'])if(task[key]!==original[key]){original[key]=task[key];changed=true;}
    // Keep model and effort from the same observation; never carry an old level
    // forward when a provider stops reporting it. Reads without metadata leave it alone.
    if(value.model)for(const [key,next] of Object.entries({reportedModel:value.model,reportedEffort:value.effort||null,modelObservedAt:value.modelObservedAt||null})){if(original[key]!==next){original[key]=next;changed=true;}}
    if(changed)await this.plane.save();
    if(!full)this.cache.set(task.id,{at:Date.now(),revision,value});return value;
  }
  async read(task,live){
    const previous=[],messages=this.plane.data?.collaboration?.messages||[];
    for(const archive of task.sessionArchives||[]){
      const file=path.join(this.plane.root,'.heloscrum/agents',task.id,'sessions',archive.id+'.json');
      assert(/^[a-f0-9-]{36}$/.test(archive.id),'Invalid session archive',500);
      const saved=JSON.parse(await readFile(file,'utf8'));
      previous.push(...messageEvents(saved.history.events,{...task,kind:saved.kind},messages).map(e=>({...e,id:archive.id+':'+e.id})),{id:archive.id+':switch',type:'session',text:archive.historyUnavailable?`${providerName(saved.kind)} history was unavailable. Existing provider records were kept; continued with ${providerName(archive.toKind)} using the handoff you reviewed.`:`${providerName(saved.kind)} session saved · continued with ${providerName(archive.toKind)} using a reviewed handoff.`,at:archive.at});
    }
    let current;
    try{current=await this.readCurrent(task,live);}catch(error){if(this.plane.history&&sessionKey(task))try{current=await this.plane.history.sessionHistory(task.project,sessionKey(task),{limit:250});current.warning='Live history unavailable: '+error.message;}catch{}if(!current){if(!previous.length)throw error;current={sessionId:task.providerSessionId||'pending',source:'Saved conversation',events:[],warning:error.message};}}
    return {...current,events:[...previous,...messageEvents(current.events,task,messages)]};
  }
  close(){this.codex.close();this.kiroV3.close();}
}
