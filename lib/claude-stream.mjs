import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {assert} from './adapters.mjs';

// A long-lived `claude --print` process driven over stdin/stdout in stream-json.
// Each line is one JSON message. The CLI emits transcript records (system,
// user, assistant, stream_event, result), control requests it needs answered
// (permission prompts), and control responses to requests HeloScrum sends
// (interrupt). No --bare: the user's own Claude Code login, settings, hooks and
// plugins stay in force. Verified against Claude Code 2.1.318.
const LIMIT=8*1024*1024;
export const STREAM_FLAGS=['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--replay-user-messages','--permission-prompt-tool','stdio'];
export class ClaudeStream {
  constructor(executable,args,{cwd,env=process.env,spawnProcess=spawn,timeoutMs=20000}={}){Object.assign(this,{executable,args,cwd,env,spawnProcess,timeoutMs});this.pending=new Map();this.child=null;this.messageListeners=new Set();this.requestHandler=null;this.closeListeners=new Set();}
  onMessage(listener){this.messageListeners.add(listener);return ()=>this.messageListeners.delete(listener);}
  onRequest(handler){this.requestHandler=handler;}
  onClose(listener){this.closeListeners.add(listener);return ()=>this.closeListeners.delete(listener);}
  get connected(){return !!this.child;}
  start(){
    assert(this.executable,'Claude Code is not installed',503);assert(!this.child,'Claude Code is already running',409);
    const child=this.spawnProcess(this.executable,[...STREAM_FLAGS,...this.args],{cwd:this.cwd,stdio:['pipe','pipe','pipe'],env:{...this.env}});this.child=child;let buffer='',stderr='';
    child.stdout.setEncoding?.('utf8');child.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});child.stdin.on('error',()=>{});
    const closed=(code,error)=>{
      if(this.child!==child)return;this.child=null;
      const last=stderr.trim().split('\n').filter(Boolean).pop();
      const reason=error instanceof Error?error:Error(code===0||code===null?'Claude Code exited':`Claude Code exited with code ${code}`+(last?': '+last:''));
      for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(reason);}this.pending.clear();
      for(const listener of this.closeListeners)listener(reason,code);
    };
    child.on('error',error=>closed(null,error));child.on('close',code=>closed(code));
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>LIMIT){closed(null,Error('Claude Code message exceeded its size limit'));child.kill();return;}let end;
      while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;let message;try{message=JSON.parse(line);}catch{continue;}this.receive(message,child);}
    });
    return child;
  }
  receive(message,child){
    if(message.type==='control_request'){
      // A request from the CLI: permission prompts and questions. Always answer.
      const id=message.request_id;
      Promise.resolve().then(()=>this.requestHandler?this.requestHandler(message.request||{},id):Promise.reject(Error('Unsupported control request'))).then(
        response=>this.write(child,{type:'control_response',response:{subtype:'success',request_id:id,response:response??{}}}),
        error=>this.write(child,{type:'control_response',response:{subtype:'error',request_id:id,error:error?.message||'Request failed'}}));
      return;
    }
    if(message.type==='control_response'){
      // The CLI also echoes HeloScrum's own responses; those carry no pending ID.
      const response=message.response||{},request=this.pending.get(response.request_id);if(!request)return;this.pending.delete(response.request_id);clearTimeout(request.timer);
      if(response.subtype==='error')request.reject(Object.assign(Error(response.error||'Claude Code refused the request'),{status:502}));else request.resolve(response.response||{});
      return;
    }
    for(const listener of this.messageListeners){try{listener(message);}catch{}}
  }
  write(child,message){try{child.stdin.write(JSON.stringify(message)+'\n');}catch{}}
  send(message){assert(this.child,'Claude Code is not running',503);this.write(this.child,message);}
  request(subtype,params={},{timeoutMs=this.timeoutMs}={}){
    assert(this.child,'Claude Code is not running',503);
    return new Promise((resolve,reject)=>{const id=randomUUID(),timer=timeoutMs?setTimeout(()=>{this.pending.delete(id);reject(Object.assign(Error(`Claude Code did not answer ${subtype} in time`),{status:504}));},timeoutMs):null;this.pending.set(id,{resolve,reject,timer});this.write(this.child,{type:'control_request',request_id:id,request:{subtype,...params}});});
  }
  // End the conversation: closing stdin lets the CLI finish and exit on its own;
  // a process that does not leave within the grace period is killed.
  close({graceMs=5000}={}){
    const child=this.child;if(!child)return Promise.resolve();
    return new Promise(resolve=>{
      let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{try{child.kill();}catch{}},graceMs);
      child.once('close',finish);child.once('error',finish);
      try{child.stdin.end();}catch{}
      if(child.exitCode!==null&&child.exitCode!==undefined)finish();
    });
  }
}
