import {open,readdir,realpath,lstat,mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assert,inside,string,run} from './adapters.mjs';

const tool=(name,description,properties,required)=>({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}});
export const workspaceTools=[
  tool('workspace_list','List files in a directory within this agent worktree.',{path:{type:'string'}},[]),
  tool('workspace_read','Read a bounded page of a UTF-8 file in this agent worktree.',{path:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16000}},['path']),
  tool('workspace_write','Create or replace a UTF-8 file in this agent worktree. Read existing content first. Cannot change Git internals or HeloScrum/provider configuration.',{path:{type:'string'},content:{type:'string',maxLength:256000}},['path','content']),
  tool('workspace_command','Request human permission to run a shell command in this worktree. Each command needs approval; permissions do not persist.',{command:{type:'string',maxLength:4000}},['command'])
];
export async function workspacePath(task,value,{write=false}={}){
  value=value||'.';assert(typeof value==='string'&&!value.includes('\0'),'Invalid workspace path');
  const root=await realpath(task.path),file=path.resolve(root,value);assert(inside(root,file),'Path must stay inside this worktree',403);
  const relative=path.relative(root,file),segments=relative.split(path.sep);
  assert(!segments.some(s=>['.git','.heloscrum','.cursor','.kiro','.codex','.aws','.ssh'].includes(s)),'Agent or credential configuration is not available through workspace tools',403);
  assert(!segments.some(s=>s==='.env'||s.startsWith('.env.')&&!s.endsWith('.example')),'Environment secrets are not available through workspace tools',403);
  // Verify every existing ancestor before creating directories or following symlinks.
  let current=root;
  for(const segment of segments.filter(Boolean)){
    current=path.join(current,segment);
    try{assert(!(await lstat(current)).isSymbolicLink()&&inside(root,await realpath(current)),'Symlink paths are not available through workspace tools',403);}catch(e){if(e.code==='ENOENT'&&write)break;throw e;}
  }
  return file;
}
export async function workspaceCall(task,name,input,{approve,signal}={}){
  if(name==='workspace_command'){
    const command=string(input.command,'shell command',4000);assert(await approve(command),'The user denied this command',403);
    const output=await run(process.platform==='win32'?'cmd.exe':'/bin/sh',process.platform==='win32'?['/c',command]:['-lc',command],{cwd:task.path,signal,timeout:60000,maxBuffer:1024*1024});return {output,exitCode:0};
  }
  const file=await workspacePath(task,input.path,{write:name==='workspace_write'});
  if(name==='workspace_list'){const items=await readdir(file,{withFileTypes:true});return {entries:items.filter(e=>!['.git','.heloscrum','.cursor','.kiro','.codex','.aws','.ssh'].includes(e.name)).slice(0,500).map(e=>({name:e.name,directory:e.isDirectory(),symlink:e.isSymbolicLink()})),truncated:items.length>500};}
  if(name==='workspace_read'){
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let text;
    try{const stat=await handle.stat();assert(stat.isFile()&&stat.size<=2*1024*1024,'Read a regular file no larger than 2 MiB',413);text=await handle.readFile('utf8');}finally{await handle.close();}
    const offset=input.offset??0,limit=input.limit??8000;
    assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>0&&limit<=16000,'Invalid file page');
    return {path:input.path,text:text.slice(offset,offset+limit),offset,nextOffset:offset+limit<text.length?offset+limit:null,totalCharacters:text.length};
  }
  assert(name==='workspace_write','Unknown workspace tool');assert(typeof input.content==='string'&&input.content.length<=256000,'File content must fit within 256,000 characters');
  await mkdir(path.dirname(file),{recursive:true});await workspacePath(task,input.path,{write:true});
  const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o644);
  try{assert((await handle.stat()).isFile(),'Write a regular workspace file',403);await handle.truncate(0);await handle.writeFile(input.content);}finally{await handle.close();}
  return {path:input.path,writtenBytes:Buffer.byteLength(input.content)};
}
