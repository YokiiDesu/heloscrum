import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GitAdapter} from '../lib/adapters.mjs';
import {ChangeReviews} from '../lib/change-reviews.mjs';

test('review records persist and expire for content, index, binary, untracked, and HEAD changes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-change-review-')),git=new GitAdapter(root);let saved;
  const plane={git,data:{},save:async()=>{saved=structuredClone(plane.data);}},reviews=new ChangeReviews(plane);
  try{
    await git.command(root,['init','-b','main']);await git.command(root,['config','user.name','Review fixture']);await git.command(root,['config','user.email','review@example.invalid']);
    await writeFile(path.join(root,'file'),'base\n');await git.command(root,['add','.']);await git.command(root,['commit','-m','base']);const [w]=await git.worktrees(root);
    await assert.rejects(reviews.mark(root,w.id,(await reviews.read(root,w.id)).fingerprint),/No changes/);
    await writeFile(path.join(root,'file'),'review me\n');let loaded=await reviews.read(root,w.id,'file');assert.match(loaded.preview.diff,/review me/);
    await reviews.mark(root,w.id,loaded.fingerprint);assert.equal((await new ChangeReviews({...plane,data:saved}).read(root,w.id)).reviewed,true);
    for(const change of [()=>writeFile(path.join(root,'file'),'later\n'),()=>git.stage(root,w.id,'file'),()=>writeFile(path.join(root,'new.bin'),Buffer.from([0,1,2])),()=>writeFile(path.join(root,'new.bin'),Buffer.from([0,1,3])),()=>symlink('/etc/passwd',path.join(root,'link'))]){
      loaded=await reviews.read(root,w.id);await reviews.mark(root,w.id,loaded.fingerprint);await change();
      assert.equal((await reviews.read(root,w.id)).reviewed,false);await assert.rejects(reviews.mark(root,w.id,loaded.fingerprint),/moved since/);
    }
    loaded=await reviews.read(root,w.id);await reviews.mark(root,w.id,loaded.fingerprint);await git.command(root,['commit','--allow-empty','-m','move HEAD']);assert.equal((await reviews.read(root,w.id)).reviewed,false);
    await assert.rejects(reviews.read(root,'foreign-worktree'),/not part/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a diff changing during load cannot receive a newer review fingerprint',async()=>{
  let revision=0;
  const plane={data:{},git:{resolve:async()=>({path:os.tmpdir(),head:'head'}),status:async()=>[{path:'file'}],command:async()=>String(revision),file:async()=>{revision++;return {diff:'old content'};}}};
  await assert.rejects(new ChangeReviews(plane).read('project','tree','file'),/moved while loading/);
});
