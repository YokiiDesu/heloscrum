import {readFile,open} from 'node:fs/promises';
import path from 'node:path';
import {ModelClient} from '../lib/model-client.mjs';
import {rolePackState} from '../lib/role-packs.mjs';
import {rolePackRequest,rolePackAnswers,selectRolePacks,ROLE_PACK_POLICY} from '../lib/role-pack-selection.mjs';
const args=process.argv.slice(2),option=key=>args[args.indexOf(key)+1];
if(!args.includes('--run-live')||!args.includes('--runtime')||!args.includes('--output'))throw Error('Use --run-live --runtime <configured runtime> --output <new JSON file>. This invokes the configured Jev service.');
const root=path.resolve(option('--runtime')),output=path.resolve(option('--output'));
const state=JSON.parse(await readFile(path.join(root,'.heloscrum/state.json'),'utf8')),secrets=JSON.parse(await readFile(path.join(root,'.heloscrum/ai-credentials.json'),'utf8'));
const connection=state.aiConnections.find(c=>c.id===state.contextSettings?.decisionConnectionId&&c.kind==='jev'&&c.enabled!==false&&secrets[c.id]);
if(!connection)throw Error('The runtime needs an enabled Jev decision connection with credentials.');
const cases=JSON.parse(await readFile(new URL('../test/fixtures/role-pack-cases.json',import.meta.url),'utf8'));if(!Array.isArray(cases)||cases.length>64)throw Error('At most 64 fixed evaluation cases are allowed.');
const titleRules=[['orchestration','coordinator|integration'],['scrum-master','scrum|facilitator'],['ui-ux','ui|ux|frontend'],['game-design','game|gameplay'],['qa-reviewer','qa|reviewer|verifier'],['database-architect','database|data architect'],['devsecops','security|devsecops'],['knowledge-manager','knowledge|archivist']];
const file=await open(output,'wx',0o600),client=new ModelClient(),report={at:new Date().toISOString(),policy:ROLE_PACK_POLICY,labelOrigin:'Agent-authored synthetic fixtures; see documentation for split provenance',titleRules,records:[]};
const save=async()=>{const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');await file.write(bytes,0,bytes.length,0);await file.truncate(bytes.length);await file.sync();};
try{await save();for(const c of cases){
 const {state,questions}=rolePackRequest(rolePackState({work:{list:()=>[]}}, {title:c.title,prompt:c.duties}));const record={...c,state,questions,startedAt:new Date().toISOString(),titleBaseline:titleRules.filter(([,rule])=>new RegExp(rule,'i').test(c.title)).map(([id])=>id).slice(0,ROLE_PACK_POLICY.maxActive)};report.records.push(record);await save();
 const started=Date.now();try{record.raw=await client.decide(connection,secrets[connection.id],state,questions,{signal:AbortSignal.timeout(ROLE_PACK_POLICY.timeoutMs)});const scores=rolePackAnswers(record.raw);record.valid=!!scores;record.selected=scores?selectRolePacks(scores):[];record.exact=!!scores&&JSON.stringify([...record.selected].sort())===JSON.stringify([...c.expected].sort());}catch(error){record.failure={name:error.name,status:error.status||null};}record.ms=Date.now()-started;await save();console.log(c.id+': '+(record.failure?'service failure':record.exact?'match':'mismatch'));
}console.log('Saved measured evaluation to '+output);}finally{await file.close();}
