import {mkdir,readFile,writeFile,realpath,lstat,open,appendFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {thinkingEvent} from './thinking-events.mjs';
import {assert,inside,run} from './adapters.mjs';

export async function cursorLaunchConfig(task,server){
  const root=await realpath(task.path),dir=path.join(root,'.cursor'),file=path.join(dir,'mcp.json');
  await mkdir(dir,{recursive:true});assert(!(await lstat(dir)).isSymbolicLink()&&inside(root,await realpath(dir)),'Cursor settings must stay inside the worktree',403);
  let config={};try{assert(!(await lstat(file)).isSymbolicLink(),'Cursor MCP settings cannot be a symlink',403);config=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  assert(config&&typeof config==='object'&&!Array.isArray(config),'Invalid Cursor MCP settings');
  config.mcpServers||={};
  const existing=config.mcpServers.heloscrum;
  assert(!existing||existing.command===server.command&&JSON.stringify(existing.args)===JSON.stringify(server.args),'An existing Cursor MCP named heloscrum uses different settings. Rename it before connecting.',409);
  config.mcpServers.heloscrum=server;
  const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(JSON.stringify(config,null,2)+'\n');}finally{await handle.close();}
  const exclude=(await run('git',['rev-parse','--path-format=absolute','--git-path','info/exclude'],{cwd:root})).trim();
  await mkdir(path.dirname(exclude),{recursive:true});let ignored='';try{ignored=await readFile(exclude,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!ignored.split('\n').includes('/.cursor/mcp.json'))await appendFile(exclude,'\n/.cursor/mcp.json\n');
  return [];
}
export const cursorArgs=(task,text)=>['--print','--output-format','stream-json','--sandbox','enabled','--trust','--workspace',task.path,'--resume',task.providerSessionId,...(task.model?['--model',task.model]:[]),text];
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
export async function cursorInteractiveArgs(task,{executable,resumeSessionId,hookCommand,execute=run}={}){
  const id=resumeSessionId||task.providerSessionId||(await execute(executable,['create-chat'],{cwd:task.path,timeout:30000})).trim();
  assert(uuid(id),'Cursor did not return a valid chat ID. Check Cursor CLI login.',502);task.providerSessionId=id;
  if(hookCommand){
    const file=path.join(task.path,'.cursor/hooks.json');let config={version:1,hooks:{}};
    try{assert(!(await lstat(file)).isSymbolicLink(),'Cursor hooks cannot be a symlink',403);config=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    assert(config.version===1&&config.hooks&&typeof config.hooks==='object'&&!Array.isArray(config.hooks),'Unsupported Cursor hook configuration');
    for(const event of ['sessionStart','beforeSubmitPrompt','afterAgentResponse','postToolUse','stop']){
      const list=config.hooks[event]||[];assert(Array.isArray(list),'Invalid Cursor hooks');
      if(!list.some(h=>h.command===hookCommand))list.push({command:hookCommand});config.hooks[event]=list;
    }
    const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(JSON.stringify(config,null,2)+'\n');}finally{await handle.close();}
    const exclude=(await execute('git',['rev-parse','--path-format=absolute','--git-path','info/exclude'],{cwd:task.path})).trim();
    let ignored='';try{ignored=await readFile(exclude,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!ignored.split('\n').includes('/.cursor/hooks.json'))await appendFile(exclude,'\n/.cursor/hooks.json\n');
  }
  // No print, trust, force, yolo, or MCP auto-approval in interactive mode.
  return ['--sandbox','enabled','--workspace',task.path,'--resume',id,...(task.model?['--model',task.model]:[])];
}

export function cursorTranscriptRoot(cwd,home=os.homedir()){
  const key=cwd.replace(/[^a-zA-Z0-9]/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'');
  return path.join(home,'.cursor/projects',key,'agent-transcripts');
}
export async function validateCursorTranscript(task,filename,home){
  assert(uuid(task.providerSessionId),'Cursor session identifier is missing',409);
  const base=await realpath(cursorTranscriptRoot(await realpath(task.path),home)),file=await realpath(filename);
  assert(inside(base,file)&&path.basename(file)===task.providerSessionId+'.jsonl','Unexpected Cursor transcript path',403);
  const relative=path.relative(base,file);assert(relative===task.providerSessionId+'.jsonl'||relative===path.join(task.providerSessionId,task.providerSessionId+'.jsonl'),'Unexpected Cursor transcript directory',403);return file;
}
export function cursorHistoryItems(records){
  const events=[],calls=new Map(),seen=new Set();
  for(const [index,row] of records.entries()){
    const role=row.role||row.type,key=row.uuid||row.id||String(index)+':'+createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0,16);
    if(seen.has(key))continue;seen.add(key);
    if(row.type==='tool_call'){const event=cursorEvent(row);if(event){const old=calls.get(event.id);if(old)Object.assign(old,event);else{events.push(event);calls.set(event.id,event);}}continue;}
    if(!['user','assistant'].includes(role))continue;
    const content=row.message?.content??row.content;
    for(const [i,item] of (typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[]).entries()){
      if(item.type==='text')events.push({id:key+':'+i,type:'message',role,text:item.text,at:row.timestamp});
      if(role==='assistant'&&['thinking','redacted_thinking'].includes(item.type))events.push(thinkingEvent({id:key+':'+i,at:row.timestamp,status:'completed'},item.thinking,{redacted:item.type==='redacted_thinking'}));
      if(item.type==='tool_use'){const event={id:item.id||key+':'+i,type:'tool',name:item.name,input:JSON.stringify(item.input??{}),output:'',status:'unknown',at:row.timestamp};events.push(event);if(item.id)calls.set(item.id,event);}
      if(item.type==='tool_result'){const event=calls.get(item.tool_use_id);if(event)Object.assign(event,{output:typeof item.content==='string'?item.content:JSON.stringify(item.content),status:item.is_error?'failed':'completed'});}
    }
  }
  return events;
}
export async function readCursorSession(task,{full=false,home=os.homedir()}={}){
  assert(uuid(task.providerSessionId),'Cursor session identifier is missing',409);const cwd=await realpath(task.path);
  const candidate=task.transcriptPath||path.join(cursorTranscriptRoot(cwd,home),task.providerSessionId,task.providerSessionId+'.jsonl');
  let file;try{file=await validateCursorTranscript(task,candidate,home);}catch(error){if(error.code==='ENOENT')throw Object.assign(Error('Waiting for Cursor to save its transcript. Use the native terminal to complete login and approvals; transcripts must be enabled.'),{status:409});throw error;}
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let text;
  try{const meta=await handle.stat();assert(meta.isFile()&&meta.size<32*1024*1024,'Cursor history exceeds the 32 MiB reader limit',413);text=await handle.readFile('utf8');}finally{await handle.close();}
  const lines=text.split('\n'),records=[];
  for(const [i,line] of lines.entries()){if(!line.trim())continue;try{const row=JSON.parse(line);assert(!row.session_id||row.session_id===task.providerSessionId,'Cursor session mismatch',403);assert(!row.conversation_id||row.conversation_id===task.providerSessionId,'Cursor session mismatch',403);records.push(row);}catch(error){if(error instanceof SyntaxError&&i===lines.length-1)break;throw error;}}
  const events=cursorHistoryItems(records);return {sessionId:task.providerSessionId,source:'Cursor native session history',events:full?events:events.slice(-250)};
}
export function cursorEvent(row){
  if(row.type==='assistant'){
    const text=typeof row.message?.content==='string'?row.message.content:(row.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    return text?{id:row.message?.id||row.request_id,type:'message',role:'assistant',text}:null;
  }
  if(row.type!=='tool_call')return null;
  const [name,call]=Object.entries(row.tool_call||{})[0]||['Tool',{}],fn=row.tool_call?.function;
  return {id:row.call_id,type:'tool',name:fn?.name||name.replace(/ToolCall$/,''),input:typeof fn?.arguments==='string'?fn.arguments:JSON.stringify(call.args||{}),output:call.result?JSON.stringify(call.result):'',status:row.subtype==='completed'?(call.result?.error?'failed':'completed'):'running'};
}

export function cursorEvents(row){
  const content=row.message?.content,baseId=row.message?.id||row.uuid||row.id;
  const thoughts=row.type==='assistant'&&Array.isArray(content)?content.flatMap((part,index)=>
    ['thinking','redacted_thinking'].includes(part.type)?[thinkingEvent({id:baseId?baseId+':thinking:'+index:undefined,at:row.timestamp,status:'completed'},part.thinking,{redacted:part.type==='redacted_thinking'})]:[]):[];
  const event=cursorEvent(row);return [...thoughts,...(event?[event]:[])];
}
