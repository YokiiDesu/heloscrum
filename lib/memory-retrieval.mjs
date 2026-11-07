import {assert} from './adapters.mjs';
import {sourcePage,sourceHash,sourceBudget} from './source-pages.mjs';

export const HISTORY_SEARCH_BUDGET={recent:80,lexical:40};
const searchStopWords=new Set('a an the is are was were be been do does did can could should would i we you it its this that these those to of in on for from with and or at as by about how what when where why'.split(' '));
export const memorySearchTerms=query=>[...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_./-]+/u).filter(t=>t&&!searchStopWords.has(t)))].slice(0,12);

// Preserve relevance order within a record, but give other records and kinds a
// turn before spending the bounded budget on more versions/windows of one.
export function historySourceOrder(rows,sourceOf=row=>row.source){
  const weave=queues=>{const result=[];for(let i=0;i<Math.max(0,...queues.map(q=>q.length));i++)for(const queue of queues)if(queue[i])result.push(queue[i]);return result;};
  const kinds=new Map();
  for(const row of rows){const source=sourceOf(row),kind=source.recordKind||source.kind,records=kinds.get(kind)||new Map(),key=source.recordId||JSON.stringify(source),versions=records.get(key)||[];versions.push(row);records.set(key,versions);kinds.set(kind,records);}
  return weave([...kinds.values()].map(records=>weave([...records.values()])));
}

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

// Retrieval conversations quote the search question, sometimes again inside a
// tool's returned matches. Those copies are not independent evidence. Mask only
// explicit query fields in retrieval records, keeping character offsets and the
// original source intact. Reports about searches keep their explanatory text.
const jsonString='"(?:\\\\.|[^"\\\\])*"';
const mask=value=>value.replace(/[^\r\n]/g,' ');
export function historyRankingText(row){
  const text=historyText(row);
  if(!/(?:memory_search|context_search|\b(?:historyBefore|retrieval|History search)\b)/i.test(text))return text;
  // Also recognize quoted queries inside JSON-encoded message text and inline
  // code. Match the same escaping depth at both ends of the quoted value.
  let ranked=text.replace(/\b(query(?:\\*"|')?\s*(?:[:=]\s*)?)(\\*["'`])([\s\S]*?)(?<!\\)\2/gi,(_m,key,quote,value)=>key+mask(quote+value+quote));
  ranked=ranked.replace(/\b(query\s*(?:[:=]\s*)?)(“[^”]*”)/gi,(_m,key,value)=>key+mask(value));
  const event=row.kind==='transcript'&&row.body.event;
  if(event&&/(?:^|__)\w*(?:memory_search|context_search)$/.test(event.name||'')){
    // A search tool's text fields echo retrieved passages. Keep its name and
    // receipt metadata searchable, but rank the original sources themselves.
    ranked=ranked.replace(new RegExp('("text"\\s*:\\s*)('+jsonString+')','g'),(_m,key,value)=>key+mask(value));
  }
  return ranked;
}
