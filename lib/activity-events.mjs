import {atomicPrivateWrite} from './private-files.mjs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {assert} from './adapters.mjs';

const uuid=/^[a-f0-9-]{36}$/i, idPattern=/^[\w:.-]{1,160}$/;
const text={type:'string',maxLength:12000};
export const ACTIVITY_TOOL={name:'activity_report',description:'Claude activity bridge: record observed tool progress or context measurements for your current session. This does not approve work, change permissions, or notify another agent.',inputSchema:{type:'object',properties:{sessionId:{type:'string'},id:{type:'string',maxLength:160},sequence:{type:'integer',minimum:0},kind:{type:'string',enum:['tool','context','session']},status:{type:'string',enum:['running','completed','failed','denied','connected']},name:{type:'string',maxLength:160},input:text,output:text,durationMs:{type:'number',minimum:0},context:{type:'object',properties:{tokens:{type:'number',minimum:0},window:{type:'number',minimum:1},percent:{type:'number',minimum:0,maximum:100}},additionalProperties:false}},required:['sessionId','id','sequence','kind','status'],additionalProperties:false}};

export function testSummary(output){
  // Only a complete Node TAP summary. Ordinary prose and a successful shell
  // exit are not evidence of a passing test suite or accepted task.
  const number=key=>{const hits=[...String(output||'').matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];return hits.length===1?Number(hits[0][1]):null;};
  const total=number('tests'),passed=number('pass'),failed=number('fail'),skipped=number('skipped'),cancelled=number('cancelled'),todo=number('todo');
  if([total,passed,failed,skipped,cancelled,todo].some(n=>n===null||!Number.isSafeInteger(n))||passed+failed+skipped+cancelled+todo!==total)return null;
  return {total,passed,failed,skipped,cancelled,todo,format:'Node TAP'};
}

export class ActivityEvents {
  constructor(plane){this.plane=plane;this.queue=Promise.resolve();}
  file(task){assert(uuid.test(task.id)&&uuid.test(task.providerSessionId),'Invalid activity identity');return path.join(this.plane.root,'.heloscrum/agents',task.id,'activity',task.providerSessionId+'.json');}
  async read(task){
    if(task.kind!=='claude'||!task.providerSessionId)return [];
    let record;try{record=JSON.parse(await readFile(this.file(task),'utf8'));}catch(error){if(error.code==='ENOENT')return [];throw error;}
    assert(record.taskId===task.id&&record.project===task.project&&record.sessionId===task.providerSessionId,'Activity session mismatch',403);return record.events;
  }
  report(task,input){
    const pending=this.queue.catch(()=>{}).then(async()=>{
      assert(task.kind==='claude'&&!task.external&&input.sessionId===task.providerSessionId,'Activity must belong to your current Claude session',403);
      assert(idPattern.test(input.id)&&Number.isSafeInteger(input.sequence)&&input.sequence>=0,'Invalid activity event');
      assert(['tool','context','session'].includes(input.kind)&&['running','completed','failed','denied','connected'].includes(input.status),'Invalid activity state');
      const event={id:input.kind==='tool'?input.id:'activity:'+input.id,eventId:input.id,type:'activity',kind:input.kind,provider:'claude',sessionId:input.sessionId,sequence:input.sequence,status:input.status,provenance:'Claude Code Mod'};
      for(const key of ['name','input','output'])if(input[key]!==undefined){assert(typeof input[key]==='string'&&input[key].length<=(key==='name'?160:12000),'Activity text is too large');event[key]=input[key];}
      if(input.durationMs!==undefined){assert(Number.isFinite(input.durationMs)&&input.durationMs>=0&&input.durationMs<=86400000,'Invalid activity duration');event.durationMs=input.durationMs;}
      if(input.kind==='context'){
        assert(input.context&&typeof input.context==='object','Context measurements are required');event.context={};
        for(const key of ['tokens','window','percent'])if(input.context[key]!==undefined){const n=input.context[key];assert(Number.isFinite(n)&&n>=(key==='window'?1:0)&&n<=(key==='percent'?100:100000000),'Invalid context measurement');event.context[key]=n;}
      }
      const events=await this.read(task),previous=events.find(e=>e.id===event.id);
      if(previous&&previous.sequence>=event.sequence)return {recorded:false,id:event.id};
      if(previous)assert(previous.kind===event.kind,'Activity kind cannot change');
      const now=new Date().toISOString();event.at=previous?.at||now;event.updatedAt=now;
      const next=events.filter(e=>e.id!==event.id);next.push(event);next.sort((a,b)=>a.at.localeCompare(b.at));
      const file=this.file(task);await mkdir(path.dirname(file),{recursive:true,mode:0o700});
      await atomicPrivateWrite(file,JSON.stringify({taskId:task.id,project:task.project,sessionId:task.providerSessionId,events:next.slice(-256)}));
      this.plane.transcripts?.cache.delete(task.id);return {recorded:true,id:event.id};
    });this.queue=pending;return pending;
  }
}

export function mergeActivity(events,activity){
  const native=new Map(events.filter(e=>e.type==='tool').map(e=>[e.id,e]));
  const toolIds=new Set(activity.filter(e=>e.kind==='tool').map(e=>e.eventId));
  return [...events.filter(e=>e.type!=='tool'||!toolIds.has(e.id)),...activity.map(event=>{
    const tool=event.kind==='tool'&&native.get(event.eventId);
    const next=tool?{...event,id:tool.id,at:tool.at||event.at,input:tool.input||event.input,output:tool.output||event.output,status:tool.status&&tool.status!=='running'?tool.status:event.status}:event;
    return {...next,...(next.kind==='tool'?{tests:testSummary(next.output)}:{})};
  })].sort((a,b)=>(a.at||'').localeCompare(b.at||''));
}
