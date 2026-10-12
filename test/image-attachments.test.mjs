import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ImageAttachments,imageInfo,MAX_IMAGE_BYTES} from '../lib/image-attachments.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {messageEnvelope,messageEvents,chatThreads} from '../lib/chat-messages.mjs';
import {bedrockRequest,ModelClient} from '../lib/model-client.mjs';
import {ManagedAgents} from '../lib/managed-agents.mjs';
import {estimateTokens,summaryRecords,ContextManager} from '../lib/context-manager.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'helo-images-')),p=new ControlPlane(root),task={id:'worker',project:root,path:root,pane:'pane',phase:'launched',kind:'codex',role:'Worker',prompt:'Test'};p.data.tasks=[task];p.save=async()=>{};p.collaboration=new Collaboration(p);p.data.contextSettings={toolResultChars:2000};p.context=new ContextManager(p);let status='working';const sent=[];p.herdr={list:async()=>[{pane_id:'pane',interactive_ready:true,agent_status:status}],prompt:async(...a)=>sent.push(a)};return {p,task,root,sent,idle:()=>status='idle',close:()=>rm(root,{recursive:true,force:true})};}
test('raster validation rejects mislabeled active content, invalid data and oversized dimensions',async()=>{
 const f=await fixture();try{assert.equal(imageInfo(Buffer.from(png,'base64')).mimeType,'image/png');await assert.rejects(f.p.images.upload(f.root,{name:'script.png',mimeType:'image/png',base64:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}));await assert.rejects(f.p.images.upload(f.root,{name:'wrong.jpg',mimeType:'image/jpeg',base64:png}),/type does not match/);assert.throws(()=>imageInfo(Buffer.alloc(MAX_IMAGE_BYTES+1)),/3 MiB/);const huge=Buffer.from(png,'base64');huge.writeUInt32BE(9000,16);assert.throws(()=>imageInfo(huge),/8,000/);await assert.rejects(f.p.images.select(f.root,['../../outside']));}finally{await f.close();}
});
test('queued images stay private until delivery; edit/requeue, idempotency, scopes and exact bytes survive',async()=>{
 const f=await fixture();try{
 const image=await f.p.images.upload(f.root,{name:'screen.png',base64:png});assert.equal(image.base64,undefined);
 await assert.rejects(f.p.images.select('/other',[image.id]),/another project/);await assert.rejects(f.p.images.select(f.root,Array(5).fill(image.id)),/four distinct/);
 const a=await f.p.promptTask('worker','Inspect this',f.root,{attachments:[image.id],requestId:'first'});assert.equal(a.message.delivery,'queued');assert.equal(a.message.attachments[0].id,image.id);await assert.rejects(f.p.images.readFor(f.task,image.id),/not been sent/);
 assert.equal((await f.p.promptTask('worker','Inspect this',f.root,{attachments:[image.id],requestId:'first'})).message.id,a.message.id);await assert.rejects(f.p.promptTask('worker','Inspect this',f.root,{requestId:'first'}),/another prompt/);
 const cancelled=await f.p.collaboration.cancelPrompt(f.task,a.message.id);assert.equal(cancelled.attachments[0].id,image.id);
 const next=await f.p.promptTask('worker','Updated direction',f.root,{attachments:[image.id]});f.idle();await f.p.collaboration.deliverReady();assert.equal(f.sent.length,1);assert.match(f.sent[0][1],/attachment_read/);
 const result=await f.p.collaboration.call(f.task,'invoke_tool',{name:'attachment_read',input:{id:image.id}});assert.equal(result.mcpResult.content[1].type,'image');assert.equal(result.mcpResult.content[1].data,png);assert(!result.offloaded);
 await assert.rejects(f.p.images.readFor({...f.task,id:'other'},image.id),/not been sent/);
 const delivered=f.p.collaboration.data.messages.find(m=>m.id===next.message.id),events=messageEvents([{id:'e',type:'message',role:'user',text:messageEnvelope(delivered)}],f.task,[delivered]);assert.equal(events[0].attachments[0].id,image.id);assert.equal(chatThreads([delivered],[],[],f.root)[0].messages[0].attachments[0].id,image.id);
 await writeFile(f.p.images.file(image.id,'original.png'),'changed');await assert.rejects(f.p.images.read(f.root,image.id),/changed unexpectedly/);
 }finally{await f.close();}
});
test('steering exposes images only when consumed; unknown managed vision capabilities fail before queueing',async()=>{
 const f=await fixture();try{const image=await f.p.images.upload(f.root,{name:'paste.png',base64:png});const receipt=await f.p.promptTask('worker','Look',f.root,{mode:'steer',attachments:[image.id]});const inbox=await f.p.collaboration.readInbox(f.task,{});assert.equal(inbox.messages[0].id,receipt.message.id);assert.equal((await f.p.images.tool(f.task,image.id)).mcpResult.content[1].data,png);f.idle();await f.p.collaboration.deliverReady();assert.equal(f.sent.length,0);
 f.task.kind='ollama';f.task.connectionId='local';f.p.ai={get:()=>({supportsImages:false})};await assert.rejects(f.p.promptTask('worker','Look again',f.root,{attachments:[image.id]}),/vision-capable/);
 }finally{await f.close();}
});
test('managed history stores references; OpenAI and Bedrock requests carry image content and summaries omit bytes',async()=>{
 const f=await fixture();try{const image=await f.p.images.upload(f.root,{name:'image.png',base64:png});const msg=await f.p.collaboration.queuePrompt(f.task,'Inspect',{mode:'steer',attachments:[image.id]});await f.p.collaboration.readInbox(f.task,{});
 const managed=new ManagedAgents(f.p),messages=[{role:'user',content:[{type:'text',text:'Inspect'},{type:'image_url',image_url:{url:'heloscrum-image:'+image.id}}]}];const sent=await managed.materializeImages({task:f.task},messages);assert.equal(sent[0].content[1].image_url.url,'data:image/png;base64,'+png);assert.equal(messages[0].content[1].image_url.url,'heloscrum-image:'+image.id);
 let body;const model=new ModelClient({fetcher:async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Seen'}}]}));}});await model.complete({kind:'ollama',baseUrl:'http://localhost:11434/v1',model:'vision'},null,{messages:sent});assert.equal(body.messages[0].content[1].type,'image_url');
 assert.equal(bedrockRequest('vision',sent,[],100).messages[0].content[1].image.source.bytes,png);assert.throws(()=>bedrockRequest('vision',[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/webp;base64,AAAA'}}]}],[],100),/PNG/);
 assert(estimateTokens(sent)>=4096&&estimateTokens(sent)<4200);assert(!summaryRecords(sent).includes(png));assert(summaryRecords(messages).includes(image.id));
 }finally{await f.close();}
});
test('text and code attachments are bounded and inert; originals remain scoped and binary support is explicit',async()=>{
 const f=await fixture();try{
 const text='<script>throw Error("never execute")</script>\n'+('code\n'.repeat(6000)),file=await f.p.images.upload(f.root,{name:'example.html',mimeType:'text/html',base64:Buffer.from(text).toString('base64')});assert.equal(file.kind,'text');assert.equal(file.mimeType,'text/plain');await f.p.promptTask('worker','Inspect',f.root,{mode:'steer',attachments:[file.id]});await f.p.collaboration.readInbox(f.task,{});
 const page=await f.p.images.tool(f.task,file.id,{limit:100});assert.equal(page.text,text.slice(0,100));assert.equal(page.nextOffset,100);assert.equal(page.base64,undefined);const next=await f.p.images.tool(f.task,file.id,{offset:100,limit:100});assert.equal(next.text,text.slice(100,200));assert.equal(page.localPath,undefined);
 const pdf=await f.p.images.upload(f.root,{name:'../../example.pdf',base64:Buffer.from('%PDF-1.4\nexample').toString('base64')});assert.equal(pdf.kind,'file');await assert.rejects(f.p.images.tool(f.task,pdf.id),/not been sent/);await f.p.promptTask('worker','Inspect original',f.root,{mode:'steer',attachments:[pdf.id]});await f.p.collaboration.readInbox(f.task,{});const original=await f.p.images.tool(f.task,pdf.id);assert.equal(original.localPath,f.p.images.file(pdf.id,'original.pdf'));assert.equal(original.base64,undefined);
 f.p.ai={get:()=>({supportsImages:false})};assert.doesNotThrow(()=>f.p.images.validateModel({...f.task,kind:'ollama'},[file]));assert.throws(()=>f.p.images.validateModel({...f.task,kind:'ollama'},[pdf]),/Convert other documents/);
 }finally{await f.close();}
});
