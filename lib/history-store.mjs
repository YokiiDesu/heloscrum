import {privateDirectory,protectPrivatePath} from './private-files.mjs';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assert } from './adapters.mjs';
import { messageEvents } from './chat-messages.mjs';
import { sessionKey } from './session-identity.mjs';

const now=()=>new Date().toISOString();
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>createHash('sha256').update(value).digest('hex');
const taskFields=['id','project','role','title','summary','prompt','kind','model','reportedModel','effort','reportedEffort','modelObservedAt','path','branch','worktreeId','createdAt','sessionStartedAt','providerSessionId','phase','sessionRevision','sessionArchives'];
const taskRecord=t=>Object.fromEntries(taskFields.filter(k=>t[k]!==undefined).map(k=>[k,t[k]]));
const jsonSafe=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
function decodedResult(output){try{let v=JSON.parse(output);if(v.isError)return null;if(v.content)v=JSON.parse(v.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));return v;}catch{return null;}}

// One server owns the file. All operations on its connection are serialized;
// readers cannot accidentally observe another operation's uncommitted writes.
export class HistoryStore {
  constructor(file){this.file=file;this.queue=Promise.resolve();this.latest=new Map();this.lastError=null;}
  async init(){
    await privateDirectory(path.dirname(this.file));
    try{this.instance=await DuckDBInstance.create(this.file,{threads:'2'});this.db=await this.instance.connect();
    await this.db.run(`CREATE TABLE IF NOT EXISTS archive_meta (key VARCHAR PRIMARY KEY,value VARCHAR NOT NULL);
      CREATE TABLE IF NOT EXISTS operational_state (id INTEGER PRIMARY KEY,body VARCHAR NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id VARCHAR PRIMARY KEY,project VARCHAR NOT NULL,task_id VARCHAR NOT NULL,provider VARCHAR NOT NULL,provider_session_id VARCHAR NOT NULL,role VARCHAR,title VARCHAR,branch VARCHAR,worktree VARCHAR,started_at VARCHAR,captured_at VARCHAR,source VARCHAR,last_error VARCHAR,event_count INTEGER DEFAULT 0);
      CREATE SEQUENCE IF NOT EXISTS archive_seq;
      CREATE TABLE IF NOT EXISTS entries (seq BIGINT DEFAULT nextval('archive_seq') PRIMARY KEY,project VARCHAR NOT NULL,kind VARCHAR NOT NULL,record_id VARCHAR NOT NULL,task_id VARCHAR,session_id VARCHAR,version VARCHAR NOT NULL,occurred_at VARCHAR,captured_at VARCHAR NOT NULL,provenance VARCHAR NOT NULL,body VARCHAR NOT NULL);
      CREATE TABLE IF NOT EXISTS archive_imports (id VARCHAR PRIMARY KEY,imported_at VARCHAR);
      INSERT INTO archive_meta VALUES ('schema','1') ON CONFLICT DO NOTHING;`);
    await protectPrivatePath(this.file);await this.permissions();
    assert((await this.query("SELECT value FROM archive_meta WHERE key='schema'"))[0].value==='1','Unsupported history database schema',500);
    for(const row of await this.query('SELECT project,kind,record_id,version FROM entries QUALIFY row_number() OVER (PARTITION BY project,kind,record_id ORDER BY seq DESC)=1'))this.latest.set(this.key(row.project,row.kind,row.record_id),row.version);
    return this;}catch(error){this.db?.closeSync();this.instance?.closeSync();throw error;}
  }
  key(project,kind,id){return JSON.stringify([project,kind,id]);}
  async query(sql,args=[]){return jsonSafe((await this.db.runAndReadAll(sql,args)).getRowObjects());}
  serial(fn,write=false){
    const operation=this.queue.catch(()=>{}).then(async()=>{
      assert(!this.closed,'History database is closed',503);
      if(!write)return fn();
      const changed=new Map();await this.db.run('BEGIN TRANSACTION');
      try{const result=await fn(changed);await this.db.run('COMMIT');for(const [key,value] of changed)this.latest.set(key,value);this.lastError=null;return result;}
      catch(error){await this.db.run('ROLLBACK').catch(()=>{});this.lastError=error.message;throw error;}
      finally{await this.permissions();}
    });this.queue=operation;return operation;
  }
  async permissions(){if(process.platform==='win32')return;/* The WAL inherits its protected directory DACL. */await protectPrivatePath(this.file+'.wal').catch(e=>{if(e.code!=='ENOENT')throw e;});}
  async entry(changed,{project,kind,id,taskId=null,sessionId=null,at=null,provenance='observed',body}){
    assert(typeof project==='string'&&typeof kind==='string'&&typeof id==='string','Archive record identity is required');
    const text=canonical(body),version=hash(text),key=this.key(project,kind,id);
    if((changed.get(key)||this.latest.get(key))===version)return;
    await this.db.run('INSERT INTO entries(project,kind,record_id,task_id,session_id,version,occurred_at,captured_at,provenance,body) VALUES (?,?,?,?,?,?,?,?,?,?)',[project,kind,id,taskId,sessionId,version,at||null,now(),provenance,text]);changed.set(key,version);
  }
  async session(task){
    const key=sessionKey(task);if(!key)return null;
    await this.db.run(`INSERT INTO sessions(id,project,task_id,provider,provider_session_id,role,title,branch,worktree,started_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,title=excluded.title`,[key,task.project,task.id,task.kind,task.providerSessionId,task.role||task.title||null,task.title||null,task.branch||null,task.path||null,task.sessionStartedAt||task.createdAt||null]);return key;
  }
  async stateEntries(changed,data){
    const c=data.collaboration||{};
    for(const plan of data.workPlans||[])await this.entry(changed,{project:plan.project,kind:'work-plan',id:plan.id,at:plan.updatedAt,body:plan});
    for(const resource of data.workResources||[])await this.entry(changed,{project:resource.project,kind:'work-resource',id:resource.id,at:resource.createdAt,body:resource});
    for(const source of data.tasks){const task=taskRecord(source);await this.session(task);await this.entry(changed,{project:task.project,kind:'task',id:task.id,taskId:task.id,sessionId:sessionKey(task),body:task});}
    for(const m of c.messages||[])await this.entry(changed,{project:m.project,kind:'message',id:m.id,taskId:m.from,sessionId:m.fromSessionKey||null,at:m.at,body:m});
    for(const m of c.memory||[])await this.entry(changed,{project:m.project,kind:'memory',id:JSON.stringify([m.key,m.revision]),taskId:m.authorTaskId||null,sessionId:m.authorSessionKey||null,at:m.at,provenance:m.source==='review'?'user-requested-review':m.authorTaskId?'live-write':'legacy-latest',body:m});
    for(const t of c.threads||[])await this.entry(changed,{project:t.project,kind:'thread',id:t.id,body:t});
    for(const q of c.userRequests||[])await this.entry(changed,{project:q.project,kind:'human-request',id:q.id,taskId:q.from,sessionId:q.fromSessionKey||null,at:q.at,body:q});
    for(const n of c.notifications||[])await this.entry(changed,{project:n.project,kind:'notification',id:n.id,at:n.at,body:n});
    for(const [id,value] of Object.entries(c.conversationStates||{}))await this.entry(changed,{project:value.project,kind:'conversation-status',id,at:value.at,body:value});
    for(const r of c.stateReports||[])await this.entry(changed,{project:r.project,kind:'state',id:r.id,taskId:r.taskId,at:r.at,body:r});
    // Older activity records have no project provenance; do not invent it.
    for(const e of data.events||[])if(e.project)await this.entry(changed,{project:e.project,kind:'activity',id:e.id,at:e.at,body:e});
  }
  saveState(data){const snapshot=structuredClone(data);return this.serial(async changed=>{await this.stateEntries(changed,snapshot);await this.db.run('INSERT INTO operational_state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',[JSON.stringify(snapshot)]);},true);}
  loadState(){return this.serial(async()=>{const rows=await this.query('SELECT body FROM operational_state WHERE id=1');return rows.length?JSON.parse(rows[0].body):null;});}
  captureState(data){const snapshot=structuredClone(data);return this.serial(changed=>this.stateEntries(changed,snapshot),true);}
  captureTranscript(task,history,{messages=[]}={}){
    task=taskRecord(task);history=structuredClone(history);assert(history.sessionId===task.providerSessionId,'Cannot archive a different provider session',409);
    return this.serial(async changed=>{
      const key=await this.session(task);assert(key,'A provider session ID is required');
      for(const event of messageEvents(history.events,task,messages))if(event.communication){
        const m=event.communication;await this.entry(changed,{project:task.project,kind:'message-session-link',id:`${m.id}:received:${key}`,taskId:task.id,sessionId:key,at:event.at,provenance:'exact-provider-delivery-envelope',body:{messageId:m.id,direction:'received',providerSessionId:task.providerSessionId,sourceEventId:event.id}});
      }

      for(const [position,event] of history.events.entries()){
        await this.entry(changed,{project:task.project,kind:'transcript',id:`${key}:${event.id}`,taskId:task.id,sessionId:key,at:event.at,provenance:history.source,body:{position,event}});
        if(event.type==='tool'&&!event.failed&&!['failed','running','inProgress'].includes(event.status)){
          const result=decodedResult(event.output);
          if(/(?:send_message|send_group_message|chat_[a-z0-9_]+)$/.test(event.name||'')&&result){
            const ids=new Set([result.id,...(result.deliveries||[]).map(d=>d.id)]);
            for(const m of messages)if(m.project===task.project&&m.from===task.id&&ids.has(m.id))await this.entry(changed,{project:task.project,kind:'message-session-link',id:`${m.id}:sent:${key}`,taskId:task.id,sessionId:key,at:event.at,provenance:'successful-provider-tool-receipt',body:{messageId:m.id,direction:'sent',providerSessionId:task.providerSessionId,sourceEventId:event.id}});
          }
          if(/(?:\/\s*|__)memory_write$/.test(event.name||'')&&result?.project===task.project&&typeof result.key==='string'&&typeof result.text==='string'&&Number.isInteger(result.revision))await this.entry(changed,{project:task.project,kind:'memory',id:JSON.stringify([result.key,result.revision]),taskId:task.id,sessionId:key,at:result.at,provenance:'successful-tool-result',body:result});
        }
      }
      await this.db.run('UPDATE sessions SET captured_at=?,source=?,last_error=NULL,event_count=? WHERE id=?',[now(),history.source,history.events.length,key]);
    },true);
  }
  markError(task,error){return this.serial(async()=>{const key=await this.session(task);if(key)await this.db.run('UPDATE sessions SET last_error=? WHERE id=?',[error.message,key]);},true);}
  captureRecords(records){const copy=structuredClone(records);return this.serial(async changed=>{for(const record of copy)await this.entry(changed,record);},true);}
  async rowsInternal(project,kind,sessionId){const rows=await this.query(`SELECT * FROM entries WHERE project=?${kind?' AND kind=?':''}${sessionId?' AND session_id=?':''} ORDER BY seq`,[project,...(kind?[kind]:[]),...(sessionId?[sessionId]:[])]);return rows.map(r=>({...r,body:JSON.parse(r.body)}));}
  rows(project,kind,sessionId){return this.serial(()=>this.rowsInternal(project,kind,sessionId));}
  summary(project){return this.serial(async()=>({engine:'DuckDB',schema:1,file:this.file,sessions:await this.query('SELECT * FROM sessions WHERE project=? ORDER BY started_at,id',[project]),counts:await this.query('SELECT kind,COUNT(DISTINCT record_id)::INTEGER AS count,COUNT(*)::INTEGER AS versions FROM entries WHERE project=? GROUP BY kind',[project]),error:this.lastError}));}
  sessionHistory(project,id,{before,limit=100}={}){
    return this.serial(async()=>{
      const session=(await this.query('SELECT * FROM sessions WHERE project=? AND id=?',[project,id]))[0];assert(session,'Archived session not found',404);
      const rows=await this.query("SELECT body FROM entries WHERE project=? AND kind='transcript' AND session_id=? QUALIFY row_number() OVER (PARTITION BY record_id ORDER BY seq DESC)=1",[project,id]);
      const events=rows.map(r=>JSON.parse(r.body)).sort((a,b)=>a.position-b.position).map(v=>v.event),end=before?events.findIndex(e=>e.id===before):events.length;assert(end>=0,'History cursor not found',404);
      const start=Math.max(0,end-Math.max(1,Math.min(250,limit)));return {session,sessionId:session.provider_session_id,source:'HeloScrum durable archive',events:events.slice(start,end),total:events.length,hasMore:start>0,before:events[start]?.id||null};
    });
  }
  export(project){return this.serial(async()=>({format:'heloscrum-history',version:1,project,exportedAt:now(),sessions:await this.query('SELECT * FROM sessions WHERE project=?',[project]),entries:await this.rowsInternal(project)}));}
  importExport(snapshot){
    assert(snapshot?.format==='heloscrum-history'&&snapshot.version===1&&Array.isArray(snapshot.entries)&&Array.isArray(snapshot.sessions),'Invalid HeloScrum history export');
    const id=hash(canonical(snapshot));return this.serial(async changed=>{
      if((await this.query('SELECT id FROM archive_imports WHERE id=?',[id])).length)return {imported:false};
      for(const s of snapshot.sessions){assert(s.project===snapshot.project,'Session project mismatch');await this.session({id:s.task_id,project:s.project,kind:s.provider,providerSessionId:s.provider_session_id,role:s.role,title:s.title,branch:s.branch,path:s.worktree,createdAt:s.started_at});}
      for(const r of snapshot.entries){assert(r.project===snapshot.project&&hash(canonical(r.body))===r.version,'Archive record integrity mismatch');await this.entry(changed,{project:r.project,kind:r.kind,id:r.record_id,taskId:r.task_id,sessionId:r.session_id,at:r.occurred_at,provenance:r.provenance,body:r.body});}
      for(const s of snapshot.sessions)await this.db.run('UPDATE sessions SET captured_at=?,source=?,last_error=?,event_count=? WHERE id=?',[s.captured_at,s.source,s.last_error,s.event_count,s.id]);
      await this.db.run('INSERT INTO archive_imports VALUES (?,?)',[id,now()]);return {imported:true};
    },true);
  }
  async close(){await this.queue.catch(()=>{});if(this.closed)return;this.closed=true;try{await this.db.run('CHECKPOINT');}finally{this.db.closeSync();this.instance.closeSync();}}
}
