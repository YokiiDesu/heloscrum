import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const codeRoot=fileURLToPath(new URL('../',import.meta.url));
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'HeloScrum platform smoke ')));
const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
git(['init','-q','-b','main']);
await writeFile(path.join(root,'README.md'),'# Disposable platform check\n');
await writeFile(path.join(root,'.gitignore'),'.heloscrum/\n');
git(['add','.']);git(['-c','user.name=HeloScrum Test','-c','user.email=test@example.invalid','commit','-qm','Fixture']);
const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
let child,exited,log='';
const env={...process.env,HELOSCRUM_ROOT:root,PORT:String(port)};
// Never inherit an explicit connection to an existing agent supervisor.
for(const key of Object.keys(env))if(/^(?:HERDR_|HELOSCRUM_(?!ROOT$))/.test(key))delete env[key];
async function request(route,{token,body}={}){
  return fetch(base+route,{method:body?'POST':'GET',headers:{Connection:'close',...(token?{'X-HeloScrum-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
}
async function start(){
  log='';child=spawn(process.execPath,[path.join(codeRoot,'server.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  exited=new Promise(resolve=>{child.once('error',error=>{log+=error.message;resolve();});child.once('exit',resolve);});
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log=(log+data).slice(-12000);});
  for(let attempt=0;attempt<150;attempt++){
    if(child.exitCode!==null)throw Error(`Server exited during startup: ${log}`);
    if(log.includes(`HeloScrum: ${base}`))return (await (await request('/api/session')).json()).token;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(`Server did not become ready: ${log}`);
}
async function stop(){
  if(!child)return;
  if(child.exitCode===null)child.kill('SIGTERM');
  let timer;
  try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Server did not stop')),10000);})]);}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');child=null;}
}
try{
  const first=await start();
  assert.equal((await request('/api/state')).status,401,'State requires a session token');
  const page=await request('/');assert.equal(page.status,200);assert.match(await page.text(),/HeloScrum/);
  for(const asset of ['/app.js','/document-preview.js','/vendor/xterm.js','/vendor/marked.js'])assert.equal((await request(asset)).status,200,asset);
  const state=await (await request('/api/state',{token:first})).json();assert.equal(state.project.path,root);assert.equal(state.tasks.length,0);
  const saved=await request('/api/project-settings/conversation',{token:first,body:{project:root,style:'concise',expectedRevision:0}});
  assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
  await stop();
  const second=await start();assert.notEqual(second,first,'Browser token rotates after restart');
  assert.equal((await request('/api/state',{token:first})).status,401,'Old browser token is rejected');
  const settings=await (await request('/api/project-settings',{token:second})).json();
  assert.deepEqual(settings.conversation,{style:'concise',revision:1},'DuckDB restores settings');
  const restored=await (await request('/api/state',{token:second})).json();assert.equal(restored.tasks.length,0);
  console.log('PASS: real HTTP startup, assets, authentication, settings persistence, restart and token renewal. No agents started.');
}finally{await stop();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
