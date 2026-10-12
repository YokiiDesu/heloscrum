import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, stat, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KiroReader, kiroItems, kiroLaunchConfig } from '../lib/kiro.mjs';
import { run, binary, HerdrAdapter } from '../lib/adapters.mjs';
import { Transcripts } from '../lib/transcripts.mjs';
import { Collaboration } from '../lib/collaboration.mjs';
import { AgentSettings } from '../lib/agent-settings.mjs';
import { effortOptions } from '../lib/effort.mjs';

const id='11111111-1111-4111-a111-111111111111', other='22222222-2222-4222-a222-222222222222';
const row=(kind,message_id,content)=>({version:'1',kind,data:{message_id,content,meta:{timestamp:Date.parse('2026-10-05T01:00:00Z')/1000}}});
const text=data=>({kind:'text',data});
const use=(toolUseId,name,input)=>({kind:'toolUse',data:{toolUseId,name,input}});
const result=(toolUseId,status,output)=>({kind:'toolResult',data:{toolUseId,status,content:[text(output)]}});

test('Kiro histories preserve provider thinking separately, pair tools, and omit signatures',()=>{
  const records=[row('Prompt','u',[text('Check <script>')]),row('AssistantMessage','a',[
    {kind:'thinking',data:{text:'Plan the check.',signature:'secret'}},text('Checking.'),use('one','execute_bash',{command:'npm test'}),use('two','fs_read',{path:'missing'}),use('pending','fs_write',{})]),
    row('ToolResults','r',[result('one','success','PASS'),result('two','error','not found'),result('orphan','success','Recovered output')])];
  const events=kiroItems([...records,records[1]]);
  assert.equal(events[0].at,'2026-10-05T01:00:00.000Z');assert.equal(events.length,7);assert.equal(events[1].type,'thinking');assert.equal(events[1].text,'Plan the check.');assert.equal(events[0].text,'Check <script>');assert.equal(events[3].output,'PASS');assert.equal(events[3].status,'completed');
  assert.equal(events[4].status,'failed');assert.equal(events[5].status,'running');assert.equal(events[6].name,'Tool result');assert(!JSON.stringify(events).includes('secret'));
  const report={state:'focused',reason:'Tests pass',nextStep:'Review'};
  const reported=kiroItems([row('AssistantMessage','a',[use('state','@heloscrum/report_state',report)]),row('ToolResults','r',[result('state','success','OK')]),row('AssistantMessage','b',[text('Done')])]);
  assert.equal(reported[1].agentState.state,'focused');
});

async function historyFixture(t){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-kiro-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const cwd=path.join(root,'worktree'),sessions=path.join(root,'sessions');await mkdir(cwd);await mkdir(sessions);
  const meta={session_id:id,cwd,created_at:'2026-10-05T01:00:00Z',updated_at:'2026-10-05T01:01:00Z',session_state:{rts_model_state:{model_info:{model_id:'auto'}}}};
  const metadata=path.join(sessions,id+'.json'),transcript=path.join(sessions,id+'.jsonl');await writeFile(metadata,JSON.stringify(meta));await writeFile(transcript,JSON.stringify(row('Prompt','u',[text('task')]))+'\n');
  return {root,cwd,sessions,meta,metadata,transcript,reader:new KiroReader(null,sessions)};
}
test('Kiro reader rejects wrong identities, escaping symlinks, and oversized files; tolerates active writes',async t=>{
  const f=await historyFixture(t),history=await f.reader.read(id,f.cwd);
  assert.equal(history.model,'auto');assert.equal(history.events[0].text,'task');
  await writeFile(f.transcript,JSON.stringify(row('Prompt','u',[text('task')]))+'\n{"incomplete');assert.equal((await f.reader.read(id,f.cwd)).events.length,1);
  await writeFile(f.transcript,'invalid\n');await assert.rejects(f.reader.read(id,f.cwd),/invalid record/);
  await writeFile(f.metadata,JSON.stringify({...f.meta,session_id:other}));await assert.rejects(f.reader.read(id,f.cwd),/session mismatch/);
  await writeFile(f.metadata,JSON.stringify({...f.meta,cwd:f.root}));await assert.rejects(f.reader.read(id,f.cwd),/does not belong/);
  await writeFile(f.metadata,JSON.stringify(f.meta));await truncate(f.transcript,32*1024*1024);await assert.rejects(f.reader.read(id,f.cwd),/reader limit/);
  const outside=path.join(f.root,id+'.jsonl');await writeFile(outside,'');await rm(f.transcript);await symlink(outside,f.transcript);await assert.rejects(f.reader.read(id,f.cwd),/Unexpected Kiro transcript path/);
  await assert.rejects(f.reader.read('../escape',f.cwd),/identifier/);
});
test('Kiro discovery queries one worktree and refuses old, ambiguous, or incomplete matches',async t=>{
  const f=await historyFixture(t);let groups=[{cwd:f.cwd,complete:true,sessions:[{sessionId:id,source:'v2'}]}];
  f.reader.command=async(args,cwd)=>{assert.equal(cwd,f.cwd);assert.deepEqual(args,['--list-sessions','--format','json']);return JSON.stringify(groups);};
  assert.equal(await f.reader.findSession(f.cwd,f.meta.created_at),id);
  await assert.rejects(f.reader.findSession(f.cwd,'2026-10-05T02:00:00Z'),/Waiting for Kiro/);
  groups[0].complete=false;await assert.rejects(f.reader.findSession(f.cwd,f.meta.created_at),/incomplete/);groups[0].complete=true;
  await writeFile(path.join(f.sessions,other+'.json'),JSON.stringify({...f.meta,session_id:other}));groups[0].sessions.push({sessionId:other,source:'v2'});await assert.rejects(f.reader.findSession(f.cwd,f.meta.created_at),/More than one/);
  groups=[{cwd:f.root,sessions:[]}];await assert.rejects(f.reader.findSession(f.cwd,f.meta.created_at),/different worktree/);
});
test('Kiro model catalog uses provider IDs/default and does not inherit Claude effort rules',async()=>{
  const reader=new KiroReader(null);reader.command=async()=>JSON.stringify({default_model:'auto',models:[{model_id:'auto',model_name:'Auto'},{model_id:'claude-sonnet-5',model_name:'Sonnet'}]});
  assert.deepEqual((await reader.models()).map(m=>[m.id,m.isDefault]),[['auto',true],['claude-sonnet-5',false]]);
  const plane={tools:{kiro:true},transcripts:{kiro:reader}},settings=new AgentSettings(plane);
  assert.equal((await settings.selection({kind:'kiro',model:'auto'})).kind,'kiro');
  assert.equal((await settings.selection({kind:'kiro'})).resolvedModel,'auto');
  assert.deepEqual(effortOptions({id:'kiro',effortLevels:['high']},'claude-sonnet-5'),[]);
  await assert.rejects(settings.selection({kind:'kiro',model:'auto',effort:'high'}),/not supported/);
});
test('Kiro profiles are task-scoped, Git-excluded, permission-preserving, and resume exact IDs',async t=>{
  const f=await historyFixture(t);await run('git',['init','-q'],{cwd:f.cwd});
  const task={id,kind:'kiro',path:f.cwd,model:'auto'},server={command:process.execPath,args:['bridge.mjs','connection.json']};
  const args=await kiroLaunchConfig(task,server,{resumeSessionId:other});
  assert.deepEqual(args,['chat','--v2','--tui','--agent','heloscrum-'+id,'--resume-id',other,'--model','auto']);assert(!args.includes('--trust-all-tools'));
  const file=path.join(f.cwd,'.kiro/agents/heloscrum-'+id+'.json'),config=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(config.mcpServers.heloscrum,server);assert.equal(config.allowedTools,undefined);await assertPrivate(file);
  await kiroLaunchConfig(task,server);assert.equal((await readFile(path.join(f.cwd,'.git/info/exclude'),'utf8')).split('/.kiro/agents/').length,2);
  assert.equal((await run('git',['status','--porcelain'],{cwd:f.cwd})).trim(),'');
  await writeFile(path.join(f.cwd,'.kiro/agents/user.json'),'{}');assert.match(await run('git',['status','--porcelain','--untracked-files=all'],{cwd:f.cwd}),/user.json/);
  const outside=path.join(f.root,'outside');await mkdir(outside);await rm(path.join(f.cwd,'.kiro/agents'),{recursive:true});await symlink(outside,path.join(f.cwd,'.kiro/agents'));
  await assert.rejects(kiroLaunchConfig(task,server),/inside its worktree/);
});
test('Kiro registration uses the same MCP identity and Herdr kind; validated identity is persisted',async t=>{
  const f=await historyFixture(t);await run('git',['init','-q'],{cwd:f.cwd});
  const task={id,kind:'kiro',path:f.cwd,project:f.cwd,title:'QA',prompt:'Check',createdAt:f.meta.created_at},plane={root:f.root,tools:{},data:{tasks:[task]},save:async()=>{}};
  const collab=new Collaboration(plane),args=await collab.register(task);assert.equal(args[0],'chat');assert.equal(task.providerSessionId,undefined);
  const config=JSON.parse(await readFile(path.join(f.cwd,'.kiro/agents/heloscrum-'+id+'.json'),'utf8'));
  const connection=JSON.parse(await readFile(config.mcpServers.heloscrum.args[1],'utf8'));assert.equal(collab.authenticate(connection.token).id,id);
  const herdr=new HerdrAdapter('herdr',f.root);herdr.json=async args=>args;assert.equal((await herdr.startAgent('wp-test','kiro','pane',args))[4],'kiro');
  const transcripts=new Transcripts(plane);transcripts.kiro=f.reader;f.reader.findSession=async()=>id;
  assert.equal((await transcripts.readCurrent(task)).events[0].text,'task');assert.equal(task.providerSessionId,id);
  transcripts.cache.clear();f.reader.findSession=async()=>{throw Error('Must use saved identity');};await transcripts.readCurrent(task);
  const unbound={...task,id:other,providerSessionId:undefined};f.reader.findSession=async()=>id;f.reader.read=async()=>{throw Error('history mismatch');};await assert.rejects(transcripts.readCurrent(unbound),/history mismatch/);assert.equal(unbound.providerSessionId,undefined);
});
test('Kiro executable discovery uses kiro-cli and supports the usual explicit override',async t=>{
  const f=await historyFixture(t);await mkdir(path.join(f.root,'.heloscrum/bin'),{recursive:true});
  const file=path.join(f.root,'.heloscrum/bin/kiro-cli');await writeFile(file,'#!/bin/sh\n',{mode:0o755});
  assert.equal(await binary('kiro',f.root),file);
});
