import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CodexReader,Transcripts} from '../lib/transcripts.mjs';

const id='11111111-1111-4111-a111-111111111111';
test('unstarted sessions show the actionable startup state instead of a circular workspace history error',async()=>{
 const transcripts=new Transcripts({tools:{codex:null},save:async()=>{}});
 transcripts.codex.findSession=async()=>{throw Error('Should not search before startup');};
 await assert.rejects(transcripts.readCurrent({kind:'codex',phase:'awaiting-setup',error:'Provider startup is taking longer. Your task is queued.'}),/Provider startup is taking longer/);
 await assert.rejects(transcripts.readCurrent({kind:'codex',phase:'starting'}),/initial task has not been sent/);
});
test('Codex session discovery is scoped to the worktree and rejects old, foreign, and ambiguous sessions',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-history-'));
 try{
  const cwd=await realpath(root),createdAt=new Date().toISOString(),time=Math.floor(Date.parse(createdAt)/1000);
  const reader=new CodexReader(null);reader.connect=async()=>{};
  let rows=[{id,cwd,createdAt:time}],params;
  reader.rpc=async(method,input)=>{assert.equal(method,'thread/list');params=input;return {data:rows};};
  assert.equal(await reader.findSession(cwd,createdAt),id);
  assert.equal(params.cwd,cwd);assert.deepEqual(params.sourceKinds,['cli']);assert.equal(params.limit,2);
  rows=[{id,cwd,createdAt:time-60}];await assert.rejects(reader.findSession(cwd,createdAt),/Waiting for Codex/);
  rows=[{id,cwd:path.dirname(cwd),createdAt:time}];await assert.rejects(reader.findSession(cwd,createdAt),/different worktree/);
  rows=[{id,cwd,createdAt:time},{id:'22222222-2222-4222-a222-222222222222',cwd,createdAt:time}];
  await assert.rejects(reader.findSession(cwd,createdAt),/More than one/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('missing Herdr session IDs recover once and persist only after validated history is read',async()=>{
 const task={id:'task',kind:'codex',path:'/worktree',createdAt:new Date().toISOString()};let saved=0,discovered=0;
 const transcripts=new Transcripts({tools:{codex:null},save:async()=>{saved++;}});
 transcripts.codex.findSession=async(cwd)=>{assert.equal(cwd,task.path);discovered++;return id;};
 transcripts.codex.read=async(session,cwd)=>{assert.equal(session,id);assert.equal(cwd,task.path);return {sessionId:id,source:'Codex session history',events:[]};};
 await transcripts.read(task,{agent:'codex'});assert.equal(task.providerSessionId,id);assert.equal(saved,1);
 transcripts.cache.clear();await transcripts.read(task,{agent:'codex'});assert.equal(discovered,1);assert.equal(saved,1);
 const other={...task,id:'other',providerSessionId:undefined};transcripts.codex.read=async()=>{throw new Error('Session does not belong to this worktree');};
 await assert.rejects(transcripts.read(other,{}),/does not belong/);assert.equal(other.providerSessionId,undefined);assert.equal(saved,1);
});

test('Claude history recovers a missed hook only for its exact session and verified worktree',async()=>{
 const {mkdir,writeFile,symlink}=await import('node:fs/promises');const {readClaudeSession}=await import('../lib/transcripts.mjs');
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-claude-history-'))),projects=path.join(root,'projects'),cwd=path.join(root,'worktree');
 try{
  await mkdir(cwd);const dir=path.join(projects,cwd.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(dir,{recursive:true});const file=path.join(dir,id+'.jsonl'),task={path:cwd,providerSessionId:id};
  const row={type:'user',uuid:'message',sessionId:id,cwd,message:{content:'Original task'}};
  await writeFile(file,JSON.stringify(row)+'\n');const history=await readClaudeSession(task,projects);assert.equal(history.transcriptPath,file);assert.equal(history.events[0].text,'Original task');
  const assistant={...row,type:'assistant',uuid:'answer',timestamp:'2026-09-11T10:00:00Z',effort:'xhigh',message:{model:'claude-opus-5',content:[{type:'text',text:'Done'}]}};
  await writeFile(file,[row,assistant,{...assistant,uuid:'synthetic',message:{model:'<synthetic>',content:[]}}].map(r=>JSON.stringify(r)).join('\n'));
  const observed=await readClaudeSession(task,projects);assert.equal(observed.model,'claude-opus-5');assert.equal(observed.effort,'xhigh');assert.equal(observed.events.at(-1).effort,'xhigh');
  await writeFile(file,JSON.stringify({...row,cwd:root}));await assert.rejects(readClaudeSession(task,projects),/does not belong/);
  await writeFile(file,JSON.stringify({...row,sessionId:'22222222-2222-4222-a222-222222222222'}));await assert.rejects(readClaudeSession(task,projects),/session mismatch/);
  const outside=path.join(root,id+'.jsonl');await writeFile(outside,JSON.stringify(row));await rm(file);await symlink(outside,file);await assert.rejects(readClaudeSession(task,projects),/Unexpected transcript path/);
  await rm(file);await assert.rejects(readClaudeSession(task,projects),/Waiting for Claude/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Codex model catalog preserves runtime effort capabilities and defaults',async()=>{
 const reader=new CodexReader(null);reader.connect=async()=>{};
 reader.rpc=async()=>({data:[{model:'test-model',displayName:'Test',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'ultra',description:'Automatic delegation'}],defaultReasoningEffort:'medium'}]});
 const [model]=await reader.models();assert.equal(model.supportedReasoningEfforts[0].reasoningEffort,'ultra');assert.equal(model.defaultReasoningEffort,'medium');
});
test('observed model and effort are persisted together without guessing unreported effort',async()=>{
 const task={id:'observed',kind:'codex',providerSessionId:id,path:'/worktree'},transcripts=new Transcripts({tools:{},save:async()=>{}});
 let observation={model:'gpt-5.6-sol',effort:'medium',modelObservedAt:'2026-09-11T10:00:00Z'};
 transcripts.codex.read=async()=>({sessionId:id,events:[],...observation});
 await transcripts.readCurrent(task,null,{full:true});assert.equal(task.reportedModel,'gpt-5.6-sol');assert.equal(task.reportedEffort,'medium');assert.equal(task.effort,undefined);
 observation={model:'gpt-5.6-terra'};await transcripts.readCurrent(task,null,{full:true});assert.equal(task.reportedModel,'gpt-5.6-terra');assert.equal(task.reportedEffort,null);
 observation={};await transcripts.readCurrent(task,null,{full:true});assert.equal(task.reportedModel,'gpt-5.6-terra');
});

test('paste wrappers normalize in live, saved-provider and durable-fallback views while raw history stays intact',async()=>{
 const {mkdir,writeFile,readFile}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-paste-history-'));
 try{
  const archiveId='22222222-2222-4222-a222-222222222222',task={id:'task',project:'pack',kind:'codex',providerSessionId:id,sessionArchives:[{id:archiveId,toKind:'codex'}]};
  const literal='<pasted_content id="42">\nKeep the nested example.\n</pasted_content id="42">';
  const raw={id:'user',type:'message',role:'user',text:`\n\n<pasted_content id="86ed">\n${literal}\n</pasted_content id="86ed">\n`};
  const saved={kind:'claude',history:{sessionId:'old',events:[raw]}},file=path.join(root,'.heloscrum/agents/task/sessions',archiveId+'.json');
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(saved));
  const transcripts=new Transcripts({root,tools:{},data:{collaboration:{messages:[]}}});
  transcripts.readCurrent=async()=>({sessionId:id,events:[{...raw,id:'current',text:'Current Codex message'}]});
  const switched=await transcripts.read(task,null);
  assert.equal(switched.events[0].text,literal,'normalize exactly once, using the original provider');
  assert.equal(switched.events[0].id,archiveId+':user');assert.equal(switched.events[1].type,'session');
  assert.equal(switched.events[2].text,'Current Codex message');
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved);
  const claude={...task,kind:'claude',sessionArchives:[]};
  transcripts.readCurrent=async()=>({sessionId:id,events:[raw]});
  assert.equal((await transcripts.read(claude,null)).events[0].text,literal);
  transcripts.readCurrent=async()=>{throw Error('Provider unavailable');};
  const history={sessionId:id,events:[raw]},before=structuredClone(history);
  transcripts.plane.history={sessionHistory:async()=>structuredClone(history)};
  const fallback=await transcripts.read(claude,null);
  assert.equal(fallback.events[0].text,literal);assert.match(fallback.warning,/Provider unavailable/);
  assert.deepEqual(history,before);
 }finally{await rm(root,{recursive:true,force:true});}
});
