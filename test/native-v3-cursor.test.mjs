import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {kiroV3Items,readKiroV3Export,KiroV3Reader} from '../lib/kiro-v3.mjs';
import {kiroLaunchConfig} from '../lib/kiro.mjs';
import {nativeSelection,NativeSetup,kiroProfileConfig} from '../lib/native-setup.mjs';
import {managedProvider} from '../lib/providers.mjs';
import {cursorInteractiveArgs,cursorHistoryItems,cursorTranscriptRoot,readCursorSession} from '../lib/cursor.mjs';
import {run} from '../lib/adapters.mjs';
const id='11111111-1111-4111-a111-111111111111',sid='sess_'+id;
const row=(id,payload)=>({id,timestamp:'2026-10-07T20:00:00Z',payload});
async function fixture(t){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'heloscrum-v3-test-')));t.after(()=>rm(root,{recursive:true,force:true}));await run('git',['init','-q'],{cwd:root});return root;}

test('engine and mode selections keep legacy sessions stable and reject cross-provider values',()=>{
 assert.deepEqual(nativeSelection('kiro',{}),{profile:null,files:[]});assert.deepEqual(nativeSelection('kiro',{kiroEngine:'v2'}),{profile:null,files:[]});
 assert.equal(nativeSelection('kiro',{kiroEngine:'v3'}).kiroEngine,'v3');assert.equal(managedProvider('cursor'),true);
 assert.equal(managedProvider({kind:'cursor',nativeSetup:{cursorMode:'interactive'}}),false);
 assert.throws(()=>nativeSelection('claude',{kiroEngine:'v3'}));assert.throws(()=>nativeSelection('kiro',{cursorMode:'interactive'}));assert.throws(()=>nativeSelection('cursor',{cursorMode:'anything'}));
});
test('V3 Markdown profile preserves permissions and body without migrating or weakening native policy',async t=>{
 const root=await fixture(t),home=path.join(root,'home'),project=path.join(root,'project');await mkdir(path.join(home,'.kiro/agents'),{recursive:true});await mkdir(project);await run('git',['init','-q'],{cwd:project});
 const markdown='---\nname: reviewer\nmodel: auto\ntools: [read]\nincludeMcpJson: false\npermissions:\n  rules:\n    - capability: shell\n      effect: deny\n      match: ["*"]\n---\nOnly review.\n';
 await writeFile(path.join(home,'.kiro/agents/reviewer.md'),markdown);
 const plane={root,tools:{kiro:true},data:{},projects:{project:()=>{}}},native=new NativeSetup(plane,{home});
 assert.equal((await native.profiles('kiro',project))[0].available,false);assert.equal((await native.profiles('kiro',project,'v3'))[0].available,true);
 const task={id,kind:'kiro',path:project,project,nativeSetup:{kiroEngine:'v3',profile:'user:reviewer',files:[]}};await native.prepare(task);
 const saved=await native.kiroProfile(task);assert.equal(saved.prompt,'Only review.');assert.equal(saved.includeMcpJson,false);assert.equal(saved.permissions.rules[0].effect,'deny');
 const args=await kiroLaunchConfig(task,{command:'node',args:['bridge']},{profile:saved,resumeSessionId:sid});assert(args.includes('--v3'));assert(args.includes(sid));assert(!args.includes('--trust-all-tools'));
 const generated=JSON.parse(await readFile(path.join(project,'.kiro/agents/heloscrum-'+id+'.json'),'utf8'));assert.deepEqual(generated.permissions,saved.permissions);assert.deepEqual(generated.tools,['read','@heloscrum']);
 assert.equal(await readFile(path.join(home,'.kiro/agents/reviewer.md'),'utf8'),markdown);
 await assert.rejects(kiroLaunchConfig({...task,nativeSetup:{}},{command:'node'},{resumeSessionId:sid}),/identifier/);
 await assert.rejects(kiroLaunchConfig(task,{command:'node'},{resumeSessionId:id}),/identifier/);
 assert.throws(()=>kiroProfileConfig('---\nname: x\nname: y\n---\nprompt',true),/YAML/);
});
test('V3 export separates provider thinking from replies and excludes prompts and signatures',()=>{
 const records=[row('private',{type:'session_start',content:'private system'}),row('note',{type:'agent_note',content:'private note'}),row('thought',{type:'assistant',operationType:'Reasoning',content:'Inspect tool permissions.',reasoningSignature:'hidden'}),row('u',{type:'user',content:'Read file'}),row('pending',{type:'pending_interaction',interactionType:'tool_approval',toolCallId:'tool',question:'Read File'}),row('call',{type:'tool_call',toolCallId:'tool',toolName:'read_file',args:{path:'README.md'},status:'denied'}),row('result',{type:'tool_result',toolCallId:'tool',success:false,content:'User denied'}),row('a',{type:'assistant',operationType:'Say',content:'Stopped.'})];
 const events=kiroV3Items(records);assert.equal(events.length,4);assert.equal(events[0].type,'thinking');assert.equal(events[0].text,'Inspect tool permissions.');assert.equal(events[2].name,'read_file');assert.equal(events[2].status,'failed');assert.equal(events[2].output,'User denied');assert(!JSON.stringify(events).includes('private'));assert(!JSON.stringify(events).includes('hidden'));
 const archive=zipSync({[sid+'/session.json']:strToU8(JSON.stringify({schemaVersion:'1.0.0',id:sid,workspacePaths:['/workspace']})),[sid+'/messages.jsonl']:strToU8(records.map(r=>JSON.stringify(r)).join('\n')),'../outside':strToU8('ignore')});
 const parsed=readKiroV3Export(archive,sid);assert.equal(parsed.records.length,records.length);assert.equal(parsed.meta.id,sid);
 assert.throws(()=>readKiroV3Export(archive,'sess_'+id.replace('1111','2222')));assert.throws(()=>readKiroV3Export(Buffer.alloc(33*1024*1024),sid),/32 MiB/);
});
test('V3 discovery rejects ambiguity, wrong worktrees, and cursor loops; read verifies export identity',async t=>{
 const root=await fixture(t),reader=new KiroV3Reader(null);reader.connect=async()=>{};
 const one={sessionId:sid,cwd:root,_meta:{kiro:{source:'local',createdAt:'2026-10-07T20:00:00Z'}}};
 reader.rpc=async()=>({sessions:[one]});assert.equal(await reader.findSession(root,'2026-10-07T20:00:00Z'),sid);
 reader.rpc=async()=>({sessions:[one,one]});await assert.rejects(reader.findSession(root,'2026-10-07T20:00:00Z'),/More than one/);
 reader.rpc=async()=>({sessions:[{...one,cwd:os.homedir()}]});await assert.rejects(reader.sessions(root),/different worktree/);
 reader.rpc=async()=>({sessions:[one],nextCursor:'same'});await assert.rejects(reader.sessions(root),/incomplete/);
 reader.export=async()=>({meta:{workspacePaths:[os.homedir()]},records:[]});await assert.rejects(reader.read(sid,root),/another worktree/);
 let reads=0;reader.export=async()=>{reads++;return {meta:{workspacePaths:[root],modelId:'auto'},records:[row('u',{type:'user',content:'Hello'})]};};
 await reader.read(sid,root);await reader.read(sid,root);assert.equal(reads,1);await reader.read(sid,root,{full:true});assert.equal(reads,2,'reviewed handoff must bypass short display cache');
});
test('Cursor interactive startup resumes one exact chat, preserves hooks and requires native approvals',async t=>{
 const root=await fixture(t);await mkdir(path.join(root,'.cursor'));await writeFile(path.join(root,'.cursor/hooks.json'),JSON.stringify({version:1,hooks:{stop:[{command:'existing-hook'}]}}));
 const task={id,path:root,providerSessionId:id,model:'auto'},args=await cursorInteractiveArgs(task,{hookCommand:'native-hook'});
 assert.deepEqual(args,['--sandbox','enabled','--workspace',root,'--resume',id,'--model','auto']);
 await cursorInteractiveArgs(task,{hookCommand:'native-hook'});const hooks=JSON.parse(await readFile(path.join(root,'.cursor/hooks.json'),'utf8'));
 assert.deepEqual(hooks.hooks.stop.map(x=>x.command),['existing-hook','native-hook']);assert(!args.some(a=>['--force','--trust','--approve-mcps','--print'].includes(a)));
 await assert.rejects(cursorInteractiveArgs(task,{resumeSessionId:'invalid'}),/chat ID/);
});
test('Cursor native transcript preserves text and tool results and rejects another session or symlink',async t=>{
 const root=await fixture(t),home=path.join(root,'home'),dir=path.join(cursorTranscriptRoot(root,home),id);await mkdir(dir,{recursive:true});const file=path.join(dir,id+'.jsonl');
 const records=[{role:'user',message:{content:[{type:'text',text:'Read <literal>'}]}},{type:'assistant',id:'a',message:{content:[{type:'thinking',thinking:'Provider thinking',signature:'secret'},{type:'tool_use',id:'t',name:'read',input:{path:'README'}}]}},{type:'user',id:'r',message:{content:[{type:'tool_result',tool_use_id:'t',content:'ok'}]}},{role:'assistant',message:{content:[{type:'text',text:'Finished'}]}}];
 await writeFile(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n{"partial');const task={id,providerSessionId:id,path:root};const result=await readCursorSession(task,{home,full:true});assert.equal(result.events.length,4);assert.equal(result.events[1].type,'thinking');assert.equal(result.events[1].text,'Provider thinking');assert.equal(result.events[2].status,'completed');assert(!JSON.stringify(result).includes('secret'));
 await writeFile(file,JSON.stringify({type:'user',session_id:'wrong',message:{content:'wrong'}}));await assert.rejects(readCursorSession(task,{home}),/mismatch/);
 const outside=path.join(root,id+'.jsonl');await writeFile(outside,'{}');await rm(file);await symlink(outside,file);await assert.rejects(readCursorSession(task,{home}),/Unexpected/);
 assert.equal(cursorHistoryItems([{type:'assistant',message:{content:[{type:'thinking',thinking:'Provider thinking',signature:'secret'}]}}]).length,1);
});

test('Cursor records without tool IDs have stable distinct IDs and honest unknown outcomes',()=>{
 const records=[{role:'assistant',message:{content:[{type:'tool_use',name:'Read',input:{path:'a'}},{type:'tool_use',name:'Write',input:{path:'b'}}]}},{role:'user',message:{content:[{type:'tool_result',content:'unpaired'}]}}];
 const first=cursorHistoryItems(records),second=cursorHistoryItems(records);assert.equal(first.length,2);
 assert.equal(new Set(first.map(e=>e.id)).size,2);assert.deepEqual(first.map(e=>e.id),second.map(e=>e.id));
 assert(first.every(e=>e.status==='unknown'&&e.output===''));
});
