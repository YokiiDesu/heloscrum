import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {HistoryStore} from '../lib/history-store.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';
import {readCodexRollout,rolloutEvents} from '../lib/codex-rollout.mjs';
const task={id:'qa',project:'pack',kind:'codex',providerSessionId:'11111111-1111-4111-a111-111111111111',role:'QA',title:'Test',createdAt:'2026-09-11T00:00:00Z'};
const key=task.id+':'+task.kind+':'+task.providerSessionId;
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'heloscrum-duckdb-')),db=await new HistoryStore(path.join(dir,'archive.duckdb')).init();t.after(async()=>{await db.close();await rm(dir,{recursive:true,force:true});});return {dir,db};}
test('atomic state and revision persistence, serialized concurrent updates, A → B → A, export/restore',async t=>{
  const {dir,db}=await fixture(t),plane={root:dir,data:{project:'pack',tasks:[task],events:[]},save(){return db.saveState(this.data);}};const c=new Collaboration(plane);c.data.credentials.qa='PRIVATE_CAPABILITY';
  await plane.save();
  const results=await Promise.allSettled([c.call(task,'memory_write',{key:'contract',text:'A',expectedRevision:0}),c.call(task,'memory_write',{key:'contract',text:'bad overwrite',expectedRevision:0})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  for(const text of ['B','A'])await c.call(task,'memory_write',{key:'contract',text,expectedRevision:c.data.memory[0].revision});
  assert.deepEqual((await db.rows('pack','memory')).map(r=>r.body.text),['A','B','A']);
  const broken=structuredClone(plane.data);broken.tasks[0].title='must roll back';broken.collaboration.memory.push({key:'invalid',revision:1,text:'missing project'});
  await assert.rejects(db.saveState(broken),/identity/);assert.equal((await db.loadState()).tasks[0].title,'Test');assert.equal((await db.rows('pack','task')).length,1);
  // Mutating a source event back to an earlier value must be a new version.
  for(const output of ['A','B','A','A'])await db.captureRecords([{project:'pack',kind:'artifact',id:'mutable',body:{output}}]);
  assert.deepEqual((await db.rows('pack','artifact')).map(r=>r.body.output),['A','B','A']);
  const exported=await db.export('pack');assert(!JSON.stringify(exported).includes('PRIVATE_CAPABILITY'));
  const copy=await new HistoryStore(path.join(dir,'restored.duckdb')).init();try{
    assert.equal((await copy.importExport(exported)).imported,true);assert.equal((await copy.importExport(exported)).imported,false);
    assert.deepEqual((await copy.export('pack')).entries.map(r=>[r.kind,r.record_id,r.version,r.body]),exported.entries.map(r=>[r.kind,r.record_id,r.version,r.body]));
    assert.equal(await copy.loadState(),null,'portable archive excludes operational secrets');
    const corrupt=structuredClone(exported);corrupt.entries.at(-1).body.output='tampered';await assert.rejects(copy.importExport(corrupt),/integrity/);
  }finally{await copy.close();}
  await assertPrivate(db.file);
});
test('full session history retains more than the UI limit and exact sessions survive reopening',async t=>{
  const {dir,db}=await fixture(t),history={sessionId:task.providerSessionId,source:'fixture',events:Array.from({length:620},(_,i)=>({id:String(i),type:'message',role:'assistant',text:'Event '+i}))};
  await db.captureTranscript(task,history);await db.captureTranscript(task,history);assert.equal((await db.rows('pack','transcript')).length,620);
  const latest=await db.sessionHistory('pack',key);assert.equal(latest.events.length,100);assert.equal(latest.events.at(-1).text,'Event 619');assert(latest.hasMore);
  const earlier=await db.sessionHistory('pack',key,{before:latest.before});assert.equal(earlier.events.at(-1).text,'Event 519');
  await assert.rejects(db.sessionHistory('other',key),/not found/);assert.throws(()=>db.captureTranscript(task,{...history,sessionId:'different'}),/different/);
  await db.close();const reopened=await new HistoryStore(path.join(dir,'archive.duckdb')).init();try{assert.equal((await reopened.sessionHistory('pack',key)).total,620);assert.equal((await reopened.summary('pack')).sessions[0].provider_session_id,task.providerSessionId);}finally{await reopened.close();}
});
test('successful tool results recover prior memory revisions and exclude failed writes',async t=>{
  const {db}=await fixture(t),note={project:'pack',key:'contract',text:'prior',revision:1,author:'QA'};
  await db.captureTranscript(task,{sessionId:task.providerSessionId,source:'fixture',events:[{id:'one',type:'tool',name:'heloscrum / memory_write',status:'completed',output:JSON.stringify({content:[{type:'text',text:JSON.stringify(note)}]})},{id:'two',type:'tool',name:'heloscrum / memory_write',status:'failed',output:JSON.stringify({...note,revision:2})}]});
  assert.equal((await db.rows('pack','memory')).length,1);assert.equal((await db.rows('pack','memory'))[0].session_id,key);
});
test('an acknowledged transaction survives a writer process killed without checkpointing',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'heloscrum-duckdb-crash-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const module=new URL('../lib/history-store.mjs',import.meta.url).href,file=path.join(dir,'crash.duckdb');
  const child=spawn(process.execPath,['--input-type=module','-e',`import {HistoryStore} from ${JSON.stringify(module)};const db=await new HistoryStore(${JSON.stringify(file)}).init();await db.saveState({project:'pack',tasks:[],events:[],marker:'acknowledged'});process.stdout.write('COMMITTED');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',d=>errors+=d);const exited=once(child,'exit');const output=await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw Error(errors||'Writer exited before acknowledging');})]);assert.match(String(output[0]),/COMMITTED/);child.kill('SIGKILL');await exited;
  const db=await new HistoryStore(file).init();try{assert.equal((await db.loadState()).marker,'acknowledged');}finally{await db.close();}
});
test('DuckDB migrates JSON once and remains authoritative if its JSON mirror becomes stale',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'heloscrum-duckdb-migrate-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'.heloscrum'));const file=path.join(dir,'.heloscrum/state.json');
  await writeFile(file,JSON.stringify({project:dir,tasks:[],events:[],marker:'legacy'}));const plane=await new ControlPlane(dir).init({history:true});
  plane.data.marker='durable';await plane.save();plane.transcripts.close();await plane.history.close();await writeFile(file,'{corrupted mirror');
  const next=await new ControlPlane(dir).init({history:true});try{assert.equal(next.data.marker,'durable');assert((await stat(path.join(dir,'.heloscrum/state.pre-duckdb.json'))).size>0);}finally{next.transcripts.close();await next.history.close();}
});
test('local rollout import verifies identity/worktree, includes full history and omits internal reasoning',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'heloscrum-rollout-'));t.after(()=>rm(dir,{recursive:true,force:true}));const records=[{type:'session_meta',payload:{id:task.providerSessionId,cwd:dir}},{type:'turn_context',timestamp:'2026-09-11T12:00:00Z',payload:{model:'gpt-5.6-sol',effort:'medium'}},{type:'response_item',payload:{type:'reasoning',encrypted_content:'NEVER_ARCHIVE'}},...Array.from({length:400},(_,i)=>({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Event '+i}]}})),{type:'response_item',payload:{type:'function_call',call_id:'tool',name:'Read',arguments:'{}'}},{type:'response_item',payload:{type:'function_call_output',call_id:'tool',output:'done'}}];
  await writeFile(path.join(dir,'rollout-'+task.providerSessionId+'.jsonl'),records.map(r=>JSON.stringify(r)).join('\n'));
  const history=await readCodexRollout({...task,path:dir},dir);assert.equal(history.model,'gpt-5.6-sol');assert.equal(history.effort,'medium');assert.equal(history.events[0].effort,'medium');assert.equal(history.events.length,402);assert.equal(history.events[0].type,'thinking');assert.equal(history.events[0].text,'');assert.equal(history.events.at(-1).output,'done');assert(!JSON.stringify(history).includes('NEVER_ARCHIVE'));
  await assert.rejects(readCodexRollout({...task,path:os.tmpdir()},dir),/worktree/);assert.equal(rolloutEvents(records).length,402);
});

// Capturing old report_state calls repeatedly must not grow the archive forever.
test('re-reading self-report pills preserves original time and stable history versions',async t=>{
  const {db}=await fixture(t),records=[{type:'response_item',timestamp:'2026-09-11T12:00:00Z',payload:{type:'function_call',call_id:'state',name:'mcp__heloscrum__report_state',arguments:JSON.stringify({state:'focused',reason:'Tests passed',nextStep:'Stop'})}},{type:'response_item',payload:{type:'function_call_output',call_id:'state',output:'{}'}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Done'}]}}];
  const a=rolloutEvents(records);await new Promise(r=>setTimeout(r,5));const b=rolloutEvents(records);assert.deepEqual(a,b);assert.equal(a[0].report.at,'2026-09-11T12:00:00Z');
  for(const events of [a,b])await db.captureTranscript(task,{sessionId:task.providerSessionId,source:'fixture',events});assert.equal((await db.rows('pack','transcript')).length,2);
});
