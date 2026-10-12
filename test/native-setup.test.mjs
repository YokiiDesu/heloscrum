import {assertPrivate} from './private-file-assert.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NativeSetup,nativeSelection} from '../lib/native-setup.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {ProjectSettings} from '../lib/project-settings.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';
import {run} from '../lib/adapters.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-native-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project'),home=path.join(root,'home'),worktree=path.join(root,'worktree');
  await mkdir(project);await mkdir(home);await run('git',['init','-q','-b','main'],{cwd:project});
  await writeFile(path.join(project,'AGENTS.md'),'Keep the public API stable.');await run('git',['add','AGENTS.md'],{cwd:project});
  await run('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Fixture'],{cwd:project});
  await run('git',['worktree','add','-q','-b','test/native',worktree],{cwd:project});
  const plane={root,tools:{codex:'codex',claude:'claude',kiro:'kiro-cli'},data:{project,tasks:[],events:[]},projects:{project:p=>assert.equal(p,project)},save:async()=>{}};
  const native=plane.nativeSetup=new NativeSetup(plane,{home,codexHome:path.join(home,'.codex')});
  const put=async(relative,content,base=project)=>{const file=path.join(base,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,typeof content==='string'?content:JSON.stringify(content));return file;};
  const task={id:'12345678-1234-4123-8123-123456789012',kind:'kiro',project,path:worktree,title:'Native fixture',prompt:'Wait',nativeSetup:{profile:null,files:[]}};plane.data.tasks.push(task);
  return {root,project,home,worktree,plane,native,put,task};
}

test('discovery shows sources and copy candidates without disclosing configuration values',async t=>{
  const f=await fixture(t);await f.put('.codex/config.toml','secret = "not-in-response"',f.home);
  await f.put('.codex/reviewer.config.toml','model = "model-native"',f.home);
  await f.put('.codex/config.toml','hooks = "project-secret"');await f.put('.codex/auth.json','{"token":"no"}');
  await f.put('.codex/skills/review/SKILL.md','# Review');await f.put('.codex/skills/review/.env','TOKEN=secret');
  await symlink(path.join(f.home,'.codex/config.toml'),path.join(f.project,'.codex/skills/link'));
  const report=await f.native.report('codex',f.project);
  assert.deepEqual(report.profiles.map(p=>p.id),['user:reviewer']);assert(report.files.find(f=>f.path==='AGENTS.md').tracked);
  assert(report.files.some(f=>f.path==='.codex/skills/review/SKILL.md'));assert(!report.files.some(f=>/auth|\.env|link/.test(f.path)));
  assert(report.skipped.some(s=>/link/.test(s)));assert(!JSON.stringify(report).includes('not-in-response'));assert(!JSON.stringify(report).includes('project-secret'));
  assert.equal(report.checks[0].state,'Detected');assert.equal(report.terminal,false);
});

test('selected local configuration is copied privately, Git-excluded, and never overwrites work',async t=>{
  const f=await fixture(t);const file='.codex/config.toml';await f.put(file,'model = "native"');await f.put('.codex/hooks/check.sh','#!/bin/sh\nexit 0\n');
  f.task.kind='codex';f.task.nativeSetup={profile:null,files:[file]};const plan=await f.native.inspect('codex',f.project,f.task.nativeSetup);
  await f.native.prepare(f.task,{expected:plan.fingerprint});assert.equal(await readFile(path.join(f.worktree,file),'utf8'),'model = "native"');
  await assertPrivate(path.join(f.worktree,file));assert.equal((await run('git',['status','--porcelain','--untracked-files=all'],{cwd:f.worktree})).trim(),'');
  await assert.rejects(readFile(path.join(f.worktree,'.codex/hooks/check.sh')),/ENOENT/);
  await f.put(file,'model = "keep edits"',f.worktree);await assert.rejects(f.native.prepare(f.task),/differs/);
  assert.equal(await readFile(path.join(f.worktree,file),'utf8'),'model = "keep edits"');
  assert.throws(()=>nativeSelection('codex',{files:['../secret']}),/supported/);assert.throws(()=>nativeSelection('codex',{files:['.codex/auth.json']}),/supported/);
  await assert.rejects(f.native.inspect('codex',f.project,{files:['AGENTS.md']}),/already comes from Git/);
});

test('source drift, symlinks, large files and conflicting batches fail before copying',async t=>{
  const f=await fixture(t);f.task.kind='claude';f.task.nativeSetup={files:['.mcp.json','.claude/settings.json']};await f.put('.mcp.json','{}');await f.put('.claude/settings.json','{}');
  const plan=await f.native.inspect('claude',f.project,f.task.nativeSetup);await f.put('.mcp.json','{"changed":true}');
  await assert.rejects(f.native.prepare(f.task,{expected:plan.fingerprint}),/changed since review/);await assert.rejects(readFile(path.join(f.worktree,'.claude/settings.json')),/ENOENT/);
  await mkdir(path.join(f.worktree,'.claude'));await symlink(f.home,path.join(f.worktree,'.claude/rules'));await f.put('.claude/rules/test.md','x');
  await assert.rejects(f.native.prepare({...f.task,nativeSetup:{files:['.claude/rules/test.md']}}),/links/);
  await f.put('.claude/skills/large/SKILL.md','x'.repeat(1024*1024+1));await assert.rejects(f.native.inspect('claude',f.project,{files:['.claude/skills/large/SKILL.md']}),/1 MiB/);
  await f.put('.claude/settings.json','{"keep":true}',f.worktree);await assert.rejects(f.native.prepare(f.task),/differs/);await assert.rejects(readFile(path.join(f.worktree,'.mcp.json')),/ENOENT/);
});

test('Kiro custom profile retains restrictions, MCPs, hooks, model and prompt; resume uses its saved copy',async t=>{
  const f=await fixture(t);const original={name:'specialist',description:'Test specialist',prompt:'file://./instructions.md',model:'auto',tools:['fs_read','@docs'],allowedTools:['fs_read'],toolsSettings:{fs_write:{allowedPaths:[]}},resources:['file://README.md'],hooks:{agentSpawn:[{command:'echo fixture'}]},mcpServers:{docs:{url:'https://example.invalid/mcp',env:{TOKEN:'private-value'}}}};
  const source=await f.put('.kiro/agents/specialist.json',original,f.home);await f.put('.kiro/agents/instructions.md','Read only.',f.home);
  f.task.nativeSetup={profile:'user:specialist',files:[]};await f.native.prepare(f.task);
  const collab=f.plane.collaboration=new Collaboration(f.plane);const args=await collab.register(f.task);
  const generated=JSON.parse(await readFile(path.join(f.worktree,'.kiro/agents/heloscrum-'+f.task.id+'.json'),'utf8'));
  assert(args.includes('--v2'));assert(!args.includes('--model'));assert(!args.includes('--trust-all-tools'));
  assert.deepEqual(generated.tools,['fs_read','@docs','@heloscrum']);assert.deepEqual(generated.allowedTools,original.allowedTools);assert.deepEqual(generated.toolsSettings,original.toolsSettings);
  assert.deepEqual(generated.hooks,original.hooks);assert.deepEqual(generated.resources,original.resources);assert.deepEqual(generated.mcpServers.docs,original.mcpServers.docs);assert.equal(generated.model,'auto');assert.deepEqual(Object.keys(generated.mcpServers).sort(),['docs','heloscrum']);
  assert.equal(generated.prompt,'file://'+path.join(f.home,'.kiro/agents/instructions.md'));assert.deepEqual(JSON.parse(await readFile(source,'utf8')),original);
  assert(!JSON.stringify(f.task).includes('private-value'));await f.put('.kiro/agents/specialist.json',{...original,tools:['*'],model:'different'},f.home);
  await collab.launchConfig(f.task,{resumeSessionId:'11111111-1111-4111-8111-111111111111'});
  const resumed=JSON.parse(await readFile(path.join(f.worktree,'.kiro/agents/heloscrum-'+f.task.id+'.json'),'utf8'));assert.equal(resumed.model,'auto');assert.deepEqual(resumed.tools,generated.tools);
  assert.equal((await run('git',['status','--porcelain','--untracked-files=all'],{cwd:f.worktree})).trim(),'');
});

test('Kiro V3 profiles and conflicting collaboration connections fail explicitly',async t=>{
  const f=await fixture(t);await f.put('.kiro/agents/modern.json',{permissions:{rules:[]}},f.home);await f.put('.kiro/agents/markdown.md','---\nname: modern\n---\nPrompt',f.home);
  await f.put('.kiro/agents/conflict.json',{mcpServers:{heloscrum:{command:'other'}}},f.home);await f.put('.kiro/agents/broken.json','{"SECRET":"dont leak this"',f.home);
  await assert.rejects(f.native.inspect('kiro',f.project,{profile:'user:modern'}),/needs Kiro V3/);
  assert.equal((await f.native.profiles('kiro',f.project)).find(p=>p.name==='markdown').available,false);
  await assert.rejects(f.native.inspect('kiro',f.project,{profile:'user:conflict'}),/already defines the heloscrum connection/);
  await assert.rejects(f.native.inspect('kiro',f.project,{profile:'user:broken'}),error=>!error.message.includes('SECRET')&&/JSON/.test(error.message));
});

test('Codex native profiles layer with model/effort flags; Claude uses its declared native agent name',async t=>{
  const f=await fixture(t);await f.put('.codex/review.config.toml','model = "native"',f.home);f.task.kind='codex';f.task.model='explicit';f.task.effort='high';f.task.nativeSetup={profile:'user:review'};
  await f.native.prepare(f.task);const collab=new Collaboration(f.plane);let args=await collab.register(f.task);assert.equal(args[args.indexOf('--profile')+1],'review');assert.equal(args[args.indexOf('--model')+1],'explicit');assert(args.includes('model_reasoning_effort="high"'));
  assert(!args.some(a=>/bypass|yolo/.test(a)));
  await f.put('.claude/agents/backend.md','---\nname: backend-expert\ndescription: Test\n---\nReview carefully.',f.home);f.task.kind='claude';f.task.nativeSetup={profile:'user:backend'};delete f.task.model;delete f.task.effort;await f.native.prepare(f.task);args=await collab.launchConfig(f.task);
  assert.equal(args[args.indexOf('--agent')+1],'backend-expert');assert(!args.includes('--model'));assert(!args.includes('--strict-mcp-config'));assert(!args.includes('--dangerously-skip-permissions'));
  assert(JSON.parse(args[args.indexOf('--settings')+1]).hooks.SessionStart.length);assert(JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.heloscrum);
});

test('project profiles require their local file, Claude shared settings are not duplicated',async t=>{
  const f=await fixture(t);await f.put('.kiro/agents/project.json',{name:'project',prompt:'Project specialist',tools:['fs_read']});
  await assert.rejects(f.native.inspect('kiro',f.project,{profile:'project:project'}),/Select the local profile file/);
  f.task.nativeSetup={profile:'project:project',files:['.kiro/agents/project.json']};await f.native.prepare(f.task);assert.equal((await f.native.kiroProfile(f.task)).prompt,'Project specialist');
  await f.put('.claude/settings.local.json','{"permissions":{"allow":["Read"]}}');const report=await f.native.report('claude',f.project);assert(report.files.find(f=>f.path==='.claude/settings.local.json').shared);
  await assert.rejects(f.native.inspect('claude',f.project,{files:['.claude/settings.local.json']}),/shares settings/);
  await assert.rejects(f.native.inspect('kiro',f.project,{profile:'project:project',files:[]},{existing:f.task,worktree:f.worktree}),/fixed after/);
});

test('reusable profiles preserve native selections and reset them when choosing another provider',async t=>{
  const f=await fixture(t);f.plane.projects.identities=()=>[];f.plane.data.mcpServers=[];f.plane.collaboration={data:{tools:[]},notify:async()=>{}};const settings=new ProjectSettings(f.plane);
  const profile=await settings.saveProfile({name:'Specialist',kind:'kiro',scope:'project',project:f.project,summary:'Build with my tools',instructions:'Read the current task',nativeSetup:{profile:'user:specialist',files:[]}});
  assert.deepEqual(settings.prepareTask({profileId:profile.id,prompt:'Build'},f.project).nativeSetup,profile.nativeSetup);
  assert.equal(settings.prepareTask({profileId:profile.id,kind:'claude',prompt:'Review'},f.project).nativeSetup,null);
});

test('tracked project profiles use committed HEAD and preserve uncommitted source edits',async t=>{
  const f=await fixture(t);const relative='.kiro/agents/tracked.json';await f.put(relative,{prompt:'Committed',tools:['fs_read']});
  await run('git',['add',relative],{cwd:f.project});await run('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','Profile'],{cwd:f.project});
  await run('git',['merge','--ff-only','main'],{cwd:f.worktree});await f.put(relative,{prompt:'Uncommitted',tools:['*']});
  f.task.nativeSetup={profile:'project:tracked',files:[]};const plan=await f.native.inspect('kiro',f.project,f.task.nativeSetup);await f.native.prepare(f.task,{expected:plan.fingerprint});
  assert.equal((await f.native.kiroProfile(f.task)).prompt,'Committed');assert.equal(JSON.parse(await readFile(path.join(f.project,relative),'utf8')).prompt,'Uncommitted');
});

test('retry after native preparation failure finishes registration before dispatching',async t=>{
  const f=await fixture(t),p=new ControlPlane(f.root);p.data.tasks=[f.task];p.data.project=f.project;p.nativeSetup=f.native;p.collaboration=new Collaboration(p);
  await mkdir(path.join(f.root,'.heloscrum'));
  Object.assign(f.task,{kind:'codex',name:'native-retry',role:'Fixture',summary:'Check',phase:'setup-error',errorCode:'native_setup_failed',branch:'test/native',pane:null});
  p.herdr={list:async()=>[],wrappedShell:async()=>false};p.dispatch=(task,args)=>{assert(p.collaboration.data.credentials[task.id]);assert(args.includes('mcp_servers.heloscrum.enabled=true'));};
  const task=await p.retryTask(f.task.id);assert.equal(task.id,f.task.id);assert(p.collaboration.data.credentials[task.id]);
});
