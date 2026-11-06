import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {assert} from './adapters.mjs';
import {thinkingEvent} from './thinking-events.mjs';
import {providerStatus} from '../dist/gemini-controls.js';

// Gemini CLI's ACP v1 transport: https://geminicli.com/docs/cli/acp-mode/
// Keep execution and permissions in the CLI; HeloScrum presents its requests.
export const geminiArgs=task=>['--acp','--approval-mode',task.nativeSetup?.geminiMode==='plan'?'plan':'default',...(task.model?['--model',task.model]:[])];
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const printable=value=>typeof value==='string'?value:JSON.stringify(value);
export function geminiEdits(content=[]){return (Array.isArray(content)?content:[]).filter(c=>c?.type==='diff'&&typeof c.path==='string'&&(c.oldText===null||c.oldText===undefined||typeof c.oldText==='string')&&typeof c.newText==='string').map(c=>({path:c.path,oldText:c.oldText??null,newText:c.newText}));}
export function geminiCommands(commands=[]){
  const seen=new Set();return (Array.isArray(commands)?commands:[]).filter(c=>typeof c?.name==='string'&&/^[a-z][a-z0-9_:-]{0,99}$/i.test(c.name)&&!seen.has(c.name)&&seen.add(c.name)).slice(0,200).map(c=>({name:'/'+c.name,description:typeof c.description==='string'?c.description.slice(0,2000):'',args:typeof c.input?.hint==='string'?c.input.hint.slice(0,300):'Optional arguments supported by this command',usesModel:true}));
}
const count=value=>Number.isFinite(value)&&value>=0?value:null;
export function geminiUsage(records=[],context){
  const measured=records.filter(r=>r.purpose==='agent'&&r.usage&&count(r.usage.totalTokens)!==null);
  const sum=key=>measured.length&&measured.every(r=>count(r.usage[key])!==null)?measured.reduce((n,r)=>n+r.usage[key],0):null;
  return {turns:records.filter(r=>r.purpose==='agent').length,measuredTurns:measured.length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),totalTokens:sum('totalTokens'),cachedReadTokens:sum('cachedReadTokens'),thoughtTokens:sum('thoughtTokens'),last:records.at(-1)?.usage||null,models:records.at(-1)?.providerResult?._meta?.quota?.model_usage?.map(m=>m.model).filter(m=>typeof m==='string')||[],context:count(context?.used)!==null&&count(context?.size)>0?{used:context.used,size:context.size,percent:Math.min(100,Math.round(context.used/context.size*100)),at:context.at||null}:null};
}
export function geminiContent(content=[]){
  return content.map(item=>item.type==='content'&&item.content?.type==='text'?item.content.text:item.type==='diff'?`${item.path}\n--- Before\n${item.oldText??''}\n+++ After\n${item.newText??''}`:item.type==='content'&&item.content?.type==='resource_link'?item.content.uri:'').filter(Boolean).join('\n\n');
}
export function geminiPermission(params){
  const call=params.toolCall;
  assert(call&&typeof call.toolCallId==='string'&&Array.isArray(params.options)&&params.options.length>0&&params.options.length<=16,'Invalid Gemini permission request',502);
  const ids=new Set();
  const options=params.options.map(option=>{
    assert(typeof option.optionId==='string'&&option.optionId.length<=200&&!ids.has(option.optionId)&&['allow_once','allow_always','reject_once','reject_always'].includes(option.kind)&&typeof option.name==='string','Invalid Gemini permission option',502);ids.add(option.optionId);
    return {id:option.optionId,label:option.kind==='allow_once'?'Allow once':option.kind==='reject_once'?'Deny':option.name,description:option.kind.endsWith('_always')?'Updates Gemini’s permission policy.':option.name};
  });
  const mcp=call._meta?.['gemini-cli']?.mcp;
  const name=mcp?.tool_name||call.name||({execute:'shell',read:'read',search:'read',edit:'write',delete:'write',move:'write',fetch:'web'})[call.kind]||call.title||'Gemini tool';
  return {type:'tool-approval',title:call.title||'Gemini tool permission',identity:randomUUID(),edits:geminiEdits(call.content),details:[call.title,call.rawInput==null?'':printable(call.rawInput),geminiContent(call.content),...(call.locations||[]).map(l=>l.path)].filter(Boolean).join('\n\n'),tool:{name,...(mcp?.server_name?{server:mcp.server_name}:{}),arguments:call.rawInput==null?'':printable(call.rawInput)},options};
}

// One reducer per turn prevents repeated chunks and partial tool updates from
// becoming duplicate transcript rows. Only displayable reasoning is retained.
export class GeminiEvents {
  constructor(){this.chunk=null;this.tools=new Map();}
  update(update){
    const kind=update.sessionUpdate;
    if(['agent_message_chunk','agent_thought_chunk'].includes(kind)){
      if(update.content?.type!=='text'||!update.content.text)return null;
      const status=kind==='agent_message_chunk'&&providerStatus({type:'message',role:'assistant',text:update.content.text},'gemini');
      if(status){this.chunk=null;return {id:randomUUID(),type:'session-mode',mode:status.mode,text:status.text};}
      if(this.chunk?.kind!==kind)this.chunk={id:randomUUID(),kind,text:''};
      if(kind==='agent_thought_chunk'&&this.chunk.text.trim()&&/^\*\*[^*\n]+\*\*\r?\n/.test(update.content.text))this.chunk.text+='\n\n';
      this.chunk.text+=update.content.text;
      return kind==='agent_thought_chunk'?thinkingEvent({id:this.chunk.id},this.chunk.text):{id:this.chunk.id,type:'message',role:'assistant',text:this.chunk.text};
    }
    if(!['tool_call','tool_call_update'].includes(kind))return null;
    this.chunk=null;
    assert(typeof update.toolCallId==='string'&&update.toolCallId.length<=500,'Invalid Gemini tool call',502);
    const old=this.tools.get(update.toolCallId)||{id:randomUUID(),type:'tool',name:'Gemini tool',input:'',output:'',status:'running'};
    const event={...old,...(update.name||update.title?{name:update.name||update.title}:{}),...(update.rawInput!=null?{input:printable(update.rawInput)}:{}),...(update.rawOutput!=null?{output:printable(update.rawOutput)}:update.content?{output:geminiContent(update.content)}:{}),...(update.status?{status:({pending:'running',in_progress:'running',completed:'completed',failed:'failed'})[update.status]||'running'}:{})};
    if(update.content?.some(c=>c.type==='diff'))event.edits=geminiEdits(update.content);
    this.tools.set(update.toolCallId,event);return event;
  }
}

export class GeminiClient {
  constructor({executable,task,mcpServers=[],spawnProcess=spawn,onUpdate=()=>{},onMetadata=()=>{},onPermission=async()=>({outcome:{outcome:'cancelled'}}),timeout=60000}){
    Object.assign(this,{executable,task,mcpServers,spawnProcess,onUpdate,onMetadata,onPermission,timeout});this.pending=new Map();this.nextId=0;this.stderr='';this.buffer='';this.active=false;this.metadataQueue=[];
  }
  send(message){assert(!this.failure,'Gemini CLI is disconnected',502);this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
  rpc(method,params,timeout=this.timeout){
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const id=++this.nextId,timer=timeout?setTimeout(()=>this.stop(Error(`Gemini CLI timed out during ${method}. Check Gemini login and MCP startup.`)),timeout):null;
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(error){this.stop(error);}
    });
  }
  receive(line){
    if(!line.trim()||this.failure)return;
    let row;try{row=JSON.parse(line);}catch{this.stop(Error('Gemini CLI returned invalid ACP JSON'));return;}
    if(!row||typeof row!=='object'||Array.isArray(row)||row.jsonrpc!=='2.0'){this.stop(Error('Gemini CLI returned an invalid ACP message'));return;}
    if(row.method==='session/update'){
      this.lastUpdateAt=Date.now();
      if(row.params?.update?.sessionUpdate==='available_commands_update')this.commandsSession=row.params.sessionId;
      // Metadata may arrive while idle; replayed transcript chunks remain ignored.
      const metadata=['available_commands_update','current_mode_update','plan','usage_update'].includes(row.params?.update?.sessionUpdate);
      if(metadata&&!this.sessionId){if(this.metadataQueue.length<32)this.metadataQueue.push(row.params);return;}
      if(metadata&&row.params?.sessionId===this.sessionId){try{this.onMetadata(row.params.update);}catch(error){this.stop(error);}return;}
      if(this.active&&row.params?.sessionId===this.sessionId){try{this.onUpdate(row.params.update);}catch(error){this.stop(error);}}
      else if(this.active&&row.params?.sessionId!==this.sessionId)this.stop(Error('Gemini session identity changed unexpectedly'));
    }else if(row.method&&row.id!==undefined){
      if(row.method!=='session/request_permission'){this.send({id:row.id,error:{code:-32601,message:'Client method not supported'}});return;}
      const allowed=this.active&&row.params?.sessionId===this.sessionId;
      Promise.resolve().then(()=>allowed?this.onPermission(row.params):{outcome:{outcome:'cancelled'}}).then(result=>{if(!this.failure)this.send({id:row.id,result});}).catch(error=>this.stop(error));
    }else if(row.id!==undefined){
      const request=this.pending.get(row.id);if(!request)return;
      this.pending.delete(row.id);clearTimeout(request.timer);
      if(row.error)request.reject(Object.assign(Error(`Gemini CLI: ${row.error.message||'ACP request failed'}${row.error.code===-32000?' Run gemini in a terminal to finish signing in, then retry.':''}`),{code:row.error.code,status:502}));
      else request.resolve(row.result);
    }
  }
  async start(sessionId){
    assert(this.executable,'Gemini CLI is not installed. Install gemini or set HELOSCRUM_GEMINI_BIN.',503);
    assert(!sessionId||uuid(sessionId),'Invalid saved Gemini session ID');
    const child=this.child=this.spawnProcess(this.executable,geminiArgs(this.task),{cwd:this.task.path,env:{...process.env,GEMINI_CLI_NO_RELAUNCH:'1'},stdio:['pipe','pipe','pipe']});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',data=>{
      this.buffer+=data;let end;
      while((end=this.buffer.indexOf('\n'))>=0){if(end>2*1024*1024){this.stop(Error('Gemini ACP event exceeded its size limit'));return;}this.receive(this.buffer.slice(0,end));this.buffer=this.buffer.slice(end+1);}
      if(this.buffer.length>2*1024*1024)this.stop(Error('Gemini ACP event exceeded its size limit'));
    });
    child.stderr.on('data',data=>{this.stderr=(this.stderr+data).slice(-3000);});
    child.stdin.on('error',error=>this.stop(error));child.on('error',error=>this.stop(error));
    child.on('close',code=>{this.exited=true;clearTimeout(this.killTimer);this.stop(Error(`Gemini CLI exited (${code??'signal'}). ${this.stderr||'Check Gemini login and model availability.'}`));});
    try{
      const init=await this.rpc('initialize',{protocolVersion:1,clientInfo:{name:'heloscrum',version:'0.4.0'},clientCapabilities:{}});
      assert(init?.protocolVersion===1,'Gemini CLI does not support ACP v1. Update Gemini CLI.',502);this.capabilities=init.agentCapabilities||{};
      assert(!sessionId||this.capabilities.loadSession,'This Gemini CLI cannot load saved sessions. Update Gemini CLI.',502);
      const session=await this.rpc(sessionId?'session/load':'session/new',{cwd:this.task.path,mcpServers:this.mcpServers,...(sessionId?{sessionId}:{})});
      this.sessionId=sessionId||session?.sessionId;assert(uuid(this.sessionId),'Gemini CLI did not return a valid session ID',502);
      this.model=session?.models?.currentModelId||null;this.modes=session?.modes||null;this.models=session?.models||null;
      this.onMetadata({sessionUpdate:'session_config',modes:this.modes,models:this.models});
      for(const row of this.metadataQueue.splice(0))if(row.sessionId===this.sessionId)this.onMetadata(row.update);
      // Gemini 0.67 streams saved history after the load response. Its command
      // advertisement follows startup replay; drain that burst while inactive.
      // Never submit the next prompt while those chunks can become new output.
      if(sessionId){
        const deadline=Date.now()+this.timeout;
        while(this.commandsSession!==this.sessionId||Date.now()-(this.lastUpdateAt||0)<150){
          if(this.failure)throw this.failure;
          assert(Date.now()<deadline,'Gemini saved-history replay did not finish. Update Gemini CLI and resume again.',502);
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      }
      if(!sessionId&&this.task.nativeSetup?.geminiMode==='plan')await this.setMode('plan');
      // An explicit model selection also applies when loading saved history.
      if(this.task.model)await this.rpc('session/set_model',{sessionId:this.sessionId,modelId:this.task.model});
      return this.sessionId;
    }catch(error){this.stop(error);throw error;}
  }
  async setMode(modeId){
    assert(this.modes?.availableModes?.some(m=>m.id===modeId),'This mode is not advertised by Gemini CLI',409);
    await this.rpc('session/set_mode',{sessionId:this.sessionId,modeId});
    this.modes.currentModeId=modeId;this.onMetadata({sessionUpdate:'current_mode_update',currentModeId:modeId});
  }
  async prompt(prompt,signal){
    signal.throwIfAborted();this.active=true;
    const cancel=()=>{if(this.failure)return;this.send({method:'session/cancel',params:{sessionId:this.sessionId}});this.cancelTimer=setTimeout(()=>this.stop(Error('Gemini turn interrupted')),2000);};
    signal.addEventListener('abort',cancel,{once:true});
    try{return await this.rpc('session/prompt',{sessionId:this.sessionId,prompt},0);}
    finally{this.active=false;signal.removeEventListener('abort',cancel);clearTimeout(this.cancelTimer);}
  }
  stop(error=Error('Gemini CLI session closed')){
    if(this.failure)return;this.failure=error;this.active=false;clearTimeout(this.cancelTimer);
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();
    if(this.child&&!this.exited){this.child.kill('SIGTERM');this.killTimer=setTimeout(()=>{if(!this.exited)this.child.kill('SIGKILL');},1500);this.killTimer.unref();}
  }
}
