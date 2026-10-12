import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelClient} from '../lib/model-client.mjs';
import {LOCAL_INFERENCE_TIMEOUTS} from '../lib/local-inference.mjs';

const connection={kind:'lmstudio',baseUrl:'http://localhost:1234/v1',model:'local-model',maxOutputTokens:4096};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const frame=value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\r\n\r\n';
const delta=(value,finish_reason=null)=>({model:'local-model',choices:[{index:0,delta:value,finish_reason}]});
function streamFixture(t,{kind='lmstudio',signal}={}){
  t.mock.timers.enable({apis:['setTimeout']});
  let controller,request,calls=0,cancelled=false;const progress=[];
  const client=new ModelClient({fetcher:async(url,options)=>{
    calls++;request={url,...options};
    return new Response(new ReadableStream({start(c){controller=c;options.signal.addEventListener('abort',()=>c.error(options.signal.reason),{once:true});},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream; charset=utf-8'}});
  }});
  const complete=client.complete({...connection,kind},'private-key',{messages:[{role:'user',content:'Test local transport'}],signal,onProgress:p=>progress.push(p)});
  complete.catch(()=>{});
  const write=value=>controller.enqueue(new TextEncoder().encode(typeof value==='string'?value:frame(value)));
  return {complete,progress,write,close:()=>controller.close(),bytes:value=>controller.enqueue(value),get request(){return request;},get calls(){return calls;},get cancelled(){return cancelled;}};
}

test('local inference can start after the former 90-second deadline',async t=>{
  const f=streamFixture(t);await flush();
  t.mock.timers.tick(95000);await flush();assert.equal(f.request.signal.aborted,false);assert.equal(f.progress.at(-1).phase,'waiting');
  f.write(delta({content:'Ready'},'stop'));f.write(frame('[DONE]'));
  assert.equal((await f.complete).message.content,'Ready');assert.equal(f.calls,1);
  const request=JSON.parse(f.request.body);assert.equal(request.stream,true);assert.equal(request.stream_options.include_usage,true);
  assert.equal(f.request.headers.Authorization,'Bearer private-key');assert.equal(f.request.redirect,'error');assert(f.cancelled);
});
test('active streamed reasoning extends the idle deadline without exposing reasoning',async t=>{
  const f=streamFixture(t);await flush();t.mock.timers.tick(100000);
  for(let i=0;i<6;i++){f.write(delta({reasoning_content:'PRIVATE_REASONING'}));await flush();t.mock.timers.tick(100000);await flush();assert.equal(f.request.signal.aborted,false);}
  f.write(delta({content:'Public reply'},'stop'));f.write({choices:[],usage:{prompt_tokens:123,completion_tokens:42}});f.write(frame('[DONE]'));
  const result=await f.complete;assert.equal(result.usage.completion_tokens,42);assert.equal(result.message.content,'Public reply');
  assert.doesNotMatch(JSON.stringify([result,f.progress]),/PRIVATE_REASONING/);assert.equal(f.progress.at(-1).phase,'receiving');
});
test('LM Studio, Ollama and llama.cpp tool fragments survive UTF-8 boundaries and interleaving',async t=>{
  for(const kind of ['lmstudio','ollama','llamacpp'])await t.test(kind,async t=>{
    const f=streamFixture(t,{kind});await flush();
    const rows=[delta({role:'assistant'}),delta({content:'模型 🦙'}),delta({tool_calls:[{index:0,id:'call_',type:'function',function:{name:'workspace_',arguments:'{"path":'}},{index:1,id:'call_two',type:'function',function:{name:'workspace_read',arguments:'{"path":"second"}'}}]}),delta({tool_calls:[{index:0,id:'one',function:{name:'read',arguments:'"模型.txt"}'}}]}),delta({},'tool_calls'),{choices:[],usage:{prompt_tokens:5,completion_tokens:20}}];
    for(const byte of new TextEncoder().encode(rows.map(frame).join('')+frame('[DONE]')))f.bytes(Uint8Array.of(byte));
    const result=await f.complete;assert.equal(result.message.content,'模型 🦙');assert.equal(result.message.tool_calls.length,2);
    assert.deepEqual(result.message.tool_calls[0],{id:'call_one',type:'function',function:{name:'workspace_read',arguments:'{"path":"模型.txt"}'}});
    assert.equal(result.usage.prompt_tokens,5);assert.equal(f.calls,1);
  });
});
test('a stalled model gets a specific idle timeout, with no automatic retry',async t=>{
  const f=streamFixture(t);await flush();f.write(delta({reasoning_content:'hidden'}));await flush();
  t.mock.timers.tick(LOCAL_INFERENCE_TIMEOUTS.idleMs);
  await assert.rejects(f.complete,e=>e.code==='MODEL_IDLE_TIMEOUT'&&/stopped sending/.test(e.message));assert.equal(f.calls,1);assert(f.request.signal.aborted);
});
test('slow startup is bounded even if the server only sends a role header',async t=>{
  const f=streamFixture(t);await flush();f.write(delta({role:'assistant',content:''}));await flush();
  t.mock.timers.tick(LOCAL_INFERENCE_TIMEOUTS.startMs);
  await assert.rejects(f.complete,e=>e.code==='MODEL_START_TIMEOUT'&&/loaded/.test(e.message));assert.equal(f.calls,1);
});
test('the startup deadline also cancels a server that never sends HTTP headers',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const client=new ModelClient({fetcher:async(url,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const promise=client.complete(connection,null,{messages:[]});promise.catch(()=>{});
  t.mock.timers.tick(LOCAL_INFERENCE_TIMEOUTS.startMs);await assert.rejects(promise,{code:'MODEL_START_TIMEOUT'});assert(signal.aborted);
});
test('even continuous generation has an overall response limit',async t=>{
  const f=streamFixture(t);await flush();
  for(let elapsed=0;elapsed<LOCAL_INFERENCE_TIMEOUTS.totalMs;elapsed+=60000){f.write(delta({reasoning:'hidden'}));await flush();t.mock.timers.tick(60000);}
  await assert.rejects(f.complete,{code:'MODEL_RESPONSE_LIMIT'});assert.equal(f.calls,1);
});
test('interrupt cancels startup and in-progress generation immediately',async t=>{
  for(const started of [false,true])await t.test(started?'receiving':'waiting',async t=>{
    const controller=new AbortController(),f=streamFixture(t,{signal:controller.signal});await flush();
    if(started){f.write(delta({content:'Incomplete'}));await flush();}
    const reason=new Error('User interrupted');controller.abort(reason);await assert.rejects(f.complete,e=>e===reason);assert.equal(f.calls,1);
  });
});
test('truncated or token-limited tool calls never become executable responses',async t=>{
  for(const finish of [null,'length'])await t.test(finish||'connection closed',async t=>{
    const f=streamFixture(t);await flush();f.write(delta({tool_calls:[{index:0,id:'write',function:{name:'workspace_write',arguments:'{"path":"x","content":"incomplete'}}]},finish));f.close();
    await assert.rejects(f.complete,/incomplete|output token limit/);assert.equal(f.calls,1);
  });
});
test('malformed, oversized, and provider-error streams fail without exposing submitted data',async t=>{
  for(const [name,text,pattern] of [
    ['error',frame({error:{message:'private prompt / secret'}}),/generation error/],
    ['bad JSON','data: private prompt / secret\n\n',/invalid response/],
    ['too large','x'.repeat(8*1024*1024+1),/exceeded 8 MiB/],
    ['missing tool ID',frame(delta({tool_calls:[{index:0,function:{name:'read',arguments:'{}'}}]},'tool_calls'))+frame('[DONE]'),/incomplete tool request/]
  ])await t.test(name,async t=>{
    const f=streamFixture(t);await flush();f.write(text);f.close();
    await assert.rejects(f.complete,e=>pattern.test(e.message)&&!/private prompt|secret/.test(e.message));assert.equal(f.calls,1);
  });
});
test('compatible JSON-only servers keep working without a duplicate inference',async()=>{
  let calls=0;const client=new ModelClient({fetcher:async()=>{calls++;return Response.json({model:'json-model',choices:[{message:{role:'assistant',content:'OK'}}],usage:{completion_tokens:2}});}});
  const result=await client.complete(connection,null,{messages:[]});assert.equal(result.message.content,'OK');assert.equal(result.usage.completion_tokens,2);assert.equal(calls,1);
});
test('local HTTP errors and low-level timeouts are readable without echoing provider data',async()=>{
  for(const [fetcher,pattern] of [[async()=>new Response('private prompt / secret',{status:401}),/HTTP 401/],[async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'UND_ERR_HEADERS_TIMEOUT'}});},/took too long to start/]]){
    let calls=0;const client=new ModelClient({fetcher:async(...args)=>{calls++;return fetcher(...args);}});
    await assert.rejects(client.complete(connection,null,{messages:[]}),e=>pattern.test(e.message)&&!/private prompt|secret/.test(e.message));assert.equal(calls,1);
  }
});
