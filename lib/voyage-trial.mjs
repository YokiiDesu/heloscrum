import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {WorkingMemory} from './working-memory.mjs';
import {cosine} from './voyage-context.mjs';

export const TRIAL_FILES=['docs/source-transfers.md','docs/working-memory.md','docs/GEMINI.md','docs/HISTORY.md','docs/SCHEDULER.md','docs/PLATFORM_TESTING.md','docs/NATIVE_SETUP.md','docs/AI_CONNECTIONS.md'];
// Labels are fixed before live inference. Evidence anchors score actual retrieved text.
export const TRIAL_QUERIES=[
  {query:'How can a reviewer get a file onto disk without filling the model prompt?',path:TRIAL_FILES[0],anchor:'Only the receipt reaches the model'},
  {query:'Can I continue a source download after my internet connection drops?',path:TRIAL_FILES[0],anchor:'Retry the identical command to resume'},
  {query:'How do we prevent comparing a patch against the wrong original file?',path:TRIAL_FILES[0],anchor:'reject a stale or incorrect baseline'},
  {query:'Does saving an attachment locally prove the agent understood it?',path:TRIAL_FILES[0],anchor:'not that the model understood'},
  {query:'May a developer approve their own reported corrections?',path:TRIAL_FILES[0],anchor:'author cannot verify'},
  {query:'Can an agent recall its earlier notes after switching providers?',path:TRIAL_FILES[1],anchor:'Notebook identity survives'},
  {query:'Where can I look up old conversations without exposing another agent’s private records?',path:TRIAL_FILES[1],anchor:'never\nsearches another agent'},
  {query:'What happens when the optional relevance service is unavailable?',path:TRIAL_FILES[1],anchor:'fall back to local search'},
  {query:'The assistant can chat but its project tools are disconnected. What should I check?',path:TRIAL_FILES[2],anchor:'folder-trust prompt'},
  {query:'Does a missing cached-input count mean zero tokens were reused?',path:TRIAL_FILES[2],anchor:'absent fields stay unknown'},
  {query:'How do I restore archived records without resending old messages?',path:TRIAL_FILES[3],anchor:'does not recreate credentials'},
  {query:'Will reminders keep running when my laptop is asleep?',path:TRIAL_FILES[4],anchor:'sleeping or shutting down the host pauses execution'},
  {query:'After downtime, will every missed recurring check be sent?',path:TRIAL_FILES[4],anchor:'rather than enumerating every missed interval'},
  {query:'Does green Windows CI mean the desktop app works natively on Windows?',path:TRIAL_FILES[5],anchor:'do not enable native Windows desktop support'},
  {query:'Are my uncommitted provider settings copied into a new worktree automatically?',path:TRIAL_FILES[6],anchor:'Tracked configuration comes from Git'},
  {query:'docs/source-transfers.md',path:TRIAL_FILES[0],kind:'exact-reference'},
  {query:'What is the cafeteria lunch menu for tomorrow?',kind:'unanswerable'},
  {query:'What was the exact dollar charge for my last Gemini request?',kind:'unanswerable'}
];
const hash=text=>createHash('sha256').update(text).digest('hex');
export function chunkSource(text,size=900){
  const chunks=[];let offset=0;
  while(offset<text.length){
    let end=Math.min(text.length,offset+size);
    if(end<text.length){const boundary=text.lastIndexOf('\n\n',end);if(boundary>offset+size/2)end=boundary+2;else{const line=text.lastIndexOf('\n',end);if(line>offset+size/2)end=line+1;}if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;}
    chunks.push({offset,end,text:text.slice(offset,end)});offset=end;
  }
  return chunks;
}
export async function loadTrialCorpus(root){
  const documents=await Promise.all(TRIAL_FILES.map(async file=>{const text=await readFile(path.join(root,file),'utf8');return {path:file,text,sha256:hash(text),chunks:chunkSource(text)};}));
  for(const q of TRIAL_QUERIES)if(q.anchor&&!documents.find(d=>d.path===q.path)?.text.includes(q.anchor))throw Error('Trial evidence anchor missing: '+q.query);
  return {documents,sha256:hash(JSON.stringify(documents.map(d=>({path:d.path,sha256:d.sha256})))),bytes:documents.reduce((n,d)=>n+Buffer.byteLength(d.text),0)};
}
function baselineMemory(corpus){
  const project='voyage-retrieval-trial',task={id:'trial',project};
  const plane={data:{agentNotebooks:{},contextSettings:{memoryRankingEnabled:false}},collaboration:{allowed:()=>true,data:{memory:corpus.documents.map(d=>({project,key:d.path,revision:1,text:d.text}))}}};
  return {memory:new WorkingMemory(plane),task};
}
function dedupe(rows){const seen=new Set();return rows.filter(r=>{if(seen.has(r.path))return false;seen.add(r.path);return true;});}
export class VoyageTrial {
  constructor(corpus,client){this.corpus=corpus;this.client=client;this.baseline=baselineMemory(corpus);this.vectors=new Map();this.queryCache=new Map();this.index=[];}
  async prepare(progress=()=>{}){
    for(const doc of this.corpus.documents){
      if(this.vectors.has(doc.sha256))continue;
      progress('Embedding '+doc.path);
      const [vectors]=await this.client.embed([doc.chunks.map(c=>c.text)],'document');
      this.vectors.set(doc.sha256,vectors);
    }
    this.index=this.corpus.documents.flatMap(doc=>doc.chunks.map((c,i)=>({...c,path:doc.path,sha256:doc.sha256,vector:this.vectors.get(doc.sha256)[i]})));
  }
  async compare(query){
    if(typeof query!=='string'||query.trim().length<2||query.length>200)throw Error('Use a query of 2–200 characters.');
    if(!this.index.length)throw Error('Run the fixed comparison first.');
    const began=performance.now();
    const local=await this.baseline.memory.search(this.baseline.task,{query,scope:'shared',ranking:'local',limit:8});
    const keyword=local.matches.map(m=>({path:m.source.key,sha256:this.corpus.documents.find(d=>d.path===m.source.key).sha256,offset:m.offset,end:m.offset+m.text.length,text:m.text,keywordScore:m.score,exact:m.exact}));
    const keywordMs=performance.now()-began;
    let vector=this.queryCache.get(query),queryCacheHit=!!vector;
    if(!vector){const [[v]]=await this.client.embed([[query]],'query');vector=v;this.queryCache.set(query,v);}
    const dense=dedupe(this.index.map(c=>({...c,similarity:cosine(vector,c.vector)})).sort((a,b)=>b.similarity-a.similarity)).map(({vector,...c})=>c);
    // Reciprocal-rank fusion of document ranks; exact identifiers stay first.
    const fused=new Map();
    for(const [arm,rows] of [['keyword',keyword],['semantic',dense]])rows.forEach((r,i)=>{const item=fused.get(r.path)||{...r,fusionScore:0};item.fusionScore+=1/(60+i+1);item[arm+'Rank']=i+1;if(arm==='semantic'){item.semanticPassage={offset:r.offset,end:r.end,text:r.text};item.similarity=r.similarity;}if(r.exact)item.exact=true;fused.set(r.path,item);});
    const hybrid=[...fused.values()].sort((a,b)=>Number(!!b.exact)-Number(!!a.exact)||b.fusionScore-a.fusionScore);
    const pack=rows=>rows.slice(0,3).map(r=>({...r,exposedBytes:Buffer.byteLength(r.text)+(r.semanticPassage&&r.semanticPassage.offset!==r.offset?Buffer.byteLength(r.semanticPassage.text):0)}));
    return {query,keyword:pack(keyword),semantic:pack(dense),hybrid:pack(hybrid),keywordMs:Math.round(keywordMs*100)/100,totalMs:Math.round(performance.now()-began),queryCacheHit};
  }
  async evaluate(progress=()=>{}){
    const start=performance.now();await this.prepare(progress);
    const missing=TRIAL_QUERIES.filter(q=>!this.queryCache.has(q.query));
    if(missing.length){progress('Embedding the fixed evaluation queries');const vectors=await this.client.embed(missing.map(q=>[q.query]),'query');missing.forEach((q,i)=>this.queryCache.set(q.query,vectors[i][0]));}
    const cases=[];for(const label of TRIAL_QUERIES){const result=await this.compare(label.query);cases.push({...result,expected:label});}
    return {version:1,at:new Date().toISOString(),corpusSha256:this.corpus.sha256,corpus:this.corpus.documents.map(({path,sha256,text,chunks})=>({path,sha256,bytes:Buffer.byteLength(text),chunks:chunks.length})),policy:{fusion:'equal-weight reciprocal rank, k=60',exactReferences:'pinned',semanticThreshold:null},summary:scoreTrial(cases),usage:this.client.usage(),elapsedMs:Math.round(performance.now()-start),cases,limitations:['Small author-labeled retrieval trial, not a held-out benchmark or agent review-quality measurement.','Keyword arm calls the actual WorkingMemory search on these files as shared notes.','Embeddings use full-document context and non-overlapping chunks; keyword search retains its existing windows.','Hybrid exposes both passages when keyword and semantic excerpts differ; bytes include both.','Unanswerable queries are diagnostic; similarity does not establish that an answer exists.','No Jev calls, live memory indexing, permission changes, or agent dispatch.']};
  }
}
export function scoreTrial(cases){
  const positive=cases.filter(c=>c.expected.kind!=='unanswerable'),out={answerable:positive.length,unanswerable:cases.length-positive.length};
  for(const arm of ['keyword','semantic','hybrid']){
    let top1=0,top3=0,evidence3=0,mrr=0,bytes=0;
    for(const c of positive){const rank=c[arm].findIndex(r=>r.path===c.expected.path);if(rank===0)top1++;if(rank>=0){top3++;mrr+=1/(rank+1);}if(c.expected.anchor&&c[arm].some(r=>r.path===c.expected.path&&(r.text.includes(c.expected.anchor)||r.semanticPassage?.text.includes(c.expected.anchor))))evidence3++;bytes+=c[arm].reduce((n,r)=>n+r.exposedBytes,0);}
    out[arm]={documentTop1:top1,documentTop3:top3,evidenceTop3:evidence3,evidenceCases:positive.filter(c=>c.expected.anchor).length,mrrAt3:Math.round(mrr/positive.length*1000)/1000,exposedBytes:bytes};
  }
  return out;
}
