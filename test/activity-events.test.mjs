import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {ActivityEvents,mergeActivity,testSummary} from '../lib/activity-events.mjs';
import {activityCard} from '../dist/activity-card.js';
import {supportsActivityMod} from '../lib/claude-mod.mjs';
const tap='# tests 5\n# suites 0\n# pass 3\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n';
test('activity is session-scoped, bounded, persistent and idempotent under out-of-order reports',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-activity-')),task={id:randomUUID(),kind:'claude',project:'/project',providerSessionId:randomUUID()},plane={root,transcripts:{cache:new Map([[task.id,{}]])}},events=new ActivityEvents(plane);
  try{
    const input={sessionId:task.providerSessionId,id:'toolu_1',kind:'tool',status:'completed',sequence:1,name:'Bash',output:tap};
    await events.report(task,input);assert.equal((await events.report(task,{...input,sequence:0,status:'running'})).recorded,false);
    assert.equal((await events.read(task))[0].status,'completed');assert.equal(plane.transcripts.cache.has(task.id),false);await assertPrivate(events.file(task));
    assert.equal((await new ActivityEvents(plane).read(task)).length,1);
    assert.equal((await events.read({...task,id:randomUUID()})).length,0);
    await assert.rejects(events.report(task,{...input,sessionId:randomUUID()}),/current Claude/);
    await assert.rejects(events.report({...task,external:true},input),/current Claude/);
    await assert.rejects(events.report(task,{...input,id:'../escape'}),/Invalid/);
    await assert.rejects(events.report(task,{...input,id:'context',kind:'context',context:{percent:101}}),/Invalid context/);
    await assert.rejects(events.report(task,{...input,id:'huge',output:'x'.repeat(12001)}),/too large/);
    await events.report(task,{...input,id:'unknown',kind:'context',context:{window:200000}});assert(!Object.hasOwn((await events.read(task)).at(-1).context,'tokens'));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('activity replaces matching native tools, retains native output, and only counts complete test reports',()=>{
  const result=mergeActivity([{id:'u',type:'message',text:'run',at:'2026-01-01'},{id:'toolu_1',type:'tool',name:'Bash',at:'2026-01-02',output:tap,status:'completed'}],[{id:'activity:toolu_1',eventId:'toolu_1',type:'activity',kind:'tool',status:'running',at:'2026-01-03'}]);
  assert.equal(result.length,2);assert.equal(result[1].status,'completed');assert.equal(result[1].tests.passed,3);assert.equal(testSummary('5 tests passed'),null);assert.equal(testSummary(tap+tap),null);assert.equal(testSummary(tap.replace('# pass 3','# pass 7')),null);
  assert.match(activityCard(result[1]),/3 passed/);assert(!activityCard({kind:'context',context:{window:200000}}).includes('0%'));
  const html=activityCard({kind:'tool',name:'<img onerror=x>',output:'<script>alert(1)</script>',status:'completed'});assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
});
test('Mod transport failures never repeat, deny, or replace native tool work',async()=>{
  const {register}=await import('../plugins/heloscrum-activity/hooks/register.js?test='+randomUUID()),hooks=new Map(),ticks=[];
  register((name,...args)=>hooks.set(name+(args[0]?.command?':'+args[0].command:''),args.at(-1)));
  const $={session:{id:async()=>randomUUID(),usage:async()=>({context:{window:200000}})},command:{register:async()=>{}},clock:{every:(_ms,fn)=>ticks.push(fn)},mcp:{call:async()=>{throw Error('offline');}}};
  await hooks.get('session.start')($,{},async()=>({}));
  let calls=0;const expected={result:{stdout:'ok'},text:'ok'};
  assert.equal(await hooks.get('tool.call')($,{tool:'Bash',tool_use_id:'toolu_2',command:'true'},async()=>{calls++;return expected;}),expected);
  await ticks[0]();assert.equal(calls,1);
  await assert.rejects(hooks.get('tool.call')($,{tool:'Bash',tool_use_id:'toolu_3'},async()=>{calls++;throw Error('native error');}),/native error/);assert.equal(calls,2);
  const reports=[];$.mcp.call=async(_server,_tool,input)=>{reports.push(input);return {content:[]};};await ticks[0]();
  assert(reports.some(r=>r.id==='toolu_2'&&r.status==='completed'));assert(reports.some(r=>r.id==='toolu_3'&&r.status==='failed'));
  const result=await hooks.get('command.run:heloscrum-status')($);assert.match(result.text,/connected/);assert(reports.some(r=>r.kind==='context'&&!('tokens' in r.context)));
  assert(supportsActivityMod('2.1.286 (Claude Code)'));assert(!supportsActivityMod('2.1.285'));
});
