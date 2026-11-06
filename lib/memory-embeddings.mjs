import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {assert} from './adapters.mjs';
import {atomicPrivateWrite,privateDirectory} from './private-files.mjs';
import {EMBEDDING_MODEL,EMBEDDING_DIMENSION,cosine,validVector} from './voyage-embeddings.mjs';

export const EMBEDDING_POLICY={version:1,model:EMBEDDING_MODEL,dimension:EMBEDDING_DIMENSION,chunkChars:950,groupBytes:20000,documentCalls:4,searchMs:15000,minuteCalls:30,indexChunks:1024,cacheGroups:128};
export const memoryHash=text=>createHash('sha256').update(text).digest('hex');
// Prefer paragraph/line boundaries, preserve exact offsets and Unicode. Adjacent
// chunks are contextualized together; overlap needlessly bills the same text twice.
export function memoryChunks(text){
  const chunks=[];let offset=0;
  while(offset<text.length){let end=Math.min(text.length,offset+EMBEDDING_POLICY.chunkChars);
    if(end<text.length){const paragraph=text.lastIndexOf('\n\n',end-1),line=text.lastIndexOf('\n',end-1);if(paragraph>offset+450)end=paragraph+2;else if(line>offset+450)end=line+1;if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;}
    chunks.push({offset,end,text:text.slice(offset,end)});offset=end;
  }return chunks;
}
const localResult=(candidates,limit,reason)=>{const local=candidates.filter(c=>c.score>0).sort((a,b)=>Number(!!b.exact)-Number(!!a.exact)||b.score-a.score);return {matches:local.slice(0,limit),more:local.length>limit,method:'exact references + keyword passages',ranking:{status:reason?'fallback':'local',...(reason?{reason}:{})}};};
export const referenceQuery=query=>/^[a-f\d]{32,64}$/i.test(query)||/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(query)||/^\d+$/.test(query)||/^(?:[A-Za-z]:)?[\w.\/-]+[\/\\][\w.\/-]+$/.test(query);

export class MemoryEmbeddings {
  constructor(plane){this.plane=plane;this.caches=new Map();this.busy=new Set();this.calls=[];this.cooldowns=new Map();}
  enabled(input={}){return input.ranking!=='local'&&!!this.plane.data.contextSettings?.memoryEmbeddingConnectionId;}
  connection(){const id=this.plane.data.contextSettings?.memoryEmbeddingConnectionId,c=id&&this.plane.ai.get(id);assert(c&&c.kind==='voyage'&&!c.archivedAt&&c.model===EMBEDDING_MODEL,'Embedding connection unavailable',409);return c;}
  async cache(task){
    assert(/^[\w-]{1,80}$/.test(task.id),'Invalid memory identity');
    const owner=memoryHash(task.project+'\0'+task.id),dir=path.join(this.plane.root,'.heloscrum/agents',task.id,'embeddings'),file=path.join(dir,'index.json');
    if(this.caches.has(owner))return this.caches.get(owner);
    let entries=[];try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved?.owner===owner&&saved.version===EMBEDDING_POLICY.version&&saved.model===EMBEDDING_MODEL&&saved.dimension===EMBEDDING_DIMENSION&&Array.isArray(saved.entries))entries=saved.entries.filter(row=>Array.isArray(row)&&row.length===2&&/^[a-f0-9]{64}$/.test(row[0])&&Array.isArray(row[1])&&row[1].length>0&&row[1].length<=64&&row[1].every(validVector)).slice(-EMBEDDING_POLICY.cacheGroups);}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
    const cache={owner,dir,file,groups:new Map(entries),queries:new Map()};this.caches.set(owner,cache);while(this.caches.size>4)this.caches.delete(this.caches.keys().next().value);return cache;
  }
  async save(cache){
    while(cache.groups.size>EMBEDDING_POLICY.cacheGroups)cache.groups.delete(cache.groups.keys().next().value);
    await privateDirectory(cache.dir);await atomicPrivateWrite(cache.file,JSON.stringify({owner:cache.owner,version:EMBEDDING_POLICY.version,model:EMBEDDING_MODEL,dimension:EMBEDDING_DIMENSION,entries:[...cache.groups]}));
  }
  async embed(task,c,inputs,type,signal,usage){
    this.calls=this.calls.filter(t=>Date.now()-t<60000);assert(this.calls.length<EMBEDDING_POLICY.minuteCalls,'Embedding request rate budget reached',429);this.calls.push(Date.now());
    const evaluation={policy:EMBEDDING_POLICY,inputType:type,inputSha256:memoryHash(JSON.stringify(inputs)),inputBytes:Buffer.byteLength(JSON.stringify(inputs)),groups:inputs.length,chunks:inputs.reduce((n,d)=>n+d.length,0)};
    const attempt=usage.length;usage.push(null);
    const result=await this.plane.context.measuredCall(task,'memory-embedding-'+type,c.id,()=>this.plane.ai.embed(c.id,inputs,type,{signal}),evaluation);
    usage[attempt]=result.usage;return result.vectors;
  }
  async rank(task,query,documents,candidates,limit){
    // IDs, paths and content hashes are deterministic lookups, with no paid call.
    const exact=candidates.filter(c=>c.exact);if(exact.length)return {...localResult(exact,limit),method:'exact references',ranking:{status:'local',reason:'exact-reference'}};
    if(referenceQuery(query))return {...localResult(candidates,limit),method:'exact references + keyword passages',ranking:{status:'local',reason:'reference-query'}};
    const fallback=(reason,usage=[])=>({...localResult(candidates,limit,reason),ranking:{status:'fallback',reason,calls:usage.length,usage}});
    let c;try{c=this.connection();}catch{return fallback('connection-unavailable');}
    if(this.busy.has(task.id)||this.busy.size>=2)return fallback('busy');
    const connectionVersion=c.id+':'+c.revision;
    if((this.cooldowns.get(connectionVersion)||0)>Date.now())return fallback('service-cooldown');
    this.busy.add(task.id);const usage=[];
    try{
      const cache=await this.cache(task),groups=[];let totalChunks=0;
      for(const doc of documents){
        const chunks=memoryChunks(doc.body);totalChunks+=chunks.length;
        let current=[],bytes=0;
        const finish=()=>{if(!current.length)return;const key=memoryHash(JSON.stringify({model:EMBEDDING_MODEL,version:EMBEDDING_POLICY.version,sha256:doc.sha256,title:doc.title,chunks:current.map(c=>[c.offset,c.end])}));groups.push({key,doc,chunks:current});current=[];bytes=0;};
        for(const chunk of chunks){const n=Buffer.byteLength(JSON.stringify(chunk.text));if(bytes+n>EMBEDDING_POLICY.groupBytes||current.length>=48)finish();current.push(chunk);bytes+=n;}finish();
      }
      if(!groups.length)return localResult(candidates,limit);
      // Cached groups do not consume inference budget. Prioritize keyword-relevant
      // sources when first indexing, then progressively fill the remaining corpus.
      const priority=new Map(candidates.map(c=>[c.sha256,c.score]));groups.sort((a,b)=>(priority.get(b.doc.sha256)||0)-(priority.get(a.doc.sha256)||0));
      const selected=[];let chunks=0;for(const group of groups){if(selected.length>=EMBEDDING_POLICY.cacheGroups||chunks+group.chunks.length>EMBEDDING_POLICY.indexChunks)continue;selected.push(group);chunks+=group.chunks.length;}
      for(const group of selected)if(cache.groups.has(group.key)&&cache.groups.get(group.key).length!==group.chunks.length)cache.groups.delete(group.key);
      const signal=AbortSignal.timeout(EMBEDDING_POLICY.searchMs);
      let documentCalls=0,dirty=false;
      const pending=selected.filter(g=>!cache.groups.has(g.key));
      while(pending.length&&documentCalls<EMBEDDING_POLICY.documentCalls){
        const batch=[];let bytes=0;
        while(pending.length&&batch.length<32){const group=pending[0],size=Buffer.byteLength(JSON.stringify(group.chunks.map(c=>c.text)));if(batch.length&&bytes+size>24000)break;batch.push(pending.shift());bytes+=size;}
        const vectors=await this.embed(task,c,batch.map(g=>g.chunks.map(c=>c.text)),'document',signal,usage);documentCalls++;batch.forEach((g,i)=>cache.groups.set(g.key,vectors[i]));dirty=true;
        // Persist successful windows immediately; an interrupted search resumes
        // from them without rebilling the completed document requests.
        await this.save(cache);
      }
      const available=selected.filter(g=>cache.groups.has(g.key));if(!available.length)return fallback('index-pending',usage);
      const queryKey=memoryHash(c.id+'\0'+query);let vector=cache.queries.get(queryKey),queryCacheHit=!!vector;
      if(!vector){[[vector]]=await this.embed(task,c,[[query]],'query',signal,usage);cache.queries.set(queryKey,vector);while(cache.queries.size>64)cache.queries.delete(cache.queries.keys().next().value);}
      const matches=[];
      for(const group of available){const vectors=cache.groups.get(group.key);if(vectors.length!==group.chunks.length)continue;for(let i=0;i<vectors.length;i++){const {body,...doc}=group.doc;matches.push({...doc,...group.chunks[i],similarity:cosine(vector,vectors[i]),score:0,exact:false});}}
      matches.sort((a,b)=>b.similarity-a.similarity||a.offset-b.offset);const seen=new Set(),ranked=matches.filter(m=>{const key=JSON.stringify(m.source);if(seen.has(key))return false;seen.add(key);return true;});
      const indexedChunks=available.reduce((n,g)=>n+g.chunks.length,0);
      return {matches:ranked.slice(0,limit),more:ranked.length>limit,method:'Voyage contextual embeddings',ranking:{status:'embedded',model:EMBEDDING_MODEL,cacheHit:!dirty&&queryCacheHit,calls:usage.length,usage,indexedChunks,totalChunks,partial:indexedChunks<totalChunks,indexPending:available.length<selected.length,indexLimited:chunks<totalChunks,note:'Similarity ranks passages; it does not prove an answer exists or that a claim is correct. Index coverage applies to this authorized source batch.'}};
    }catch(e){this.cooldowns.set(connectionVersion,Date.now()+60000);return fallback(e.status===429?'rate-budget':['AbortError','TimeoutError'].includes(e.name)?'service-timeout':e.code&&['EACCES','ENOSPC','EROFS'].includes(e.code)?'cache-unavailable':'service-unavailable',usage);}
    finally{this.busy.delete(task.id);}
  }
}
