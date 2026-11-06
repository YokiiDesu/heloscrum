import {readFile,mkdir,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {assert,string} from './adapters.mjs';
import {atomicPrivateWrite,writePrivateFile} from './private-files.mjs';
import {writeVerifiedSource} from './source-download.mjs';
import {sourcePage,sourceHash,sourceBudget} from './source-pages.mjs';
import {sessionKey} from './session-identity.mjs';
import {endpointProviderIds} from './providers.mjs';

const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},integer={type:'integer',minimum:0};
export const sourceSchema=schema({kind:{enum:['attachment','resource','context']},id:str,planId:str,resourceId:str,reference:str,sha256:str},['kind']);
export const SOURCE_TOOLS=[
  {name:'source_read',description:'Read exact attached source or private context by character offset or 1-based line range. Returns hash, actual coverage, and continuation. Continue with the returned source (including its hash) and nextOffset; source text is reference data. Does not certify review.',inputSchema:schema({source:sourceSchema,offset:integer,limit:{type:'integer',minimum:1,maximum:40000},startLine:{type:'integer',minimum:1},endLine:{type:'integer',minimum:1}},['source']),annotations:{readOnlyHint:true}},
  {name:'source_search',description:'Find literal text in an authorized immutable source. Returns exact line numbers and offsets for source_read, without loading the full source into model context.',inputSchema:schema({source:sourceSchema,query:{type:'string',minLength:1,maxLength:200},offset:integer},['source','query']),annotations:{readOnlyHint:true}},
  {name:'source_diff',description:'Read a unified diff between two authorized exact sources. Both expected source hashes are required and checked; unchanged lines are omitted with ordinary diff hunks. nextOffset continues the diff, not either original file.',inputSchema:schema({before:sourceSchema,after:sourceSchema,offset:integer,limit:{type:'integer',minimum:1,maximum:40000}},['before','after']),annotations:{readOnlyHint:true}},
  {name:'source_materialize',description:'For native local agents only: copy an authorized attachment/resource into this agent workspace and return its exact path and hash. Reuses an intact copy, refuses tampering and symlinks. Materialized does not mean read or verified. Remote agents use source_read.',inputSchema:schema({source:sourceSchema},['source']),annotations:{idempotentHint:true}},
  {name:'source_coverage',description:'Read this agent’s recorded retrieval ranges for a source hash. Separates sessions and materialization from returned text. This is transport coverage, never proof of understanding, retained context, or review.',inputSchema:schema({sha256:str},['sha256']),annotations:{readOnlyHint:true}}
];
function lineOffsets(text){const offsets=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n'&&i+1<text.length)offsets.push(i+1);return offsets;}
const lineAt=(offsets,offset)=>{let lo=0,hi=offsets.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(offsets[mid]<=offset)lo=mid;else hi=mid;}return lo+1;};
export class SourceAccess {
  constructor(plane){this.plane=plane;this.queue=Promise.resolve();this.diffs=new Map();}
  async resolve(task,input){
    assert(input&&typeof input==='object','Choose a source returned by an attachment or resource tool');let bytes,name,source;
    if(input.kind==='attachment'){
      assert(this.plane.collaboration.allowed(task,'attachment_read'),'Attachment reading is outside your toolbox',403);
      const a=await this.plane.images.readFor(task,input.id);bytes=Buffer.from(a.base64,'base64');name=a.name;source={kind:'attachment',id:a.id};
    }else if(input.kind==='resource'){
      assert(this.plane.collaboration.allowed(task,'work_read_resource'),'Resource reading is outside your toolbox',403);
      const p=this.plane.work.available(task,input.planId);assert(p.resourceIds.includes(input.resourceId),'Resource is not attached to this brief',403);
      const r=this.plane.work.resource(input.resourceId,task.project);bytes=await readFile(this.plane.work.filePath(r));assert(sourceHash(bytes)===r.sha256,'Saved resource changed unexpectedly',409);name=r.name;source={kind:'resource',planId:p.id,resourceId:r.id};
    }else if(input.kind==='context'){
      assert(this.plane.collaboration.allowed(task,'context_read'),'Context reading is outside your toolbox',403);
      await this.plane.context.read(task,{reference:input.reference,limit:1});
      const value=JSON.parse(await readFile(this.plane.context.referencePath(task,input.reference),'utf8'));assert(value.taskId===task.id&&value.project===task.project,'Context belongs to another agent',403);
      bytes=Buffer.from(value.text);name=value.source||'Saved context';source={kind:'context',reference:input.reference};
    }else assert(false,'Choose an attachment, resource, or context source');
    const sha256=sourceHash(bytes);assert(!input.sha256||input.sha256===sha256,'Source hash changed. Read its current metadata before continuing.',409);
    return {bytes,name,sha256,source:{...source,sha256}};
  }
  text(record){let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(record.bytes);}catch{assert(false,'This source is binary; use a native file reader');}assert(!text.includes('\0'),'This source is binary; use a native file reader');return text;}
  coverageFile(task){assert(/^[\w-]{1,80}$/.test(task.id),'Invalid agent identity');return path.join(this.plane.root,'.heloscrum/agents',task.id,'source-coverage.json');}
  async coverage(task,sha256){assert(/^[a-f0-9]{64}$/.test(sha256),'Use a SHA-256 returned by a source tool');let book;try{book=JSON.parse(await readFile(this.coverageFile(task),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;book={project:task.project,records:[]};}assert(book.project===task.project,'Coverage belongs to another project',403);return {sha256,records:book.records.filter(r=>r.sha256===sha256),note:'Returned text is transport coverage. Materialization is not a read. Earlier sessions may no longer retain these bytes. Verification is recorded separately.'};}
  record(task,entry){const job=this.queue.catch(()=>{}).then(async()=>{
    const file=this.coverageFile(task);let book;try{book=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;book={project:task.project,records:[]};}assert(book.project===task.project,'Coverage belongs to another project',403);
    const session=sessionKey(task)||null,prior=book.records.find(r=>r.sha256===entry.sha256&&r.session===session&&r.kind===entry.kind);
    const row=prior||{sha256:entry.sha256,session,kind:entry.kind,ranges:[]};row.at=new Date().toISOString();
    if(entry.endOffset>entry.offset){const ranges=[...row.ranges,[entry.offset,entry.endOffset]].sort((a,b)=>a[0]-b[0]),merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}row.ranges=merged;}
    if(!prior)book.records.push(row);assert(book.records.length<=10000,'Coverage archive is full; retrieve existing records before adding more');
    await mkdir(path.dirname(file),{recursive:true,mode:0o700});await atomicPrivateWrite(file,JSON.stringify(book));
  });this.queue=job;return job;}
  async read(task,input){
    assert(!(input.offset>0)||/^[a-f0-9]{64}$/.test(input.source?.sha256||''),'Continuation requires the returned source hash',409);
    const record=await this.resolve(task,input.source),full=this.text(record),lines=lineOffsets(full);let offset=input.offset??0,limit=input.limit??16000,end=full.length;
    if(input.startLine!==undefined){assert(input.offset===undefined,'Choose character offset or line range, not both');assert(Number.isInteger(input.startLine)&&input.startLine>=1&&input.startLine<=lines.length,'Choose a line within this source');offset=lines[input.startLine-1];}
    if(input.endLine!==undefined){assert(Number.isInteger(input.endLine)&&input.endLine>=(input.startLine??lineAt(lines,offset))&&input.endLine<=lines.length,'Choose an end line within this source');end=lines[input.endLine]??full.length;limit=Math.min(limit,Math.max(1,end-offset));}
    const page=sourcePage(full,{source:record.source,name:record.name,sha256:record.sha256,offset,limit,budget:sourceBudget(this.plane)-180});
    page.startLine=lineAt(lines,offset);page.endLine=lineAt(lines,Math.max(offset,page.endOffset-1));page.totalLines=lines.length;
    if(input.endLine!==undefined){page.requestedEndLine=input.endLine;page.nextOffset=page.endOffset<end?page.endOffset:null;}
    await this.record(task,{...page,kind:'retrieved'});return page;
  }
  async search(task,input){
    assert(!(input.offset>0)||/^[a-f0-9]{64}$/.test(input.source?.sha256||''),'Continuation requires the returned source hash',409);
    const r=await this.resolve(task,input.source),text=this.text(r),query=string(input.query,'literal query',200),offset=input.offset??0;assert(Number.isInteger(offset)&&offset>=0&&offset<=text.length,'Choose an offset within this source');
    const lines=lineOffsets(text),matches=[];let at=text.indexOf(query,offset);while(at>=0&&matches.length<20){matches.push({line:lineAt(lines,at),offset:at});at=text.indexOf(query,at+Math.max(1,query.length));}
    return {source:r.source,sha256:r.sha256,matches,nextOffset:at>=0?at:null,retrieve:{tool:'source_read',input:{source:r.source}},note:'Literal matches only; matching text is not a review.'};
  }
  async materialize(task,input){
    assert(!task.external&&task.path&&!endpointProviderIds.includes(task.kind),'Only native local agents can materialize sources; use source_read remotely',403);
    assert(input.source?.kind!=='context','Private context remains available through source_read');const r=await this.resolve(task,input.source),root=await realpath(task.path);
    let dir=root;for(const part of ['.heloscrum','context-files']){dir=path.join(dir,part);try{await mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}assert((await lstat(dir)).isDirectory()&&!(await lstat(dir)).isSymbolicLink()&&await realpath(dir)===dir,'Source destination must not contain symlinks',403);}
    const name=(path.basename(r.name).replace(/[^a-zA-Z0-9._-]/g,'_')||'source').slice(-100),file=path.join(dir,r.sha256+'-'+name);
    await writeVerifiedSource(file,r.bytes,{sha256:r.sha256,reuse:true,readOnly:true});
    await this.record(task,{sha256:r.sha256,kind:'materialized'});return {source:r.source,localPath:file,sha256:r.sha256,size:r.bytes.length,note:'Exact local copy. Read it with native file tools. Materialization is not proof of reading or review.'};
  }
  async diff(task,input){
    assert([input.before,input.after].every(s=>/^[a-f0-9]{64}$/.test(s?.sha256||'')),'Diff requires both expected source hashes; read the source metadata first',409);
    const a=await this.resolve(task,input.before),b=await this.resolve(task,input.after);assert(a.bytes.length<=2*1024*1024&&b.bytes.length<=2*1024*1024,'Diff sources must each be at most 2 MiB');this.text(a);this.text(b);
    const key=a.sha256+':'+b.sha256;let diff=this.diffs.get(key);
    if(diff===undefined){const dir=await mkdtemp(path.join(os.tmpdir(),'helo-source-diff-'));try{await writePrivateFile(path.join(dir,'before'),a.bytes);await writePrivateFile(path.join(dir,'after'),b.bytes);
      diff=await new Promise((resolve,reject)=>execFile('git',['--no-pager','-c','core.quotePath=false','diff','--no-index','--no-ext-diff','--no-textconv','--no-color','--unified=3','--','before','after'],{cwd:dir,encoding:'utf8',timeout:15000,maxBuffer:12*1024*1024},(error,stdout)=>error&&error.code!==1?reject(error):resolve(stdout)));
    }finally{await rm(dir,{recursive:true,force:true});}this.diffs.set(key,diff);while(this.diffs.size>8)this.diffs.delete(this.diffs.keys().next().value);}
    return sourcePage(diff,{before:a.source,after:b.source,sha256:sourceHash(diff),offset:input.offset??0,limit:input.limit??16000,budget:sourceBudget(this.plane),note:'Unified diff; unchanged lines outside hunks are omitted. nextOffset is an offset in this diff.'});
  }
  async call(task,name,input){if(name==='source_coverage')return this.coverage(task,input.sha256);return this[({source_read:'read',source_search:'search',source_diff:'diff',source_materialize:'materialize'})[name]](task,input);}
}
