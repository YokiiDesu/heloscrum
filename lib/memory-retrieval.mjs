import {assert} from './adapters.mjs';
import {sourcePage,sourceHash,sourceBudget} from './source-pages.mjs';

export function sharedMemoryPage(notes,input,plane){
  const offset=input.offset??0,limit=input.limit??10;
  assert(Number.isInteger(offset)&&offset>=0,'Use a nonnegative offset');
  if(!input.key){assert(Number.isInteger(limit)&&limit>=1&&limit<=20,'List at most 20 shared notes');const list=notes.slice(offset,offset+limit).map(({key,revision,author,at,text})=>({key,revision,author,at,totalCharacters:text.length,retrieve:{tool:'memory_read',input:{key}}}));return {notes:list,total:notes.length,nextOffset:offset+list.length<notes.length?offset+list.length:null,note:'Index only. Read a key or use memory_search for relevant passages.'};}
  const note=notes.find(n=>n.key===input.key);if(!note)return {notes:[]};
  assert(input.revision===undefined||input.revision===note.revision,'Shared note changed; search History for the recorded revision or read the current contract',409);
  assert(offset===0||input.revision===note.revision,'Continue shared memory with the returned revision',409);
  if(input.sinceRevision!==undefined){assert(Number.isInteger(input.sinceRevision)&&input.sinceRevision>=0&&input.sinceRevision<=note.revision,'Use an existing shared note revision');if(input.sinceRevision===note.revision)return {key:note.key,revision:note.revision,changed:false,notes:[{key:note.key,revision:note.revision}],note:'Unchanged. Reuse this revision only if its content remains available in your current context.'};}
  const {key,revision,author,at,text}=note;
  return sourcePage(text,{key,revision,author,at,notes:[{key,revision,author}],sha256:sourceHash(text),offset,limit:input.limit??8000,budget:sourceBudget(plane)});
}
export function historyText(row){
  const b=row.body;
  if(row.kind==='memory')return b.text||'';
  if(row.kind==='message')return b.text||'';
  if(row.kind==='transcript'){const e=b.event||{};return [e.name,e.text,e.input,e.output].filter(v=>typeof v==='string'&&v).join('\n');}
  if(row.kind==='work-plan')return [b.title,b.instructions,b.planText,...(b.items||[]).map(i=>[i.title,i.description,i.acceptance,i.note].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
  return [b.title,b.prompt,b.summary].filter(Boolean).join('\n');
}
