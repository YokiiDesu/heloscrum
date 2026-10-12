import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {open,realpath,unlink,lstat,rmdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {assert,inside} from './adapters.mjs';
import {responseStates} from './agent-state.mjs';
import {thinkingEvent} from './thinking-events.mjs';

export const kiroV3Id=id=>typeof id==='string'&&/^sess_[a-f0-9-]{36}$/.test(id);
const LIMIT=32*1024*1024;
const printable=value=>typeof value==='string'?value:JSON.stringify(value??'',null,2);

// Session prompts, agent notes and signatures never enter chat. Provider
// thinking text is a separate, collapsed activity rather than an assistant reply.
export function kiroV3Items(records){
  const events=[],calls=new Map(),seen=new Set();
  for(const [index,row] of records.entries()){
    const p=row.payload||{},id=row.id||String(index);if(seen.has(id))continue;seen.add(id);
    const at=row.timestamp;
    if(p.type==='user'||p.type==='assistant'&&p.operationType==='Say'){
      if(typeof p.content==='string'&&p.content)events.push({id,type:'message',role:p.type,text:p.content,at});
    }
    if(p.type==='assistant'&&p.operationType==='Reasoning')events.push(thinkingEvent({id,at,status:'completed'},p.content));
    if(p.type==='tool_call'||p.type==='pending_interaction'&&p.interactionType==='tool_approval'){
      const key=p.toolUseId||p.toolCallId||id;
      const event={id:key,type:'tool',name:p.toolName||p.title||p.question||'Tool',input:printable(p.args),output:'',status:p.status==='denied'||p.status==='failed'?'failed':'running',at};
      if(calls.has(key))Object.assign(calls.get(key),event);else{events.push(event);calls.set(key,event);}
    }
    if(p.type==='tool_result'){
      const key=p.toolUseId||p.toolCallId,failed=p.success===false||p.isError===true||p.status==='error'||p.status==='failed';
      const result={output:printable(p.content??p.output),status:failed?'failed':'completed',failed};
      if(calls.has(key))Object.assign(calls.get(key),result);else events.push({id,type:'tool',name:'Tool result',input:'',at,...result});
    }
  }
  return responseStates(events);
}

export function readKiroV3Export(data,id){
  assert(kiroV3Id(id),'Invalid Kiro V3 session identifier');assert(data.length<=LIMIT,'Kiro export exceeds the 32 MiB reader limit',413);
  let total=0;
  const files=unzipSync(data,{filter:file=>{
    if(![id+'/session.json',id+'/messages.jsonl'].includes(file.name))return false;
    total+=file.originalSize;assert(Number.isSafeInteger(total)&&total<=LIMIT,'Kiro export exceeds the 32 MiB reader limit',413);return true;
  }});
  const meta=JSON.parse(strFromU8(files[id+'/session.json']||new Uint8Array()));
  assert(meta.id===id&&meta.schemaVersion==='1.0.0','Unsupported or mismatched Kiro V3 export',502);
  const lines=strFromU8(files[id+'/messages.jsonl']||new Uint8Array()).split('\n'),records=[];
  for(const [i,line] of lines.entries()){if(!line.trim())continue;try{records.push(JSON.parse(line));}catch{assert(i===lines.length-1,'Kiro export contains an invalid record',502);}}
  return {meta,records};
}

// Read-only ACP connection: never session/load, session/prompt, approval,
// configuration change, or filesystem access through the agent. The installed
// provider owns storage and creates a bounded export; its TUI owns execution.
export class KiroV3Reader {
  constructor(executable,{spawnProcess=spawn}={}){this.executable=executable;this.spawnProcess=spawnProcess;this.pending=new Map();this.next=0;this.cache=new Map();this.reading=new Map();}
  async connect(){
    if(this.starting)return this.starting;if(this.client)return;
    this.starting=(async()=>{
      assert(this.executable,'Kiro CLI is not installed',503);
      const child=this.spawnProcess(this.executable,['acp','--agent-engine=v3','--auth-method=cli'],{stdio:['pipe','pipe','pipe'],env:{...process.env}});this.client=child;let buffer='';
      child.stdout.setEncoding('utf8');child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
      const closed=()=>{if(this.client!==child)return;this.client=null;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error('Kiro V3 history connection closed'));}this.pending.clear();};
      child.on('error',closed);child.on('close',closed);
      child.stdout.on('data',chunk=>{
        buffer+=chunk;if(buffer.length>4*1024*1024){closed();child.kill();return;}let end;
        while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}
          if(message.method){if(message.id!==undefined)child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Read-only history client'}})+'\n');continue;}
          const request=this.pending.get(message.id);if(!request)continue;this.pending.delete(message.id);clearTimeout(request.timer);
          message.error?request.reject(Error(message.error.message||'Kiro history request failed')):request.resolve(message.result);
        }
      });
      try{const result=await this.rpc('initialize',{protocolVersion:1,clientInfo:{name:'heloscrum_history',version:'0.4.0'},clientCapabilities:{}});
        assert(result.protocolVersion===1&&result.agentCapabilities?.sessionCapabilities?.list,'Kiro V3 session discovery is unavailable',503);
        assert(result.agentCapabilities?._meta?.kiro?.extensionMethods?.includes('_kiro/session/export'),'This Kiro V3 version does not advertise history export. Update Kiro CLI.',503);
      }catch(error){closed();child.kill();throw error;}
    })();try{await this.starting;}finally{this.starting=null;}
  }
  rpc(method,params){
    assert(['initialize','session/list','_kiro/session/export'].includes(method),'Read-only Kiro method required');
    return new Promise((resolve,reject)=>{const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Kiro V3 history request timed out'));},15000);this.pending.set(id,{resolve,reject,timer});this.client.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  }
  async sessions(cwd){
    await this.connect();const directory=await realpath(cwd),rows=[],seen=new Set();let cursor;
    do{const page=await this.rpc('session/list',{cwd:directory,...(cursor?{cursor}:{})});assert(Array.isArray(page.sessions),'Unexpected Kiro V3 session list',502);
      for(const row of page.sessions){assert(kiroV3Id(row.sessionId),'Unexpected Kiro V3 session identifier',502);assert(await realpath(row.cwd)===directory,'Kiro session belongs to a different worktree',403);if(row._meta?.kiro?.source==='local')rows.push(row);}
      cursor=page.nextCursor;if(cursor){assert(!seen.has(cursor)&&seen.size<20,'Kiro session discovery is incomplete',409);seen.add(cursor);}
    }while(cursor);return rows;
  }
  async findSession(cwd,createdAt){
    const since=Date.parse(createdAt);assert(Number.isFinite(since),'Task creation time is missing',409);
    const rows=(await this.sessions(cwd)).filter(r=>Date.parse(r._meta?.kiro?.createdAt)>=since-1000);
    assert(rows.length===1,rows.length?'More than one Kiro V3 session matches this worktree':'Waiting for Kiro V3 to save its first message',409);return rows[0].sessionId;
  }
  async export(id){
    const result=await this.rpc('_kiro/session/export',{sessionId:id});assert(result.success&&typeof result.filePath==='string','Kiro did not return a session export',502);
    const file=await realpath(result.filePath),tmp=await realpath(os.tmpdir()),parent=path.dirname(file);
    assert(inside(tmp,file)&&/^kiro-exports-[\w-]+$/.test(path.basename(parent))&&path.basename(file)==='kiro-session-'+id+'.zip','Unexpected Kiro export path',403);
    assert(!(await lstat(result.filePath)).isSymbolicLink(),'Kiro export cannot be a symlink',403);
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const size=await handle.stat();assert(size.isFile()&&size.size<=LIMIT,'Kiro export exceeds the 32 MiB reader limit',413);return readKiroV3Export(await handle.readFile(),id);}
    finally{await handle.close();await unlink(file).catch(()=>{});await rmdir(parent).catch(()=>{});}
  }
  async read(id,cwd,{full=false}={}){
    assert(kiroV3Id(id),'Invalid Kiro V3 session identifier',409);const directory=await realpath(cwd),key=id+':'+directory;
    const requestKey=key+(full?':full':'');let promise=this.reading.get(requestKey);
    if(!promise){promise=(async()=>{
      const cached=this.cache.get(key);if(!full&&cached&&Date.now()-cached.at<2000)return cached.value;
      await this.connect();
      const {meta,records}=await this.export(id);assert(Array.isArray(meta.workspacePaths)&&meta.workspacePaths.length===1&&await realpath(meta.workspacePaths[0])===directory,'Kiro V3 export belongs to another worktree',403);
      const value={sessionId:id,source:'Kiro V3 session export',model:meta.modelId||null,effort:meta.effortLevel||null,events:kiroV3Items(records)};
      if(this.cache.size>=40)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{at:Date.now(),value});return value;
    })();this.reading.set(requestKey,promise);promise.finally(()=>this.reading.delete(requestKey)).catch(()=>{});}
    const value=await promise;return {...value,events:full?value.events:value.events.slice(-250)};
  }
  close(){this.client?.kill();}
}
