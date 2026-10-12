import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {RolePacks,validatePackConfig,rolePackState} from '../lib/role-packs.mjs';
import {ROLE_PACKS} from '../dist/role-pack-catalog.js';
import {ROLE_PACK_POLICY,rolePackAnswers,selectRolePacks} from '../lib/role-pack-selection.mjs';
import {reviewEligibility} from '../lib/role-pack-panels.mjs';
import {ContextManager} from '../lib/context-manager.mjs';
import {WorkManagement} from '../lib/work-management.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
const result=(scores={})=>({model:'jev-fixture',answers:Object.fromEntries(ROLE_PACKS.map(p=>[p.id,{type:'noul',noul:scores[p.id]??.05}])),usage:{input_tokens:100,output_tokens:50}});
async function setup(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'hs-role-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const task={id:randomUUID(),kind:'claude',project:root,path:root,phase:'launched',providerSessionId:randomUUID(),title:'Builder',prompt:'Design the interface and test keyboard navigation.',claudeRolePacks:{mode:'auto',pinned:[],revision:1}},calls=[];
  const plane={root,data:{tasks:[task],workPlans:[],workResources:[],agentNotebooks:{},contextSettings:{decisionConnectionId:'jev'}},save:async()=>{},ai:{get:()=>({id:'jev',kind:'jev',model:'jev-fixture',revision:1}),decide:async(_id,state,questions)=>{calls.push({state,questions});return result({'ui-ux':.96});}}};
  plane.context=new ContextManager(plane);plane.collaboration=new Collaboration(plane);plane.work=new WorkManagement(plane);
  const packs=new RolePacks(plane,{compatible:async()=>true});plane.rolePacks=packs;
  return {root,task,plane,packs,calls};
}
function plan(task,overrides={}){return {id:randomUUID(),project:task.project,title:'Project',status:'active',revision:1,participantIds:[task.id],items:[],resourceIds:[],proposals:[],management:{qaLeadId:'qa'},updatedAt:new Date().toISOString(),...overrides};}
test('eight installed packs validate human configuration; unavailable providers, hooks, Off, Manual and a fully pinned catalog never infer',async t=>{
  const {task,packs,calls}=await setup(t);assert.equal(ROLE_PACKS.length,8);assert.equal(ROLE_PACKS.at(-1).name,'Knowledge Manager');
  for(const kind of ['codex','cursor','kiro','openai']){task.kind=kind;await packs.resolve(task);assert.equal((await packs.view(task)).panels.length,0);}
  task.kind='claude';packs.compatible=async()=>false;await packs.resolve(task);assert.equal(calls.length,0);packs.compatible=async()=>true;
  for(const config of [{mode:'off',pinned:[]},{mode:'manual',pinned:['qa-reviewer']},{mode:'auto',pinned:ROLE_PACKS.map(p=>p.id)}]){
    await packs.configure(task,{...config,expectedRevision:task.claudeRolePacks.revision});assert.equal(calls.length,0);
  }
  assert.throws(()=>validatePackConfig({mode:'manual',pinned:[]}),/at least one/);
  assert.throws(()=>validatePackConfig({mode:'auto',pinned:['root-admin']}),/installed/);
  assert.throws(()=>validatePackConfig({mode:'auto',pinned:['ui-ux','ui-ux']}),/different/);
  assert.deepEqual(validatePackConfig({mode:'manual',pinned:ROLE_PACKS.map(p=>p.id)}).pinned,ROLE_PACKS.map(p=>p.id));
  await assert.rejects(packs.configure(task,{mode:'off',pinned:[],expectedRevision:0}),/changed/);
});
test('selection preserves exact judgments, request, usage and policy, caches unchanged duties, and does not infer on view refresh',async t=>{
  const {task,packs,calls,plane,root}=await setup(t);const p=plan(task);plane.data.workPlans.push(p);
  const selection=await packs.resolve(task);assert.deepEqual(selection.selected,['ui-ux']);assert.equal(selection.scores['ui-ux'],.96);
  await packs.resolve(task);await packs.view(task);p.revision++;await packs.resolve(task);assert.equal(calls.length,1);
  const dir=root+'/.heloscrum/agents/'+task.id+'/context-usage',files=await readdir(dir),audit=JSON.parse(await readFile(dir+'/'+files[0]));
  assert.equal(audit.kind,'role-pack-selection');assert.deepEqual(audit.answers,result({'ui-ux':.96}).answers);assert.equal(audit.usage.input_tokens,100);assert.equal(audit.evaluation.policy.threshold,ROLE_PACK_POLICY.threshold);assert.deepEqual(audit.evaluation.selected,['ui-ux']);assert.equal(Object.keys(audit.evaluation.questions).length,8);
  assert(!JSON.stringify(calls).includes('token-key'));task.prompt='Design database migrations and recovery.';assert.equal((await packs.view(task)).selection.status,'pending');assert.equal((await packs.view(task)).panels.length,0);
});
test('schema failures, missing evidence and service failures abstain without retries or false zero usage',async t=>{
  const {task,packs,plane,calls}=await setup(t);task.prompt='';assert.equal((await packs.resolve(task)).reason,'missing-evidence');assert.equal(calls.length,0);
  task.prompt='Build the UI';plane.ai.decide=async()=>({answers:{},usage:{input_tokens:99}});assert.equal((await packs.resolve(task)).reason,'invalid-model-answer');await packs.resolve(task);assert.equal(task.rolePackAttempts.length,1);
  task.rolePackAttempts=[];plane.ai.decide=async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});};assert.equal((await packs.resolve(task,{retry:true})).reason,'service-timeout');
  assert.equal((await packs.resolve(task,{retry:true})).reason,'rate-limit');
  const bad=result();bad.answers['ui-ux'].noul=1.4;assert.equal(rolePackAnswers(bad),null);bad.answers['ui-ux']={type:'score',score:.9};assert.equal(rolePackAnswers(bad),null);
  assert.equal(rolePackAnswers({...result(),answers:{...result().answers,extra:{type:'noul',noul:.3}}}),null);
  assert.deepEqual(selectRolePacks({'ui-ux':.99,'game-design':.98,devsecops:.97},['qa-reviewer']),['qa-reviewer','ui-ux','game-design','devsecops']);
});
test('in-flight judgments cannot override a manual change or role change, and identical requests share one call',async t=>{
  const {task,packs,plane}=await setup(t);let finish,started;const ready=new Promise(r=>started=r);let calls=0;
  plane.ai.decide=async()=>{calls++;started();return new Promise(r=>finish=r);};const first=packs.resolve(task);await ready;const second=packs.resolve(task);
  await packs.configure(task,{mode:'manual',pinned:['database-architect'],expectedRevision:1});finish(result({'ui-ux':1}));await Promise.all([first,second]);assert.deepEqual(task.rolePackSelection.selected,['database-architect']);assert.equal(calls,1);
});
test('views respect project, plan and notebook boundaries; QA selection grants no review rights',async t=>{
  const {task,packs,plane}=await setup(t);task.claudeRolePacks={mode:'manual',pinned:['qa-reviewer','orchestration'],revision:1};
  const visible=plan(task,{items:[{id:'mine',title:'Own candidate',status:'needs_review',ownerId:task.id,note:'Author checks only',dependsOn:[]},{id:'peer',title:'Peer candidate',status:'needs_review',ownerId:'peer',note:'NOT RUN: browser',dependsOn:[]}]});
  plane.data.workPlans.push(visible,plan(task,{project:'/other',title:'FOREIGN SECRET'}),plan(task,{participantIds:['other'],title:'PRIVATE SECRET'}));
  await packs.resolve(task);const view=await packs.view(task);assert(!JSON.stringify(view).includes('SECRET'));assert.equal(view.panels[0].metrics.find(m=>m.label==='Eligible for you').value,0);assert.match(reviewEligibility(visible,task,visible.items[0]),/Independent/);
  visible.management.reviewerIds=[task.id];assert.equal(reviewEligibility(visible,task,visible.items[1]),null);visible.items[1].contributors=[task.id];assert.match(reviewEligibility(visible,task,visible.items[1]),/Independent/);
  const state=rolePackState(plane,task);assert.equal(state.assignments.length,1);assert.equal(state.sources.length,1);assert(!JSON.stringify(state).includes('SECRET'));
});
test('role tools are reserved for current native Claude identity, never external contacts or other providers',async t=>{
  const {task,packs,plane}=await setup(t);assert(plane.collaboration.catalog(task,{compact:true}).tools.some(t=>t.name==='role_pack_view'));
  for(const kind of ['codex','kiro','cursor'])assert(!plane.collaboration.catalog({...task,kind},{compact:true}).tools.some(t=>t.name.startsWith('role_pack_')));
  assert(!plane.collaboration.allowed({...task,external:true},'role_pack_sync'));
  await assert.rejects(packs.sync(task,{sessionId:randomUUID()}),/current Claude/);assert.equal(task.rolePackAttempts,undefined);
  task.claudeRolePacks={mode:'off',pinned:[],revision:2};await packs.sync(task,{sessionId:task.providerSessionId});assert.equal((await packs.view(task)).native.current,true);
});

test('re-enabling native Mods can resolve a previously unavailable Auto selection',async t=>{
  const {task,packs,calls}=await setup(t);packs.compatible=async()=>false;await packs.resolve(task);assert.equal(task.rolePackSelection.status,'unavailable');packs.compatible=async()=>true;await packs.resolve(task);assert.deepEqual(task.rolePackSelection.selected,['ui-ux']);assert.equal(calls.length,1);
});

test('Knowledge Manager separates document references, governance reports and actual review evidence',async t=>{
  const {task,packs,plane}=await setup(t);task.claudeRolePacks={mode:'manual',pinned:['knowledge-manager'],revision:1};
  const p=plan(task,{resourceIds:['sop'],items:[{id:'govern',title:'Establish SOP standards',ownerId:task.id,status:'needs_review',acceptance:'Agree template, classification, tags, storage and retention rules.',note:'Draft standards proposed; approval pending.',dependsOn:[]}]});
  plane.data.workPlans.push(p,plan(task,{resourceIds:['sop']}));plane.data.workResources.push({id:'sop',project:task.project,name:'SOP.md',repoPath:'docs/SOP.md',sha256:'a'.repeat(64),createdAt:'2026-10-09T00:00:00.000Z'});
  plane.notebooks={read:async()=>({entries:[{id:'note',category:'decision',text:'Old decision',confidence:'reported',freshness:{state:'stale',reasons:['Plan revision changed']}}],total:1,revision:2})};
  plane.collaboration.data.memory.push({project:task.project,key:'doc-policy-proposal',text:'Not adopted yet',revision:1},{project:'/other',key:'FOREIGN POLICY',text:'PRIVATE SECRET'});
  await packs.resolve(task);const view=await packs.view(task),panel=view.panels[0];
  assert.equal(panel.metrics[0].value,1);assert.equal(panel.metrics[2].value,1);assert.equal(panel.sections.length,6);
  assert.match(panel.guide.join(' '),/classification/);assert.match(panel.guide.join(' '),/required authorization before deleting/);
  assert.equal(panel.sections.find(s=>s.title==='Recorded verification').total,0);
  const reference=panel.sections.find(s=>s.title==='Document references').items[0];assert.match(reference.label,/not inspected/);assert.equal(reference.source.sha256,'a'.repeat(64));assert.match(reference.detail,/retention rule/);
  assert(!JSON.stringify(view).includes('PRIVATE SECRET'));assert(!JSON.stringify(view).includes('Recorded PASS'));
  p.items[0].verification={passed:false,evidence:'Template v2 requires a named owner; inspected SOP revision 3 has none.',name:'Reviewer',at:'2026-10-09T01:00:00.000Z'};
  const reviewed=(await packs.view(task)).panels[0].sections.find(s=>s.title==='Recorded verification');assert.equal(reviewed.items[0].label,'Recorded FAIL');assert.match(reviewed.items[0].text,/Template v2/);
});

test('Manual retains all installed packs and Auto retains every match alongside pins',async t=>{
  const {task,packs,calls,plane}=await setup(t),ids=ROLE_PACKS.map(p=>p.id);
  const manual=await packs.configure(task,{mode:'manual',pinned:ids,expectedRevision:1});
  assert.deepEqual(manual.panels.map(p=>p.id),ids);assert.equal(calls.length,0);
  assert.deepEqual((await packs.view(task)).config.pinned,ids);
  let inferred=0;plane.ai.decide=async()=>{inferred++;return result(Object.fromEntries(ids.map(id=>[id,id==='qa-reviewer'?.05:.95])));};
  const auto=await packs.configure(task,{mode:'auto',pinned:['qa-reviewer','knowledge-manager'],expectedRevision:2});
  assert.equal(inferred,1);assert.equal(auto.panels.length,ids.length);
  assert.deepEqual(auto.selection.selected.slice(0,2),['qa-reviewer','knowledge-manager']);
  assert.deepEqual([...auto.selection.selected].sort(),[...ids].sort());
  assert.equal(ROLE_PACK_POLICY.maxActive,ids.length);
});

test('DevSecOps displays lifecycle criteria and actual evidence without claiming a security verdict',async t=>{
  const {task,packs,plane}=await setup(t);task.claudeRolePacks={mode:'manual',pinned:['devsecops'],revision:1};
  const p=plan(task,{items:[{id:'secure',title:'Review CI dependency control',ownerId:task.id,status:'in_progress',acceptance:'Record the build artifact, finding owner and runtime follow-up.',dependsOn:[]}]});
  plane.data.workPlans.push(p);await packs.resolve(task);
  const panel=(await packs.view(task)).panels[0];
  assert.equal(panel.sections[0].title,'Security lifecycle & delivery criteria');
  assert.equal(panel.sections[1].total,0);assert.match(panel.sections[1].empty,/not a passing result/);
  assert.equal(panel.sections.at(-1).total,0);
  p.items[0].note='Dependency scan at revision abc: candidate finding; reproduction pending.';
  assert.match((await packs.view(task)).panels[0].sections[1].items[0].text,/reproduction pending/);
  assert.match(panel.guide.join(' '),/runtime|after release/);
});

test('existing Database Architect pins keep the broader Data Architect workspace',async t=>{
  const {task,packs}=await setup(t);task.claudeRolePacks={mode:'manual',pinned:['database-architect'],revision:7};
  await packs.resolve(task);const view=await packs.view(task),panel=view.panels[0];
  assert.equal(view.config.revision,7);assert.deepEqual(view.config.pinned,['database-architect']);
  assert.equal(panel.name,'Data Architect');assert.equal(panel.sections[0].title,'Data architecture & governance criteria');
  assert.equal(panel.sections[2].title,'Data models, contracts & decisions');
  assert.equal(panel.sections.at(-1).total,0);assert.match(panel.guide.join(' '),/small application may need one simple database/);
});
