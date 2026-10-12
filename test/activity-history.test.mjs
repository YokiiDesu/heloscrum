import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {HistoryStore} from '../lib/history-store.mjs';
import {mergeActivity,ActivityEvents} from '../lib/activity-events.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {AIConnections} from '../lib/ai-connections.mjs';

test('native tool followed by a Mod report remains one saved history event',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-activity-history-')),db=await new HistoryStore(path.join(root,'history.duckdb')).init(),task={id:randomUUID(),project:root,kind:'claude',providerSessionId:randomUUID(),role:'Fixture',path:root};
  try{
    const native=[{id:'toolu_actual',type:'tool',name:'Bash',status:'running',at:'2026-10-09T20:00:00.000Z'}],history={sessionId:task.providerSessionId,source:'Claude session history',events:native};
    await db.captureTranscript(task,history);
    const activity=new ActivityEvents({root});await activity.report(task,{sessionId:task.providerSessionId,id:'toolu_actual',kind:'tool',sequence:1,status:'completed',name:'Bash',output:'ok'});
    await db.captureTranscript(task,{...history,events:mergeActivity(native,await activity.read(task))});
    const saved=await db.sessionHistory(root,task.id+':claude:'+task.providerSessionId);assert.equal(saved.events.length,1);assert.equal(saved.events[0].type,'activity');assert.equal(saved.events[0].status,'completed');
  }finally{await db.close();await rm(root,{recursive:true,force:true});}
});
test('only Claude sees the activity tool and memory-ranking settings reject a missing service',async()=>{
  const plane={root:'/private/tmp',data:{tasks:[],contextSettings:{revision:0,budgetTokens:32000,toolResultChars:12000}},save:async()=>{}},collab=new Collaboration(plane),claude={id:randomUUID(),project:'/private/tmp',kind:'claude',toolPolicy:{mode:'selected',allowed:[]}};
  assert(collab.catalog(claude,{compact:true}).tools.some(t=>t.name==='activity_report'));
  assert(!collab.catalog({...claude,kind:'codex'},{compact:true}).tools.some(t=>t.name==='activity_report'));
  assert(!collab.allowed({...claude,external:true},'activity_report'));
  const ai=new AIConnections(plane);await assert.rejects(ai.configureContext({expectedRevision:0,memoryRankingEnabled:true}),/Jev connection/);
  const configured=await ai.configureContext({expectedRevision:0,memoryRankingEnabled:false});assert.equal(configured.memoryRankingEnabled,false);
});
