import test from 'node:test';
import assert from 'node:assert/strict';
import {messageEnvelope,messageEvents,directThreadId,chatThreads} from '../lib/chat-messages.mjs';
import {Collaboration} from '../lib/collaboration.mjs';

const qa={id:'11111111-1111-4111-a111-111111111111',role:'QA',prompt:'Verify the changes',project:'pack',phase:'launched',pane:'qa'};
const reviewer={...qa,id:'22222222-2222-4222-a222-222222222222',role:'Reviewer',pane:'review'};
const builder={...qa,id:'33333333-3333-4333-a333-333333333333',role:'Builder',pane:'build'};
function setup(){const prompts=[],plane={root:'/tmp',data:{tasks:[qa,reviewer,builder]},save:async()=>{},herdr:{list:async()=>[qa,reviewer,builder].map(t=>({pane_id:t.pane,interactive_ready:true,agent_status:'idle'})),prompt:async(...args)=>prompts.push(args)}};return {registry:new Collaboration(plane),prompts,plane};}

test('core tools support Kiro schemas while messages still require a recipient',async()=>{
  const {registry}=setup();
  for(const tool of registry.catalog(qa).tools){
    for(const keyword of ['oneOf','anyOf','allOf'])assert.equal(tool.inputSchema[keyword],undefined,`${tool.name}: top-level ${keyword}`);
  }
  await assert.rejects(registry.call(qa,'send_message',{message:'No recipient'}),/recipient.*threadId/);
  assert.equal(registry.data.messages.length,0);
});

test('recorded batched DMs become named messages; unknown or modified envelopes stay ordinary text',async()=>{
  const {registry}=setup();
  const a=await registry.send(qa,reviewer.id,'**F8 is fixed.**\n```js\nMath.imul(a,b)\n```');
  const b=await registry.send(builder,reviewer.id,'Please verify the fix.');
  const raw={id:'turn',type:'message',role:'user',text:messageEnvelope(a)+'\n\n'+messageEnvelope(b)},copy=structuredClone(raw);
  const events=messageEvents([raw],reviewer,registry.data.messages);
  assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.text),[a.text,b.text]);assert.equal(events[0].communication.fromRole,'QA');assert.equal(events[0].communication.toRole,'Reviewer');
  assert(!events[0].text.includes('Reply using'));assert.deepEqual(raw,copy);
  const bad={...raw,text:messageEnvelope(a).replace('F8 is fixed','F8 is broken')};assert.deepEqual(messageEvents([bad],reviewer,registry.data.messages),[bad]);
  assert.deepEqual(messageEvents([raw],builder,registry.data.messages),[raw]);
  const extra={...raw,text:'Human preface\n'+messageEnvelope(a)+'\nAdditional human direction'};
  const mixed=messageEvents([extra],reviewer,registry.data.messages);assert.equal(mixed.length,3);assert.equal(mixed[0].text,'Human preface');assert.equal(mixed[2].text,'Additional human direction');
  assert.deepEqual(messageEvents([{...raw,role:'assistant'}],reviewer,registry.data.messages),[{...raw,role:'assistant'}]);
});

test('the actual delivery batch stays branded, compact, and readable for human and agent messages',async()=>{
  const {registry,prompts}=setup();
  const human=await registry.queuePrompt(reviewer,'hello');
  const agent=await registry.send(qa,reviewer.id,'**Verified.**\nKeep the exact code and wording.',{kind:'result',requiresReply:false});
  await registry.deliver();
  assert.equal(prompts.length,1);
  const text=prompts[0][1];
  assert.equal((text.match(/^\[HeloScrum direct message /gm)||[]).length,2);
  assert.doesNotMatch(text,/^\[\d+ direct message /m);
  assert.doesNotMatch(text,/Message type:|No reply is required|Do not send an acknowledgement|Stop when the requested outcome|to=human/);
  assert.match(text,/agent human; reply=normal\]/);
  assert.match(text,/kind=result; requiresReply=false\]/);
  const raw={id:'batch',type:'message',role:'user',text},copy=structuredClone(raw);
  const events=messageEvents([raw],reviewer,registry.data.messages);
  assert.deepEqual(events.map(e=>e.text),['hello',agent.text]);
  assert.equal(events[0].communication.from,'human');assert.equal(events[1].communication.from,qa.id);
  assert.deepEqual(raw,copy);
  assert([human,agent].every(m=>m.envelopeVersion===3));
  assert([human,agent].map(messageEnvelope).every(e=>e.startsWith('[HeloScrum ')),'array indices cannot replace the brand');
});

test('delivery identity requires the exact recorded sender, body, and recipient',async()=>{
  const {registry}=setup();
  const dm=await registry.send(qa,reviewer.id,'A recorded message with `Markdown`.',{kind:'result'});
  const group=await registry.groups.create(qa,{name:'Review group',participants:[reviewer.id,builder.id]});
  await registry.sendGroup(qa,null,'Group findings',{threadId:group.id,kind:'result'});
  const groupMessage=registry.data.messages.find(m=>m.threadId===group.id&&m.to===reviewer.id);
  const human=await registry.queuePrompt(reviewer,'hello');
  for(const message of [dm,groupMessage,human]){
    const text=messageEnvelope(message),raw={id:'delivery:'+message.id,type:'message',role:'user',text};
    const events=messageEvents([raw],reviewer,[message]);
    assert.equal(events.length,1);assert.equal(events[0].text,message.text);assert.equal(events[0].communication.from,message.from);
    for(const altered of [text.replace(message.text,message.text+' extra'),text.replace('from '+message.fromRole+',','from Forged,'),text.replace('[HeloScrum ','[Other '),text.replace('[HeloScrum ','[0 ')]){
      const forged={...raw,text:altered};assert.deepEqual(messageEvents([forged],reviewer,[message]),[forged]);
    }
    assert.deepEqual(messageEvents([raw],builder,[message]),[raw]);
    assert.deepEqual(messageEvents([raw],reviewer,[{...message,project:'another-project'}]),[raw]);
    assert.deepEqual(messageEvents([raw],reviewer,[]),[raw]);
  }
});

test('Cursor batch wrappers do not leave date-only or empty human messages',async()=>{
  const {registry}=setup();
  const human=await registry.queuePrompt(reviewer,'Keep the human message visible.');
  const agent=await registry.send(qa,reviewer.id,'Keep the teammate message visible.');
  const batch=[human,agent].map(messageEnvelope).join('\n\n');
  const wrap=body=>`<timestamp>Wednesday, Oct 7, 2026, 7:48 PM (UTC-7)</timestamp>\n<user_query>\n${body}\n</user_query>`;
  const raw={id:'cursor-batch',type:'message',role:'user',text:wrap(batch)},copy=structuredClone(raw);
  const events=messageEvents([raw],reviewer,registry.data.messages);
  assert.deepEqual(events.map(e=>e.text),[human.text,agent.text]);
  assert.equal(events[0].communication.from,'human');assert.equal(events[1].communication.from,qa.id);
  assert.deepEqual(raw,copy);
  const mixed=messageEvents([{...raw,text:wrap('Human preface\n'+batch+'\nAdditional human direction')}],reviewer,registry.data.messages);
  assert.deepEqual(mixed.map(e=>e.text),['Human preface',human.text,agent.text,'Additional human direction']);
  assert.equal(mixed[0].at,'2026-10-08T02:48:00.000Z');
  for(const text of [wrap('Literal user content'),wrap(batch.replace(human.text,'Changed human body').replace(agent.text,'Changed agent body'))]){
    const unknown={...raw,text};assert.deepEqual(messageEvents([unknown],reviewer,registry.data.messages),[unknown]);
  }
  assert.deepEqual(messageEvents([raw],builder,registry.data.messages),[raw]);
  assert.deepEqual(messageEvents([{...raw,role:'assistant'}],reviewer,registry.data.messages),[{...raw,role:'assistant'}]);
});

test('compact envelope boundaries preserve added prose and never authenticate an altered body',async()=>{
  const {registry}=setup();
  const message=await registry.send(qa,reviewer.id,'Keep this message exactly.');
  const envelope=messageEnvelope(message);
  assert.match(envelope,/kind=request; requiresReply=true\]/);
  const raw={id:'compact',type:'message',role:'user',text:envelope};
  for(const text of [envelope.replace(message.text,message.text+' Extra direction.'),envelope.replace('[/HeloScrum message]','[/Other message]')]){
    const modified={...raw,text};assert.deepEqual(messageEvents([modified],reviewer,[message]),[modified]);
  }
  const mixed=messageEvents([{...raw,text:'Human preface\n'+envelope+'\nAdditional human direction'}],reviewer,[message]);
  assert.deepEqual(mixed.map(e=>e.text),['Human preface',message.text,'Additional human direction']);
  assert.deepEqual(messageEvents([{...raw,role:'assistant'}],reviewer,[message]),[{...raw,role:'assistant'}]);
});

test('Claude paste wrappers disappear before splitting human and teammate deliveries without changing their bodies',async()=>{
  const {registry}=setup(),task={...reviewer,kind:'claude'};
  const literal='<pasted_content id="42">\nKeep this example literally.\n</pasted_content id="42">';
  const human=await registry.queuePrompt(reviewer,literal);
  human.attachments=[{id:'image-1',kind:'image',name:'example.png',mimeType:'image/png'}];
  const agent=await registry.send(qa,reviewer.id,'**Verified** with `Markdown`.',{kind:'result',requiresReply:false});
  const wrap=(body,newline='\n',id='6657')=>`\n\n<pasted_content id="${id}">${newline}${body}${newline}</pasted_content id="${id}">\n`;
  for(const newline of ['\n','\r\n'])for(const pasteId of ['6657','86ed','A9bF','paste_86ed-2']){
    const batch=[human,agent].map(messageEnvelope).join('\n\n');
    const raw={id:'claude-batch',type:'message',role:'user',text:wrap(batch,newline,pasteId),at:'2026-10-08T20:11:41.653Z'},copy=structuredClone(raw);
    const events=messageEvents([raw],task,registry.data.messages);
    assert.deepEqual(events.map(e=>e.text),[literal,agent.text]);
    assert.deepEqual(events[0].attachments,human.attachments);
    assert.equal(events[0].communication.from,'human');assert.equal(events[1].communication.from,qa.id);
    assert.deepEqual(raw,copy);
    const mixed=messageEvents([{...raw,text:wrap('Keep this preface.\n'+batch+'\nKeep this ending.',newline,pasteId)}],task,registry.data.messages);
    assert.deepEqual(mixed.map(e=>e.text),['Keep this preface.',literal,agent.text,'Keep this ending.']);
    const altered=wrap(batch.replace(agent.text,'Changed body'),newline,pasteId);
    const changed=messageEvents([{...raw,text:altered}],task,registry.data.messages);
    assert.equal(changed.filter(e=>e.communication).length,1);
    assert(changed.some(e=>!e.communication&&e.text.includes('Changed body')));
    assert(messageEvents([raw],{...builder,kind:'claude'},registry.data.messages).every(e=>!e.communication),'paste IDs cannot authenticate a delivery to another agent');
  }
});

for(const id of ['6657','86ed','A9bF','paste_86ed-2'])test(`Claude paste normalization preserves literal content and malformed pairs (${id})`,()=>{
  const task={...reviewer,kind:'claude'},body='Original task\n\n```xml\n<pasted_content id="8">\nLiteral example\n</pasted_content id="8">\n```';
  const wrap=body=>`\n\n<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">\n`;
  const event={id:'initial',type:'message',role:'user',text:wrap(body),at:'2026-10-08T19:26:17.819Z'};
  assert.deepEqual(messageEvents([event],task,[]),[{...event,text:body}]);
  assert.deepEqual(messageEvents([{...event,text:wrap('')}],task,[]),[]);
  const attached={...event,text:wrap(''),attachments:[{id:'image-1'}]};
  assert.deepEqual(messageEvents([attached],task,[]),[{...attached,text:''}]);
  for(const text of [body,wrap(body).replace(`</pasted_content id="${id}">`,`</pasted_content id="${id}0">`),`Explain this:\n${wrap(body)}`,`\`\`\`xml\n${wrap(body)}\`\`\``,wrap(body).replace(`</pasted_content id="${id}">`,''),`</pasted_content id="${id}">`]){
    const literal={...event,text};assert.deepEqual(messageEvents([literal],task,[]),[literal]);
  }
  for(const kind of ['codex','cursor','kiro'])assert.deepEqual(messageEvents([event],{...task,kind},[]),[event]);
  for(const other of [{...event,role:'assistant'},{...event,type:'tool',name:'Read',output:event.text},{...event,communication:{from:'human'}}])assert.deepEqual(messageEvents([other],task,[]),[other]);
});

test('queued work is delivered without resending completed deliveries',async()=>{
  const {registry,prompts}=setup();
  const historical=await registry.send(qa,reviewer.id,'An earlier delivery.');
  historical.delivery='delivered';const before=structuredClone(historical);
  const queued=await registry.send(qa,reviewer.id,'Waiting for an idle agent.');
  await registry.deliver();
  assert.equal(queued.envelopeVersion,3);assert.deepEqual(historical,before);
  assert.equal(prompts.length,1);assert.doesNotMatch(prompts[0][1],/Message type:|An earlier delivery/);
  assert.equal(messageEvents([{id:'new',type:'message',role:'user',text:prompts[0][1]}],reviewer,registry.data.messages)[0].text,queued.text);
});


test('bidirectional DMs form one thread and older messages page beyond the dashboard limit',async()=>{
  const {registry}=setup();
  for(let i=0;i<181;i++){const item=await registry.send(i%2?reviewer:qa,i%2?qa.id:reviewer.id,'Message '+i);item.delivery='delivered';item.at=new Date(1000+i).toISOString();}
  const id=directThreadId(qa.id,reviewer.id),list=registry.threadList('pack');assert.equal(list.length,1);assert.equal(list[0].count,181);assert.equal(list[0].messages,undefined);
  const latest=registry.threadPage('pack',id);assert.equal(latest.messages.length,60);assert.equal(latest.messages.at(-1).text,'Message 180');assert(latest.hasMore);
  const older=registry.threadPage('pack',id,latest.before);assert.equal(older.messages.at(-1).text,'Message 120');
  assert.throws(()=>registry.threadPage('outside',id),/not found/);assert.throws(()=>registry.threadPage('pack',id,'invalid'),/cursor/);
});

test('group messages fan out once, render once, and preserve reply membership and project boundaries',async()=>{
  const {registry,prompts,plane}=setup();
  const receipt=await registry.call(qa,'send_message',{to:[reviewer.id,builder.id],name:'Release checks',message:'Review these results',requestId:'group-start'});
  assert.equal(receipt.deliveries.length,2);assert.equal(registry.data.threads.length,1);
  const again=await registry.call(qa,'send_message',{to:[builder.id,reviewer.id],name:'Release checks',message:'Review these results',requestId:'group-start'});assert.equal(again.id,receipt.id);assert.equal(registry.data.messages.length,2);
  await registry.deliver();assert.equal(prompts.length,2);assert(prompts.every(([,text])=>text.includes('thread '+receipt.threadId)));
  let group=registry.threads('pack')[0];assert.equal(group.name,'Release checks');assert.equal(group.count,1);assert.equal(group.messages[0].deliveries.length,2);
  const incoming=registry.data.messages.find(m=>m.to===reviewer.id);
  const rendered=messageEvents([{id:'u',type:'message',role:'user',text:messageEnvelope(incoming)}],reviewer,registry.data.messages)[0];assert.equal(rendered.communication.kind,'group');assert.equal(rendered.text,'Review these results');
  const response=await registry.call(reviewer,'send_message',{threadId:receipt.threadId,replyTo:incoming.id,message:'Verified'});assert.equal(response.deliveries.length,2);assert(response.deliveries.some(d=>d.to===qa.id));assert(response.deliveries.some(d=>d.to===builder.id));
  group=registry.threads('pack')[0];assert.equal(group.count,2);
  const outsider={...qa,id:'outside',project:'other'};plane.data.tasks.push(outsider);
  await assert.rejects(registry.call(outsider,'send_message',{threadId:receipt.threadId,message:'Intrude'}),/not available/);
  await assert.rejects(registry.send(qa,[reviewer.id,'outside'],'Invalid group'),/not in your project/);
  assert.equal(registry.data.threads.length,1);assert.equal(registry.data.messages.length,4);
  assert.deepEqual(chatThreads(registry.data.messages,registry.data.threads,[],'other'),[]);
  const dm=await registry.send(qa,reviewer.id,'Private follow-up');
  await assert.rejects(registry.send(reviewer,null,'Wrong thread',{threadId:receipt.threadId,replyTo:dm.id}),/does not belong/);
  assert.equal(registry.threadList('pack').length,2);
});

test('full or invalid group inboxes reject the whole send and catalog announces the capability',async()=>{
  const {registry}=setup();
  for(let i=0;i<100;i++)await registry.send(qa,reviewer.id,'Queued '+i);
  await assert.rejects(registry.send(qa,[reviewer.id,builder.id],'Overflow'),/full/);assert.equal(registry.data.messages.length,100);assert.equal(registry.data.threads.length,0);
  await assert.rejects(registry.send(qa,[builder.id,builder.id],'Duplicate'),/different/);
  const tool=registry.catalog({...qa,toolPolicy:{mode:'selected',allowed:[]}}).tools.find(t=>t.name==='send_message');assert.match(tool.description,/group chat/);assert(tool.inputSchema.properties.threadId);
});

test('explicit group tools enforce membership, quiet acknowledgements, closure and reasoned reopening',async()=>{
  const {registry,prompts,plane}=setup();const outsider={...qa,id:'outsider',role:'Observer'};plane.data.tasks.push(outsider);
  const args={name:'Test Drive 2',participants:[reviewer.id,builder.id],requestId:'create-once'};
  const group=await registry.call(qa,'create_group',args);assert.equal(prompts.length,0);assert.equal((await registry.call(qa,'create_group',args)).id,group.id);
  await assert.rejects(registry.call(qa,'create_group',{...args,name:'Different'}),/different/);
  assert.equal((await registry.call(outsider,'list_groups')).groups.length,0);await assert.rejects(registry.call(outsider,'read_group',{threadId:group.id}),/not available/);
  const initial=await registry.call(qa,'send_group_message',{threadId:group.id,message:'Verify the contract',kind:'request',requestId:'request-once'});assert(initial.receiptOnly);
  const ack=await registry.call(reviewer,'send_group_message',{threadId:group.id,message:'Received',kind:'ack',replyTo:initial.id});assert(ack.deliveries.every(d=>d.delivery==='inbox'));
  await registry.deliver();assert.equal(prompts.length,2,'only the request wakes its two recipients');
  await assert.rejects(registry.call(builder,'send_group_message',{threadId:group.id,message:'Thanks',kind:'ack',replyTo:ack.id}),/acknowledgement/);
  await assert.rejects(registry.call(builder,'send_group_message',{threadId:group.id,message:'Please reply to receipt',kind:'ack',requiresReply:true}),/cannot require/);
  await registry.call(builder,'send_group_message',{threadId:group.id,message:'Final result',kind:'result',requiresReply:false});
  await registry.call(qa,'set_chat_status',{threadId:group.id,status:'closed',reason:'All acceptance checks passed'});
  assert.equal((await registry.call(reviewer,'read_group',{threadId:group.id})).status,'closed');assert(registry.data.messages.filter(m=>m.from===builder.id).every(m=>m.delivery==='cancelled'));
  await assert.rejects(registry.call(builder,'send_group_message',{threadId:group.id,message:'Another closing statement',kind:'result'}),/closed/);
  await assert.rejects(registry.call(outsider,'set_chat_status',{threadId:group.id,status:'open',reason:'Intrude'}),/not available/);
  await assert.rejects(registry.call(qa,'set_chat_status',{threadId:group.id,status:'open',reason:''}),/reason/);
  await registry.call(qa,'set_chat_status',{threadId:group.id,status:'open',reason:'A new regression was reproduced'});
  await registry.deliver();assert.equal(prompts.length,2,'reopening does not replay cancelled work');
  const human={id:'human',role:'You',human:true,project:'pack'};const receipt=await registry.sendGroup(human,null,'New requirement',{threadId:group.id,kind:'request'});assert.equal(receipt.deliveries.length,3);
  assert.equal((await registry.call(qa,'list_groups')).groups.length,1);assert.equal((await registry.call(qa,'read_group',{threadId:group.id})).count,4);
  const dm=await registry.send(qa,builder.id,'Private result',{kind:'result'});await registry.call(builder,'set_chat_status',{threadId:dm.conversationId,status:'closed',reason:'No follow-up needed'});await assert.rejects(registry.send(qa,builder.id,'Encore'),/closed/);
});

test('recorded communication guidance is applied without becoming chat prose or changing a sender',async()=>{
  const {registry}=setup();const msg=await registry.send(qa,reviewer.id,'The restart test passed.');
  msg.envelopeVersion=3;msg.conversationStyle='expressive';
  const raw={id:'tone',type:'message',role:'user',text:messageEnvelope(msg)};
  assert.match(raw.text,/communication style: expressive/);
  const [event]=messageEvents([raw],reviewer,registry.data.messages);
  assert.equal(event.text,msg.text);assert.equal(event.communication.from,qa.id);
  const altered={...raw,text:raw.text.replace('style: expressive','style: concise')};
  assert.deepEqual(messageEvents([altered],reviewer,registry.data.messages),[altered]);
});
