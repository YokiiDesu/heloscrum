import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Collaboration} from '../lib/collaboration.mjs';
import {HistoryStore} from '../lib/history-store.mjs';
import {evaluateProposal,tally,STRUCTURE_TOOLS,structureHint} from '../lib/conversation-structures.mjs';
import {messageEnvelope,messageEvents} from '../lib/chat-messages.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-structures-'));
  const db=await new HistoryStore(path.join(root,'archive.duckdb')).init();
  t.after(async()=>{await db.close();await rm(root,{recursive:true,force:true});});
  const tasks=['Architect','Builder','QA','Outsider'].map((role,i)=>({id:`agent-${i}`,role,title:role,summary:role,project:root,phase:'launched',pane:String(i),kind:'codex',providerSessionId:`00000000-0000-4000-a000-00000000000${i}`}));
  const calls=[],plane={root,data:{project:root,tasks,events:[]},save(){return db.saveState(this.data);},herdr:{list:async()=>tasks.map(t=>({pane_id:t.pane,interactive_ready:true,agent_status:'idle'})),prompt:async(...args)=>calls.push(args)}};
  const registry=new Collaboration(plane),human={id:'human',human:true,role:'You',project:root};
  const group=await registry.call(tasks[0],'create_group',{name:'Storage design',participants:[tasks[1].id,tasks[2].id]});
  return {root,db,plane,registry,human,tasks,group,calls};
}
const deliveriesOf=(r,id)=>r.data.messages.filter(m=>m.groupMessageId===id);
const option=(labels,votes,rule='majority',voters=['a','b','c'])=>({options:labels.map((label,i)=>({id:'ABCDE'[i],label})),rule,voters,votes:votes.map(([voter,stance,opt])=>({voter,voterRole:voter,stance,option:opt??null}))});

test('the catalog exposes structured conversation tools as core group tools',async t=>{
  const {registry:r,tasks}=await fixture(t);
  const names=r.catalog(tasks[0]).tools.map(tool=>tool.name);
  for(const tool of STRUCTURE_TOOLS){assert(names.includes(tool.name),tool.name);assert.equal(tool.inputSchema.additionalProperties,false);}
  const compact=r.catalog(tasks[0],{compact:true}).tools.map(tool=>tool.name);
  assert(compact.includes('cast_vote')&&compact.includes('take_position'),'local-model agents get the response tools directly');
  assert.equal(r.scope(tasks[0]).tools.find(tool=>tool.name==='start_proposal').locked,true);
});

test('majority, unanimous and proposer-decides rules resolve deterministically',()=>{
  assert.equal(evaluateProposal(option(['Yes'],[['a','support','A']])),null,'one vote of three is not yet a majority');
  assert.deepEqual(evaluateProposal(option(['Yes'],[['a','support','A'],['b','support','A']])).status,'accepted');
  assert.equal(evaluateProposal(option(['X','Y'],[['a','support','A'],['b','support','B'],['c','abstain']])).status,'rejected');
  assert.equal(evaluateProposal(option(['X','Y'],[['a','support','A']]),{final:true}).status,'expired');
  assert.equal(evaluateProposal(option(['X'],[['a','support','A'],['b','abstain']],'unanimous')),null,'unanimous waits for every voter');
  assert.equal(evaluateProposal(option(['X'],[['a','support','A'],['b','abstain'],['c','support','A']],'unanimous')).status,'accepted');
  assert.match(evaluateProposal(option(['X'],[['a','support','A'],['b','object'],['c','support','A']],'unanimous')).reason,/1 voter objects/);
  assert.match(evaluateProposal(option(['X','Y'],[['a','support','A'],['b','support','B'],['c','support','A']],'unanimous')).reason,/different options/);
  const decided=option(['X','Y'],[['a','support','A'],['b','support','B']],'proposer-decides',['a','b']);
  assert.equal(evaluateProposal(decided),null);
  decided.votes.push({voter:'p',voterRole:'Lead',stance:'support',option:'B',deciding:true});
  assert.deepEqual([evaluateProposal(decided).status,evaluateProposal(decided).option],['accepted','B']);
  const changed=option(['X','Y'],[['a','support','A'],['a','support','B']]);
  assert.deepEqual(tally(changed).support,{A:0,B:1},'only the latest vote per voter counts');
});

test('a group proposal wakes voters once, collects quiet votes, and becomes a decision record',async t=>{
  const {root,db,plane,registry:r,tasks,group,calls}=await fixture(t);
  const revision=r.data.revision;
  const input={threadId:group.id,title:'Use SQLite for local cache',summary:'We need a durable local cache.',options:['SQLite','Flat JSON files'],requestId:'proposal-1'};
  const opened=await r.call(tasks[0],'start_proposal',input);
  assert.equal(opened.structure.status,'open');assert.deepEqual(opened.structure.voters,[tasks[0].id,tasks[1].id,tasks[2].id].sort());
  assert.equal((await r.call(tasks[0],'start_proposal',input)).structure.id,opened.structure.id,'retries return the original proposal');
  await assert.rejects(r.call(tasks[0],'start_proposal',{...input,title:'Different'}),e=>e.status===409);
  await assert.rejects(r.call(tasks[3],'start_proposal',{...input,requestId:'x'}),e=>e.status===403);
  const id=opened.structure.id;
  assert.deepEqual(deliveriesOf(r,opened.message.id).map(m=>m.delivery),['queued','queued']);
  await r.deliver();assert.equal(calls.length,2);
  assert(calls.every(([,prompt])=>prompt.includes('Proposal: Use SQLite for local cache')&&prompt.includes(`cast_vote {"structureId":"${id}"`)&&prompt.includes('invoke_tool')));

  await assert.rejects(r.call(tasks[1],'cast_vote',{structureId:id,stance:'support',rationale:'Needs an option'}),/Choose one of/);
  await assert.rejects(r.call(tasks[3],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Not a member'}),e=>e.status===403);
  const first=await r.call(tasks[1],'cast_vote',{structureId:id,option:'B',stance:'support',rationale:'JSON is simpler to inspect.'});
  assert.equal(first.structure.status,'open');assert.deepEqual(deliveriesOf(r,first.message.id).map(m=>m.delivery),['inbox','inbox'],'votes never wake anyone');
  const persuasion=await r.call(tasks[0],'send_group_message',{threadId:group.id,message:'JSON loses writes on crash; SQLite has WAL.',kind:'result',requiresReply:false});
  await assert.rejects(r.call(tasks[1],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Crash safety wins.'}),/reason for changing/);
  await assert.rejects(r.call(tasks[1],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Crash safety wins.',reason:'Persuaded',influencedBy:'missing'}),e=>e.status===404);
  const changed=await r.call(tasks[1],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Crash safety wins.',reason:'Architect showed JSON loses writes on crash.',influencedBy:persuasion.id});
  assert.equal(changed.structure.status,'open');
  const vote=changed.structure.votes.at(-1);assert.deepEqual(vote.previous,{option:'B',stance:'support',rationale:'JSON is simpler to inspect.'});assert.equal(vote.influencedBy,persuasion.id);
  assert.equal((await r.call(tasks[1],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Crash safety wins.'})).structure.votes.length,2,'repeating the same vote is a no-op');
  const deciding=await r.call(tasks[2],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Tests already cover SQLite.'});
  assert.equal(deciding.structure.status,'accepted');assert.equal(deciding.structure.outcome.option,'A');
  const decision=deciding.decision;assert.equal(decision.status,'accepted');assert.equal(decision.decision,'A. SQLite');
  assert.deepEqual(decision.alternatives,['B. Flat JSON files']);assert.match(decision.rationale,/Builder changed their vote: Architect showed/);
  assert.equal(deciding.structure.decisionId,decision.id);
  await assert.rejects(r.call(tasks[0],'cast_vote',{structureId:id,option:'A',stance:'support',rationale:'Late'}),e=>e.status===409);

  const outcome=deliveriesOf(r,decision.messageId);assert.equal(outcome.length,3,'the outcome reaches every member');
  assert(outcome.every(m=>m.from==='heloscrum'&&m.fromRole==='HeloScrum'&&m.delivery==='queued'&&m.requiresReply===false));
  calls.length=0;await r.deliver();assert.equal(calls.length,3);assert(calls.every(([,prompt])=>prompt.includes('Proposal accepted: Use SQLite for local cache')));
  const note=r.data.memory.find(m=>m.key===decision.memoryKey);assert.match(decision.memoryKey,/^decisions\/use-sqlite-for-local-cache-/);
  assert.match(note.text,/## Decision\nA\. SQLite/);assert.equal(note.source,'decision');
  assert.equal(r.data.revision,revision,'structured messages and decisions do not trigger tool rediscovery');
  assert.equal(r.snapshot(root).notifications.filter(n=>n.type==='decision').length,1);

  const page=r.groups.read(tasks[1],{threadId:group.id});
  assert.deepEqual(page.structures.map(s=>[s.type,s.status]),[['proposal','accepted'],['decision','accepted']]);
  assert(page.messages.some(m=>m.structure?.event==='resolved'&&m.structure.decisionId===decision.id));
  assert.deepEqual(r.threadList(root).find(x=>x.id===group.id).structureCounts,{open:0,decisions:1});
  const restored=new Collaboration({...plane,data:await db.loadState()});assert.equal(restored.structures.read(tasks[0],id).status,'accepted');
  const versions=await db.rows(root,'conversation-structure');assert(versions.some(v=>v.body.id===decision.id));
});

test('envelopes carry the response hint and still match recorded deliveries',async t=>{
  const {registry:r,tasks,group}=await fixture(t);
  const opened=await r.call(tasks[0],'start_debate',{threadId:group.id,question:'Monorepo or polyrepo?',claim:'Monorepo',arguments:'Atomic changes.'});
  const delivery=deliveriesOf(r,opened.message.id).find(m=>m.to===tasks[1].id),envelope=messageEnvelope(delivery);
  assert.match(envelope,/take_position \{"structureId"/);assert.equal(structureHint({type:'decision',event:'recorded'}),'');
  const events=messageEvents([{id:'e1',type:'message',role:'user',text:envelope}],tasks[1],r.data.messages);
  assert.equal(events.length,1);assert.equal(events[0].communication.id,delivery.id);assert.equal(events[0].text,delivery.text);
});

test('debates record positions, rebuttals and changes of mind, then close into a decision with dissent',async t=>{
  const {registry:r,tasks,group,human}=await fixture(t);
  const opened=await r.call(tasks[0],'start_debate',{threadId:group.id,question:'How should agents share state?',context:'Three providers, one repo.',claim:'Shared memory notes',arguments:'Already revisioned.',requestId:'debate-1'});
  const id=opened.structure.id;assert.equal(opened.structure.positions[0].id,'P1');
  assert.equal((await r.call(tasks[0],'start_debate',{threadId:group.id,question:'How should agents share state?',context:'Three providers, one repo.',claim:'Shared memory notes',arguments:'Already revisioned.',requestId:'debate-1'})).structure.id,id);
  assert.deepEqual(deliveriesOf(r,opened.message.id).map(m=>m.delivery),['queued','queued']);
  const p2=await r.call(tasks[1],'take_position',{structureId:id,action:'state',claim:'A task board field',arguments:'Visible to the owner.',rebuts:['P1']});
  assert.equal(p2.structure.positions[1].id,'P2');assert.deepEqual(p2.structure.positions[1].rebuts,['P1']);
  assert.deepEqual(deliveriesOf(r,p2.message.id).map(m=>m.delivery),['queued','queued'],'new positions wake the others');
  await assert.rejects(r.call(tasks[1],'take_position',{structureId:id,action:'state',claim:'Shared memory notes'}),/already a position/);
  await assert.rejects(r.call(tasks[1],'take_position',{structureId:id,action:'state',claim:'Own',rebuts:['P2']}),/other members/);
  await assert.rejects(r.call(tasks[2],'take_position',{structureId:id,action:'adopt',positionId:'P9',reason:'x'}),e=>e.status===404);
  const qa=await r.call(tasks[2],'take_position',{structureId:id,action:'adopt',positionId:'P2',reason:'Owner visibility matters most.'});
  assert.deepEqual(deliveriesOf(r,qa.message.id).map(m=>m.delivery),['inbox','inbox'],'adopting is quiet');
  await assert.rejects(r.call(tasks[2],'take_position',{structureId:id,action:'adopt',positionId:'P2',reason:'again'}),e=>e.status===409);
  const moved=await r.call(tasks[2],'take_position',{structureId:id,action:'adopt',positionId:'P1',reason:'Memory notes already reach every provider.',influencedBy:opened.message.id});
  const stance=moved.structure.stances.at(-1);assert.deepEqual([stance.from,stance.position,stance.influencedBy],['P2','P1',opened.message.id]);
  assert.deepEqual(moved.structure.positions.map(p=>[p.id,p.holders.map(h=>h.role)]),[['P1',['Architect','QA']],['P2',['Builder']]]);

  await assert.rejects(r.call(tasks[1],'record_decision',{threadId:group.id,title:'Share state',decision:'Notes',rationale:'Consensus',debateId:id}),e=>e.status===403);
  const closed=await r.call(tasks[0],'record_decision',{threadId:group.id,title:'Share state through memory notes',decision:'Use shared memory notes for cross-agent state.',rationale:'Two of three members converged on P1.',debateId:id,positionId:'P1'});
  const decision=closed.structure;
  assert.deepEqual(decision.dissent.map(d=>[d.memberRole,d.reason]),[['Builder','Held P2: A task board field']]);
  assert.deepEqual(decision.alternatives,['P2: A task board field']);assert.match(decision.context,/How should agents share state\?/);
  assert.deepEqual(decision.source,{type:'debate',id,positionId:'P1'});
  assert.equal(r.structures.read(tasks[0],id).status,'closed');assert.equal(r.structures.read(tasks[0],id).decisionId,decision.id);
  await assert.rejects(r.call(tasks[1],'take_position',{structureId:id,action:'state',claim:'Late'}),e=>e.status===409);

  const replaced=await r.call(tasks[1],'record_decision',{threadId:group.id,title:'Share state on the task board',decision:'Mirror state to the board.',rationale:'Owner asked for visibility.',supersedes:decision.id,alternatives:['Memory notes only']});
  const old=r.structures.read(tasks[0],decision.id);assert.equal(old.status,'superseded');assert.equal(old.supersededBy,replaced.structure.id);
  assert.match(r.data.memory.find(m=>m.key===old.memoryKey).text,/Status: superseded/);assert.equal(r.data.memory.find(m=>m.key===old.memoryKey).revision,2);
  await assert.rejects(r.call(tasks[1],'record_decision',{threadId:group.id,title:'Again',decision:'x',rationale:'y',supersedes:decision.id}),e=>e.status===409);
  const outsider=await r.call(tasks[3],'create_group',{name:'Private',participants:[tasks[1].id,tasks[2].id]});
  await assert.rejects(r.call(tasks[3],'record_decision',{threadId:outsider.id,title:'Hijack',decision:'x',rationale:'y',supersedes:replaced.structure.id}),e=>e.status===403,'members of other groups cannot supersede a decision they cannot read');
  const withdrawn=await r.structures.act(human,{action:'supersede',structureId:replaced.structure.id,reason:'We will revisit after the release.'});
  assert.equal(withdrawn.structure.status,'superseded');
  await assert.rejects(r.structures.act(tasks[0],{action:'supersede',structureId:decision.id,reason:'x'}),e=>e.status===403);
});

test('proposer-decides waits for every vote, then lets only the proposer decide',async t=>{
  const {registry:r,tasks,group,calls}=await fixture(t);
  const {structure}=await r.call(tasks[0],'start_proposal',{threadId:group.id,title:'Release name',summary:'Pick one.',options:['Aurora','Breeze'],rule:'proposer-decides'});
  assert.deepEqual(structure.voters,[tasks[1].id,tasks[2].id]);
  await assert.rejects(r.call(tasks[0],'cast_vote',{structureId:structure.id,option:'A',stance:'support',rationale:'Early'}),e=>e.status===409);
  await r.call(tasks[1],'cast_vote',{structureId:structure.id,option:'A',stance:'support',rationale:'Bright'});
  await r.deliver();calls.length=0;
  await r.call(tasks[2],'cast_vote',{structureId:structure.id,option:'B',stance:'support',rationale:'Calm'});
  const ask=r.data.messages.filter(m=>m.structure?.event==='awaiting-decision');
  assert.deepEqual(ask.map(m=>[m.to,m.delivery]),[[tasks[0].id,'queued']],'only the proposer is woken to decide');
  await r.deliver();assert.equal(calls.length,1);assert.match(calls[0][1],/decide with cast_vote/);
  await assert.rejects(r.call(tasks[0],'cast_vote',{structureId:structure.id,stance:'abstain',rationale:'Undecided'}),/supporting an option or objecting/);
  const decided=await r.call(tasks[0],'cast_vote',{structureId:structure.id,option:'B',stance:'support',rationale:'Calm fits the brand.'});
  assert.equal(decided.structure.status,'accepted');assert.equal(decided.decision.decision,'B. Breeze');
  assert.deepEqual(decided.decision.dissent.map(d=>d.memberRole),['Builder']);
});

test('the owner can overrule a proposal; closing a chat withdraws open structures',async t=>{
  const {registry:r,tasks,group,human}=await fixture(t);
  const {structure}=await r.call(tasks[0],'start_proposal',{threadId:group.id,title:'Ship Friday',summary:'Ready?',options:['Ship'],rule:'unanimous'});
  await r.call(tasks[1],'cast_vote',{structureId:structure.id,stance:'object',rationale:'Docs are missing.'});
  await assert.rejects(r.structures.act(human,{action:'resolve',structureId:structure.id,outcome:'accepted'}),/Invalid reason/);
  await assert.rejects(r.structures.act(human,{action:'resolve',structureId:structure.id,outcome:'maybe',reason:'x'}),/accepted, rejected, or withdrawn/);
  await assert.rejects(r.structures.act(tasks[1],{action:'resolve',structureId:structure.id,outcome:'rejected',reason:'x'}),e=>e.status===403);
  const overruled=await r.structures.act(human,{action:'resolve',structureId:structure.id,outcome:'accepted',reason:'Docs can follow.'});
  assert.equal(overruled.structure.status,'accepted');assert.equal(overruled.structure.outcome.by,'human');assert.equal(overruled.decision.decision,'Ship');
  assert.deepEqual(overruled.decision.dissent.map(d=>d.memberRole),['Builder']);
  const debate=await r.call(tasks[1],'start_debate',{threadId:group.id,question:'Tabs or spaces?',claim:'Spaces'});
  const owned=await r.structures.create(human,{type:'decision',threadId:group.id,debateId:debate.structure.id,positionId:'P1',title:'Use spaces',decision:'Spaces',rationale:'Formatter default.'});
  assert.equal(owned.structure.recordedByRole,'You');assert.equal(r.structures.read(tasks[0],debate.structure.id).status,'closed');
  const open=await r.call(tasks[2],'start_proposal',{threadId:group.id,title:'Rename',summary:'?',options:['Yes'],deadline:new Date(Date.now()+3600000).toISOString()});
  const talk=await r.call(tasks[2],'start_debate',{threadId:group.id,question:'Later?'});
  await r.call(tasks[0],'set_chat_status',{threadId:group.id,status:'closed',reason:'Done'});
  assert.equal(r.structures.read(tasks[0],open.structure.id).status,'withdrawn');assert.equal(r.structures.read(tasks[0],talk.structure.id).status,'closed');
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'New',summary:'?',options:['Yes']}),e=>e.status===409);
});

test('deadlines expire open proposals on the delivery pass and validation enforces limits',async t=>{
  const {registry:r,tasks,group,calls}=await fixture(t);
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'x',summary:'y',options:['A'],deadline:'2020-01-01T00:00:00Z'}),/future/);
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'x',summary:'y',options:['A'],deadline:new Date(Date.now()+40*86400000).toISOString()}),/30 days/);
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'x',summary:'y',options:['A'],deadline:'tomorrow'}),/ISO/);
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'x',summary:'y',options:['Same','same']}),/distinct/);
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'x',summary:'y',options:['1','2','3','4','5','6']}),/one to five/);
  const {structure}=await r.call(tasks[0],'start_proposal',{threadId:group.id,title:'Expire me',summary:'Soon',options:['Yes'],deadline:new Date(Date.now()+60000).toISOString()});
  await r.call(tasks[1],'cast_vote',{structureId:structure.id,option:'A',stance:'support',rationale:'Fine'});
  assert.equal(r.structures.expire(Date.now()),false,'nothing expires before the deadline');
  r.structures.all.find(s=>s.id===structure.id).deadline=new Date(Date.now()-1000).toISOString();
  await r.deliver();
  const expired=r.structures.read(tasks[0],structure.id);assert.equal(expired.status,'expired');assert.match(expired.outcome.reason,/1 of 3 votes/);
  assert.equal(expired.decisionId,null);assert(calls.some(([,prompt])=>prompt.includes('Proposal expired: Expire me')));
  for(let i=0;i<9;i++)await r.call(tasks[0],'start_debate',{threadId:group.id,question:'Debate '+i});
  await r.call(tasks[0],'start_proposal',{threadId:group.id,title:'Tenth',summary:'x',options:['Yes']});
  await assert.rejects(r.call(tasks[0],'start_debate',{threadId:group.id,question:'Eleventh'}),e=>e.status===429);
});

test('a failed step leaves no partial structure or message behind',async t=>{
  const {registry:r,tasks,group}=await fixture(t);
  const before=r.data.messages.length;
  for(let i=0;i<100;i++)r.data.messages.push({id:'flood-'+i,project:tasks[1].project,from:'x',to:tasks[1].id,text:'x',delivery:'queued',at:new Date().toISOString()});
  await assert.rejects(r.call(tasks[0],'start_proposal',{threadId:group.id,title:'Blocked',summary:'Full inbox',options:['Yes']}),e=>e.status===429);
  assert.equal(r.structures.all.length,0);assert.equal(r.data.messages.length,before+100);
});
