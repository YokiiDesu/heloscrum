import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatThreads,conversationMessages,replyThreads} from '../dist/chat-threads.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const thread=(id,extra={})=>({id,kind:'group',name:id,project:'/audit',projectName:'Audit',status:'open',participants:[],messages:[],hasMore:false,...extra});
function view(){
  const textarea={value:'original draft'},submit={disabled:false,textContent:'Send'},replyError={textContent:''};
  const form={isConnected:true,querySelector:selector=>selector==='textarea'?textarea:selector==='[type=submit]'?submit:{textContent:''},parentElement:{querySelector:()=>replyError}};
  const instance=Object.assign(Object.create(ChatThreads.prototype),{selected:'a',selectionVersion:0,loadVersion:0,threads:[thread('a'),thread('b')],project:{path:'/audit'},pages:new Map([['a',thread('a')],['b',thread('b')]]),drafts:new Map([['a',textarea.value]]),replyDrafts:new Map(),answerDrafts:new Map(),reopenReasons:new Map(),host:{querySelector:selector=>selector==='.reply-composer [type=submit]'?submit:form},renderList(){},renderDetail(data){this.rendered=data;},errors:[],error(error){if(error)this.errors.push(error.message);}});
  return {instance,textarea,submit,form,replyError};
}
function formData(t,textarea){
  const original=globalThis.FormData;
  globalThis.FormData=class{constructor(){this.text=textarea.value;}get(name){return name==='message'?this.text:'result';}has(){return false;}};
  t.after(()=>{globalThis.FormData=original;});
}

test('a completed send clears only its submitted draft, not another conversation',async t=>{
  const {instance:v,textarea,submit}=view(),pending=deferred();formData(t,textarea);
  v.api=()=>pending.promise;const sending=v.send();assert.equal(submit.disabled,true);
  v.selected='b';textarea.value='other conversation draft';v.drafts.set('b',textarea.value);
  pending.resolve({});await sending;
  assert.equal(textarea.value,'other conversation draft');assert.equal(v.drafts.get('b'),textarea.value);assert.equal(v.drafts.has('a'),false);assert.equal(submit.disabled,false);
});

test('typing the next message while a send completes preserves the new draft',async t=>{
  const {instance:v,textarea}=view(),pending=deferred();formData(t,textarea);
  v.api=route=>route==='groups/message'?pending.promise:Promise.resolve(thread('a'));
  const sending=v.send();textarea.value='next message';v.drafts.set('a',textarea.value);pending.resolve({});await sending;
  assert.equal(textarea.value,'next message');assert.equal(v.drafts.get('a'),'next message');
});

test('failed message retries preserve the draft and reuse the delivery request ID',async t=>{
  const {instance:v,textarea,submit}=view();formData(t,textarea);const ids=[];
  v.api=async(route,payload)=>{ids.push(payload.requestId);throw Error('Connection lost');};
  await assert.rejects(v.send(),/Connection lost/);await assert.rejects(v.send(),/Connection lost/);
  assert.equal(ids[0],ids[1]);assert.equal(textarea.value,'original draft');assert.equal(v.drafts.get('a'),'original draft');assert.equal(submit.disabled,false);
});

test('reply completion preserves edits made after sending',async t=>{
  const {instance:v,textarea,submit}=view(),pending=deferred();formData(t,textarea);
  v.replyRoot='root';v.replyDrafts.set('a:root',textarea.value);
  v.api=route=>route==='groups/message'?pending.promise:Promise.resolve(thread('a'));
  const sending=v.sendReply();textarea.value='additional evidence';v.replyDrafts.set('a:root',textarea.value);pending.resolve({});await sending;
  assert.equal(textarea.value,'additional evidence');assert.equal(v.replyDrafts.get('a:root'),textarea.value);assert.equal(submit.disabled,false);
});

test('a delayed error from the previous conversation does not replace the selected conversation',async()=>{
  const {instance:v}=view(),pending=deferred();v.api=()=>pending.promise;
  const loading=v.load('a');v.selected='b';v.selectionVersion++;pending.reject(Error('A failed'));await loading;
  assert.deepEqual(v.errors,[]);assert.equal(v.rendered,undefined);
});

test('out-of-order loads cannot roll back the current thread status or messages',async()=>{
  const {instance:v}=view(),old=deferred(),latest=deferred();let count=0;
  v.api=()=>++count===1?old.promise:latest.promise;
  const first=v.load('a'),second=v.load('a');latest.resolve(thread('a',{status:'closed',messages:[{id:'new',at:'2026-10-07T12:00:00Z',text:'New result'}]}));await second;
  old.resolve(thread('a',{status:'open'}));await first;
  assert.equal(v.rendered.status,'closed');assert.equal(v.pages.get('a').messages[0].text,'New result');
});

test('older-page responses are ignored after navigating away and back',async()=>{
  const {instance:v}=view(),pending=deferred();v.pages.set('a',thread('a',{hasMore:true,before:'cursor'}));v.api=()=>pending.promise;
  const loading=v.older();v.selectionVersion+=2;pending.resolve(thread('a',{messages:[{id:'old',at:'2026-10-07T10:00:00Z'}]}));await loading;
  assert.equal(v.pages.get('a').messages.length,0);assert.equal(v.loadingOlder,false);
});

test('workspace captures preserve group, reply, question, and reopening drafts',()=>{
  const {instance:v}=view();v.replyDrafts.set('a:root','Reply');v.answerDrafts.set('question','Answer');v.reopenReasons.set('a','New evidence');
  assert.deepEqual(v.capture(),{selected:'a',drafts:[['a','original draft']],replyDrafts:[['a:root','Reply']],answerDrafts:[['question','Answer']],reopenReasons:[['a','New evidence']]});
});

test('background refreshes do not erase an actionable send failure',()=>{
  const status={textContent:''},body={querySelector:()=>null};
  const v=Object.assign(Object.create(ChatThreads.prototype),{host:{querySelector:selector=>selector==='.thread-error'?status:body}});
  v.error(Error('Message could not be sent'));v.error(null,'load');assert.equal(status.textContent,'Message could not be sent');
  v.error(null);assert.equal(status.textContent,'');v.error(Error('Read failed'),'load');v.error(null,'load');assert.equal(status.textContent,'');
});

test('unanswered questions outside the loaded page stay actionable and deduplicate when history arrives',()=>{
  const question={id:'old-question',from:'reviewer',fromRole:'Reviewer',at:'2026-10-01T12:00:00Z',status:'pending',question:'Which material?',options:['PLA']};
  const page=thread('a',{messages:[{id:'reply',at:'2026-10-07T12:00:00Z',replyTo:'old-question'}],userRequests:[question,{...question,id:'answered',status:'answered'},{...question,id:'cancelled',status:'cancelled'}]}),original=structuredClone(page);
  const visible=conversationMessages(page);assert.equal(visible.length,2);assert.equal(visible[0].text,'Which material?');assert.equal(visible[0].earlierQuestion,true);assert.equal(replyThreads(visible).replies.get('old-question').length,1);assert.deepEqual(page,original);
  const actual={...visible[0],earlierQuestion:undefined};page.messages.unshift(actual);assert.equal(conversationMessages(page).filter(message=>message.id==='old-question').length,1);assert.equal(conversationMessages(page)[0],actual);
});
