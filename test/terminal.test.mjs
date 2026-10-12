import '../scripts/setup-pty.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import * as pty from '../lib/pty.mjs';
import {WebSocket} from 'ws';
import {Terminals} from '../lib/terminals.mjs';
import {apiFixture} from './api-fixture.mjs';
import xterm from '@xterm/headless';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('terminal preserves alternate-screen redraws and input, resizes, and stays silent between events',{timeout:60000},async()=>{
 const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const task={id:'agent',pane:'pane-1',path:os.tmpdir()};const plane={tools:{herdr:'/fixture/herdr'},herdr:{session:'test',env:process.env,terminal:async()=> 'terminal-1'},task:id=>{assert.equal(id,task.id);return task;}};
 let spawned;const terminals=new Terminals(server,plane,port,token=>token==='test-token',{spawn:(executable,args,options)=>{assert.equal(executable,'/fixture/herdr');assert.deepEqual(args,['--session','test','terminal','attach','terminal-1']);spawned=pty.spawn(process.execPath,[fileURLToPath(new URL('./fixtures/tui.mjs',import.meta.url))],options);return spawned;}});
 const terminal=new xterm.Terminal({cols:80,rows:24,allowProposedApi:true});
 const screen=()=>Array.from({length:terminal.rows},(_,i)=>terminal.buffer.active.getLine(i)?.translateToString(true)||'').join('\n');
 let output='',messages=0;
 const wait=async text=>{const deadline=Date.now()+(process.platform==='win32'?15000:5000);while(Date.now()<deadline){if(screen().includes(text))return;await delay(20);}assert.fail('Missing '+text+'\n'+screen()+'\n'+JSON.stringify(output.slice(-1500)));};
 let ws;try{
  const ticket=await terminals.ticket(task.id);ws=new WebSocket(`ws://127.0.0.1:${port}/terminal/${ticket.id}`,['heloscrum','test-token'],{origin:`http://127.0.0.1:${port}`});ws.on('message',raw=>{messages++;const message=JSON.parse(raw);assert.equal(message.error,undefined);output+=message.data||'';terminal.write(message.data||'');});await once(ws,'open');
  await wait('Task overview');
  // ConPTY can rewrite escape sequences. Check the resulting terminal screen
  // instead of requiring one exact Unix clear/cursor byte sequence.
  assert.equal(terminal.buffer.active.type,'alternate');assert(!output.includes('heartbeat'));
  const before=messages;await delay(150);assert.equal(messages,before,'transport must not append keep-alive text');
  ws.send(JSON.stringify({data:'\x1b[B'}));await wait('Selected: Recent messages');assert(!screen().includes('Selected: Task overview'),'A redraw replaces the previous selection');
  terminal.resize(62,18);ws.send(JSON.stringify({cols:62,rows:18}));await wait('62×18');assert.equal(terminal.cols,62);assert.equal(terminal.rows,18);
  ws.close();await once(ws,'close');
  const reused=new WebSocket(`ws://127.0.0.1:${port}/terminal/${ticket.id}`,['heloscrum','test-token'],{origin:`http://127.0.0.1:${port}`});const [error]=await once(reused,'error');assert.match(error.message,/403/);
 }finally{ws?.terminate();terminals.close();try{spawned?.kill();}catch{}terminal.dispose();await new Promise(resolve=>server.close(resolve));}
});

test('browser terminal launches the real HeloScrum CLI with an authenticated ticket even under CI',async()=>{
 const f=await apiFixture(),port=f.server.address().port;let ws,spawned;
 const terminals=new Terminals(f.server,f.plane,port,token=>token==='browser-token',{spawn:(executable,args,options)=>{
   assert.equal(executable,process.execPath);assert.match(args[0],/bin[\\/]heloscrum\.mjs$/);assert.equal(args[1],'tui');assert.equal(args[args.indexOf('--project')+1],f.root);
   assert.equal(options.env.FORCE_COLOR,'3');spawned=pty.spawn(executable,args,{...options,env:{...options.env,CI:'true'}});return spawned;
 }});
 try{
   assert.throws(()=>terminals.tuiTicket({project:'/unregistered'}),/Open this project/);
   const ticket=terminals.tuiTicket({project:f.root,cols:120,rows:34,motion:false}),url=`ws://127.0.0.1:${port}/terminal/${ticket.id}`;
   const unauthorized=new WebSocket(url,['heloscrum','wrong-token'],{origin:f.plane.baseUrl});const [denial]=await once(unauthorized,'error');assert.match(denial.message,/403/);assert.equal(spawned,undefined);
   ws=new WebSocket(url,['heloscrum','browser-token'],{origin:f.plane.baseUrl});let output='';ws.on('message',raw=>{const value=JSON.parse(raw);assert.equal(value.error,undefined);output+=value.data||'';});await once(ws,'open');
   const deadline=Date.now()+(process.platform==='win32'?15000:5000);
   while(Date.now()<deadline&&!output.includes('Ready to work'))await delay(25);
   assert.match(output,/H E L O S C R U M/);assert.match(output,/█████/);assert.match(output,/Ready to work/);
   ws.send(JSON.stringify({data:'q'}));await once(ws,'close');
   assert.equal((await f.client.request('/me')).kind,'owner');assert.equal(f.prompts.length,0,'Opening or closing the TUI never dispatches agent work');
   const reused=new WebSocket(url,['heloscrum','browser-token'],{origin:f.plane.baseUrl});const [error]=await once(reused,'error');assert.match(error.message,/403/);
 }finally{ws?.terminate();terminals.close();try{spawned?.kill();}catch{}await f.close();}
});

test('native terminals guard concurrent owners and reconnect after detach without stopping an agent',async()=>{
 const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const task={id:'agent',kind:'codex',phase:'launched',pane:'pane-1',path:os.tmpdir()};let spawns=0;
 const plane={tools:{herdr:'/fixture/herdr'},herdr:{session:'test',env:process.env,terminal:async()=> 'terminal-1'},task:()=>task};
 const terminals=new Terminals(server,plane,port,()=>true,{spawn:(executable,args,options)=>{spawns++;assert.equal(options.cols,62);assert.equal(options.rows,18);return pty.spawn(process.execPath,[fileURLToPath(new URL('./fixtures/tui.mjs',import.meta.url))],options);}});
 const connect=async()=>{const ticket=await terminals.ticket('agent',{cols:62,rows:18});const ws=new WebSocket(`ws://127.0.0.1:${port}/terminal/${ticket.id}`,['heloscrum','token'],{origin:`http://127.0.0.1:${port}`});await once(ws,'open');return ws;};
 let ws;try{
  const one=terminals.ticket('agent',{cols:62,rows:18});await assert.rejects(terminals.ticket('agent'),/already open/);const ticket=await one;
  ws=new WebSocket(`ws://127.0.0.1:${port}/terminal/${ticket.id}`,['heloscrum','token'],{origin:`http://127.0.0.1:${port}`});await once(ws,'open');
  await assert.rejects(terminals.ticket('agent'),/already open/);assert.equal(spawns,1);
  const detached=once(terminals.nativeConnections.get('agent').ws,'close');ws.close();await once(ws,'close');await detached;ws=await connect();assert.equal(spawns,2);
  assert.equal(task.phase,'launched');assert.equal(task.pane,'pane-1');
 }finally{ws?.terminate();terminals.close();await new Promise(resolve=>server.close(resolve));}
});
