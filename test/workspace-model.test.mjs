import test from 'node:test';
import assert from 'node:assert/strict';
import {workspacePreferences,statusLabel,modelActivityLabel,toolPresentation,turnActivity} from '../dist/workspace-model.js';
test('work updates keep notes and IDs in details instead of the collapsed title',()=>{
  const name='work_update_task(planId: plan-id, itemId: task-id, status: in_progress, note: Applied solver edits and checked files. '+ 'More detail. '.repeat(60)+'expectedRevision: 6)';
  const event={name,status:'completed'},model=toolPresentation(event);
  assert.equal(model.name,'Task updated · In progress');assert.equal(model.kind,'tool');assert.equal(model.input,name);assert.equal(event.name,name);
  assert.equal(toolPresentation({...event,status:'failed'}).name,'Task update failed');assert.equal(toolPresentation({...event,status:'running'}).name,'Updating task');
  const input=JSON.stringify({status:'needs_review',note:'Detailed result'}),structured=toolPresentation({name:'mcp__heloscrum__work_update_task',input,status:'completed'});
  assert.equal(structured.name,'Task updated · Needs review');assert.equal(structured.input,input);
  assert.equal(toolPresentation({name:'Read README',input:'README.md'}).name,'Read README');
});
import {codexItems} from '../lib/transcripts.mjs';
import {transcriptRows} from '../dist/tui-model.js';

test('large legacy commands stay compact without losing the script or misclassifying its contents',()=>{
  const name="cat << 'EOF' > /tmp/preset.rs\n"+'println!("write read edit patch shell");\n'.repeat(100)+'EOF\nrustc /tmp/preset.rs';
  const event={id:'script',type:'tool',name,input:'',output:'finished',status:'completed'},saved=structuredClone(event),tool=toolPresentation(event);
  assert.equal(tool.kind,'command');assert.equal(tool.name,"cat << 'EOF' > /tmp/preset.rs …");assert.equal(tool.input,name);assert.deepEqual(event,saved);
  const collapsed=transcriptRows([event],100,new Set());assert(collapsed.length<5);assert(!collapsed.some(row=>row.text.includes('println!')));
  const expanded=transcriptRows([event],100,new Set([event.id]));assert(expanded.some(row=>row.text.includes('println!')));assert(expanded.some(row=>row.text.includes('finished')));
  assert.equal(toolPresentation({name:'python3 -c \'\n'+name}).kind,'command');
});

test('all tool titles are bounded, with provider kinds and distinct input preserved',()=>{
  const name='mcp__example__record_note(text: '+'read write edit '.repeat(200)+')',input=JSON.stringify({id:'note-1'});
  const event={id:'note',type:'tool',name,input,toolKind:'other'},tool=toolPresentation(event);
  assert.equal(tool.name,'record_note');assert.equal(tool.kind,'tool');assert.equal(tool.input,input);assert.equal(tool.titleDetails,name);
  const expanded=transcriptRows([event],100,new Set([event.id]));assert(expanded.some(row=>row.text.includes('FULL CALL')));assert(expanded.some(row=>row.text.includes('note-1')));
  for(const name of ['Unrecognized operation '+ 'x'.repeat(500),'x'.repeat(500)+'(value: 1)', 'Long description\n'+ 'read write '.repeat(500)]){
    const result=toolPresentation({name});assert(result.name.length<=110);assert(!result.name.includes('\n'));assert.equal(result.input,name);assert.equal(result.kind,'tool');
  }
  assert.equal(toolPresentation({name:'Some path contains write_file',toolKind:'execute'}).kind,'command');
  assert.equal(toolPresentation({name:'Write a notebook entry',toolKind:'other'}).kind,'tool');
  assert.equal(toolPresentation({name:'Read README.md'}).kind,'read');
  assert.equal(toolPresentation({name:'mcp__server__write_file'}).kind,'edit');
});

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
