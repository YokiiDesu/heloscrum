import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeCommands,commandCatalog,nativeCommandText,commandPromptReady} from '../lib/native-commands.mjs';
const prompts={codex:'Done\n› Ask Codex to do anything\nGPT-6.1 Sol',claude:'Done\n❯ \n? for shortcuts',kiro:'Done\n› ask a question or describe a task ↵',cursor:'Done\n→ Add a follow-up'};
function fixture(kind='codex'){
  const task={id:'task',kind,project:'/project',role:'Builder',pane:'pane',phase:'launched',providerSessionId:'one',nativeSetup:{cursorMode:'interactive',kiroEngine:'v3'}};
  const sent=[],records=[],live={pane_id:'pane',interactive_ready:true,agent_status:'done'};let output=prompts[kind];
  const plane={task:id=>{assert.equal(id,task.id);return task;},data:{tasks:[task]},collaboration:{delivering:new Set()},herdr:{list:async()=>[live],read:async()=>output,prompt:async(...args)=>{sent.push(args);}},record:async(...args)=>records.push(args)};
  const commands=new NativeCommands(plane),run=async(name,args='',requestId='request-one')=>commands.run(task.id,{name,args,requestId,expected:(await commands.inspect(task.id)).expected});
  return {task,plane,sent,records,live,commands,run,setOutput:s=>output=s};
}
test('provider catalogs preserve native command names and distinguish headless sessions',()=>{
  assert(commandCatalog({kind:'codex'}).commands.some(c=>c.name==='/goal'));
  assert(commandCatalog({kind:'cursor',nativeSetup:{cursorMode:'interactive'}}).commands.some(c=>c.name==='/summarize'));
  assert(!commandCatalog({kind:'cursor'}).supported);
  assert(!commandCatalog({kind:'ollama'}).supported);
  assert(commandCatalog({kind:'kiro'}).commands.some(c=>c.name==='/help --legacy'));
  assert(commandCatalog({kind:'kiro',nativeSetup:{kiroEngine:'v3'}}).commands.some(c=>c.name==='/help'));
  assert(!commandCatalog({kind:'claude'}).commands.some(c=>c.name==='/goal'));
});
test('native commands travel literally to all four CLI adapters without message envelopes',async()=>{
  for(const [kind,name] of [['codex','/status'],['claude','/context'],['kiro','/usage'],['cursor','/about']]){
    const f=fixture(kind),r=await f.run(name);assert.equal(r.delivery,'sent');assert.deepEqual(f.sent,[['pane',name]]);assert.equal(f.plane.collaboration.delivering.size,0);
  }
});
test('arguments remain literal, reject controls and cannot substitute another provider command',()=>{
  const task={kind:'codex'};assert.equal(nativeCommandText(task,'/goal','Inspect `file` and $(literal)'),'\/goal Inspect `file` and $(literal)');
  for(const args of ['do this\n/exit','x\ry','x\x1by','x\x00y','x\u2028y'])assert.throws(()=>nativeCommandText(task,'/goal',args),/one line/);
  assert.throws(()=>nativeCommandText(task,'/summarize'),/library/);assert.throws(()=>nativeCommandText(task,'/status','/clear'),/native panel/);
});
test('busy, blocked, headless, stopped and drafted sessions cannot receive commands',async()=>{
  for(const status of ['working','blocked','starting']){const f=fixture();f.live.agent_status=status;await assert.rejects(f.run('/status'),/Wait/);assert.equal(f.sent.length,0);}
  const f=fixture();f.live.interactive_ready=false;await assert.rejects(f.run('/status'),/Wait/);f.live.interactive_ready=true;
  f.setOutput('› Please preserve this draft\nGPT-6.1 Sol');await assert.rejects(f.run('/status'),/draft/);
  f.task.phase='switching';await assert.rejects(f.run('/status'),/setup/);
  const c=fixture('cursor');c.task.nativeSetup.cursorMode='headless';await assert.rejects(c.run('/about'),/no interactive/);
});
test('session replacement, concurrent delivery and stale identity fail before sending',async()=>{
  const f=fixture(),expected=(await f.commands.inspect('task')).expected;f.task.providerSessionId='replacement';
  await assert.rejects(f.commands.run('task',{name:'/status',expected,requestId:'replace-one'}),/session changed/);
  f.plane.collaboration.delivering.add('task');await assert.rejects(f.run('/status'),/Another input/);f.plane.collaboration.delivering.clear();
  f.plane.promptingTasks=new Set(['task']);await assert.rejects(f.run('/status'),/Another input/);assert.equal(f.sent.length,0);
});
test('successful and uncertain command receipts prevent accidental retry execution',async()=>{
  const f=fixture();await f.run('/status');await f.run('/status');assert.equal(f.sent.length,1);
  await assert.rejects(f.run('/diff'),/different command/);
  f.plane.herdr.prompt=async()=>{f.sent.push('uncertain');throw Error('lost response');};
  await assert.rejects(f.run('/diff','','request-two'),/unconfirmed/);await assert.rejects(f.run('/diff','','request-two'),/unconfirmed/);assert.equal(f.sent.length,2);assert.equal(f.plane.collaboration.delivering.size,0);
});
test('model-using command arguments are not copied into the activity log',async()=>{
  const f=fixture();await f.run('/goal','Task-specific private objective');assert.equal(f.sent[0][1],'/goal Task-specific private objective');assert(!JSON.stringify(f.records).includes('private objective'));
});
test('native prompt evidence requires an empty composer',()=>{
  for(const kind of Object.keys(prompts)){assert(commandPromptReady({kind},prompts[kind]));assert(!commandPromptReady({kind},'No known prompt'));}
  assert(!commandPromptReady({kind:'claude'},'❯ /compact draft'));
  assert(!commandPromptReady({kind:'cursor'},'→ A typed prompt'));
});

test('a preceding placeholder cannot hide a later native draft',()=>{
 for(const [kind,draft] of [['codex','› Keep this draft'],['cursor','→ Keep this draft'],['kiro','› Keep this draft'],['claude','❯ Try my exact words']])assert(!commandPromptReady({kind},prompts[kind]+'\n'+draft));
});

import {isSlashDraft,resolveSlashCommand,slashSuggestions} from '../dist/slash-commands.js';
test('composer routes provider commands but preserves absolute paths and ordinary messages',()=>{
  const report=commandCatalog({kind:'codex'});
  for(const text of ['Please run /status','/workspace/file.txt','/usr/bin/env']){assert(!isSlashDraft(text));assert.equal(resolveSlashCommand(text,report),null);}
  assert(isSlashDraft('/'));assert(isSlashDraft('/status'));assert(isSlashDraft('/custom-command'));
  assert.deepEqual(resolveSlashCommand(' /goal Inspect the engine ',report),{name:'/goal',args:'Inspect the engine'});
  assert.deepEqual(slashSuggestions('/sta',report.commands).map(c=>c.name),['/status']);
  assert.throws(()=>resolveSlashCommand('/unknown-command',report),/custom commands/);
  assert.throws(()=>resolveSlashCommand('/status ignore this',report),/native panel/);
  assert.throws(()=>resolveSlashCommand('/goal a\nsecond command',report),/one line/);
  assert.throws(()=>resolveSlashCommand('/goal '+ 'x'.repeat(4001),report),/4,000/);
  assert.throws(()=>resolveSlashCommand('/status',commandCatalog({kind:'ollama'})),/no native/);
});
test('Kiro V2 composer uses the catalogued classic help instead of invoking its Help Agent',()=>{
  const report=commandCatalog({kind:'kiro'});
  assert.deepEqual(resolveSlashCommand('/help',report),{name:'/help --legacy',args:''});
  assert.deepEqual(resolveSlashCommand('/help --legacy',report),{name:'/help --legacy',args:''});
  assert.throws(()=>resolveSlashCommand('/help Explain the project',report),/library/);
});

test('Claude recognizes its native empty placeholder without accepting a typed draft',()=>{
  assert(commandPromptReady({kind:'claude'},'❯ Try "edit <filepath> to..."'));
  assert(!commandPromptReady({kind:'claude'},'❯ Try my exact words'));
  assert(!commandPromptReady({kind:'claude'},'❯ Try "edit <filepath> to..." next'));
});
