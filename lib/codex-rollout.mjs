import { readdir,readFile,realpath,stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assert,inside } from './adapters.mjs';
import { responseStates } from './agent-state.mjs';
import {thinkingEvent,reasoningSummary} from './thinking-events.mjs';
const files=new Map();
export function rolloutEvents(records){
  const events=[],calls=new Map();let turnId='initial',model,effort;
  for(const [index,row] of records.entries()){
    if(row.type==='turn_context'){turnId=row.payload?.turn_id||row.payload?.turnId||String(index);model=row.payload?.model;effort=row.payload?.effort??row.payload?.collaboration_mode?.settings?.reasoning_effort;}
    if(row.type!=='response_item')continue;
    const p=row.payload,base={id:p.id||`rollout:${index}`,at:row.timestamp,turnId,...(model&&p.role!=='user'?{model,effort:effort||null}:{})};
    if(p.type==='message'&&['user','assistant'].includes(p.role)){
      const text=(p.content||[]).filter(c=>['text','input_text','output_text'].includes(c.type)).map(c=>c.text).join('\n');
      if(text)events.push({...base,type:'message',role:p.role,text});
    }else if(p.type==='reasoning'){
      events.push(thinkingEvent(base,reasoningSummary(p.summary),{summary:true}));
    }else if(['function_call','custom_tool_call'].includes(p.type)){
      const event={...base,type:'tool',name:p.name,input:p.arguments??p.input??'',output:'',status:'running'};events.push(event);calls.set(p.call_id,event);
    }else if(['function_call_output','custom_tool_call_output'].includes(p.type)){
      let event=calls.get(p.call_id);if(!event){event={...base,type:'tool',name:'Tool result',input:''};events.push(event);}
      event.output=typeof p.output==='string'?p.output:JSON.stringify(p.output);event.status='completed';
      try{event.failed=JSON.parse(event.output).isError===true;if(event.failed)event.status='failed';}catch{}
    }
  }
  return responseStates(events);
}
export async function readCodexRollout(task,root=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'sessions')){
  assert(/^[a-f0-9-]{36}$/.test(task.providerSessionId),'Codex session identifier is missing',409);
  const base=await realpath(root),cacheKey=base+':'+task.providerSessionId;let file=files.get(cacheKey);
  if(!file){
    const matches=[];
    async function visit(dir,depth){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isDirectory()&&depth<3)await visit(path.join(dir,entry.name),depth+1);else if(entry.isFile()&&entry.name.endsWith('-'+task.providerSessionId+'.jsonl'))matches.push(path.join(dir,entry.name));}}
    await visit(base,0);assert(matches.length===1,'Exact Codex rollout is not available',404);file=await realpath(matches[0]);assert(inside(base,file),'Unexpected rollout path',403);files.set(cacheKey,file);
  }
  file=await realpath(file);assert(inside(base,file),'Unexpected rollout path',403);
  assert((await stat(file)).size<=64*1024*1024,'Codex history exceeds the 64 MiB import limit',413);
  const lines=(await readFile(file,'utf8')).split('\n'),records=[];
  for(const [i,line] of lines.entries()){if(!line.trim())continue;try{records.push(JSON.parse(line));}catch{assert(i===lines.length-1,'Codex history contains an invalid record',409);}}
  const meta=records.find(r=>r.type==='session_meta')?.payload;
  assert(meta?.id===task.providerSessionId&&await realpath(meta.cwd)===await realpath(task.path),'Session does not belong to this worktree',403);
  const context=records.findLast(r=>r.type==='turn_context'&&r.payload?.model);
  return {...(context?{model:context.payload.model,effort:context.payload.effort??context.payload.collaboration_mode?.settings?.reasoning_effort??null,modelObservedAt:context.timestamp||null}:{}),sessionId:task.providerSessionId,source:'Codex session history (local rollout)',events:rolloutEvents(records)};
}
