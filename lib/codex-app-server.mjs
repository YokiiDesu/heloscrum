import {spawn} from 'node:child_process';
import {assert} from './adapters.mjs';

// JSON-RPC client for `codex app-server --listen stdio://`. Codex omits the
// jsonrpc field on the wire; requests carry id+method+params, notifications
// have no id, and the server also sends requests (approvals) that must be
// answered with the same id. Verified against codex-cli 0.163.0.
const LIMIT=8*1024*1024;
export class CodexAppServer {
  constructor(executable,{spawnProcess=spawn,env=process.env,clientInfo={name:'heloscrum',version:'0.4.0'},timeoutMs=20000}={}){Object.assign(this,{executable,spawnProcess,env,clientInfo,timeoutMs});this.pending=new Map();this.next=0;this.child=null;this.starting=null;this.notificationListeners=new Set();this.requestHandler=null;this.closeListeners=new Set();this.info=null;}
  onNotification(listener){this.notificationListeners.add(listener);return ()=>this.notificationListeners.delete(listener);}
  onRequest(handler){this.requestHandler=handler;}
  onClose(listener){this.closeListeners.add(listener);return ()=>this.closeListeners.delete(listener);}
  get connected(){return !!this.child;}
  async connect(){
    if(this.starting)return this.starting;if(this.child)return;
    this.starting=(async()=>{
      assert(this.executable,'Codex is not installed',503);
      const child=this.spawnProcess(this.executable,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe'],env:{...this.env}});this.child=child;let buffer='';
      child.stdout.setEncoding?.('utf8');child.stderr?.on('data',()=>{});child.stdin.on('error',()=>{});
      const closed=error=>{if(this.child!==child)return;this.child=null;const reason=error instanceof Error?error:Error('Codex app-server connection closed');for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(reason);}this.pending.clear();for(const listener of this.closeListeners)listener(reason);};
      child.on('error',closed);child.on('close',()=>closed());
      child.stdout.on('data',chunk=>{
        buffer+=chunk;if(buffer.length>LIMIT){closed(Error('Codex app-server message exceeded its size limit'));child.kill();return;}let end;
        while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;let message;try{message=JSON.parse(line);}catch{continue;}this.receive(message,child);}
      });
      try{this.info=await this.rpc('initialize',{clientInfo:this.clientInfo,capabilities:{experimentalApi:true}});this.notify('initialized',{});}
      catch(error){closed(error);child.kill();throw error;}
    })();
    try{await this.starting;}finally{this.starting=null;}
  }
  receive(message,child){
    if(message.method&&message.id!==undefined){
      // A server request: approvals, user input, elicitation. Always answer.
      Promise.resolve().then(()=>this.requestHandler?this.requestHandler(message.method,message.params||{}):Promise.reject(Object.assign(Error('Unsupported server request'),{code:-32601}))).then(
        result=>this.write(child,{id:message.id,result:result??{}}),
        error=>this.write(child,{id:message.id,error:{code:Number.isInteger(error?.code)?error.code:-32603,message:error?.message||'Request failed'}}));
      return;
    }
    if(message.method){for(const listener of this.notificationListeners){try{listener(message.method,message.params||{});}catch{}}return;}
    const request=this.pending.get(message.id);if(!request)return;this.pending.delete(message.id);clearTimeout(request.timer);
    if(message.error)request.reject(Object.assign(Error(message.error.message||'Codex app-server request failed'),{status:502,code:message.error.code,data:message.error.data}));else request.resolve(message.result);
  }
  write(child,message){try{child.stdin.write(JSON.stringify(message)+'\n');}catch{}}
  notify(method,params){assert(this.child,'Codex app-server is not connected',503);this.write(this.child,{method,params});}
  rpc(method,params,{timeoutMs=this.timeoutMs}={}){
    assert(this.child,'Codex app-server is not connected',503);
    return new Promise((resolve,reject)=>{const id=++this.next,timer=timeoutMs?setTimeout(()=>{this.pending.delete(id);reject(Object.assign(Error(`Codex app-server did not answer ${method} in time`),{status:504}));},timeoutMs):null;this.pending.set(id,{resolve,reject,timer});this.write(this.child,{id,method,params});});
  }
  close(){const child=this.child;this.child=null;if(child){for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(Error('Codex app-server closed'));}this.pending.clear();child.kill();}}
}
