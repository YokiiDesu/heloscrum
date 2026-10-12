import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath,open} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {GitAdapter} from '../lib/adapters.mjs';
import {readWorkspaceFile,MAX_WORKSPACE_FILE} from '../lib/workspace-files.mjs';
import {fileReference} from '../dist/resource-preview.js';

test('local link parsing preserves Unicode, encoded characters and line/heading references',()=>{
  for(const [link,expected] of [
    ['C:\\notes.md',{path:'C:/notes.md',line:null,column:null,fragment:''}],
    ['file:///C:/Work/brief.md#L2',{path:'C:/Work/brief.md',line:2,column:null,fragment:''}],
    ['docs/HANDOFF.md',{path:'docs/HANDOFF.md',line:null,column:null,fragment:''}],
    ['file:///tmp/Plan%20caf%C3%A9.md#evidence',{path:'/tmp/Plan café.md',line:null,column:null,fragment:'evidence'}],
    ['src/app.ts:12:4',{path:'src/app.ts',line:12,column:4,fragment:''}],
    ['src/app.ts#L12-L20',{path:'src/app.ts',line:12,column:null,fragment:''}],
    ['./percent%2520%23name.md',{path:'./percent%20#name.md',line:null,column:null,fragment:''}]
  ])assert.deepEqual(fileReference(link),expected,link);
});
test('web/app URLs, unsafe schemes and malformed paths never become file previews',()=>{
  for(const link of ['https://example.org/doc.md','http://localhost:4182/','//example.org/readme.md','mailto:person@example.org','vscode://file/tmp/doc.md','javascript:123','javascript%3A123','data:text/html,hello','file://remote/share.md','#section','?query=1','bad%ZZ.md','%00.md','~/.ssh/key','file:///tmp/test.md?download=1','notes.md:0','src/test.ts#L0','%2f%2fhost/file.md'])assert.equal(fileReference(link),null,link);
});

async function fixture(t){
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'hs-file-preview-'))),project=path.join(dir,'project'),tree=path.join(dir,'agent'),other=path.join(dir,'other');
  await mkdir(project);const git=new GitAdapter(dir);
  await git.command(project,['init','-b','main']);await git.command(project,['config','user.name','File preview test']);await git.command(project,['config','user.email','preview@example.invalid']);
  await writeFile(path.join(project,'README.md'),'# Project copy\n');await git.command(project,['add','.']);await git.command(project,['commit','-m','fixture']);
  await git.command(project,['worktree','add','-b','agent',tree]);await git.command(project,['worktree','add','-b','other',other]);
  await writeFile(path.join(tree,'README.md'),'# Agent copy\n');await mkdir(path.join(tree,'docs'));await writeFile(path.join(tree,'docs/HANDOFF.md'),'# Handoff\n\n| File | Result |\n| --- | --- |\n| Source | PASS |\n');await writeFile(path.join(tree,'docs/QA.md'),'# QA evidence\n');
  const plane={git,data:{project,tasks:[{id:'sender',project,path:tree,role:'Author'},{id:'other',project,path:other},{id:'external',project,external:true}]},projects:{project(value){assert.equal(value,project);return value;}}};
  t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,project,tree,other,plane,read:input=>readWorkspaceFile(plane,{project,...input})};
}
test('relative links use the sender, absolute links select the owning worktree, and nested links stay with their document',async t=>{
  const f=await fixture(t);
  assert.equal((await f.read({path:'README.md'})).bytes.toString(),'# Project copy\n');
  const owned=await f.read({taskId:'sender',path:'README.md'});assert.equal(owned.bytes.toString(),'# Agent copy\n');assert.equal(owned.worktree.label,'Author');
  const absolute=await f.read({taskId:'other',path:pathToFileURL(path.join(f.tree,'docs/HANDOFF.md')).href+'#L1'});assert.equal(absolute.relativePath,path.join('docs','HANDOFF.md'));assert.equal(absolute.worktree.path,f.tree);
  assert.equal((await f.read({path:'QA.md',base:absolute.path})).bytes.toString(),'# QA evidence\n');
  assert.equal((await f.read({taskId:'external',path:'README.md'})).bytes.toString(),'# Project copy\n');
  await writeFile(path.join(f.tree,'docs/Plan café%20#1.md'),'Unicode + literal percent/hash');
  assert.equal((await f.read({path:pathToFileURL(path.join(f.tree,'docs/Plan café%20#1.md')).href})).bytes.toString(),'Unicode + literal percent/hash');
});
test('traversal, sibling-prefix paths, escaped symlinks, private metadata and unregistered senders are refused',async t=>{
  const f=await fixture(t),outside=path.join(f.dir,'outside.md');await writeFile(outside,'private');
  await mkdir(path.join(f.dir,'project-other'));await writeFile(path.join(f.dir,'project-other/README.md'),'another project');
  await symlink(outside,path.join(f.tree,'escape.md'));await symlink(f.dir,path.join(f.tree,'escape-dir'),'junction');
  await writeFile(path.join(f.tree,'.env'),'TOKEN=private');await mkdir(path.join(f.tree,'.heloscrum'));await writeFile(path.join(f.tree,'.heloscrum/connection.json'),'secret');
  await symlink(path.join(f.tree,'.env'),path.join(f.tree,'secret-link.md'));
  for(const file of [outside,path.join(f.dir,'project-other/README.md'),'../outside.md','escape.md','escape-dir/outside.md','.git','.heloscrum/connection.json','.env','secret-link.md'])await assert.rejects(f.read({taskId:'sender',path:file}),error=>error.status===403,file);
  await assert.rejects(f.read({taskId:'missing',path:'README.md'}),error=>error.status===404);
  await assert.rejects(f.read({path:'README.md',base:outside}),error=>error.status===403);
});
test('missing, directory and oversized files fail clearly; ordinary binary/empty bytes are retained for downloads',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.read({path:'missing.md'}),error=>error.status===404&&/no longer exists/.test(error.message));
  await assert.rejects(f.read({path:f.project}),error=>error.status===415);
  const file=await open(path.join(f.project,'large.md'),'w');await file.truncate(MAX_WORKSPACE_FILE+1);await file.close();
  await assert.rejects(f.read({path:'large.md'}),error=>error.status===413);
  await writeFile(path.join(f.project,'data.bin'),Buffer.from([0,255,3]));assert.deepEqual((await f.read({path:'data.bin'})).bytes,Buffer.from([0,255,3]));
  await writeFile(path.join(f.project,'empty.md'),'');assert.equal((await f.read({path:'empty.md'})).size,0);
  await symlink(path.join(f.tree,'docs/QA.md'),path.join(f.tree,'alias.md'));assert.equal((await f.read({taskId:'sender',path:'alias.md'})).bytes.toString(),'# QA evidence\n');
});
