import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeItems,codexItems} from '../lib/transcripts.mjs';
import {cursorEvents} from '../lib/cursor.mjs';
import {rolloutEvents} from '../lib/codex-rollout.mjs';
import {thinkingBlock} from '../dist/thinking-block.js';
import {transcriptRows} from '../dist/tui-model.js';
import {turnActivity} from '../dist/workspace-model.js';

test('Claude thinking keeps its position and identity without signatures or redacted data',()=>{
  const assistant={type:'assistant',uuid:'reply',timestamp:'2026-10-09T07:00:00Z',message:{model:'claude-fixture',content:[
    {type:'thinking',thinking:'Check the saved contract.',signature:'PRIVATE_SIGNATURE'},
    {type:'text',text:'Reading the contract.'},
    {type:'tool_use',id:'read',name:'Read',input:{file_path:'CONTRACT.md'}},
    {type:'redacted_thinking',thinking:'DO_NOT_DISPLAY',data:'REDACTED_PAYLOAD'},
  ]}};
  const records=[assistant,structuredClone(assistant),{type:'user',uuid:'result',message:{content:[
    {type:'tool_result',tool_use_id:'read',content:'Contract contents'},
    {type:'thinking',thinking:'A user block is not model activity.'},
  ]}}],before=structuredClone(records),events=claudeItems(records);
  assert.deepEqual(events.map(e=>e.type),['thinking','message','tool','thinking']);
  assert.equal(events[0].id,'reply:0');assert.equal(events[0].text,'Check the saved contract.');
  assert.equal(events[0].model,'claude-fixture');assert.equal(events[0].status,'completed');
  assert.equal(events[2].status,'completed');assert.equal(events[2].output,'Contract contents');
  assert.equal(events[3].text,'');assert.equal(events[3].redacted,true);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_SIGNATURE|REDACTED_PAYLOAD|DO_NOT_DISPLAY|A user block/);
  assert.deepEqual(records,before);
});

test('Codex live and archived histories expose summaries and retain empty reasoning activity',()=>{
  const items=[{id:'summary',type:'reasoning',summary:[{type:'summary_text',text:'Compare the public schema.'}],content:['RAW_REASONING'],encrypted_content:'ENCRYPTED'},
    {id:'empty',type:'reasoning',summary:[],content:['RAW_REASONING'],encrypted_content:'ENCRYPTED'}];
  const live=codexItems([{id:'turn',status:'completed',items}]);
  const archived=rolloutEvents(items.map(payload=>({type:'response_item',payload})));
  for(const events of [live,archived]){
    assert.equal(events.length,2);assert.equal(events[0].text,'Compare the public schema.');
    assert.equal(events[0].textKind,'summary');assert.equal(events[1].type,'thinking');assert.equal(events[1].text,'');
    assert.doesNotMatch(JSON.stringify(events),/RAW_REASONING|ENCRYPTED/);
  }
});

test('Codex thinking does not inherit a later interruption or failure from its turn',()=>{
  for(const status of ['completed','interrupted','failed','inProgress']){
    const input=[{id:'turn',status,items:[
      {id:'reason',type:'reasoning',summary:[]},
      {id:'cancelled',type:'reasoning',status:'interrupted',summary:[]},
      {id:'running',type:'reasoning',status:'inProgress',summary:['Checking the result.']},
      {id:'command',type:'commandExecution',status:'completed',command:'pwd',exitCode:0},
    ]}],before=structuredClone(input),events=codexItems(input);
    assert.equal(events[0].status,'recorded');
    assert.equal(events[1].status,'interrupted');
    assert.equal(events[2].status,'inProgress');
    assert.equal(events[3].status,'completed');
    const html=thinkingBlock(events[0],{markdown:()=>''});
    assert.match(html,/tool-recorded/);assert.doesNotMatch(html,/cancelled|failed|tool-running/);
    assert.deepEqual(input,before);
  }
});

test('empty thinking distinguishes missing text, missing summaries and provider redaction in both views',()=>{
  for(const [event,label] of [
    [{id:'plain',type:'thinking',text:''},'No text recorded'],
    [{id:'summary',type:'thinking',text:'  ',textKind:'summary'},'No summary recorded'],
    [{id:'redacted',type:'thinking',text:'',redacted:true},'Text withheld by provider'],
  ]){
    const html=thinkingBlock(event,{markdown:()=>{throw Error('No readable text');}});
    assert.ok(html.includes(label));assert.doesNotMatch(html,/<details|Show text|Show summary/);
    const rows=transcriptRows([event],120);
    assert.ok(rows.some(row=>row.text.includes(label)));assert.ok(rows.every(row=>!row.toolHeader));
  }
});

test('Cursor captures thinking and replies together without treating request IDs as event IDs',()=>{
  const row={type:'assistant',request_id:'whole-turn',message:{content:[
    {type:'thinking',thinking:'Inspect the tool result.',signature:'PRIVATE_SIGNATURE'},
    {type:'redacted_thinking',data:'REDACTED_PAYLOAD'},
    {type:'text',text:'The result is ready.'},
  ]}},events=cursorEvents(row);
  assert.deepEqual(events.map(e=>e.type),['thinking','thinking','message']);
  assert.equal(events[0].text,'Inspect the tool result.');assert.equal(events[0].id,undefined);
  assert.equal(events[1].text,'');assert.equal(events[2].text,'The result is ready.');
  assert.equal(cursorEvents({...row,message:{...row.message,id:'reply'}})[0].id,'reply:thinking:0');
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_SIGNATURE|REDACTED_PAYLOAD/);
  assert.deepEqual(cursorEvents({type:'user',message:row.message}),[]);
});

test('thinking disclosure defaults closed, preserves supplied Markdown and offers no empty toggle',()=>{
  const event={id:'r" data-bad="x',type:'thinking',text:'A **provider summary**.',textKind:'summary',durationMs:1250,status:'completed'};
  const calls=[],html=thinkingBlock(event,{scope:'history',markdown:text=>{calls.push(text);return '<p>A <strong>provider summary</strong>.</p>';}});
  assert.match(html,/^<details\b/);assert.doesNotMatch(html,/<details[^>]*\sopen(?:[\s=>])/);
  assert.match(html,/Show summary/);assert.match(html,/Hide summary/);assert.match(html,/1\.3 s/);
  assert.match(html,/data-event="r&quot; data-bad=&quot;x"/);assert.match(html,/<strong>provider summary<\/strong>/);
  assert.deepEqual(calls,[event.text]);
  const unavailable=thinkingBlock({...event,text:''},{markdown:()=>{throw Error('Empty thinking must not be rendered');}});
  assert.match(unavailable,/Thinking/);assert.match(unavailable,/No summary recorded/);assert.match(unavailable,/title="This session recorded thinking activity without readable summary\."/);assert.doesNotMatch(unavailable,/<details|Show summary/);
});

test('TUI thinking toggles independently and never counts as completed tool work',()=>{
  const events=[{id:'r',type:'thinking',text:'Inspect **permissions** first.',textKind:'summary'},
    {id:'empty',type:'thinking',text:''},{id:'read',type:'tool',name:'Read',status:'completed'}],before=structuredClone(events);
  const closed=transcriptRows(events,60),open=transcriptRows(events,60,new Set(['r']));
  assert.match(closed.map(r=>r.text).join('\n'),/Thinking.*show summary/);
  assert.doesNotMatch(closed.map(r=>r.text).join('\n'),/Inspect permissions/);
  assert.match(open.map(r=>r.text).join('\n'),/Inspect permissions first/);
  assert.equal(closed.find(r=>r.eventId==='r').toolHeader,true);
  assert.equal(closed.find(r=>r.eventId==='empty').toolHeader,false);
  assert.deepEqual(turnActivity(events),{total:1,completed:1,failed:0,running:0});
  assert.deepEqual(events,before);
});
