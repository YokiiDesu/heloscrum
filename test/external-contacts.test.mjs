import {assertPrivate} from './private-file-assert.mjs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Collaboration} from '../lib/collaboration.mjs';
import {EXTERNAL_CONTACT_TOOLS} from '../lib/external-contacts.mjs';
import {ImageAttachments} from '../lib/image-attachments.mjs';
import {apiFixture} from './api-fixture.mjs';
import {HeloClient} from '../cli/client.mjs';

const setup={name:'Codex — this chat',client:'codex',externalSessionId:'test-desktop-chat'};
async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-external-'));
  const agent={id:'11111111-1111-4111-a111-111111111111',project:root,role:'Builder',kind:'codex',pane:'one',phase:'launched',prompt:''};
  const prompts=[],plane={root,data:{project:root,tasks:[agent]},save:async()=>{},herdr:{list:async()=>[{pane_id:'one',interactive_ready:true,agent_status:'idle'}],prompt:async(...args)=>prompts.push(args)}};
  const registry=new Collaboration(plane);plane.collaboration=registry;plane.images=new ImageAttachments(plane);
  return {root,agent,prompts,plane,registry,async close(){await rm(root,{recursive:true,force:true});}};
}

test('external contacts are durable project identities with private, recoverable credentials and no agent session',async()=>{
  const f=await fixture(),{root,registry,plane}=f;
  try{
    const result=await registry.external.register(root,setup),id=result.contact.id,file=result.mcp.args[1],config=JSON.parse(await readFile(file,'utf8'));
    assert.equal(plane.data.tasks.length,1);assert.equal(result.contact.deliveryMode,'pull');
    await assertPrivate(file);
    assert.equal(registry.authenticate(config.token).id,id);
    assert(!JSON.stringify(result).includes(config.token));assert(!JSON.stringify(registry.snapshot(root)).includes(config.token));
    assert.equal((await registry.external.register(root,setup)).contact.id,id);
    assert.equal(registry.external.records.length,1);
    await assert.rejects(registry.external.register(root,{...setup,name:'An impostor'}),/different contact details/);
    const reboot=new Collaboration(plane);assert.equal(reboot.authenticate(config.token).id,id);
    const contact=reboot.participant(id,root);
    for(const name of ['work_update_task','memory_write','report_state','run_shell']){
      await assert.rejects(reboot.call(contact,name,{}),e=>e.status===403);
      await assert.rejects(reboot.call(contact,'invoke_tool',{name,input:{}}),e=>e.status===403);
    }
    assert(reboot.catalog(contact,{compact:true}).tools.every(t=>EXTERNAL_CONTACT_TOOLS.has(t.name)));
    assert(!reboot.contacts(root+'/other').some(c=>c.id===id));
    const message=await reboot.send(f.agent,id,'Waiting for an external reader');
    await reboot.external.revoke(root,id);
    assert.equal(message.delivery,'cancelled');assert(!reboot.contacts(root).some(c=>c.id===id));
    assert.throws(()=>reboot.authenticate(config.token),e=>e.status===401);
    await assert.rejects(reboot.call(contact,'send_message',{to:f.agent.id,message:'Still connected?'}),e=>e.status===403);
    await assert.rejects(readFile(file),e=>e.code==='ENOENT');
  }finally{await f.close();}
});

test('external direct messages and group replies preserve identities, cursor delivery, project isolation, and receipts',async()=>{
  const f=await fixture(),{root,registry,agent,plane}=f;
  try{
    const {contact}=await registry.external.register(root,setup),external=registry.participant(contact.id,root);
    const peer={...agent,id:'22222222-2222-4222-a222-222222222222',role:'QA',pane:'two'};plane.data.tasks.push(peer);
    const outside={...agent,id:'33333333-3333-4333-a333-333333333333',project:root+'/other'};plane.data.tasks.push(outside);
    const incoming=await registry.send(agent,external.id,'Can you review the result?',{requiresReply:true});
    await registry.deliverReady();assert.equal(incoming.delivery,'queued');assert.equal(f.prompts.length,0,'pull delivery never starts a managed runtime');
    const inbox=await registry.call(external,'read_inbox',{});
    assert.equal(inbox.messages[0].id,incoming.id);assert.equal(incoming.delivery,'delivered');assert.equal(incoming.deliveryChannel,'inbox');
    assert.equal(incoming.toSessionKey,external.id+':external:test-desktop-chat');
    assert.equal((await registry.call(external,'read_inbox',{after:inbox.nextCursor})).messages.length,0);
    await assert.rejects(registry.call(external,'read_inbox',{after:'foreign-message'}),e=>e.status===404);
    await assert.rejects(registry.send(external,outside.id,'Outside project'),e=>e.status===404);
    const reply=await registry.call(external,'send_message',{to:agent.id,message:'Reviewed the result.',replyTo:incoming.id,kind:'result',requiresReply:false});
    assert.equal(reply.from,external.id);assert.equal(reply.fromRole,setup.name);
    await registry.deliverReady();assert.equal(f.prompts.length,1);assert.match(f.prompts[0][1],/Reviewed the result/);
    const group=await registry.groups.create(agent,{name:'External review',participants:[peer.id,external.id]});
    const sent=await registry.call(peer,'send_group_message',{threadId:group.id,message:'Shared result'});
    assert(sent.deliveries.some(d=>d.to===external.id));
    assert.equal((await registry.call(external,'read_group',{threadId:group.id})).messages[0].text,'Shared result');
    const groupReply=await registry.call(external,'send_message',{threadId:group.id,message:'Group result received',replyTo:sent.id,kind:'result',requiresReply:false});
    assert.deepEqual(groupReply.deliveries.map(d=>d.to).sort(),[agent.id,peer.id].sort());
    assert.throws(()=>registry.groups.read(outside,{threadId:group.id}),e=>e.status===403);
    assert(registry.threadPage(root,group.id).participants.some(p=>p.id===external.id&&p.name===setup.name));
    const attachment=await plane.images.upload(root,{name:'review.txt',base64:Buffer.from('Shared evidence').toString('base64')});
    await registry.sendGroup({id:'human',role:'You',human:true,project:root},null,'Attached evidence',{threadId:group.id,attachments:[attachment.id]});
    await assert.rejects(registry.call(external,'attachment_read',{id:attachment.id}),e=>e.status===403);
    await registry.readInbox(external,{after:inbox.nextCursor});
    assert.equal((await registry.call(external,'attachment_read',{id:attachment.id})).text,'Shared evidence');
    await assert.rejects(registry.call(outside,'attachment_read',{id:attachment.id}),e=>e.status===403);

  }finally{await f.close();}
});

test('external inbox pages mark only returned messages delivered and retries recover persistence failures',async()=>{
  const f=await fixture(),{root,registry,plane,agent}=f;
  try{
    const {contact}=await registry.external.register(root,setup),external=registry.participant(contact.id,root);
    for(let i=0;i<52;i++)await registry.send(agent,external.id,'Message '+i);
    const first=await registry.readInbox(external,{});assert.equal(first.messages.length,50);assert(first.hasMore);
    assert.equal(registry.data.messages.at(-1).delivery,'queued');
    const second=await registry.readInbox(external,{after:first.nextCursor});assert.equal(second.messages.length,2);assert.equal(second.hasMore,false);
    assert.equal(registry.data.messages.at(-1).delivery,'delivered');
    plane.save=async()=>{throw Error('Disk unavailable');};
    await assert.rejects(registry.external.register(root,{...setup,externalSessionId:'second-chat'}),/Disk unavailable/);
    await assert.rejects(registry.external.register(root,{...setup,externalSessionId:'second-chat'}),/Disk unavailable/);
    plane.save=async()=>{};
    const recovered=await registry.external.register(root,{...setup,externalSessionId:'second-chat'});assert(recovered.contact.id);assert.equal(registry.external.records.length,2);
  }finally{await f.close();}
});

function client(file,threadId){
  const env={...process.env};delete env.CODEX_THREAD_ID;delete env.CODEX_SESSION_ID;if(threadId)env.CODEX_THREAD_ID=threadId;
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url)),file],{env,stdio:['pipe','pipe','pipe']}),pending=new Map();let seq=0;
  createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line),entry=pending.get(m.id);if(entry){clearTimeout(entry.timer);pending.delete(m.id);m.error?entry.reject(Error(m.error.message)):entry.resolve(m.result);}});
  return {child,call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout'));},8000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}};
}

test('real stdio MCP bridge accepts the bound chat, rejects missing or different chat IDs, and exchanges replies',async()=>{
  const f=await fixture(),{root,registry,plane,agent}=f;let server;const clients=[];
  try{
    server=http.createServer(async(req,res)=>{try{
      const actor=registry.authenticate(req.headers.authorization?.replace(/^Bearer /,''));let raw='';for await(const chunk of req)raw+=chunk;const data=raw?JSON.parse(raw):{};
      const value=req.url.endsWith('/catalog')?registry.catalog(actor,{compact:true}):req.url.endsWith('/listed')?{}:await registry.call(actor,data.name,data.input);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
    }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});plane.baseUrl='http://127.0.0.1:'+server.address().port;
    const config=await registry.external.register(root,setup),file=config.mcp.args[1];
    for(const thread of [undefined,'another-chat']){const wrong=client(file,thread);clients.push(wrong);await assert.rejects(wrong.call('initialize'),/another Codex chat/);}
    const bridge=client(file,setup.externalSessionId);clients.push(bridge);
    const init=await bridge.call('initialize');assert.match(init.instructions,/does not wake/);
    assert((await bridge.call('tools/list')).tools.some(t=>t.name==='contact_identity'));
    const identity=JSON.parse((await bridge.call('tools/call',{name:'contact_identity'})).content[0].text);assert.equal(identity.id,config.contact.id);
    const message=await registry.send(agent,identity.id,'Reply to this MCP test');
    const inbox=JSON.parse((await bridge.call('tools/call',{name:'read_inbox'})).content[0].text);assert.equal(inbox.messages[0].id,message.id);
    const output=await bridge.call('tools/call',{name:'send_message',arguments:{to:agent.id,message:'MCP reply',replyTo:message.id,kind:'result',requiresReply:false}});
    assert.equal(output.isError,false);assert.equal(registry.data.messages.at(-1).from,identity.id);
    await registry.external.revoke(root,identity.id);
    assert.equal((await bridge.call('tools/call',{name:'contact_identity'})).isError,true);
  }finally{for(const c of clients)c.child.kill();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await f.close();}
});

test('owner API registers and disconnects external contacts without exposing secrets or granting agents registration rights',async()=>{
  const f=await apiFixture();let agentClient;
  try{
    const before=f.plane.data.tasks.length,sequence=f.plane.data.api.sequence;
    const created=await f.client.mutate(f.base+'/external-contacts',setup,{key:'register-external'});
    assert.equal(f.plane.data.tasks.length,before);assert.equal(created.contact.role,setup.name);assert(f.plane.data.api.sequence>sequence,'contact registration publishes a workspace event');
    const same=await f.client.mutate(f.base+'/external-contacts',setup,{key:'register-external'});assert.equal(same.contact.id,created.contact.id);
    const config=JSON.parse(await readFile(created.mcp.args[1],'utf8'));
    assert(!JSON.stringify(await f.client.request('/operations/'+created.operationId)).includes(config.token));
    const listing=await f.client.list(f.base+'/external-contacts');assert.equal(listing.items.length,1);
    const recovered=await f.client.request(f.base+'/external-contacts/'+created.contact.id+'/connection');assert.equal(recovered.contact.id,created.contact.id);
    agentClient=new HeloClient(await f.credential(['agents:read','agents:write']));
    await assert.rejects(agentClient.mutate(f.base+'/external-contacts',setup),e=>e.status===403);
    await assert.rejects(agentClient.request(f.base+'/external-contacts/'+created.contact.id+'/connection'),e=>e.status===403);
    await assert.rejects(agentClient.mutate(f.base+'/external-contacts/'+created.contact.id,{}, {method:'DELETE'}),e=>e.status===403);
    await f.client.mutate(f.base+'/external-contacts/'+created.contact.id,{}, {method:'DELETE'});
    assert.equal((await f.client.list(f.base+'/external-contacts')).items.length,0);
  }finally{agentClient?.close();await f.close();}
});

test('external inbox checkpoints survive restarts, failed saves and DM/group interleaving without silently acknowledging messages',async()=>{
  const f=await fixture(),{root,registry,plane,agent}=f;
  try{
    const {contact}=await registry.external.register(root,setup),external=registry.participant(contact.id,root);
    const peer={...agent,id:'22222222-2222-4222-a222-222222222222'};plane.data.tasks.push(peer);
    const group=await registry.groups.create(agent,{name:'Inbox test',participants:[peer.id,external.id]});
    const dm=await registry.send(agent,external.id,'Direct message');
    const sent=await registry.send(agent,null,'Group message',{threadId:group.id});
    const groupDelivery=registry.data.messages.find(m=>m.groupMessageId===sent.id&&m.to===external.id);
    await assert.rejects(registry.call(external,'ack_inbox',{ids:[dm.id]}),e=>e.status===403);
    assert.deepEqual((await registry.call(external,'read_inbox',{unreadOnly:true})).messages.map(m=>m.id),[dm.id,groupDelivery.id]);
    assert.equal((await registry.call(external,'read_inbox',{unreadOnly:true})).messages.length,2,'reading never marks a message handled');
    await assert.rejects(registry.call(external,'ack_inbox',{ids:[dm.id,'not-mine']}),e=>e.status===403);
    assert.equal(dm.inboxAcknowledgedAt,undefined,'batch validation is atomic');
    plane.save=async()=>{throw Error('Disk unavailable');};
    await assert.rejects(registry.call(external,'ack_inbox',{ids:[dm.id]}),/Disk unavailable/);assert.equal(dm.inboxAcknowledgedAt,undefined);
    plane.save=async()=>{};
    const fresh=await registry.send(agent,external.id,'Arrived during processing');
    const ack=await registry.call(external,'ack_inbox',{ids:[dm.id]});assert.equal(ack.pendingCount,2);
    const at=dm.inboxAcknowledgedAt;await registry.call(external,'ack_inbox',{ids:[dm.id]});assert.equal(dm.inboxAcknowledgedAt,at);
    plane.data=structuredClone(plane.data);const reboot=new Collaboration(plane);plane.collaboration=reboot;
    assert.deepEqual((await reboot.call(external,'read_inbox',{unreadOnly:true})).messages.map(m=>m.id),[groupDelivery.id,fresh.id]);
    assert.equal((await reboot.call(external,'read_inbox',{})).messages.length,3,'history stays readable');
    await assert.rejects(reboot.call(peer,'ack_inbox',{ids:[groupDelivery.id]}),e=>e.status===403);
    await reboot.call(external,'ack_inbox',{ids:[groupDelivery.id,fresh.id]});
    assert.equal((await reboot.call(external,'read_inbox',{unreadOnly:true})).messages.length,0);
    assert.equal(f.prompts.length,0,'checkpoints do not send receipt messages or wake agents');
  }finally{await f.close();}
});

test('agents and external contacts exchange scoped images/files in DMs and groups with exact retries',async()=>{
  const f=await fixture(),{root,registry,plane,agent}=f;
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
  try{
    const {contact}=await registry.external.register(root,setup),external=registry.participant(contact.id,root);
    const peer={...agent,id:'22222222-2222-4222-a222-222222222222'};plane.data.tasks.push(peer);
    const image=await registry.call(external,'attachment_upload',{name:'proof.png',base64:png});
    const file=await registry.call(agent,'attachment_upload',{name:'evidence.txt',base64:Buffer.from('Evidence\n').toString('base64')});
    const secret=await plane.images.upload(root,{name:'not-shared.txt',base64:Buffer.from('Private').toString('base64')});
    await assert.rejects(registry.call(external,'send_message',{to:agent.id,message:'Wrong attachment',attachments:[secret.id]}),e=>e.status===403);
    await assert.rejects(registry.call(external,'send_message',{to:agent.id,message:'Wrong attachment',attachments:[file.id]}),e=>e.status===403);
    const input={to:external.id,message:'File for you',attachments:[file.id],requestId:'file-retry'};
    const delivered=await registry.call(agent,'send_message',input);
    assert.equal((await registry.call(agent,'send_message',input)).id,delivered.id);
    await assert.rejects(registry.call(agent,'send_message',{...input,attachments:[]}),e=>e.status===409);
    await assert.rejects(registry.call(external,'attachment_read',{id:file.id}),e=>e.status===403);
    await registry.call(external,'read_inbox',{unreadOnly:true});
    assert.equal((await registry.call(external,'attachment_read',{id:file.id})).text,'Evidence\n');
    const group=await registry.call(external,'send_message',{to:[agent.id,peer.id],name:'Shared files',message:'Image and received evidence',attachments:[image.id,file.id]});
    assert.equal(group.deliveries.length,2);
    await assert.rejects(registry.call(peer,'attachment_read',{id:image.id}),e=>e.status===403);
    await registry.deliverReady();
    assert.equal((await registry.call(agent,'attachment_read',{id:image.id})).mcpResult.content[1].data,png);
    const groupInput={threadId:group.threadId,message:'Returned proof',attachments:[image.id],requestId:'group-file-retry'};
    const returned=await registry.call(agent,'send_group_message',groupInput);
    assert.equal((await registry.call(agent,'send_group_message',groupInput)).id,returned.id);
    await assert.rejects(registry.call(agent,'send_group_message',{...groupInput,attachments:[file.id]}),e=>e.status===409);
    const received=await registry.call(external,'read_inbox',{unreadOnly:true});assert(received.messages.some(m=>m.threadId===group.threadId&&m.attachments[0].id===image.id));
    const foreign=await plane.images.upload(root+'/other',{name:'foreign.txt',base64:'YQ=='});
    await assert.rejects(registry.call(external,'send_message',{to:agent.id,message:'Foreign',attachments:[foreign.id]}),e=>e.status===403);
    agent.kind='ollama';plane.ai={get:()=>({supportsImages:false})};const before=registry.data.messages.length;
    await assert.rejects(registry.call(external,'send_message',{to:agent.id,message:'Vision',attachments:[image.id]}),/vision-capable/);
    await assert.rejects(registry.call(external,'send_group_message',{...groupInput,requestId:'unsupported-image'}),/vision-capable/);
    assert.equal(registry.data.messages.length,before);
    await assert.rejects(registry.call(external,'attachment_upload',{name:'too-big.bin',base64:Buffer.alloc(10*1024*1024+1).toString('base64')}),e=>e.status===413);
  }finally{await f.close();}
});

test('contact client transfers large files, images and binary originals through real MCP and preserves full offloaded text',async()=>{
  const f=await fixture(),{root,registry,plane}=f;let server,bridge;
  const {connectContact,contactCommand}=await import('../scripts/contact-mcp.mjs');
  const {ContextManager}=await import('../lib/context-manager.mjs');
  const {writeFile}=await import('node:fs/promises');
  try{
    plane.data.contextSettings={toolResultChars:2000};plane.context=new ContextManager(plane);
    server=http.createServer(async(req,res)=>{try{
      const actor=registry.authenticate(req.headers.authorization?.replace(/^Bearer /,''));let raw='';for await(const chunk of req)raw+=chunk;const data=raw?JSON.parse(raw):{};
      const value=req.url.endsWith('/catalog')?registry.catalog(actor,{compact:true}):req.url.endsWith('/listed')?{}:await registry.call(actor,data.name,data.input);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
    }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});plane.baseUrl='http://127.0.0.1:'+server.address().port;
    const config=await registry.external.register(root,{...setup,client:'generic'});bridge=await connectContact(config.mcp.args[1]);
    for(const [name,bytes] of [
      ['large.txt',Buffer.from('こんにちは 🐾 evidence\n'.repeat(50000))],
      ['picture.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')],
      ['report.pdf',Buffer.from('%PDF-1.4\n\x00\x01inert fixture')]
    ]){
      const source=path.join(root,name),output=path.join(root,'received-'+name);await writeFile(source,bytes);
      const upload=await contactCommand(bridge,'upload',[source]);assert.equal(upload.size,bytes.length);assert.equal(upload.base64,undefined);
      const received=await contactCommand(bridge,'receive',[upload.id,output]);assert.equal(received.sha256,upload.sha256);assert.deepEqual(await readFile(output),bytes);
      await assert.rejects(contactCommand(bridge,'receive',[upload.id,output]),e=>e.code==='EEXIST');
    }
    const wrong=await plane.images.upload(root,{name:'private.txt',base64:'YQ=='});
    await assert.rejects(contactCommand(bridge,'receive',[wrong.id,path.join(root,'leak.txt')]),/not been sent/);
  }finally{await bridge?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await f.close();}
});
