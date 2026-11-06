import {createHash} from 'node:crypto';

export const VOYAGE_TRIAL_POLICY=Object.freeze({model:'voyage-context-4',dimensions:512,maxCalls:12,maxInputBytes:120000,maxRequestBytes:28000,maxResponseBytes:4*1024*1024,timeoutMs:30000});
const digest=value=>createHash('sha256').update(value).digest('hex');
export class VoyageError extends Error {
  constructor(code,message){super(message);this.name='VoyageError';this.code=code;}
}
const fail=(code,message)=>{throw new VoyageError(code,message);};

// A bounded, explicit trial client. It never reads application credentials or retries.
export class VoyageContext {
  #key;
  constructor(apiKey,{fetchImpl=fetch,policy={}}={}){
    if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192||/[\r\n\0]/.test(apiKey))fail('key','Enter a valid Voyage API key.');
    this.#key=apiKey.trim();this.fetchImpl=fetchImpl;this.policy={...VOYAGE_TRIAL_POLICY,...policy};this.calls=[];this.inputBytes=0;
  }
  forget(){this.#key=null;}
  async embed(inputs,type){
    const p=this.policy;
    if(!this.#key)fail('key','The trial key has been cleared.');
    if(!['query','document'].includes(type)||!Array.isArray(inputs)||!inputs.length||inputs.length>1000||inputs.some(group=>!Array.isArray(group)||!group.length||(type==='query'&&group.length!==1)||group.some(text=>typeof text!=='string'||!text.length)))fail('input','Invalid embedding input.');
    const inputBytes=inputs.flat().reduce((sum,s)=>sum+Buffer.byteLength(s),0);
    if(inputBytes>p.maxRequestBytes||this.inputBytes+inputBytes>p.maxInputBytes||this.calls.length>=p.maxCalls)fail('budget','Trial request budget reached. No request was sent.');
    const body=JSON.stringify({inputs,model:p.model,input_type:type,output_dimension:p.dimensions,output_dtype:'float'});
    const call={number:this.calls.length+1,type,inputBytes,requestBytes:Buffer.byteLength(body),requestSha256:digest(body),groups:inputs.length,chunks:inputs.flat().length,model:p.model,usage:null,status:'pending'};
    this.inputBytes+=inputBytes;this.calls.push(call);const started=performance.now();
    try{
      let response;
      try{response=await this.fetchImpl('https://api.voyageai.com/v1/contextualizedembeddings',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.#key,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(p.timeoutMs)});}
      catch(error){fail(['TimeoutError','AbortError'].includes(error.name)?'timeout':'transport','Voyage request could not complete. No automatic retry was made.');}
      call.httpStatus=response.status;
      if(!response.ok){const retryAfter=Number(response.headers.get('retry-after'));if(response.status===429)call.retryAfterSeconds=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(3600,retryAfter):60;await response.body?.cancel();fail(response.status===401||response.status===403?'authentication':response.status===429?'rate-limit':'service','Voyage returned HTTP '+response.status+'. No automatic retry was made.');}
      const chunks=[];let bytes=0;
      try{for await(const chunk of response.body){bytes+=chunk.length;if(bytes>p.maxResponseBytes)fail('response-limit','Voyage response exceeded the trial limit.');chunks.push(chunk);}}
      catch(error){if(error instanceof VoyageError)throw error;fail('transport','Voyage response was interrupted.');}
      call.responseBytes=bytes;
      let raw;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid-response','Voyage returned invalid JSON.');}
      if(Number.isSafeInteger(raw.usage?.total_tokens)&&raw.usage.total_tokens>=0)call.usage={total_tokens:raw.usage.total_tokens};
      if(typeof raw.model==='string')call.reportedModel=raw.model;
      if(!Array.isArray(raw.data)||raw.data.length!==inputs.length)fail('invalid-response','Voyage returned an unexpected group count.');
      const result=new Array(inputs.length),seen=new Set();
      for(const group of raw.data){
        const i=group.index;
        if(!Number.isInteger(i)||i<0||i>=inputs.length||seen.has(i)||!Array.isArray(group.data)||group.data.length!==inputs[i].length)fail('invalid-response','Voyage returned invalid group indexes.');
        seen.add(i);const vectors=new Array(inputs[i].length),indexes=new Set();
        for(const item of group.data){
          const j=item.index,v=item.embedding;
          if(!Number.isInteger(j)||j<0||j>=vectors.length||indexes.has(j)||!Array.isArray(v)||v.length!==p.dimensions||!v.every(Number.isFinite)||!v.some(n=>n!==0))fail('invalid-response','Voyage returned invalid embeddings.');
          indexes.add(j);vectors[j]=v;
        }
        result[i]=vectors;
      }
      call.status='complete';return result;
    }catch(error){call.status='failed';call.errorCode=error.code||'internal';throw error;}
    finally{call.elapsedMs=Math.round(performance.now()-started);}
  }
  usage(){return {calls:this.calls.map(c=>({...c})),inputBytes:this.inputBytes,knownTokens:this.calls.reduce((n,c)=>n+(c.usage?.total_tokens||0),0),unknownUsageCalls:this.calls.filter(c=>!c.usage).length,limits:{...this.policy}};}
}

export function cosine(a,b){
  if(a.length!==b.length)fail('dimensions','Embedding dimensions do not match.');
  let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}
  if(!aa||!bb)fail('dimensions','Cannot compare zero vectors.');
  return dot/Math.sqrt(aa*bb);
}
