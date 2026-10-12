import {privateDirectory} from './private-files.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assert,run} from './adapters.mjs';
import {nativeSummary} from './native-summary.mjs';
import {localCompletion} from './local-inference.mjs';

export async function fetchJSON(url,{fetcher=fetch,signal,timeout=90000,...options}={}) {
  const response=await fetcher(url,{...options,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
  // Provider errors can echo submitted prompts or credentials. Keep them out of logs/UI.
  assert(response.ok,`Model service returned HTTP ${response.status}. Check the connection, model, and account permissions.`,502);
  let text='',bytes=0;const decoder=new TextDecoder();
  for await(const chunk of response.body){bytes+=chunk.length;assert(bytes<=8*1024*1024,'Model response exceeded 8 MiB',502);text+=decoder.decode(chunk,{stream:true});}
  text+=decoder.decode();
  try{return JSON.parse(text);}catch{throw Object.assign(Error('Model service returned invalid JSON'),{status:502});}
}

export function bedrockRequest(model,messages,tools,maxTokens){
  const system=messages.filter(m=>m.role==='system').map(m=>({text:m.content})),converted=[];
  for(const m of messages.filter(m=>m.role!=='system')){
    const role=m.role==='assistant'?'assistant':'user',content=[];
    if(m.role==='tool')content.push({toolResult:{toolUseId:m.tool_call_id,content:[{text:m.content||'(empty)'}]}});
    else{
      if(Array.isArray(m.content)){for(const part of m.content){if(part.type==='text')content.push({text:part.text});else if(part.type==='image_url'){const match=/^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url||'');assert(match,'Bedrock needs a PNG, JPEG or GIF image');content.push({image:{format:match[1],source:{bytes:match[2]}}});}}}else if(m.content)content.push({text:m.content});
      for(const call of m.tool_calls||[])content.push({toolUse:{toolUseId:call.id,name:call.function.name,input:JSON.parse(call.function.arguments)}});
    }
    if(!content.length)continue;
    if(converted.at(-1)?.role===role)converted.at(-1).content.push(...content);else converted.push({role,content});
  }
  return {modelId:model,system,messages:converted,inferenceConfig:{maxTokens},...(tools.length?{toolConfig:{tools:tools.map(t=>({toolSpec:{name:t.function.name,description:t.function.description,inputSchema:{json:t.function.parameters}}}))}}:{})};
}
export function bedrockResponse(result){
  const content=result.output?.message?.content;
  assert(Array.isArray(content),'Bedrock did not return a Converse message',502);
  return {message:{role:'assistant',content:content.filter(c=>typeof c.text==='string').map(c=>c.text).join('\n'),tool_calls:content.filter(c=>c.toolUse).map(({toolUse:c})=>({id:c.toolUseId,type:'function',function:{name:c.name,arguments:JSON.stringify(c.input)}}))},usage:result.usage,model:result.modelId};
}

export class ModelClient {
  constructor({fetcher=fetch,aws='aws',execute=run,localTimeouts}={}){Object.assign(this,{fetcher,aws,execute,localTimeouts});}
  async awsCall(connection,service,operation,payload,{signal,endpointBody=false}={}){
    const dir=await mkdtemp(path.join(os.tmpdir(),'heloscrum-inference-'));
    try{
      await privateDirectory(dir);
      const input=path.join(dir,'input.json'),output=path.join(dir,'output.json');
      await writeFile(input,JSON.stringify(payload),{mode:0o600});
      const args=[service,operation,'--region',connection.region,...(connection.profile?['--profile',connection.profile]:[]),'--no-cli-pager','--output','json',...(endpointBody?['--endpoint-name',connection.endpointName,'--content-type','application/json','--accept','application/json','--body','fileb://'+input,output]:['--cli-input-json','file://'+input])];
      let text;try{text=await this.execute(this.aws,args,{timeout:120000,signal,env:{AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off'}});}catch(error){if(signal?.aborted)throw error;throw Object.assign(Error('AWS inference failed. Check the AWS CLI, profile login, region, model or endpoint, and invoke permissions.'),{status:502});}
      return JSON.parse(endpointBody?await readFile(output,'utf8'):text);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  async models(connection,key){
    if(['bedrock','sagemaker','jev'].includes(connection.kind))return connection.model?[{id:connection.model,label:connection.model,isDefault:true}]:[];
    const result=await fetchJSON(connection.baseUrl+'/models',{fetcher:this.fetcher,timeout:10000,headers:key?{Authorization:'Bearer '+key}:{}});
    assert(Array.isArray(result.data),'This endpoint does not expose an OpenAI-compatible model catalog',502);
    const models=result.data.filter(m=>typeof m.id==='string').slice(0,200).map(m=>({id:m.id,label:m.id,isDefault:m.id===connection.model}));
    if(connection.kind==='lmstudio'&&connection.baseUrl.endsWith('/v1')){
      // Optional native metadata distinguishes loaded models from downloaded files.
      // Older LM Studio servers and reverse proxies may only expose /v1/models.
      try{
        const native=await fetchJSON(connection.baseUrl.slice(0,-3)+'/api/v1/models',{fetcher:this.fetcher,timeout:3000,headers:key?{Authorization:'Bearer '+key}:{}});
        if(Array.isArray(native.models))return models.flatMap(model=>{
          const entry=native.models.find(m=>m.key===model.id||m.loaded_instances?.some(i=>i.id===model.id));
          if(!entry)return [model];if(entry.type!=='llm')return [];
          const instance=entry.loaded_instances?.find(i=>i.id===model.id)||entry.loaded_instances?.[0];
          return [{...model,label:entry.display_name||model.id,loaded:!!instance,...(instance?.config?.context_length?{contextWindow:instance.config.context_length}:{}),...(typeof entry.capabilities?.trained_for_tool_use==='boolean'?{supportsTools:entry.capabilities.trained_for_tool_use}:{}),...(typeof entry.capabilities?.vision==='boolean'?{supportsImages:entry.capabilities.vision}:{})}];
        }).sort((a,b)=>Number(!!b.loaded)-Number(!!a.loaded));
      }catch{/* The compatible catalog still works without optional metadata. */}
    }
    return models;
  }
  async complete(connection,key,{model=connection.model,messages,tools=[],maxTokens=2048,signal,onProgress}={}){
    assert(model,'Choose an exact model ID');assert(connection.kind!=='jev','Jev selects context; choose a language model for summaries');
    maxTokens=Math.min(maxTokens,connection.maxOutputTokens||4096);
    if(['codex-summary','claude-summary'].includes(connection.kind)){assert(!tools.length,'Native summary connections do not run agent tools');return nativeSummary(connection.kind==='claude-summary'?this.claude:this.codex,{...connection,model},{messages,maxTokens,signal});}
    if(connection.kind==='bedrock')return bedrockResponse(await this.awsCall(connection,'bedrock-runtime','converse',bedrockRequest(model,messages,tools,maxTokens),{signal}));
    const payload={model,messages,stream:false,max_tokens:maxTokens,...(tools.length?{tools,tool_choice:'auto'}:{})};
    const result=connection.kind==='sagemaker'?await this.awsCall(connection,'sagemaker-runtime','invoke-endpoint',payload,{signal,endpointBody:true}):await localCompletion(connection.baseUrl+'/chat/completions',{fetcher:this.fetcher,signal,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},payload,onProgress,timeouts:this.localTimeouts});
    const message=result.choices?.[0]?.message;
    assert(message&&message.role==='assistant'&&(typeof message.content==='string'||Array.isArray(message.tool_calls)),'Endpoint did not return an OpenAI-compatible assistant message',502);
    // Do not mix provider-internal reasoning/signatures into the visible transcript.
    return {message:{role:'assistant',content:message.content||'',...(message.tool_calls?.length?{tool_calls:message.tool_calls}:{})},usage:result.usage,model:result.model||model};
  }
  async decide(connection,key,state,questions,{signal}={}){
    assert(connection.kind==='jev'&&key,'Add a TypeSafe API key in AI connections to use Jev',409);
    assert(JSON.stringify({state,questions}).length<=24000,'Jev decision input must stay under 24,000 characters');
    return fetchJSON('https://api.typesafe.ai/v1/systemone',{fetcher:this.fetcher,signal,timeout:15000,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},method:'POST',body:JSON.stringify({model:connection.model||'jev-latest',state,questions})});
  }
}
