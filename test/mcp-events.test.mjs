import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Webhook} from 'standardwebhooks';
import {McpEvents} from '../lib/mcp-events.mjs';
import {callbackURL,publicAddress,signingSecret,webhookFetch,signedPost} from '../lib/event-webhooks.mjs';

const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
const otherSecret='whsec_'+Buffer.alloc(32,9).toString('base64');
const params=(extra={})=>({name:'message.created',arguments:{project_id:'p',channel:'all'},delivery:{mode:'webhook',url:'https://callback.example/receiver',secret},...extra});
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'hs-events-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const f={dir,now:Date.now(),messages:[],sent:[],groups:[{id:'g'}],status:204,revoked:false,failPage:false,verification:true};
  const contact={id:'c',project:'/project',externalSessionId:'cloud'};
  const call=async(name,input)=>{
    if(name==='contact_identity'){if(f.revoked)throw Error('Revoked');return contact;}
    if(name==='list_groups')return {groups:f.groups};
    if(name==='read_inbox'){
      const index=input.after?f.messages.findIndex(m=>m.id===input.after)+1:0;
      if(f.failPage&&index>0)throw Error('Page unavailable');
      const messages=f.messages.slice(index,index+2);return {messages,hasMore:index+2<f.messages.length,nextCursor:messages.at(-1)?.id};
    }
    if(name==='ack_inbox')return {acknowledged:input.ids};
    if(name==='attachment_read')return {mcpResult:{content:[{type:'image',data:'AA==',mimeType:'image/png'}]}};
    return {};
  };
  const fetcher=async(url,options)=>{
    const body=JSON.parse(options.body);f.sent.push({url,options,body});
    if(body.type==='verification')return {status:200,ok:true,json:async()=>({challenge:f.verification?body.challenge:'wrong'})};
    return {status:f.status,ok:f.status>=200&&f.status<300,json:async()=>({})};
  };
  const config={file:path.join(dir,'events.json'),contact,projectId:'p',call,catalog:async()=>({tools:[{name:'read_inbox'},{name:'send_message'},{name:'attachment_read'}]}),now:()=>f.now,fetcher};
  f.make=async()=>new McpEvents(config).init();f.events=await f.make();
  f.message=(id,extra={})=>({id,at:new Date(f.now+1).toISOString(),from:'sender',text:'hello',kind:'request',...extra});
  return f;
}

test('MCP 2.0 discovery, safe tools, scoped identity and attachment content',async t=>{
  const f=await fixture(t);
  const discover=await f.events.rpc('owner',{id:1,method:'server/discover'});
  assert.deepEqual(discover.result.supportedVersions,['2026-07-28']);assert.deepEqual(discover.result.capabilities.events,{});
  const tools=await f.events.rpc('owner',{id:2,method:'tools/list'});assert.deepEqual(tools.result.tools.map(t=>t.name),['read_inbox','attachment_read']);
  const denied=await f.events.rpc('owner',{id:3,method:'tools/call',params:{name:'send_message'}});assert.equal(denied.error.code,-32602);
  const media=await f.events.rpc('owner',{id:4,method:'tools/call',params:{name:'attachment_read',arguments:{id:'image'}}});assert.equal(media.result.content[0].type,'image');assert.equal(media.result.resultType,'complete');
});
test('subscription verification, canonical identity, persistence and key rotation',async t=>{
  const f=await fixture(t),first=await f.events.subscribe('owner',params());
  assert.equal(f.sent.length,1);const verification=f.sent[0];
  assert.equal(new Webhook(secret).verify(verification.options.body,verification.options.headers).challenge,verification.body.challenge);
  const again=await f.events.subscribe('owner',params({arguments:{channel:'all',project_id:'p'}}));assert.equal(again.id,first.id);assert.equal(f.sent.length,1);
  f.events=await f.make();const rotated=await f.events.subscribe('owner',params({delivery:{mode:'webhook',url:params().delivery.url,secret:otherSecret}}));assert.equal(rotated.id,first.id);
  f.messages=[f.message('1')];await f.events.tick();const event=f.sent.at(-1);assert.equal(event.options.headers['webhook-signature'].split(' ').length,2);
  assert.equal(new Webhook(secret).verify(event.options.body,event.options.headers).data.delivery_id,'1');assert.equal(new Webhook(otherSecret).verify(event.options.body,event.options.headers).data.delivery_id,'1');
  assert.equal(f.events.state.subscriptions.length,1);assert.equal(f.events.state.pending[0].accepted,true);
});
test('verification failures, wrong principal/filter and malformed secrets fail closed',async t=>{
  const f=await fixture(t);f.verification=false;
  await assert.rejects(()=>f.events.subscribe('owner',params()),e=>e.code===-32015&&e.data.reason==='challenge_failed');assert.equal(f.events.state.subscriptions.length,0);
  f.verification=true;await assert.rejects(()=>f.events.subscribe('owner',params({arguments:{project_id:'other'}})));
  await assert.rejects(()=>f.events.subscribe('someone-else',params()));
  for(const value of ['plain','whsec_eA==','whsec_!!!!'])assert.throws(()=>signingSecret(value));
  await assert.rejects(()=>f.events.subscribe('owner',params({ttlMs:0})));
});
test('pagination, filtering, duplicate reads and acknowledgements do not produce extra events',async t=>{
  const f=await fixture(t);await f.events.subscribe('owner',params({arguments:{project_id:'p',channel:'group'}}));
  f.messages=[f.message('d'),f.message('g',{threadId:'g',groupMessageId:'gm'}),f.message('a',{kind:'ack',threadId:'g'}),f.message('private',{threadId:'not-member'})];
  await f.events.tick();await f.events.tick();const events=f.sent.filter(s=>s.body.eventId);assert.equal(events.length,1);assert.equal(events[0].body.data.message_id,'gm');
  assert.equal(events[0].body.data.group_id,'g');assert.equal(f.messages.length,4);
  const result=await f.events.rpc('owner',{id:5,method:'tools/call',params:{name:'ack_inbox',arguments:{ids:['g']}}});assert.equal(result.result.isError,undefined);
});
test('failed page preserves the outbox checkpoint and delivers after recovery',async t=>{
  const f=await fixture(t);await f.events.subscribe('owner',params());f.messages=[f.message('1'),f.message('2'),f.message('3')];f.failPage=true;
  await assert.rejects(()=>f.events.tick(),/Page unavailable/);assert.equal(f.events.state.seen.length,0);assert.equal(f.sent.length,1);
  f.failPage=false;await f.events.tick();assert.equal(f.events.state.seen.length,3);assert.equal(f.events.state.pending.filter(p=>!p.finished).length,2);
});
test('transient delivery retries preserve event ID across restart; 410 and 413 stop',async t=>{
  const f=await fixture(t);await f.events.subscribe('owner',params());f.messages=[f.message('1')];f.status=503;await f.events.tick();const first=f.sent.at(-1);
  f.events=await f.make();f.now+=5000;f.status=204;await f.events.tick();const second=f.sent.at(-1);assert.equal(first.body.eventId,second.body.eventId);assert.notEqual(first.options.headers['webhook-timestamp'],second.options.headers['webhook-timestamp']);
  f.messages.push(f.message('2'));f.status=413;await f.events.tick();const count=f.sent.length;f.now+=10000;await f.events.tick();assert.equal(f.sent.length,count);
  f.messages.push(f.message('3'));f.status=410;await f.events.tick();assert.equal(f.events.state.subscriptions[0].expiresAt,f.now);
});
test('expiration, unsubscribe and revoked group/contact access prevent delivery',async t=>{
  const f=await fixture(t);const sub=await f.events.subscribe('owner',params({ttlMs:1000}));assert.equal(Date.parse(sub.refreshBefore),f.now+1000);
  f.now+=1001;f.messages=[f.message('1')];await f.events.tick();assert.equal(f.sent.length,1);
  await f.events.subscribe('owner',params());f.revoked=true;await assert.rejects(()=>f.events.tick(),/Revoked/);assert.equal(f.sent.length,1);
  f.revoked=false;f.messages=[f.message('2',{threadId:'g'})];f.status=503;await f.events.tick();f.groups=[];f.now+=5000;await f.events.tick();assert.equal(f.events.state.pending.length,0);
  await f.events.unsubscribe('owner',params());await f.events.unsubscribe('owner',params());assert.equal(f.events.state.subscriptions.length,0);
  const saved=JSON.parse(await readFile(path.join(f.dir,'events.json')));assert.equal(saved.subscriptions.length,0);
});
test('webhook destinations reject local/private/reserved addresses and mixed DNS answers',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.0.2.1','198.51.100.3','203.0.113.10','224.0.0.1','::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  for(const url of ['http://example.com','https://u:p@example.com','https://example.com:8080','https://example.com/#fragment'])assert.throws(()=>callbackURL(url));
  await assert.rejects(()=>webhookFetch('https://callback.example',{headers:{},body:'{}'},async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/non-public/);
  await assert.rejects(()=>signedPost({secret,url:'https://callback.example',id:'s'},'e',{text:'x'.repeat(262144)},()=>{throw Error('must not fetch');}),/256 KiB/);
});
