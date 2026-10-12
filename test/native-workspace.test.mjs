import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitAdapter } from '../lib/adapters.mjs';
import { ResourceHistory } from '../lib/resource-history.mjs';
import { ControlPlane } from '../lib/control-plane.mjs';
import { fingerprint } from '../lib/patch.mjs';

test('native review stages and unstages exactly one hunk and rejects a stale review', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-hunks-')),git=new GitAdapter(root);
  try {
    await git.command(root,['init','-b','main']);await git.command(root,['config','user.name','HeloScrum Test']);await git.command(root,['config','user.email','test@example.invalid']);
    const lines=Array.from({length:40},(_,i)=>'line '+(i+1));
    await writeFile(path.join(root,'a file.txt'),lines.join('\n')+'\n');await git.command(root,['add','.']);await git.command(root,['commit','-m','fixture']);
    const [w]=await git.worktrees(root);
    lines.splice(2,0,'inserted early');lines[32]='changed later';
    await writeFile(path.join(root,'a file.txt'),lines.join('\n')+'\n');
    let review=await git.file(root,w.id,'a file.txt');assert.equal(review.patch.hunks.length,2);
    await git.stageHunk(root,w.id,'a file.txt',1,review.patch.fingerprint);
    let staged=await git.file(root,w.id,'a file.txt',true);
    assert.match(staged.diff,/\+changed later/);assert.doesNotMatch(staged.diff,/\+inserted early/);
    await assert.rejects(git.stageHunk(root,w.id,'a file.txt',0,review.patch.fingerprint),/changed since review/);
    await git.stageHunk(root,w.id,'a file.txt',0,staged.patch.fingerprint,true);
    assert.equal((await git.status(root))[0].staged,false);
    review=await git.file(root,w.id,'a file.txt');await git.stageHunk(root,w.id,'a file.txt',0,review.patch.fingerprint);
    staged=await git.file(root,w.id,'a file.txt',true);assert.match(staged.diff,/\+inserted early/);assert.doesNotMatch(staged.diff,/\+changed later/);
    await writeFile(path.join(root,'a file.txt'),lines.join('\n')+'\nchanged while reviewing\n');
    await assert.rejects(git.stageHunk(root,w.id,'a file.txt',0,review.patch.fingerprint),/changed since review/);
    await assert.rejects(git.stageHunk(root,w.id,'a file.txt',999,(await git.file(root,w.id,'a file.txt')).patch.fingerprint),/whole-file/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('resource history expires old samples, bounds storage, and keeps absent metrics unknown',()=>{
  const history=new ResourceHistory(100);
  assert.deepEqual(history.record([{id:'a',cpu:null}],0)[0].history,[]);
  history.record([{id:'a',cpu:'2.1%'}],1);history.record([{id:'a',cpu:'4.2%'}],50);
  assert.deepEqual(history.record([{id:'a',cpu:'3%'}],102)[0].history.map(x=>x.cpu),[4.2,3]);
  history.record([],103);assert.equal(history.history.size,0);
});

test('native agent selections require the output that was reviewed and an agent that is not working',async()=>{
  const plane=new ControlPlane('/fixture');plane.data.tasks=[{id:'task',project:'/fixture',pane:'pane'}];
  let output='Choose a permission',status='blocked',calls=[];
  plane.herdr={list:async()=>[{pane_id:'pane',agent_status:status}],read:async()=>output,key:async(...args)=>calls.push(args)};plane.record=async()=>{};
  await assert.rejects(plane.respondTask('task','enter',fingerprint('older prompt')),/output changed/);
  await plane.respondTask('task','enter',fingerprint(output));assert.deepEqual(calls,[['pane','enter']]);
  status='working';await assert.rejects(plane.respondTask('task','enter',fingerprint(output)),/Interrupt the agent/);
});
