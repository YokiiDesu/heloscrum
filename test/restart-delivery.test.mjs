import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {startBackend}=require('../desktop/backend.cjs');
const codeRoot=fileURLToPath(new URL('../',import.meta.url)),bridgeScript=fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url));

function bridge(t,file){
  const child=spawn(process.execPath,[bridgeScript,file],{stdio:['pipe','pipe','pipe']}),pending=new Map();let next=0;
  child.stderr.on('data',()=>{});t.after(()=>{child.stdin.end();child.kill();});
  createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
  const rpc=(method,params)=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  return {rpc,notify:method=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',method})+'\n')};
}
const timed=async promise=>{const started=Date.now(),value=await promise;return {value,ms:Date.now()-started};};

test('a busy agent bridge cannot hold a stopping backend open, and reports resume after restart',{timeout:60000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-restart-'));execFileSync('git',['init','--quiet',root]);t.after(()=>rm(root,{recursive:true,force:true}));
  const id=randomUUID(),sessionId=randomUUID(),token=randomBytes(32).toString('hex'),dir=path.join(root,'.heloscrum/agents',id);
  await mkdir(dir,{recursive:true,mode:0o700});
  await writeFile(path.join(root,'.heloscrum/state.json'),JSON.stringify({project:root,events:[],tasks:[{id,kind:'claude',providerSessionId:sessionId,project:root,path:root,phase:'launched',role:'Worker',title:'Worker',prompt:'Fixture'}],collaboration:{revision:0,tools:[],messages:[],notifications:[],credentials:{[id]:token}}}));
  const env={...process.env};for(const key of Object.keys(env))if(/^(HERDR|HELOSCRUM)_/.test(key))delete env[key];
  let backend=startBackend({node:process.execPath,codeRoot,root,port:0,env});t.after(()=>backend.stop());
  let {url}=await backend.ready;const file=path.join(dir,'connection.json');await writeFile(file,JSON.stringify({url,token,taskId:id}),{mode:0o600});
  const agent=bridge(t,file);await agent.rpc('initialize',{});agent.notify('notifications/initialized');
  let sequence=0;const report=()=>timed(agent.rpc('tools/call',{name:'activity_report',arguments:{sessionId,id:'toolu_restart',sequence:++sequence,kind:'tool',status:'running',name:'Bash'}}));
  assert.equal((await report()).value.result.isError,false);
  // Keep one kept-alive connection continuously busy, as several agents' Mods and
  // catalog polls do. Before the fix, shutdown waited here until SIGKILL.
  let busy=true;const calls=[];const loop=Promise.all([0,1,2].map(async()=>{while(busy)calls.push(await report());}));
  await new Promise(resolve=>setTimeout(resolve,300));
  const stopped=await timed(backend.stop());
  assert(stopped.ms<5000,`backend took ${stopped.ms} ms to stop while an agent was calling`);
  const afterStop=await report();assert.equal(afterStop.value.result.isError,true);assert(afterStop.ms<2000,`a call to the stopped backend took ${afterStop.ms} ms`);
  backend=startBackend({node:process.execPath,codeRoot,root,port:0,env});({url}=await backend.ready);
  await new Promise(resolve=>setTimeout(resolve,500));busy=false;await loop;
  assert(calls.length>1);assert(calls.every(call=>call.ms<5000),'no report stayed open across the restart');
  const resumed=await report();assert.equal(resumed.value.result.isError,false,resumed.value.result.content?.[0]?.text);
});

test('the bridge bounds telemetry calls to a stalled backend without shortening real tool calls',{timeout:30000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-stalled-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const open=new Set();const server=http.createServer((req,res)=>{open.add(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{for(const res of open)res.destroy();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const file=path.join(root,'connection.json');await writeFile(file,JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,token:'stalled',taskId:'stalled-agent'}),{mode:0o600});
  const agent=bridge(t,file);await agent.rpc('initialize',{});
  let toolAnswered=false;agent.rpc('tools/call',{name:'send_message',arguments:{to:'peer',message:'hello'}}).then(()=>{toolAnswered=true;});
  const telemetry=await timed(agent.rpc('tools/call',{name:'activity_report',arguments:{sessionId:randomUUID(),id:'toolu_stalled',sequence:1,kind:'tool',status:'running'}}));
  assert.equal(telemetry.value.result.isError,true);
  assert(telemetry.ms>=4500&&telemetry.ms<6500,`telemetry call answered after ${telemetry.ms} ms`);
  assert.equal(toolAnswered,false,'an ordinary tool call keeps its longer bound');
});

test('the activity Mod backs off while HeloScrum is unreachable and recovers on the next success',async()=>{
  const {register}=await import('../plugins/heloscrum-activity/hooks/register.js?test='+randomUUID()),hooks=new Map(),ticks=[];
  register((name,...args)=>hooks.set(name+(args[0]?.command?':'+args[0].command:''),args.at(-1)));
  let online=false,attempts=0;
  const $={session:{id:async()=>randomUUID(),usage:async()=>({context:{window:200000}})},command:{register:async()=>{}},ui:{invalidate:()=>{}},clock:{every:(_ms,fn)=>ticks.push(fn)},
    mcp:{call:async(_server,tool)=>{if(tool!=='activity_report')throw Error('offline');attempts++;if(!online)throw Error('offline');return {content:[]};}}};
  await hooks.get('session.start')($,{},async()=>({}));
  for(let n=0;n<60;n++)await ticks[0]();
  // Attempts at ticks 1, 2, 4, 8, 16 and 32, then every 30: 6 in 60 ticks, not 60.
  assert.equal(attempts,6);
  const forced=attempts;const status=await hooks.get('command.run:heloscrum-status')($);assert.match(status.text,/unavailable/);assert.equal(attempts,forced+1,'an explicit status check retries at once');
  online=true;await hooks.get('command.run:heloscrum-status')($);
  const delivered=attempts;await hooks.get('tool.call')($,{tool:'Bash',tool_use_id:'toolu_after',command:'true'},async()=>({text:'ok'}));
  await ticks[0]();assert(attempts>delivered,'a success resets the back-off');
});
