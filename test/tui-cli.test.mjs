import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import * as pty from '../lib/pty.mjs';
import xterm from '@xterm/headless';
import {apiFixture} from './api-fixture.mjs';
import {codeRoot,HeloClient} from '../cli/client.mjs';
import {detailRows,itemsFor} from '../cli/tui-model.mjs';
import {command,createBrief,parseArgs} from '../cli/commands.mjs';
import {plainText} from '../dist/tui-model.js';
import '../scripts/setup-pty.mjs';

test('terminal models render live appearance, Markdown, tools, and safe untrusted content',()=>{
  const item={id:'a',appearance:{color:'mint',icon:'bot'}},history={events:[{id:'m',type:'message',role:'assistant',text:'## Title\n**Bold** and `code`\n\x1b]52;c;SECRET\x07'},{id:'t',type:'tool',name:'read_file',input:{path:'brief.md'},output:'TOOL RESULT',status:'completed'}]};
  const closed=detailRows('Agents',item,history,60),open=detailRows('Agents',item,history,60,{expanded:true});
  assert.ok(!closed.map(r=>r.text).join('\n').includes('TOOL RESULT'));assert.match(open.map(r=>r.text).join('\n'),/TOOL RESULT/);assert.ok(!JSON.stringify(open).includes('SECRET'));
  assert.ok(closed.some(r=>r.spans?.some(s=>s.bold&&s.text.includes('Bold'))));assert.equal(plainText('\x1b[2Jsafe'),'safe');
  assert.equal(itemsFor('Tasks',{plans:[{id:'p',title:'Plan',items:[],proposals:[{id:'change',operation:'create',status:'pending'}]}]}).length,2);
  assert.deepEqual(parseArgs(['changes','diff','--staged','--no-reply']).options,{staged:true,'no-reply':true});
});

test('agent processes cannot accidentally discover the local owner credential',async()=>{
  const previous=process.env.HELOSCRUM_AGENT_ID,saved=process.env.HELOSCRUM_CREDENTIAL;
  try{process.env.HELOSCRUM_AGENT_ID='worker';delete process.env.HELOSCRUM_CREDENTIAL;await assert.rejects(HeloClient.load(),e=>e.status===403&&/never selected implicitly/.test(e.message));}
  finally{if(previous===undefined)delete process.env.HELOSCRUM_AGENT_ID;else process.env.HELOSCRUM_AGENT_ID=previous;if(saved!==undefined)process.env.HELOSCRUM_CREDENTIAL=saved;}
});

test('closing the CLI client cancels pending reads and prevents further requests',async()=>{
  const client=new HeloClient({url:'http://127.0.0.1:4173',token:'unused',fetch:async(_url,{signal})=>new Promise((resolve,reject)=>{
    if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })});
  const pending=client.request('/me');client.close();
  await assert.rejects(pending,error=>error.code==='CONNECTION_FAILED');
  await assert.rejects(client.request('/me'),error=>error.code==='CONNECTION_FAILED');
});

test('stopping an event watch does not deliver the remaining events in the same network chunk',async()=>{
  const controller=new AbortController(),seen=[];
  const frame=id=>`id: ${id}\nevent: workspace.changed\ndata: {"id":"${id}"}\n\n`;
  const client=new HeloClient({url:'http://127.0.0.1:4173',token:'unused',fetch:async()=>new Response(frame(1)+frame(2))});
  await client.watch('example',{signal:controller.signal,onEvent:event=>{seen.push(event.id);controller.abort();}});
  assert.deepEqual(seen,['1'],'An aborted consumer must not receive buffered updates');
});

test('CLI acknowledgments preserve the shared message reply defaults',async()=>{
  const requests=[],client={project:async()=>({id:'example'}),mutate:async(route,input)=>{requests.push({route,input});return {};}};
  await command(client,['messages','send'],{project:'example',to:'builder',text:'Received',kind:'ack'});
  assert.equal(Object.hasOwn(requests[0].input,'requiresReply'),false);
  await command(client,['messages','send'],{project:'example',to:'builder',text:'For reference','no-reply':true});
  assert.equal(requests[1].input.requiresReply,false);
});

test('brief resources retain deterministic valid keys with a maximum-length request ID',async()=>{
  const requests=[],client={mutate:async(route,input,options)=>{requests.push({route,input,...options});return {id:'resource-'+requests.length};}},key='a'.repeat(120);
  const options={'request-id':key,instructions:'Build the feature',reference:['docs/brief.md','docs/design.md']};
  await createBrief(client,'/projects/example',options);await createBrief(client,'/projects/example',options);
  assert.match(requests[0].key,/^[a-f0-9]{64}$/);assert.equal(requests[0].key,requests[3].key);
  assert.notEqual(requests[0].key,requests[1].key);assert.equal(requests[2].key,key);
});

test('actual PTY supports adaptive layouts, scrolling, forms and safe exit',async()=>{
  const f=await apiFixture();let terminal,child;
  try{
    terminal=new xterm.Terminal({cols:120,rows:34,allowProposedApi:true});
    const env={...process.env,TERM:'xterm-256color',FORCE_COLOR:'3'};delete env.CI;delete env.NO_COLOR;
    child=pty.spawn(process.execPath,[path.join(codeRoot,'bin/heloscrum.mjs'),'tui','--credential',path.join(f.root,'.heloscrum/api-owner.json'),'--project',f.root,'--no-motion'],{name:'xterm-256color',cols:120,rows:34,cwd:codeRoot,env});
    let exited=false,exitCode,raw='';const exit=new Promise(resolve=>child.onExit(result=>{exited=true;exitCode=result.exitCode;resolve();}));
    child.onData(chunk=>{raw+=chunk;terminal.write(chunk);});
    const screen=()=>Array.from({length:terminal.rows},(_,i)=>terminal.buffer.active.getLine(i)?.translateToString(true)||'').join('\n');
    // Windows protects persisted state with a real DACL before publishing it.
    // Allow that native filesystem work on hosted runners; return immediately
    // when the expected screen appears rather than sleeping a fixed interval.
    const waitMs=process.platform==='win32'?15000:5000;
    const wait=async needle=>{const deadline=Date.now()+waitMs;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,30));if(screen().includes(needle))return screen();if(exited)break;}throw Error('Missing '+needle+'\n'+screen()+'\n'+raw.slice(-1000));};
    const gone=async needle=>{const deadline=Date.now()+waitMs;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,30));if(!screen().includes(needle))return;}throw Error('Still showing '+needle);};
    await wait('Ready to work');assert.match(screen(),/H E L O S C R U M/);assert.match(screen(),/█████/);assert.match(raw,/\x1b\[38;2;/,'The interactive TUI emits ANSI colors');assert.match(screen(),/read_file/);assert.match(screen(),/q quit/);
    child.write('h');await gone('█████');child.write('h');await wait('█████');
    child.write('t');await wait('Requirements loaded');
    child.write('f');await wait('Focus');child.write('f');await wait('Split');assert.match(screen(),/QA/);
    child.resize(78,26);terminal.resize(78,26);await wait('Focus');assert.match(screen(),/q quit/);assert.ok(!screen().includes('█████'),'Laptop heights use the compact mark');
    child.write('2');await wait('Your next idea');child.write('n');await wait('New task brief');
    child.write('Terminal task');await wait('Title (optional): Terminal task');child.write('\r');await new Promise(r=>setTimeout(r,100));child.write('Build a compact keyboard workflow');await wait('Build a compact');child.write('\x13');await wait('Action completed');
    for(let i=0;i<100&&!f.plane.data.workPlans.length;i++)await new Promise(r=>setTimeout(r,20));
    assert.equal(f.plane.data.workPlans.length,1);assert.equal(f.plane.data.workPlans[0].status,'draft');assert.equal(f.prompts.length,0);
    child.write('s');await wait('Dispatch Terminal task');child.write('\x1b');await gone('Dispatch Terminal task');
    assert.equal(f.plane.data.workPlans[0].status,'draft','Esc never dispatches the brief');
    child.write('5');await wait('Shared deadlines');child.write('?');await wait('Keyboard guide');child.write('\x1b');await gone('Keyboard guide');
    child.write('q');await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('TUI did not exit')),3000))]);assert.equal(exitCode,0);assert.match(raw,/\x1b\[\?1049l/,'Alternate terminal screen is restored');
    assert.equal((await f.client.request('/me')).kind,'owner','Closing TUI leaves backend running');
    assert.ok(!/TypeError|ReferenceError|Invalid hook/.test(raw));
  }finally{if(child)try{child.kill();}catch{}terminal?.dispose();await f.close();}
});
