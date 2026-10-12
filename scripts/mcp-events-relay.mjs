#!/usr/bin/env node
// Private outbound transport for a separate cloud Work contact. It never
// opens an inbound port or accesses HeloScrum's owner API.
import {readFile,open,mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {McpEvents} from '../lib/mcp-events.mjs';
import {projectId} from '../lib/api-access.mjs';

const configuration=JSON.parse(await readFile(process.argv[2],'utf8'));
const connection=JSON.parse(await readFile(configuration.connectionFile,'utf8'));
if(connection.client!=='generic'||!connection.contactId||connection.externalSessionId!==configuration.cloudChatId)throw Error('Use the dedicated cloud contact, never a local Codex contact');
const local=new URL(connection.url),remote=new URL(configuration.gateway);
if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||remote.protocol!=='https:'||remote.username||remote.password||remote.pathname!=='/')throw Error('Invalid relay connection');
const directory=path.dirname(process.argv[2]);await mkdir(directory,{recursive:true,mode:0o700});
const lockfile=path.join(directory,'relay.lock');let lock;
try{lock=await open(lockfile,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number(await readFile(lockfile,'utf8'));let alive=false;
  try{process.kill(pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
  if(alive)throw Error('The relay is already running');
  await unlink(lockfile);lock=await open(lockfile,'wx',0o600);
}
await lock.writeFile(String(process.pid));
const controller=new AbortController();let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;controller.abort();});
async function request(route,body){
  const response=await fetch(new URL('/agent-api/'+route,local),{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])});
  if(!response.ok)throw Object.assign(Error('Local HeloScrum denied or could not complete the scoped request'),{status:response.status});
  return response.json();
}
async function call(name,input){
  let value=await request('call',{name,input});
  if(value.offloaded&&value.reference){let text='',offset=0;do{const page=await request('call',{name:'context_read',input:{reference:value.reference,offset,limit:8000}});text+=page.text;offset=page.nextOffset;if(text.length>2*1024*1024)throw Error('Tool result exceeds relay limit');}while(offset!=null);value=JSON.parse(text);}
  return value;
}
async function relay(route,body){
  const response=await fetch(new URL(route,remote),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+configuration.serviceToken,'X-HeloScrum-Relay-Key':configuration.relayKey},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)])});
  if(!response.ok)throw Object.assign(Error('Cloud relay request failed'),{status:response.status});
  return response.json();
}
try{
  const contact=await call('contact_identity',{});
  if(contact.id!==connection.contactId||contact.externalSessionId!==configuration.cloudChatId)throw Error('Cloud contact identity mismatch');
  const events=await new McpEvents({file:path.join(directory,'events.json'),contact,projectId:projectId(contact.project),call,catalog:()=>request('catalog')}).init();
  let lastError='',lastTick=0;
  console.log(JSON.stringify({status:'starting',contactId:contact.id,cloudChatId:configuration.cloudChatId}));
  while(!stopping){
    try{
      const {requests}=await relay('/relay/poll',{});
      for(const job of requests){
        const response=await events.rpc(job.principal,JSON.parse(job.request));
        await relay('/relay/result',{id:job.id,lease:job.lease,response});
      }
      if(Date.now()-lastTick>=2000){await events.tick();lastTick=Date.now();}
      if(lastError){console.log(JSON.stringify({status:'connected'}));lastError='';}
    }catch(error){
      if(stopping)break;
      const code=error.status??error.code??error.name;
      if(lastError!==String(code)){console.error(JSON.stringify({status:'retrying',reason:String(code)}));lastError=String(code);}
    }
    if(!stopping)await delay(lastError?5000:750,undefined,{signal:controller.signal}).catch(error=>{if(error.name!=='AbortError')throw error;});
  }
}finally{await lock.close();await unlink(lockfile).catch(()=>{});}
