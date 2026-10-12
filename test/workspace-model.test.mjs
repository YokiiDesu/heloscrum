import test from 'node:test';
import assert from 'node:assert/strict';
import {workspacePreferences,statusLabel,modelActivityLabel,toolPresentation,turnActivity} from '../dist/workspace-model.js';
import {codexItems} from '../lib/transcripts.mjs';

test('workspace defaults fit laptops while preserving explicit layout and chat choices',()=>{
  assert.equal(workspacePreferences({},true).layout,'focus');assert.equal(workspacePreferences().layout,'grid');
  assert.deepEqual(workspacePreferences({layout:'split',theme:'block',tab:'changes',selected:'qa',compare:'builder'},true),{layout:'split',theme:'block',tab:'changes',selected:'qa',compare:'builder'});
  assert.equal(workspacePreferences({layout:'bad',theme:'bad'}).theme,'bubble');assert.equal(statusLabel('blocked'),'Needs Review');
});
test('tool progress describes observed results in the current turn without inventing completion',()=>{
  const events=[{type:'tool',status:'completed'},{type:'message',role:'user'},{type:'tool',name:'read_file',status:'completed'},{type:'tool',name:'Terminal command',status:'completed',exitCode:1},{type:'tool',name:'Edit',status:'inProgress'},{type:'tool',name:'unknown'}];
  assert.deepEqual(turnActivity(events),{total:4,completed:1,failed:1,running:1});
  assert.equal(toolPresentation(events.at(-1)).status,'recorded');assert.equal(toolPresentation({name:'Edit',durationMs:1200}).duration,'1.2 s');
});
test('Block receives provider public summaries and durations, never raw reasoning content',()=>{
  const events=codexItems([{id:'turn',items:[{id:'reason',type:'reasoning',summary:['A provider summary'],content:['private content']},{id:'hidden',type:'reasoning',content:['private only']},{id:'cmd',type:'commandExecution',command:'npm test',durationMs:200,status:'completed',exitCode:0}]}]);
  assert.equal(events.find(e=>e.id==='reason').text,'A provider summary');assert.equal(events.find(e=>e.id==='hidden').text,'');assert.equal(events.find(e=>e.id==='cmd').durationMs,200);assert.doesNotMatch(JSON.stringify(events),/private/);
});

test('waiting and cancelled tool calls stay distinct from completed work',()=>{
  assert.equal(toolPresentation({status:'queued'}).status,'pending');
  assert.equal(toolPresentation({status:'awaiting_approval'}).status,'blocked');
  assert.equal(toolPresentation({status:'interrupted'}).status,'cancelled');
  assert.equal(toolPresentation({status:'cancelled',failed:true}).status,'failed');
  assert.deepEqual(turnActivity([{type:'tool',status:'queued'},{type:'tool',status:'cancelled'}]),{total:2,completed:0,failed:0,running:0});
});

test('local model activity distinguishes startup, generation, and completed work',()=>{
  assert.equal(modelActivityLabel('working',{phase:'waiting'}),'Waiting For Model');
  assert.equal(modelActivityLabel('working',{phase:'receiving'}),'Receiving Response');
  assert.equal(modelActivityLabel('working',null),'Working');
  assert.equal(modelActivityLabel('idle',{phase:'receiving'}),'Ready');
  assert.equal(modelActivityLabel('done',{phase:'waiting'}),'Finished');
});
