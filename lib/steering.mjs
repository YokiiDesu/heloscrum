import {readFile,mkdir,realpath,lstat,open,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {assert,inside,run} from './adapters.mjs';
import {constants} from 'node:fs';

export const hookCommand=(...args)=>args.map(value=>process.platform==='win32'?`"${value.replaceAll('"','\\"')}"`:"'"+value.replaceAll("'","'\\''")+"'").join(' ');
export const isSteering=message=>message.sessionPrompt&&message.promptMode==='steer';
export function promptBatch(messages){
  const batch=[];let size=0,attachments=0;
  for(const message of messages){
    const length=message.text.length+400,count=message.attachments?.length||0;
    if(batch.length&&(size+length>20000||batch.length>=8||attachments+count>4))break;
    batch.push(message);size+=length;attachments+=count;
  }
  return batch;
}

// The native CLI only accepts administrator-owned system defaults. Install a
// narrowly scoped workspace hook instead, preserving existing native settings.
export async function geminiSteeringConfig(workspace,command){
  const root=await realpath(workspace),directory=path.join(root,'.gemini'),filename=path.join(directory,'settings.json');
  await mkdir(directory,{recursive:true});
  assert(!(await lstat(directory)).isSymbolicLink()&&inside(root,await realpath(directory)),'Gemini settings must stay inside the worktree',403);
  let settings={};
  try{assert(!(await lstat(filename)).isSymbolicLink(),'Gemini settings cannot be a symlink',403);settings=JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  assert(settings&&typeof settings==='object'&&!Array.isArray(settings),'Invalid Gemini workspace settings');
  settings.hooks ||= {};const hooks=settings.hooks.BeforeModel||[];assert(Array.isArray(hooks),'Invalid Gemini BeforeModel hooks');
  if(hooks.some(group=>group.hooks?.some(h=>h.command===command)))return;
  settings.hooks.BeforeModel=[...hooks,{hooks:[{name:'heloscrum-steering',type:'command',command,timeout:10000}]}];
  const handle=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(JSON.stringify(settings,null,2)+'\n');}finally{await handle.close();}
  let exclude;
  try{exclude=(await run('git',['rev-parse','--path-format=absolute','--git-path','info/exclude'],{cwd:root})).trim();}catch(error){if(error.code===128)return;throw error;}
  let ignored='';try{ignored=await readFile(exclude,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!ignored.split('\n').includes('/.gemini/settings.json'))await appendFile(exclude,'\n/.gemini/settings.json\n');
}

export function steeringHookOutput(provider,text,hook){
  if(provider!=='gemini')return {additional_context:text};
  // Gemini 0.67 merges this text view back into the original SDK contents,
  // preserving tool calls, tool results, images and thought signatures. Never
  // override model/config or rebuild its multimodal conversation ourselves.
  const messages=hook?.llm_request?.messages;
  assert(Array.isArray(messages),'Gemini did not supply the native model request');
  return {hookSpecificOutput:{hookEventName:'BeforeModel',llm_request:{messages:[...messages,{role:'user',content:text}]}}};
}
