import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ControlPlane} from '../lib/control-plane.mjs';
import {remoteIdentity,validateRemote} from '../lib/project-library.mjs';
import {ProjectVisibility} from '../dist/chat-directory.js';
import {appearanceFor} from '../dist/agent-appearance.js';

async function fixture(){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-library-'))),plane=await new ControlPlane(root).init();await plane.git.command(root,['init','-b','main']);await plane.git.command(root,['config','user.name','HeloScrum Test']);await plane.git.command(root,['config','user.email','test@example.invalid']);await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');await writeFile(path.join(root,'readme.txt'),'retained work\n');await plane.git.command(root,['add','.']);await plane.git.command(root,['commit','-m','initial']);plane.herdr={list:async()=>[]};return {root,plane};}
test('project directory remembers empty projects; session archive/trash/restore preserve history and worktrees',async()=>{
  const {root,plane}=await fixture();try{
    const [w]=await plane.git.worktrees(root),task={id:'test-agent',project:root,path:root,worktreeId:w.id,role:'Builder',title:'Build something',kind:'codex',phase:'launched',prompt:'Keep files',providerSessionId:'exact-session',branch:'main',createdAt:new Date().toISOString()};plane.data.tasks.push(task);
    await plane.projects.appearance(task.id,{icon:'cat',color:'teal'});assert.deepEqual(appearanceFor(task),{icon:'cat',color:'teal'});assert.equal(task.providerSessionId,'exact-session');
    await assert.rejects(plane.projects.appearance(task.id,{icon:'script',color:'url(evil)'}),/picker/);
    await plane.projects.sessionState(root,task.id,'archived');assert.equal((await plane.projects.directory()).projects[0].sessions[0].state,'archived');assert.throws(()=>plane.task(task.id),/Restore/);
    await plane.projects.sessionState(root,task.id,'trash');await plane.projects.sessionState(root,task.id,'active');assert.equal(plane.task(task.id).providerSessionId,'exact-session');assert.equal(await readFile(path.join(root,'readme.txt'),'utf8'),'retained work\n');assert.equal((await plane.git.worktrees(root))[0].head,w.head);
    await plane.projects.pin(root,true);await plane.save();const saved=JSON.parse(await readFile(path.join(root,'.heloscrum/state.json'),'utf8'));assert.equal(saved.projects[0].pinned,true);assert.deepEqual(saved.tasks[0].appearance,{icon:'cat',color:'teal'});
    task.pane='pane';plane.herdr.list=async()=>[{pane_id:'pane',agent_status:'working'}];await assert.rejects(plane.projects.sessionState(root,task.id,'trash'),/finish or interrupt/);assert.equal(task.trashedAt,undefined);
    plane.collaboration.delivering.add(task.id);await assert.rejects(plane.projects.sessionState(root,task.id,'archived'),/update/);plane.collaboration.delivering.clear();
    await assert.rejects(plane.projects.sessionState('/foreign',task.id,'trash'),/Open this project/);
  }finally{await plane.saveQueue;await rm(root,{recursive:true,force:true});}
});
test('resuming uses the verified exact provider session without re-submitting the task',async()=>{
  const {root,plane}=await fixture();try{
    const t={id:'resume',project:root,path:root,title:'Saved session',phase:'launched',providerSessionId:'saved-id',pane:'old',workspace:'old-workspace',kind:'codex'};plane.data.tasks.push(t);let launches=[];
    plane.transcripts.readCurrent=async()=>({sessionId:'saved-id'});plane.collaboration.launchConfig=async(_,options)=>{assert.equal(options.resumeSessionId,'saved-id');return ['resume','saved-id'];};plane.dispatch=(task,args)=>launches.push({task:{...task},args});
    await plane.projects.resume(root,t.id);assert.equal(launches.length,1);assert.deepEqual(launches[0].args,['resume','saved-id']);assert.equal(t.resumeOnly,true);assert.equal(t.providerSessionId,'saved-id');assert.equal(t.pane,null);
    await assert.rejects(plane.projects.resume(root,t.id),/in progress/);
    t.phase='launched';plane.transcripts.readCurrent=async()=>({sessionId:'wrong'});await assert.rejects(plane.projects.resume(root,t.id),/identity changed/);assert.equal(launches.length,1);
  }finally{await plane.saveQueue;await rm(root,{recursive:true,force:true});}
});
test('local clone/connect/publish round trip refuses overwrites and stale branch reviews',async()=>{
  const {root,plane}=await fixture(),outside=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-remotes-')));try{
    const bare=path.join(outside,'remote.git');await mkdir(bare);await plane.git.command(bare,['init','--bare']);
    await plane.projects.connect(root,{name:'origin',remote:bare,hosting:'git'});await assert.rejects(plane.projects.connect(root,{name:'origin',remote:bare}),/already exists/);
    const [w]=await plane.git.worktrees(root),review=await plane.projects.pushPreview(root,w.id);await plane.projects.push(root,w.id,review);assert.equal((await plane.git.command(bare,['rev-parse','refs/heads/main'])).trim(),review.head);
    await writeFile(path.join(root,'readme.txt'),'changed\n');await plane.git.command(root,['add','readme.txt']);await plane.git.command(root,['commit','-m','next']);await assert.rejects(plane.projects.push(root,w.id,review),/changed/);
    const destination=path.join(outside,'clone');await plane.projects.clone({remote:root,destination});assert.equal(plane.data.project,destination);assert.equal(await readFile(path.join(destination,'readme.txt'),'utf8'),'changed\n');await assert.rejects(plane.projects.clone({remote:root,destination}),/never overwritten/);
    await plane.selectProject(root);const directory=await plane.projects.directory();assert(directory.projects.some(p=>p.id===destination&&p.sessions.length===0));
  }finally{await plane.saveQueue;await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('host parsing supports private/self-hosted repos without accepting credentials or remote commands',()=>{
  assert.equal(remoteIdentity('git@github.com:owner/repo.git').web,'https://github.com/owner/repo');
  assert.equal(remoteIdentity('ssh://git@gitlab.example.com/team/subgroup/repo.git','gitlab').requestsUrl,'https://gitlab.example.com/team/subgroup/repo/-/merge_requests');
  assert.equal(remoteIdentity('https://git.example.com:8443/group/repo','gitlab').web,'https://git.example.com:8443/group/repo');
  for(const url of ['ext::sh -c evil','--upload-pack=evil','https://user:token@github.com/team/repo','https://token@github.com/team/repo','file:///tmp/repo','ftp://example.com/repo'])assert.throws(()=>validateRemote(url));
});
test('local folders require explicit Git setup, preserve files, and persist without changing the current project on failure',async()=>{
  const {root,plane}=await fixture(),outside=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-local-project-')));
  try{
    const folder=path.join(outside,"New project's folder");await mkdir(folder);
    await writeFile(path.join(folder,'existing.txt'),'keep this exactly\n');
    await assert.rejects(plane.selectProject(folder),error=>error.status===422&&error.code==='PROJECT_NEEDS_GIT');
    assert.equal(plane.data.project,root);await assert.rejects(readFile(path.join(folder,'.git/HEAD')),error=>error.code==='ENOENT');
    await assert.rejects(plane.selectProject(path.join(outside,'missing')),error=>error.status===404);
    await assert.rejects(plane.selectProject(path.join(folder,'existing.txt')),error=>error.status===400);
    await assert.rejects(plane.selectProject('relative/path'),error=>error.status===400);
    assert.equal(plane.data.project,root);
    assert.deepEqual(await plane.selectProject(folder,{initialize:true}),{path:folder});
    assert.equal(await readFile(path.join(folder,'existing.txt'),'utf8'),'keep this exactly\n');
    assert.equal((await plane.git.command(folder,['ls-tree','-r','--name-only','HEAD'])).trim(),'');
    assert.equal((await plane.git.command(folder,['status','--porcelain'])).trim(),'?? existing.txt');
    assert.equal((await plane.git.command(folder,['remote'])).trim(),'');
    const head=(await plane.git.command(folder,['rev-parse','HEAD'])).trim();
    await plane.selectProject(folder,{initialize:true});assert.equal((await plane.git.command(folder,['rev-parse','HEAD'])).trim(),head);
    const saved=JSON.parse(await readFile(path.join(root,'.heloscrum/state.json'),'utf8'));
    assert.equal(saved.project,folder);assert(saved.projects.some(project=>project.path===folder));
    const broken=path.join(outside,'existing-metadata');await mkdir(path.join(broken,'.git'),{recursive:true});
    await writeFile(path.join(broken,'.git','keep'),'unrelated metadata');
    await assert.rejects(plane.selectProject(broken,{initialize:true}),error=>error.status===409);
    assert.equal(await readFile(path.join(broken,'.git','keep'),'utf8'),'unrelated metadata');assert.equal(plane.data.project,folder);
  }finally{await plane.saveQueue;await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('failed Git initialization releases its empty claim and permits a retry without losing files',async()=>{
  const {root,plane}=await fixture(),outside=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-init-retry-'))),previous=process.env.GIT_DEFAULT_HASH;
  try{
    await writeFile(path.join(outside,'retained.txt'),'keep this file');
    process.env.GIT_DEFAULT_HASH='invalid-hash-for-test';
    await assert.rejects(plane.selectProject(outside,{initialize:true}),/unknown hash algorithm/);
    if(previous===undefined)delete process.env.GIT_DEFAULT_HASH;else process.env.GIT_DEFAULT_HASH=previous;
    assert.equal(plane.data.project,root);
    await assert.rejects(readFile(path.join(outside,'.git/HEAD')),error=>error.code==='ENOENT');
    await plane.selectProject(outside,{initialize:true});
    assert.equal(plane.data.project,outside);assert.equal(await readFile(path.join(outside,'retained.txt'),'utf8'),'keep this file');
    assert.equal((await plane.git.command(outside,['ls-tree','-r','--name-only','HEAD'])).trim(),'');
  }finally{if(previous===undefined)delete process.env.GIT_DEFAULT_HASH;else process.env.GIT_DEFAULT_HASH=previous;await plane.saveQueue;await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('hidden conversation projects persist independently from collapse and reveal always expands',()=>{
  const visibility=new ProjectVisibility();visibility.toggle('/a');visibility.hide('/a');visibility.toggle('/b');const restored=new ProjectVisibility(visibility.snapshot());assert(restored.hidden.has('/a'));assert(restored.collapsed.has('/a'));restored.reveal('/a');assert(!restored.hidden.has('/a'));assert(!restored.collapsed.has('/a'));assert(restored.collapsed.has('/b'));
});
