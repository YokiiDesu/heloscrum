import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Collaboration} from '../lib/collaboration.mjs';
import {ChatThreads,conversationMessages,replyThreads} from '../dist/chat-threads.js';
import {filterChats} from '../dist/chat-directory.js';
import {decisionCard,debateCard,proposalCard,structurePayload,structureRole,structureSummary} from '../dist/conversation-structures.js';

async function conversation(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-structure-ui-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const tasks=['Architect','Builder','QA'].map((role,i)=>({id:`ui-agent-${i}`,role,title:role,project:root,phase:'launched',pane:String(i),kind:'codex'}));
  const r=new Collaboration({root,data:{project:root,tasks,events:[]},save:async()=>{},herdr:{list:async()=>[],prompt:async()=>{}}});
  const group=await r.call(tasks[0],'create_group',{name:'Cache design',participants:[tasks[1].id,tasks[2].id]});
  return {root,r,tasks,group};
}
const markdown=text=>`<p>${String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p>`;
function view(page){
  const v=Object.assign(Object.create(ChatThreads.prototype),{markdown,structureDrafts:new Map(),structureOpen:new Set(),structureBusy:null,messageScope:1});
  v.replyIndex=replyThreads(conversationMessages(page));return v;
}

test('a group chat that votes produces a decision record the chat view renders',async t=>{
  const {root,r,tasks,group}=await conversation(t);
  const {structure}=await r.call(tasks[0],'start_proposal',{threadId:group.id,title:'Cache <format>',summary:'Pick a cache format.',options:['SQLite','JSON']});
  await r.call(tasks[1],'cast_vote',{structureId:structure.id,option:'B',stance:'support',rationale:'Readable.'});
  await r.call(tasks[1],'cast_vote',{structureId:structure.id,option:'A',stance:'support',rationale:'Crash safe.',reason:'Architect showed data loss.',influencedBy:structure.messageId});
  const {decision}=await r.call(tasks[2],'cast_vote',{structureId:structure.id,option:'A',stance:'support',rationale:'Tested.'});
  const page=r.threadPage(root,group.id),v=view(page);
  const opened=page.messages.find(m=>m.structure?.event==='opened'),outcome=page.messages.find(m=>m.structure?.event==='resolved'),vote=page.messages.find(m=>m.structure?.event==='vote');
  assert.equal(structureRole(opened),'card');assert.equal(structureRole(vote),'tag');
  const card=v.messageBubble(opened,page);
  assert.match(card,/class="structure-card structure-proposal"/);assert.match(card,/Cache &lt;format&gt;/,'titles are escaped');
  assert.match(card,/2\/3/);assert.match(card,/class="proposal-option winner"/);assert.match(card,/Accepted/);
  assert.match(card,/moved from B to A: Architect showed data loss\./);assert.match(card,/Persuaded by Architect/);
  assert(!card.includes('structure-form'),'closed proposals offer no actions');
  assert.match(v.messageBubble(vote,page),/class="structure-tag structure-tag-proposal"><span>Vote<\/span>/);
  assert.match(v.messageBubble(outcome,page),/Proposal accepted/);
  const summary=structureSummary(page,{expanded:true,markdown});
  assert.match(summary,/0 open · 1 decision/);assert.match(summary,/Decision record/);assert.match(summary,new RegExp(decision.memoryKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(structureSummary(page,{markdown}),/Show decisions/);
  const listed=r.threadDirectory().threads;
  assert.deepEqual(filterChats(listed,{kind:'decisions'}).map(x=>x.id),[group.id]);
  const {messages:_messages,...loaded}=page;assert.deepEqual(filterChats([loaded],{kind:'decisions'}).map(x=>x.id),[group.id],'a loaded conversation keeps its counts beside its full structure list');
});

test('open proposals offer the owner an outcome form and preserve drafts across live refreshes',()=>{
  const proposal={id:'p1',type:'proposal',status:'open',title:'Ship',summary:'Ready?',options:[{id:'A',label:'Ship now'},{id:'B',label:'Wait'}],rule:'majority',voters:['a','b'],voterRoles:{a:'Builder',b:'QA'},createdBy:'a',createdByRole:'Builder',votes:[],currentVotes:[],tally:{support:{A:0,B:0},object:0,abstain:0,voted:0,eligible:2,waiting:['a','b']},outcome:null,deadline:null};
  const drafts=new Map([['p1:resolve:reason','Docs <done>']]),html=proposalCard(proposal,{markdown,drafts,open:new Set(['p1:resolve'])});
  assert.match(html,/data-structure-form="resolve"/);assert(!html.includes('data-structure-form="vote"'),'the owner decides; agents vote through their tools');
  assert.match(html,/<details class="structure-action" open data-detail-key="p1:resolve">/);assert.match(html,/Docs &lt;done&gt;/);
  assert.match(html,/Waiting on Builder, QA/);
  assert(!proposalCard(proposal,{markdown,viewer:'other'}).includes('structure-form'));
  const form=entries=>({get:name=>entries[name],has:name=>name in entries});
  assert.deepEqual(structurePayload('resolve','p1',form({outcome:'accepted:A',reason:' Go '})),{action:'resolve',structureId:'p1',outcome:'accepted',option:'A',reason:'Go'});
  assert.deepEqual(structurePayload('resolve','p1',form({outcome:'rejected',reason:'No'})),{action:'resolve',structureId:'p1',outcome:'rejected',reason:'No'});
  assert.deepEqual(structurePayload('supersede','x',form({reason:'Old'})),{action:'supersede',structureId:'x',reason:'Old'});
  assert.deepEqual(structurePayload('decide','d1',form({title:'T',decision:'D',rationale:'R',positionId:''})),{type:'decision',debateId:'d1',title:'T',decision:'D',rationale:'R'});
  assert.throws(()=>structurePayload('vote','x',form({})),/Unknown/);
});

test('debate and decision cards show positions, changes of mind, dissent and lineage',()=>{
  const debate={id:'d1',type:'debate',status:'open',question:'Monorepo?',context:'',moderatorRole:'Architect',positions:[{id:'P1',author:'a',authorRole:'Architect',claim:'Yes',arguments:'Atomic',rebuts:[],holders:[{id:'a',role:'Architect'},{id:'q',role:'QA'}]},{id:'P2',author:'b',authorRole:'Builder',claim:'No',arguments:'',rebuts:['P1'],holders:[{id:'b',role:'Builder'}]}],stances:[{member:'q',memberRole:'QA',position:'P2',from:null},{member:'q',memberRole:'QA',position:'P1',from:'P2',reason:'Atomic commits',influencedBy:'m1'}]};
  const html=debateCard(debate,{markdown,lookup:id=>id==='m1'?{fromRole:'Architect'}:null});
  assert.match(html,/Rebuts P1/);assert.match(html,/QA<\/span><\/span> moved from P2 to P1: Atomic commits/);assert.match(html,/Persuaded by Architect/);assert.match(html,/data-structure-form="decide"/);
  const decision={id:'x',type:'decision',status:'superseded',title:'Use monorepo',context:'',decision:'Yes',rationale:'Atomic',alternatives:['P2: No'],consequences:'',dissent:[{member:'b',memberRole:'Builder',reason:'Held P2: No'}],participantRoles:['Architect','Builder','QA'],recordedByRole:'Architect',at:'2026-10-17T00:00:00Z',memoryKey:'decisions/use-monorepo-x',supersededBy:'y',supersedes:null};
  const card=decisionCard(decision,{markdown});
  assert.match(card,/is-superseded/);assert.match(card,/Held P2: No/);assert.match(card,/data-focus-structure="y"/);assert(!card.includes('data-structure-form'),'superseded decisions have no actions');
});
