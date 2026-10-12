import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {AgentIdentityDirectory,agentIdentities,agentAvatar,agentLabel,agentColor} from '../dist/agent-appearance.js';
import {ChatThreads,replyThreads} from '../dist/chat-threads.js';
import {transcriptRows} from '../dist/tui-model.js';
import {ControlPlane} from '../lib/control-plane.mjs';
import {Collaboration} from '../lib/collaboration.mjs';

test('agent group reads do not expose the human UI identity directory across projects',()=>{
  const actor={id:'actor',role:'QA',project:'/allowed',prompt:'Verify'},other={id:'foreign',role:'Private role',project:'/secret-other-project',prompt:'Private task'};
  const registry=new Collaboration({root:'/tmp',data:{tasks:[actor,other]},save:async()=>{}});
  registry.data.threads.push({id:'group',project:actor.project,name:'Allowed group',participants:[actor.id]});
  const page=registry.groups.read(actor,{threadId:'group'});
  assert.equal(page.agentIdentities,undefined);assert(!JSON.stringify(page).includes(other.project));assert(!JSON.stringify(page).includes(other.role));
});

test('latest identity overrides cached sessions without merging agents with the same role',()=>{
  const identities=new AgentIdentityDirectory(),cached={id:'one',project:'/first',role:'QA',appearance:{color:'rose',icon:'cat'}};
  identities.update([cached,{id:'two',project:'/second',role:'QA',appearance:{color:'gold',icon:'dog'}}]);
  identities.update([{...cached,appearance:{color:'mint',icon:'shield-check'},appearanceRevision:2}]);
  assert.deepEqual(identities.resolve(cached).appearance,{color:'mint',icon:'shield-check'});
  assert.deepEqual(identities.resolve('two').appearance,{color:'gold',icon:'dog'});
  assert.equal(identities.update([cached]),false,'late responses cannot roll back a saved appearance');
  assert.deepEqual(identities.resolve(cached).appearance,{color:'mint',icon:'shield-check'});
  assert.equal(identities.resolve({id:'human'}).appearance,undefined);
});

test('cached messages, replies, and terminal rows resolve current sender appearance by ID',()=>{
  const sender='appearance-sender',other='appearance-recipient',at='2026-10-01T00:00:00Z';
  const thread={kind:'group',status:'closed',participants:[{id:sender,name:'QA'},{id:other,name:'QA'}],messages:[
    {id:'old',from:sender,fromRole:'QA',text:'Original evidence',at,deliveries:[{status:'delivered'}]},
    {id:'reply',replyTo:'old',from:sender,fromRole:'QA',text:'Prior reply',at,deliveries:[{status:'delivered'}]}
  ]},original=structuredClone(thread),view={replyIndex:replyThreads(thread.messages),markdown:text=>text};
  agentIdentities.update([{id:sender,appearance:{color:'rose',icon:'cat'},appearanceRevision:1}]);
  const render=()=>ChatThreads.prototype.messageBubble.call(view,thread.messages[0],thread);
  assert.match(render(),/agent-icons.svg#cat/);
  agentIdentities.update([{id:sender,appearance:{color:'teal',icon:'rocket'},appearanceRevision:2}]);
  const html=render();assert.match(html,/agent-icons.svg#rocket/);assert.match(html,/--agent-color:light-dark\([^;]+#66c8ca\)/);assert(!html.includes('agent-icons.svg#cat'));assert.deepEqual(thread,original);
  const rows=transcriptRows([{id:'incoming',type:'message',text:'Older DM',communication:{from:sender,fromRole:'QA',toRole:'Builder',kind:'dm'}},{id:'reply',type:'message',role:'assistant',text:'Older response'}],80,new Set(),{task:{id:sender}});
  assert.equal(rows.find(r=>r.kind==='message-header').spans.find(s=>s.bold).color,agentColor(sender));
  assert.equal(rows.find(r=>r.responseHeader).spans[0].color,agentColor(sender));
  assert(!agentAvatar('human').includes('data-agent-identity'));
  assert(!agentLabel(sender,'<script>alert(1)</script>').includes('<script>'));
});

test('appearance survives restart and applies to all saved provider sessions without changing history',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-identity-')),plane=await new ControlPlane(root).init({history:true});
  let reopened;
  try{
    const task={id:'durable-agent',project:root,role:'QA',title:'Verify',prompt:'Verify',kind:'codex',phase:'launched',providerSessionId:'first-session'};
    plane.data.tasks.push(task);plane.herdr={list:async()=>[]};
    for(const sessionId of ['first-session','second-session']){task.providerSessionId=sessionId;await plane.history.captureTranscript(task,{sessionId,source:'fixture',events:[{id:'old-message',type:'message',role:'assistant',text:'Preserve this original message'}]});}
    await plane.projects.appearance(task.id,{icon:'gem',color:'orchid'});
    const before=await plane.history.rows(root,'transcript');
    await plane.projects.appearance(task.id,{icon:'rocket',color:'teal'});
    await plane.projects.sessionState(root,task.id,'archived');
    assert.deepEqual(await plane.history.rows(root,'transcript'),before);
    const identities=new AgentIdentityDirectory();identities.update(plane.projects.identities());
    const sessions=(await plane.history.summary(root)).sessions;assert.equal(sessions.length,2);
    for(const session of sessions)assert.deepEqual(identities.resolve(session.task_id).appearance,{icon:'rocket',color:'teal'});
    assert(plane.projects.identities().some(a=>a.id===task.id),'archived agents remain in the appearance directory');
    await plane.saveQueue;plane.transcripts.close();await plane.history.close();
    reopened=await new ControlPlane(root).init({history:true});
    const saved=reopened.projects.identities().find(a=>a.id===task.id);assert.deepEqual(saved.appearance,{icon:'rocket',color:'teal'});assert.equal(saved.appearanceRevision,2);
    assert.deepEqual(await reopened.history.rows(root,'transcript'),before);
  }finally{plane.transcripts.close();await plane.history.close();if(reopened){reopened.transcripts.close();await reopened.history.close();}await rm(root,{recursive:true,force:true});}
});
