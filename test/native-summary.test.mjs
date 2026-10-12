import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {stat} from 'node:fs/promises';
import {nativeSummary} from '../lib/native-summary.mjs';
import {ModelClient} from '../lib/model-client.mjs';

const connection={model:'gpt-6.1-sol'};
const request={messages:[{role:'system',content:'Summarize.'},{role:'user',content:'Private task text 🦙'}],maxTokens:2048};
function fixture(output,code=0){
  let seen;
  const launch=(executable,args,options)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    seen={executable,args,options,stdin:''};
    child.stdin.on('data',c=>seen.stdin+=c.toString());
    child.stdin.on('finish',()=>queueMicrotask(()=>{for(const byte of Buffer.from(output))child.stdout.write(Buffer.from([byte]));child.stdout.end();child.stderr.end();child.emit('close',code);}));
    return child;
  };
  return {launch,get seen(){return seen;}};
}
test('native summary uses isolated stdin input, bounded tools, low effort, and cleans its directory',async()=>{
  const f=fixture(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Keep mint accents 🦙.'}})+'\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:123,output_tokens:8}})+'\n');
  const result=await nativeSummary('/test/codex',connection,request,f.launch);
  assert.equal(result.message.content,'Keep mint accents 🦙.');assert.equal(result.usage.input_tokens,123);
  assert(JSON.parse(f.seen.stdin).messages[1].content.includes('Private task'));assert(!f.seen.args.join(' ').includes('Private task'));
  for(const flag of ['--ephemeral','--ignore-user-config','--ignore-rules','read-only','shell_tool','hooks','multi_agent'])assert(f.seen.args.includes(flag));
  assert(f.seen.args.includes('model_reasoning_effort="low"'));
  await assert.rejects(stat(f.seen.options.cwd),{code:'ENOENT'});
});
test('native summary errors never echo provider output and always clean temporary records',async()=>{
  const f=fixture('private task and credentials',1);
  await assert.rejects(nativeSummary('/test/codex',connection,request,f.launch),error=>/summary failed/.test(error.message)&&!error.message.includes('credentials'));
  await assert.rejects(stat(f.seen.options.cwd),{code:'ENOENT'});
});
test('incomplete, invalid, and oversized native summaries are rejected',async()=>{
  for(const output of ['not JSON',JSON.stringify({type:'turn.completed'}),JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'x'.repeat(9000)}})+'\n'+JSON.stringify({type:'turn.completed'})]){
    const f=fixture(output);await assert.rejects(nativeSummary('/test/codex',connection,request,f.launch));
  }
});
test('cancelled requests and tool-enabled connections do not launch a summarizer',async()=>{
  await assert.rejects(nativeSummary('/test/codex',connection,{...request,signal:AbortSignal.abort()},()=>{assert.fail('Must not launch');}),/cancelled/);
  await assert.rejects(new ModelClient().complete({kind:'codex-summary',model:'gpt-6.1-sol'},null,{messages:[],tools:[{}]}),/do not run agent tools/);
});
test('Claude summaries use the existing account, disable tools/customizations, and report the matching model',async()=>{
  const f=fixture(JSON.stringify({is_error:false,result:'Keep mint accents.',modelUsage:{'claude-haiku-helper':{},'claude-sonnet-5':{}},usage:{input_tokens:90,output_tokens:5}}));
  const result=await nativeSummary('/test/claude',{kind:'claude-summary',model:'sonnet'},request,f.launch);
  assert.equal(result.model,'claude-sonnet-5');assert.equal(result.message.content,'Keep mint accents.');
  for(const flag of ['--safe-mode','--strict-mcp-config','--no-session-persistence'])assert(f.seen.args.includes(flag));
  assert.equal(f.seen.args[f.seen.args.indexOf('--tools')+1],'');assert.equal(f.seen.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'2048');
  assert(!f.seen.args.join(' ').includes('Private task'));await assert.rejects(stat(f.seen.options.cwd),{code:'ENOENT'});
});
test('Claude summary refuses an unexpected reported model and provider errors',async()=>{
  for(const response of [{result:'OK',modelUsage:{'claude-haiku-4-5':{}}},{is_error:true,result:'private prompt'}]){
    const f=fixture(JSON.stringify(response));await assert.rejects(nativeSummary('/test/claude',{kind:'claude-summary',model:'sonnet'},request,f.launch));
  }
});
