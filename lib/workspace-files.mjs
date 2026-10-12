import {realpath,open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assert,inside,string} from './adapters.mjs';
import {fileReference} from '../dist/resource-preview.js';

export const MAX_WORKSPACE_FILE=20*1024*1024;
const protectedPath=relative=>relative.split(path.sep).some(part=>['.git','.heloscrum','.ssh','.aws'].includes(part)||/^\.env(?:\.|$)/i.test(part));

// Human browser access only. The caller has already checked same-origin + token.
// Git's registered worktrees, not a user-supplied root, define the read boundary.
export async function readWorkspaceFile(plane,input){
  const project=plane.projects.project(input.project||plane.data.project);
  const reference=fileReference(string(input.path,'file link',8192));
  assert(reference,'Use a local file link');
  const trees=await plane.git.worktrees(project);
  const roots=(await Promise.all(trees.map(async tree=>{try{return {...tree,path:await realpath(tree.path)};}catch{return null;}}))).filter(Boolean).sort((a,b)=>b.path.length-a.path.length);
  const rootFor=value=>roots.find(root=>inside(root.path,value));
  const check=async candidate=>{
    const lexical=rootFor(candidate);
    assert(!lexical||!protectedPath(path.relative(lexical.path,candidate)),'Private workspace files are not available in previews',403);
    let resolved;
    try{resolved=await realpath(candidate);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))throw Object.assign(Error('File no longer exists at this path. Its worktree may have been moved or removed.'),{status:404});throw error;}
    const root=rootFor(resolved);
    assert(root&&(!lexical||inside(lexical.path,resolved)),'File is outside this project’s registered worktrees',403);
    assert(!protectedPath(path.relative(root.path,resolved)),'Private workspace files are not available in previews',403);
    return {resolved,root};
  };
  let base=project;
  if(!path.isAbsolute(reference.path)&&!input.base&&input.taskId&&input.taskId!=='human'){
    const task=plane.data.tasks.find(task=>task.id===input.taskId&&task.project===project);
    assert(task,'The file’s sender is not in this project',404);
    if(!task.external){assert(task.path,'The sender’s worktree is unavailable',404);base=(await check(task.path)).resolved;}
  }
  if(input.base){assert(path.isAbsolute(input.base),'Invalid source document path');base=path.dirname((await check(input.base)).resolved);}
  const {resolved,root}=await check(path.resolve(base,reference.path));
  assert((await lstat(resolved)).isFile(),'Only regular files can be previewed',415);
  // Resolve links first, then refuse a last-component swap or non-regular file.
  const handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await handle.stat();assert(stat.isFile(),'Only regular files can be previewed',415);
    assert(stat.size<=MAX_WORKSPACE_FILE,'Files above 20 MiB cannot be previewed here. Use the file path in your editor.',413);
    const buffer=Buffer.alloc(Math.min(stat.size+1,MAX_WORKSPACE_FILE+1));let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    assert(length<=stat.size,'File changed while opening. Try again.',409);
    const owner=plane.data.tasks.find(task=>task.project===project&&task.path===root.path);
    return {name:path.basename(resolved),path:resolved,relativePath:path.relative(root.path,resolved),project,worktree:{path:root.path,branch:root.branch,label:owner?.role||owner?.title||(root.path===project?'Project working copy':root.branch)},size:length,modifiedAt:stat.mtime.toISOString(),bytes:buffer.subarray(0,length)};
  }finally{await handle.close();}
}
