import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,chmod,symlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {ControlPlane} from '../lib/control-plane.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {WorkingMemory} from '../lib/working-memory.mjs';
import {WorkManagement} from '../lib/work-management.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {sourcePage,sourceHash,toolText,mcpToolResult,parseToolText} from '../lib/source-pages.mjs';
import {downloadSource} from '../lib/source-download.mjs';
import {contactCommand} from '../scripts/contact-mcp.mjs';
import {assertPrivate} from './private-file-assert.mjs';

async function fixture({history=false}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'helo-transfer-')),p=new ControlPlane(root);
  const tasks=['Builder','Reviewer','Outsider'].map(role=>({id:randomUUID(),project:root,path:path.join(root,role),role,title:role,kind:'codex',phase:'launched',providerSessionId:randomUUID()}));
  for(const t of tasks)await mkdir(t.path);
  p.data.tasks=tasks;p.projects={project:x=>x};p.data.contextSettings={toolResultChars:12000};p.save=async()=>{};p.collaboration=new Collaboration(p);p.context=new ContextManager(p);p.work=new WorkManagement(p);p.notebooks=new WorkingMemory(p);
  if(history)p.history=await new HistoryStore(path.join(root,'history.duckdb')).init();
  const upload=async(text,task=tasks[0])=>p.images.uploadFor(task,{name:'solver.rs',base64:Buffer.from(text).toString('base64')});
  const grant=(attachment,to)=>p.collaboration.data.messages.push({id:randomUUID(),project:root,from:tasks[0].id,to:to.id,delivery:'delivered',attachments:[attachment]});
  return {root,p,tasks,upload,grant,close:async()=>{await p.history?.close();await rm(root,{recursive:true,force:true});}};
}
test('180 KB source uses one bounded page per call, exact text and flat MCP output',async()=>{
  const f=await fixture();try{const text='source line\n'.repeat(15000),file=await f.upload(text),task=f.tasks[0];let offset=0,rebuilt='',calls=0;
    do{const page=await f.p.collaboration.call(task,'invoke_tool',{name:'attachment_read',input:{id:file.id,offset}});assert.equal(page.offloaded,undefined);assert.equal(page.sha256,file.sha256);assert(toolText(page).length<=12000);const wire=mcpToolResult(JSON.parse(JSON.stringify(page)));const decoded=parseToolText(wire.content[0].text);assert.equal(decoded.text,page.text);if(offset===0)assert(wire.content[0].text.includes('\n\nsource line\n'));rebuilt+=page.text;offset=page.nextOffset;calls++;}while(offset!==null);
    assert.equal(rebuilt,text);assert(calls<=17,`Expected at most 17 reads, got ${calls}`);
    const unicode='🚀\n"\\'.repeat(10000);offset=0;rebuilt='';do{const page=sourcePage(unicode,{offset,limit:16000,budget:2000});assert(JSON.stringify(mcpToolResult(page,{explicitSuccess:true})).length<=2000);assert(!/[\uD800-\uDBFF]$/.test(page.text));rebuilt+=page.text;offset=page.nextOffset;}while(offset!==null);assert.equal(rebuilt,unicode);
    const forged={format:'heloscrum-source-page',text:'x'.repeat(13000)};assert((await f.p.context.bound(task,'untrusted',forged)).offloaded,'Untrusted markers do not bypass the response budget');
  }finally{await f.close();}
});
test('source lines, search, exact diffs and session coverage preserve authorization and hashes',async()=>{
  const f=await fixture();try{const [a,b]=f.tasks,one=await f.upload('first\nold value\nlast\n'),two=await f.upload('first\nnew value\nlast\n');f.grant(one,b);f.grant(two,b);const source={kind:'attachment',id:one.id,sha256:one.sha256};
    const page=await f.p.collaboration.call(b,'source_read',{source,startLine:2,endLine:2});assert.equal(page.text,'old value\n');assert.equal(page.startLine,2);assert.equal(page.endLine,2);assert.equal(page.nextOffset,null);
    const match=await f.p.collaboration.call(b,'source_search',{source,query:'old value'});assert.deepEqual(match.matches,[{line:2,offset:6}]);
    const diff=await f.p.collaboration.call(b,'source_diff',{before:source,after:{kind:'attachment',id:two.id,sha256:two.sha256}});assert.match(diff.text,/-old value\n\+new value/);assert.equal(diff.before.sha256,one.sha256);assert.equal(diff.after.sha256,two.sha256);
    const coverage=await f.p.collaboration.call(b,'source_coverage',{sha256:one.sha256});assert.deepEqual(coverage.records[0].ranges,[[6,16]]);assert.equal(coverage.records[0].kind,'retrieved');
    b.providerSessionId=randomUUID();await f.p.collaboration.call(b,'source_read',{source,startLine:1,endLine:1});assert.equal((await f.p.collaboration.call(b,'source_coverage',{sha256:one.sha256})).records.length,2);
    await assert.rejects(f.p.collaboration.call(f.tasks[2],'source_read',{source}),/not been sent/);await assert.rejects(f.p.collaboration.call(b,'source_read',{source:{...source,sha256:'0'.repeat(64)}}),/hash changed/);
    const ref=await f.p.context.store(a,'private checkpoint','Private');await assert.rejects(f.p.collaboration.call(b,'source_read',{source:{kind:'context',reference:ref.reference}}),/not found/);
  }finally{await f.close();}
});
test('native materialization stays inside the receiving workspace and is distinct from retrieval',async()=>{
  const f=await fixture();try{const a=f.tasks[0],file=await f.upload('exact source'),source={kind:'attachment',id:file.id};const copy=await f.p.collaboration.call(a,'source_materialize',{source});assert(copy.localPath.startsWith(await realpath(a.path)+path.sep));assert.equal(await readFile(copy.localPath,'utf8'),'exact source');assert.equal((await f.p.collaboration.call(a,'source_materialize',{source})).localPath,copy.localPath);const coverage=await f.p.collaboration.call(a,'source_coverage',{sha256:file.sha256});assert.deepEqual(coverage.records.map(r=>r.kind),['materialized']);assert.deepEqual(coverage.records[0].ranges,[]);
    await chmod(copy.localPath,0o600);await writeFile(copy.localPath,'tampered');await assert.rejects(f.p.collaboration.call(a,'source_materialize',{source}),/changed/);assert.equal(await readFile(copy.localPath,'utf8'),'tampered');
    await assert.rejects(f.p.collaboration.sources.materialize({...a,external:true},{source}),/native local/);
    const b=f.tasks[1];f.grant(file,b);await symlink(a.path,path.join(b.path,'.heloscrum'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.p.collaboration.call(b,'source_materialize',{source}),/symlinks/);
  }finally{await f.close();}
});
test('review packet versions reuse exact sources and findings require separate reviewer reports',async()=>{
  const f=await fixture();try{const [a,b,c]=f.tasks,one=await f.upload('one'),two=await f.upload('two');f.grant(one,b);f.grant(two,b);const base={requestId:'packet-one',title:'Solver review',summary:'Baseline',evidence:'Author tests passed',memberIds:[b.id],files:[{name:'solver.rs',source:{kind:'attachment',id:one.id}}]};
    const first=await f.p.collaboration.call(a,'review_packet_create',base);assert.equal((await f.p.collaboration.call(a,'review_packet_create',base)).packetId,first.packetId);
    await assert.rejects(f.p.collaboration.call(a,'review_packet_create',{...base,title:'conflicting replay'}),/Request ID/);
    await assert.rejects(f.p.collaboration.call(c,'review_packet_read',{packetId:first.packetId}),/not available/);
    const finding=await f.p.collaboration.call(b,'review_finding_write',{packetId:first.packetId,expectedRevision:1,title:'Invalid geometry',status:'open',evidence:'Probe reproduces on source hash '+one.sha256,sourceHash:one.sha256});
    await assert.rejects(f.p.collaboration.call(a,'review_finding_write',{packetId:first.packetId,expectedRevision:2,id:finding.finding.id,title:'Invalid geometry',status:'verified',evidence:'Self approval'}),/cannot independently/);
    const next=await f.p.collaboration.call(a,'review_packet_create',{...base,requestId:'packet-two',previousPacketId:first.packetId,summary:'Fix geometry',files:[{name:'solver.rs',source:{kind:'attachment',id:two.id}}]});const packet=JSON.parse((await f.p.collaboration.call(b,'review_packet_read',{packetId:next.packetId})).text);
    assert.equal(packet.version,2);assert.equal(packet.changes[0].before.sha256,one.sha256);assert.equal(packet.findings[0].id,finding.finding.id);assert(!JSON.stringify(packet).includes('"text":"two"'));
    const verified=await f.p.collaboration.call(b,'review_finding_write',{packetId:next.packetId,expectedRevision:1,id:finding.finding.id,title:'Invalid geometry',status:'verified',evidence:'Independent probe passed on candidate',sourceHash:two.sha256});assert.equal(verified.taskAccepted,false);assert.equal(verified.finding.evidenceClass,'reviewer-reported');
    await assert.rejects(f.p.collaboration.call(b,'review_finding_write',{packetId:next.packetId,expectedRevision:1,title:'Stale update',status:'open',evidence:'stale'}),/changed/);
  }finally{await f.close();}
});
test('Memory searches durable History and exact passages without exposing peer transcripts or other projects',async()=>{
  const f=await fixture({history:true});try{const [a,b]=f.tasks;
    await f.p.history.captureRecords([
      {project:f.root,kind:'memory',id:'old-note',body:{key:'solver-contract',text:'Historical collision limit is 12',revision:1}},
      {project:f.root,kind:'transcript',id:'own-event',taskId:a.id,body:{event:{text:'Collision retry evidence from previous session'}}},
      {project:f.root,kind:'transcript',id:'peer-event',taskId:b.id,body:{event:{text:'Collision peer private secret'}}},
      {project:'/other',kind:'memory',id:'other-note',body:{text:'Collision other project secret'}}
    ]);
    const result=await f.p.notebooks.search(a,{query:'collision',scope:'history',ranking:'local'});assert.equal(result.matches.length,2);assert(!JSON.stringify(result).includes('secret'));assert(result.historyAvailable);
    for(const m of result.matches){assert.equal(m.source.retrieve.tool,'memory_source_read');const exact=await f.p.collaboration.call(a,m.source.retrieve.tool,m.source.retrieve.input);assert(exact.text.includes('ollision'));}
    const privateHit=result.matches.find(m=>m.source.recordKind==='transcript');await assert.rejects(f.p.notebooks.readSource(b,{source:privateHit.source}),/not available/);
    await f.p.collaboration.call(a,'memory_write',{key:'contract',text:'Current collision limit is 20',expectedRevision:0});assert.equal((await f.p.collaboration.call(a,'memory_read',{key:'contract',sinceRevision:1})).changed,false);assert.equal((await f.p.collaboration.call(a,'memory_read',{})).notes[0].text,undefined);
    const hit=(await f.p.notebooks.search(a,{query:'contract',scope:'shared'})).matches[0];await f.p.collaboration.call(a,'memory_write',{key:'contract',text:'New collision limit is 30',expectedRevision:1});await assert.rejects(f.p.notebooks.readSource(a,hit.source.retrieve.input),/changed/);
    a.toolPolicy={mode:'selected',allowed:[]};assert.equal((await f.p.notebooks.search(a,{query:'collision',scope:'history'})).matches.filter(m=>m.source.recordKind==='memory').length,0);
  }finally{await f.close();}
});
test('external contacts discover shared Memory and source reads without gaining private or write access',async()=>{
  const f=await fixture({history:true});try{
    const [a]=f.tasks,registered=await f.p.collaboration.external.register(f.root,{name:'Remote reviewer',client:'generic',externalSessionId:'fixture-session'}),remote=f.p.collaboration.participant(registered.contact.id,f.root);
    await f.p.collaboration.call(a,'memory_write',{key:'shared-contract',text:'Stable review requirements',expectedRevision:0});
    const names=f.p.collaboration.catalog(remote).tools.map(t=>t.name);for(const name of ['source_read','source_search','source_diff','memory_search','memory_source_read','review_packet_read'])assert(names.includes(name));assert(!names.includes('source_materialize'));assert(!names.includes('memory_write'));
    const result=await f.p.collaboration.call(remote,'memory_search',{query:'shared-contract',scope:'shared'});assert.equal(result.matches[0].source.key,'shared-contract');const hit=result.matches[0].source.retrieve;assert.equal((await f.p.collaboration.call(remote,hit.tool,hit.input)).text,'Stable review requirements');
    await assert.rejects(f.p.collaboration.call(remote,'notebook_read',{}),/outside/);await assert.rejects(f.p.collaboration.call(remote,'memory_write',{key:'shared-contract',text:'overwrite',expectedRevision:1}),/outside/);
  }finally{await f.close();}
});

test('attachments and task resources fit one escaped response and resume exact local downloads',async()=>{
  const f=await fixture();try{
    const [a,b,c]=f.tasks,text='\uFEFF'+('const x = "🚀\\\\\\n\\\"";\r\n').repeat(10000),attachment=await f.upload(text);
    const resource=await f.p.work.upload(f.root,'solver.rs',Buffer.from(text)),planId=randomUUID();
    f.p.data.workPlans.push({id:planId,project:f.root,status:'active',participantIds:[a.id,b.id],resourceIds:[resource.id]});
    const source={kind:'resource',planId,resourceId:resource.id,sha256:resource.sha256};
    for(const [tool,input] of [['attachment_read',{id:attachment.id}],['work_read_resource',{planId,resourceId:resource.id}]]){
      let offset=0,rebuilt='';do{const page=await f.p.collaboration.call(a,tool,{...input,offset});assert.equal(page.offloaded,undefined);assert(JSON.stringify({jsonrpc:'2.0',id:99,result:mcpToolResult(page,{explicitSuccess:true})}).length<=12000);rebuilt+=page.text;offset=page.nextOffset;}while(offset!==null);assert.equal(rebuilt,text);
    }
    const output=path.join(a.path,'download.rs');let calls=0;
    await assert.rejects(downloadSource(async(name,input)=>{if(++calls===3)throw Error('Connection interrupted');return f.p.collaboration.call(a,name,input);},source,output),/interrupted/);
    await assert.rejects(readFile(output),{code:'ENOENT'});const checkpoint=JSON.parse(await readFile(output+'.heloscrum-partial.json','utf8'));assert(checkpoint.offset>0);assert(checkpoint.offset<text.length);
    await assert.rejects(downloadSource((name,input)=>f.p.collaboration.call(c,name,input),source,output),/not available/);
    let firstOffset;const client={call:async(name,input)=>{firstOffset??=input.offset;return f.p.collaboration.call(a,name,input);}};
    const receipt=await contactCommand(client,'receive-resource',[planId,resource.id,output]);assert.equal(receipt.resumed,true);assert.equal(firstOffset,checkpoint.offset);assert.equal(receipt.sha256,resource.sha256);assert.deepEqual(await readFile(output),Buffer.from(text));assert(!JSON.stringify(receipt).includes('const x'));
    await assert.rejects(downloadSource(client.call,source,output),{code:'EEXIST'});
    const copied=await f.p.collaboration.call(b,'source_materialize',{source});assert.deepEqual(await readFile(copied.localPath),Buffer.from(text));assert.deepEqual((await f.p.collaboration.call(b,'source_coverage',{sha256:resource.sha256})).records.map(r=>r.kind),['materialized']);
    await assert.rejects(f.p.collaboration.call(a,'source_read',{source:{...source,sha256:'0'.repeat(64)},offset:checkpoint.offset}),/hash changed/);
    await assert.rejects(f.p.collaboration.call(a,'source_read',{source:{kind:'resource',planId,resourceId:resource.id},offset:checkpoint.offset}),/requires.*hash/);
    await assert.rejects(f.p.collaboration.call(a,'source_diff',{before:{...source,sha256:'0'.repeat(64)},after:{kind:'attachment',id:attachment.id,sha256:attachment.sha256}}),/hash changed/);
    await assert.rejects(f.p.collaboration.call(a,'source_diff',{before:{kind:'resource',planId,resourceId:resource.id},after:source}),/requires both/);
  }finally{await f.close();}
});

test('small-page downloads batch protected checkpoints, flush interruptions and reject invalid pages before saving them',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'helo-checkpoint-'));
  try{
    const text='雪🧵\n'.repeat(40000),sha256=sourceHash(text),source={kind:'attachment',id:'fixture',sha256},output=path.join(root,'download.txt'),file=output+'.heloscrum-partial.json';
    let calls=0,lastEnd=0;const savedOffsets=new Set();
    await assert.rejects(downloadSource(async(name,input)=>{
      assert.equal(name,'source_read');
      const saved=await readFile(file,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(saved)savedOffsets.add(JSON.parse(saved).offset);
      if(++calls===80)throw Error('Transfer interrupted');
      const page=sourcePage(text,{source,sha256,offset:input.offset,limit:800,budget:2000});lastEnd=page.endOffset;return page;
    },source,output),/Transfer interrupted/);
    assert(savedOffsets.size<5,'many small pages share a few protected checkpoint writes');
    const checkpoint=JSON.parse(await readFile(file,'utf8'));assert.equal(checkpoint.offset,lastEnd);assert.equal(checkpoint.text,text.slice(0,lastEnd));assert.equal(checkpoint.partialHash,sourceHash(checkpoint.text));
    await assertPrivate(file);
    await assert.rejects(downloadSource(async(name,input)=>({...sourcePage(text,{source,sha256,offset:input.offset,limit:800,budget:2000}),nextOffset:input.offset}),source,output),/non-progressing/);
    assert.deepEqual(JSON.parse(await readFile(file,'utf8')),checkpoint,'an invalid continuation cannot taint the saved prefix');
    let first;
    const result=await downloadSource(async(name,input)=>{first??=input.offset;return sourcePage(text,{source,sha256,offset:input.offset,limit:800,budget:2000});},source,output);
    assert.equal(first,lastEnd);assert(result.resumed);assert.equal(await readFile(output,'utf8'),text);assert.equal(result.sha256,sha256);
    await assertPrivate(output);
    await assert.rejects(readFile(file),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('packet continuation rejects changed findings and History search pages unique transcript events',async()=>{
  const f=await fixture({history:true});try{
    const [a,b]=f.tasks,file=await f.upload('exact snapshot');f.grant(file,b);
    const receipt=await f.p.collaboration.call(a,'review_packet_create',{requestId:'long-packet',title:'Review',summary:'x'.repeat(3000),evidence:'e'.repeat(4000),memberIds:[b.id],files:Array.from({length:20},(_,i)=>({name:'file-'+i,source:{kind:'attachment',id:file.id}}))});
    const page=await f.p.collaboration.call(b,'review_packet_read',{packetId:receipt.packetId});assert(page.nextOffset>0);
    await f.p.collaboration.call(b,'review_finding_write',{packetId:receipt.packetId,expectedRevision:1,title:'Probe finding',status:'open',evidence:'Observed on exact snapshot'});
    await assert.rejects(f.p.collaboration.call(b,'review_packet_read',{packetId:receipt.packetId,revision:page.revision,offset:page.nextOffset}),/changed/);
    await f.p.history.captureRecords(Array.from({length:25},(_,i)=>({project:f.root,kind:'transcript',id:'event-'+i,taskId:a.id,body:{event:{text:'Collision original '+i}}})));
    await f.p.history.captureRecords(Array.from({length:25},(_,i)=>({project:f.root,kind:'transcript',id:'event-'+i,taskId:a.id,body:{event:{text:'Collision final '+i}}})));
    const matches=[];let cursor;do{const result=await f.p.notebooks.search(a,{query:'collision',scope:'history',limit:8,ranking:'local',...(cursor?{historyBefore:cursor}:{})});matches.push(...result.matches);cursor=result.nextHistoryBefore;}while(cursor);
    assert.equal(matches.length,25);assert.equal(new Set(matches.map(m=>m.source.recordId)).size,25);assert(matches.every(m=>m.text.includes('final')));
  }finally{await f.close();}
});
