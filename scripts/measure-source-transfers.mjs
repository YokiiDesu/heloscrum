// Compare exact source transport against an existing baseline checkout.
// No provider/model calls, live agents, or user project data are used.
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {sourceHash,toolText} from '../lib/source-pages.mjs';

const candidate=fileURLToPath(new URL('../',import.meta.url)),baseline=process.argv[2];
if(!baseline)throw Error('Pass an existing baseline checkout path');
const fixtures={plain:'source line\n'.repeat(15000),escaped:('\uFEFFconst value = "🚀\\\\\\n\\\"";\r\n').repeat(7500)};
const results=[];
for(const [version,root] of [['baseline',path.resolve(baseline)],['candidate',candidate]]){
  const load=name=>import(pathToFileURL(path.join(root,'lib',name+'.mjs')).href);
  const [{ControlPlane},{Collaboration},{ContextManager},{WorkManagement}]=await Promise.all(['control-plane','collaboration','context-manager','work-management'].map(load));
  for(const [fixture,source] of Object.entries(fixtures))for(const kind of ['attachment','resource']){
    const dir=await mkdtemp(path.join(os.tmpdir(),'helo-transfer-measure-'));
    try{
      const p=new ControlPlane(dir),task={id:randomUUID(),project:dir,path:path.join(dir,'agent'),kind:'codex',phase:'launched',providerSessionId:randomUUID()};await mkdir(task.path);
      p.data.tasks=[task];p.projects={project:x=>x};p.data.contextSettings={toolResultChars:12000};p.save=async()=>{};p.collaboration=new Collaboration(p);p.context=new ContextManager(p);p.work=new WorkManagement(p);
      let ref,name,input;
      if(kind==='attachment'){const a=await p.images.uploadFor(task,{name:'solver.rs',base64:Buffer.from(source).toString('base64')});name='attachment_read';input={id:a.id};ref={kind,id:a.id,sha256:a.sha256};}
      else {const r=await p.work.upload(dir,'solver.rs',Buffer.from(source)),planId=randomUUID();p.data.workPlans.push({id:planId,project:dir,status:'active',participantIds:[task.id],resourceIds:[r.id]});name='work_read_resource';input={planId,resourceId:r.id};ref={kind,...input,sha256:r.sha256};}
      let calls=0,modelBytes=0,wireBytes=0;
      const call=async(name,input)=>{
        const value=await p.collaboration.call(task,name,input),text=version==='candidate'?toolText(value):JSON.stringify(value);calls++;modelBytes+=Buffer.byteLength(text);wireBytes+=Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:calls,result:{content:[{type:'text',text}],isError:false}}));
        if(!value.offloaded)return value;
        let textValue='',offset=0;do{const page=await call('context_read',{reference:value.reference,offset,limit:8000});textValue+=page.text;offset=page.nextOffset;}while(offset!==null);return JSON.parse(textValue);
      };
      let rebuilt='',offset=0;const started=performance.now();do{const page=await call(name,{...input,offset});rebuilt+=page.text;offset=page.nextOffset;}while(offset!==null);
      if(rebuilt!==source)throw Error('Transport changed the source');
      results.push({version,fixture,kind,strategy:'complete paged retrieval',sourceBytes:Buffer.byteLength(source),sha256:sourceHash(source),calls,modelBytes,wireBytes,elapsedMs:+(performance.now()-started).toFixed(2),fidelity:'exact',reviewFindings:'not measured'});
      if(version==='candidate'){
        const start=performance.now(),local=await p.collaboration.call(task,'source_materialize',{source:ref});
        results.push({version,fixture,kind,strategy:'local copy receipt only',sourceBytes:Buffer.byteLength(source),sha256:sourceHash(source),calls:1,modelBytes:Buffer.byteLength(JSON.stringify(local)),elapsedMs:+(performance.now()-start).toFixed(2),fidelity:'hash verified',reviewFindings:'not measured',note:'No source read or review is claimed. Later native reads add model context.'});
      }
    }finally{await rm(dir,{recursive:true,force:true});}
  }
}
console.log(JSON.stringify({measuredAt:new Date().toISOString(),node:process.version,platform:process.platform,budgetCharacters:12000,method:'Same exact fixture bytes; actual local readers and scoped offload follow-up calls. Model bytes count returned text, including redundant previews. Wire bytes include MCP JSON escaping. Single local timing samples exclude uploads, provider latency, tokenization and review.',results},null,2));
