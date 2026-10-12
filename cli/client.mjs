import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

export const codeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export class CliError extends Error {constructor(message,{code='INVALID_INPUT',status=400,operationId}={}){super(message);Object.assign(this,{code,status,operationId});}}
export const exitCode=error=>error.code==='OUTCOME_UNCERTAIN'?9:error.code==='OPERATION_PENDING'?8:error.status===401?3:error.status===403?4:error.status===409?5:error.status>=500||error.code==='CONNECTION_FAILED'?6:2;
export class HeloClient {
  constructor({url,token,fetch=globalThis.fetch,timeout=30000}){
    const endpoint=new URL(url);if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new CliError('Use an HTTP or HTTPS backend URL without embedded credentials');
    if(endpoint.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new CliError('Use HTTPS or a localhost SSH tunnel for a remote backend');
    this.url=endpoint.href.replace(/\/$/,'');this.token=token;this.fetch=fetch;this.timeout=timeout;this.controller=new AbortController();
  }
  static async load(options={}){
    if((process.env.HELOSCRUM_AGENT_ID)&&!options.credential&&!process.env.HELOSCRUM_CREDENTIAL)throw new CliError('Agent processes must select --credential or HELOSCRUM_CREDENTIAL; the local owner is never selected implicitly.',{code:'FORBIDDEN',status:403});
    const root=path.resolve(options.root||process.env.HELOSCRUM_ROOT||codeRoot);
    const file=options.credential||process.env.HELOSCRUM_CREDENTIAL||path.join(root,'.heloscrum/api-owner.json');
    let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch(e){throw new CliError(`Cannot read credential file ${file}. Start the backend with heloscrum serve, or pass --credential.`,{code:'UNAUTHENTICATED',status:401});}
    if(typeof saved.token!=='string')throw new CliError('Credential file has no token',{status:401});
    // An endpoint override must be explicit; credentials never follow redirects.
    return new HeloClient({url:options.url||saved.url,token:saved.token});
  }
  async request(route,{method='GET',body,key,signal}={}){
    let response;
    try{response=await this.fetch(this.url+'/api/v1'+route,{method,redirect:'error',headers:{Authorization:'Bearer '+this.token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(this.timeout),...(signal?[signal]:[])])});}
    catch(e){if(signal?.aborted)throw e;throw new CliError(method==='GET'?'Cannot reach HeloScrum. Check that the backend is running.':`Connection interrupted. Check operations before resubmitting; reuse request ID ${key||'(none)'}.`,{code:'CONNECTION_FAILED',status:503});}
    let value;try{value=await response.json();}catch{throw new CliError('Backend returned an invalid API response',{status:502});}
    if(!response.ok)throw new CliError(value.error?.message||value.error||'API request failed',{code:value.error?.code,status:response.status});
    return value.data===undefined?value:value.data;
  }
  async mutate(route,body={},options={}){
    const key=options.key||randomUUID(),operation=await this.request(route,{method:options.method||'POST',body,key});
    if(options.noWait)return {operationId:operation.id,status:operation.status};
    return this.wait(operation,{timeout:options.timeout||120000});
  }
  async list(route){const items=[];let cursor;do{const data=await this.request(route+(cursor?(route.includes('?')?'&':'?')+'cursor='+encodeURIComponent(cursor):''));items.push(...data.items);cursor=data.nextCursor;}while(cursor);return {items};}
  close(){this.controller.abort();}
  async wait(operation,{timeout=120000}={}){
    const started=Date.now();
    while(['queued','running'].includes(operation.status)){
      if(Date.now()-started>timeout)throw new CliError('Operation is still running; inspect it with operations get '+operation.id,{code:'OPERATION_PENDING',operationId:operation.id});
      await new Promise(resolve=>setTimeout(resolve,150));operation=await this.request('/operations/'+encodeURIComponent(operation.id));
    }
    if(operation.status!=='succeeded')throw new CliError(operation.error?.message||'Operation failed',{code:operation.error?.code||'OPERATION_FAILED',status:operation.error?.status||400,operationId:operation.id});
    return {...operation.result,operationId:operation.id};
  }
  async project(candidate){
    if(!candidate)throw new CliError('Choose --project <ID, name, or absolute path>. Use projects list to see available projects.');
    const records=[];let cursor;
    do{const data=await this.request('/projects'+(cursor?'?cursor='+encodeURIComponent(cursor):''));records.push(...data.items);cursor=data.nextCursor;}while(cursor);
    const exact=records.filter(p=>p.id===candidate||p.path===candidate),matches=exact.length?exact:records.filter(p=>p.name===candidate);
    if(matches.length!==1)throw new CliError(matches.length?'Project name is ambiguous; use its ID or absolute path':'Project is not available to this credential',{status:matches.length?400:404});
    return matches[0];
  }
  async watch(project,{after,signal,onEvent,onReconnect=()=>{}}){
    let cursor=after,delay=1000;
    while(!signal?.aborted){
      const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      let heartbeat=setTimeout(abort,45000);
      try{
        const response=await this.fetch(this.url+'/api/v1/projects/'+encodeURIComponent(project)+'/events'+(cursor?'?after='+encodeURIComponent(cursor):''),{redirect:'error',headers:{Authorization:'Bearer '+this.token},signal:controller.signal});
        if(!response.ok){const result=await response.json();throw new CliError(result.error?.message||'Event stream failed',{status:response.status,code:result.error?.code});}
        let buffer='';const decoder=new TextDecoder();delay=1000;
        for await(const bytes of response.body){
          clearTimeout(heartbeat);heartbeat=setTimeout(abort,45000);buffer+=decoder.decode(bytes,{stream:true});
          if(buffer.length>1024*1024)throw new CliError('Event frame is too large',{status:502});
          let at;while((at=buffer.indexOf('\n\n'))>=0){if(signal?.aborted)return;const chunk=buffer.slice(0,at);buffer=buffer.slice(at+2);const data=chunk.split('\n').filter(l=>l.startsWith('data: ')).map(l=>l.slice(6)).join('\n');if(!data)continue;
            const eventId=chunk.split('\n').find(l=>l.startsWith('id: '))?.slice(4),type=chunk.split('\n').find(l=>l.startsWith('event: '))?.slice(7);
            if(type==='access.revoked')throw new CliError('Event access was revoked',{status:401});
            const event=JSON.parse(data);await onEvent({...event,type:type||event.type});if(eventId)cursor=eventId;
          }
        }
      }catch(e){if(signal?.aborted)return;if(e instanceof CliError&&[400,401,403,404].includes(e.status))throw e;onReconnect(e);}
      finally{clearTimeout(heartbeat);signal?.removeEventListener('abort',abort);controller.abort();}
      if(!signal?.aborted)await new Promise(resolve=>{const timer=setTimeout(done,delay);function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}signal?.addEventListener('abort',done,{once:true});});
      delay=Math.min(delay*2,30000);
    }
  }
}
