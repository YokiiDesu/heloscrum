import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GitAdapter,DockerAdapter,parseStatus,inside,binary} from '../lib/adapters.mjs';
import {validRequest} from '../lib/security.mjs';

test('HeloScrum binary overrides take precedence over workspace binaries',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-binary-'));
 const previous=process.env.HELOSCRUM_KIRO_BIN;
 try{
  const local=path.join(root,'.heloscrum/bin/kiro-cli'),override=path.join(root,'custom-cli');
  await mkdir(path.dirname(local),{recursive:true});
  await writeFile(local,'#!/bin/sh\nexit 0\n',{mode:0o700});await writeFile(override,'#!/bin/sh\nexit 0\n',{mode:0o700});
  delete process.env.HELOSCRUM_KIRO_BIN;
  assert.equal(await binary('kiro',root),local);
  process.env.HELOSCRUM_KIRO_BIN=override;
  assert.equal(await binary('kiro',root),override);
  delete process.env.HELOSCRUM_KIRO_BIN;
  assert.equal(await binary('kiro',root),local);
 }finally{if(previous===undefined)delete process.env.HELOSCRUM_KIRO_BIN;else process.env.HELOSCRUM_KIRO_BIN=previous;await rm(root,{recursive:true,force:true});}
});

test('status parsing preserves unusual filenames and rename sources',()=>{
 const files=parseStatus(' M path with space.txt\0R  new name\0old name\0?? :(glob)*\0UU conflicted\0');
 assert.equal(files[0].path,'path with space.txt');assert.equal(files[1].original,'old name');assert.equal(files[2].untracked,true);assert.equal(files[3].conflict,true);
});
test('origin and host validation blocks foreign pages and DNS rebinding',()=>{
 const req=(headers)=>({headers:{host:'127.0.0.1:4173',...headers}});
 assert.equal(validRequest(req({origin:'http://127.0.0.1:4173'}),4173),true);
 assert.equal(validRequest(req({origin:'https://evil.test'}),4173),false);
 assert.equal(validRequest(req({host:'evil.test:4173'}),4173),false);
 assert.equal(validRequest(req({'sec-fetch-site':'cross-site'}),4173),false);
 assert.equal(validRequest(req({'sec-fetch-site':'same-site'}),4173),false);
 assert.equal(inside('/tmp/repo','/tmp/repo-other/secrets'),false);
});
test('real Git review, literal-path staging, worktree isolation and symlink guard',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-git-test-'));const git=new GitAdapter(root);
 try{
  await git.command(root,['init','-b','main']);await git.command(root,['config','user.email','test@example.invalid']);await git.command(root,['config','user.name','HeloScrum Test']);
  await writeFile(path.join(root,'tracked.txt'),'original\n');await git.command(root,['add','--','tracked.txt']);await git.command(root,['commit','-m','fixture']);
  const [w]=await git.worktrees(root);assert.equal(w.branch,'main');const literal=process.platform==='win32'?'[literal].txt':':(glob)*';
  await writeFile(path.join(root,'tracked.txt'),'changed\n');await writeFile(path.join(root,literal),'literal\n');await writeFile(path.join(root,'unrelated.txt'),'untouched\n');
  assert.match((await git.file(root,w.id,'tracked.txt')).diff,/\+changed/);
  await git.stage(root,w.id,literal);let files=await git.status(root);assert.equal(files.find(f=>f.path===literal).staged,true);assert.equal(files.find(f=>f.path==='unrelated.txt').staged,false);
  await git.stage(root,w.id,literal,true);files=await git.status(root);assert.equal(files.find(f=>f.path===literal).untracked,true);
  await assert.rejects(git.file(root,w.id,'../../etc/passwd'));
  await assert.rejects(git.resolve(root,'unknown'));
  await symlink(path.join(root,'tracked.txt'),path.join(root,'outside'),'file');await assert.rejects(git.file(root,w.id,'outside'));
  const child=await git.create(root,'feat/test');assert.equal(await readFile(path.join(child.path,'tracked.txt'),'utf8'),'original\n');
  assert.equal((await git.worktrees(root)).length,2);await assert.rejects(git.create(root,'feat/test'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Docker adapter normalizes observed JSON and rejects arbitrary operations',async()=>{
 const d=new DockerAdapter('docker');d.command=async args=>args[0]==='ps'?JSON.stringify({ID:'a'.repeat(64),Names:'db',State:'running',Image:'postgres:16',Labels:'com.docker.compose.project=app,com.docker.compose.project.working_dir=/tmp/project'}):JSON.stringify({ID:'a'.repeat(12),CPUPerc:'1.2%',MemUsage:'10MiB / 1GiB'});
 const result=await d.list();assert.equal(result.containers[0].cpu,'1.2%');assert.equal(result.containers[0].workingDir,'/tmp/project');await assert.rejects(d.action('a'.repeat(64),'prune'));await assert.rejects(d.validate('--help'));
});

test('reviewed commits reject stale index state and clean branches merge without conflicts',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-review-test-'));const git=new GitAdapter(root);
 try{
  await git.command(root,['init','-b','main']);await git.command(root,['config','user.email','test@example.invalid']);await git.command(root,['config','user.name','HeloScrum Test']);
  await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');await writeFile(path.join(root,'file'),'base\n');await git.command(root,['add','.']);await git.command(root,['commit','-m','base']);
  const w=await git.create(root,'feat/review');await writeFile(path.join(w.path,'file'),'reviewed\n');await git.stage(root,w.id,'file');const before=await git.commitPreview(root,w.id);
  await writeFile(path.join(w.path,'file'),'later\n');await git.stage(root,w.id,'file');await assert.rejects(git.commit(root,w.id,'stale',before),/moved since review/);
  const current=await git.commitPreview(root,w.id);await git.commit(root,w.id,'reviewed change',current);const merge=await git.mergePreview(root,w.id);
  await assert.rejects(git.merge(root,w.id,{sourceHead:'wrong',targetHead:merge.target.head}),/changed since review/);
  await git.merge(root,w.id,{sourceHead:merge.source.head,targetHead:merge.target.head});assert.equal(await readFile(path.join(root,'file'),'utf8'),'later\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Herdr preserves typed CLI refusal errors, including nonzero stdout with stderr noise',async()=>{
 const {HerdrAdapter}=await import('../lib/adapters.mjs');const h=new HerdrAdapter('herdr','/fixture');
 h.command=async()=>{throw Object.assign(new Error('warning'),{stdout:JSON.stringify({error:{code:'agent_pane_busy',message:'not an available shell'}}),stderr:'warning',code:1});};
 await assert.rejects(h.json(['agent','start']),e=>e.code==='agent_pane_busy'&&e.message==='not an available shell');
});
test('Herdr waits only on explicit pre-launch refusals and bounds the retries',async()=>{
 const {HerdrAdapter}=await import('../lib/adapters.mjs');const h=new HerdrAdapter('herdr','/fixture');let calls=0,waits=0;h.waitForShell=async()=>{waits++;};
 h.json=async()=>{if(++calls<3)throw Object.assign(new Error('busy'),{code:'agent_pane_busy'});return {ok:true};};
 assert.deepEqual(await h.startAgent('agent','codex','w:p1'),{ok:true});assert.equal(calls,3);assert.equal(waits,2);
 calls=0;h.json=async()=>{calls++;throw Object.assign(new Error('busy'),{code:'agent_pane_busy'});};
 await assert.rejects(h.startAgent('agent','codex','w:p1'),/busy/);assert.equal(calls,20);
 calls=0;h.json=async()=>{calls++;throw Object.assign(new Error('timeout after dispatch'),{code:'agent_start_timeout'});};
 await assert.rejects(h.startAgent('agent','codex','w:p1'),/timeout/);assert.equal(calls,1);
});
test('managed shells opt out of the nested Kiro terminal; recovery only recognizes an idle wrapper',async()=>{
 const {HerdrAdapter}=await import('../lib/adapters.mjs');const h=new HerdrAdapter('herdr','/fixture');let args;
 h.json=async a=>{args=a;return {root_pane:{pane_id:'w:p1'}};};await h.createWorkspace('/worktree','Task');assert(args.includes('PROCESS_LAUNCHED_BY_Q=1'));assert(args.includes('COLORTERM=truecolor'));assert(args.includes('FORCE_COLOR=3'));assert(args.includes('NO_COLOR='));assert.equal(h.env.TERM,'xterm-256color');assert.equal(h.env.NO_COLOR,undefined);
 const info={shell_pid:10,foreground_process_group_id:10,foreground_processes:[{pid:10,cmdline:'zsh (kiro-cli-term)',cwd:'/worktree'}]};h.json=async()=>({process_info:info});
 assert.equal(await h.wrappedShell('w:p1','/worktree'),true);assert.equal(await h.wrappedShell('w:p1','/other'),false);
 info.foreground_processes.push({pid:11,cmdline:'claude',cwd:'/worktree'});assert.equal(await h.wrappedShell('w:p1','/worktree'),false);
});

test('Herdr readiness fallback requires positive screen evidence and preserves explicit refusals',async()=>{
 const {HerdrAdapter}=await import('../lib/adapters.mjs'),h=new HerdrAdapter('herdr','/fixture');
 let agent={pane_id:'w:p1',agent:'codex',agent_status:'idle',revision:1},detail={agent:'codex',state:'idle',visible_idle:true,visible_blocker:false,visible_working:false},calls=0;
 h.json=async()=>({agents:[agent]});h.command=async args=>{assert.deepEqual(args,['agent','explain','w:p1','--json']);calls++;return JSON.stringify(detail);};
 assert.equal((await h.list())[0].interactive_ready,true);await h.list();assert.equal(calls,1);
 for(const patch of [{visible_idle:false},{visible_blocker:true},{visible_working:true},{agent:'claude'},{skip_state_update:true}]){
  h.readiness.clear();const original=detail;detail={...original,...patch};assert.equal((await h.list())[0].interactive_ready,false);detail=original;
 }
 agent={...agent,interactive_ready:false};const before=calls;assert.equal((await h.list())[0].interactive_ready,false);assert.equal(calls,before);
 delete agent.interactive_ready;agent.agent_status='working';await h.list();assert.equal(calls,before);
 agent.agent_status='idle';h.readiness.clear();h.command=async()=>{throw Error('Unavailable');};assert.equal((await h.list())[0].interactive_ready,false);
});
