import {assert} from './adapters.mjs';

// Local models can spend minutes loading or processing a prompt. Once generation
// starts, activity extends the idle deadline, but never the overall safety cap.
export const LOCAL_INFERENCE_TIMEOUTS=Object.freeze({startMs:300000,idleMs:120000,totalMs:1800000});
const MAX_BYTES=8*1024*1024;
const failure=(message,code)=>Object.assign(Error(message),{status:502,code});
const seconds=ms=>Math.ceil(ms/1000);
const parse=text=>{try{return JSON.parse(text);}catch{throw failure('The local model server returned an invalid response.','MODEL_INVALID_RESPONSE');}};

export async function localCompletion(url,{fetcher=fetch,signal,headers,payload,onProgress,timeouts=LOCAL_INFERENCE_TIMEOUTS}={}){
  const limits={...LOCAL_INFERENCE_TIMEOUTS,...timeouts};
  for(const value of Object.values(limits))assert(Number.isInteger(value)&&value>0&&value<=3600000,'Invalid local model timeout');
  const deadline=new AbortController(),combined=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  let idleTimer,totalTimer,response,bytes=0,receiving=false;
  const arm=(ms,code,message)=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>deadline.abort(failure(message,code)),ms);idleTimer.unref?.();};
  const activity=()=>{
    receiving=true;
    arm(limits.idleMs,'MODEL_IDLE_TIMEOUT',`The local model stopped sending a response for ${seconds(limits.idleMs)} seconds. Check its server, then try again. This request was not retried automatically.`);
    onProgress?.({phase:'receiving',lastActivityAt:new Date().toISOString()});
  };
  try{
    combined.throwIfAborted();
    onProgress?.({phase:'waiting',startedAt:new Date().toISOString()});
    arm(limits.startMs,'MODEL_START_TIMEOUT',`The local model did not start responding within ${seconds(limits.startMs)} seconds. Check that the model is loaded and its server is running, then try again.`);
    totalTimer=setTimeout(()=>deadline.abort(failure(`The local model reached the ${seconds(limits.totalMs)}-second response limit. Try a shorter response or a smaller model. This request was not retried automatically.`,'MODEL_RESPONSE_LIMIT')),limits.totalMs);totalTimer.unref?.();
    response=await fetcher(url,{method:'POST',redirect:'error',signal:combined,headers,body:JSON.stringify({...payload,stream:true,stream_options:{include_usage:true}})});
    combined.throwIfAborted();
    // Never expose provider error bodies: they can echo prompts and credentials.
    assert(response.ok,`Model service returned HTTP ${response.status}. Check the connection, model, and account permissions.`,502);
    assert(response.body,'The local model server returned an empty response.',502);
    const decoder=new TextDecoder(),streaming=/text\/event-stream/i.test(response.headers.get('content-type')||'');
    let buffer='',data=[],done=false,finished=false,content='',model=payload.model,usage;
    const calls=new Map();
    const event=()=>{
      if(!data.length)return;
      const text=data.join('\n');data=[];
      if(text==='[DONE]'){done=true;return;}
      const chunk=parse(text);
      assert(chunk&&typeof chunk==='object'&&!chunk.error,'The local model server reported a generation error. Check its server logs.',502);
      if(typeof chunk.model==='string')model=chunk.model;
      if(chunk.usage)usage=chunk.usage;
      const choice=chunk.choices?.find(c=>c.index===0)||chunk.choices?.[0];
      if(!choice)return;
      const delta=choice.delta||{};
      if(choice.finish_reason==='length')throw failure('The local model reached its output token limit before finishing. Increase Maximum Output Tokens in the connection settings, or lower the model’s reasoning budget. No tools from this incomplete response were run.','MODEL_OUTPUT_LIMIT');
      if(choice.finish_reason!=null){assert(['stop','tool_calls'].includes(choice.finish_reason),'The local model stopped without a complete response.',502);finished=true;}
      if(delta.content||delta.reasoning_content||delta.reasoning||delta.tool_calls?.length||finished)activity();
      if(typeof delta.content==='string')content+=delta.content;
      for(const part of delta.tool_calls||[]){
        assert(Number.isInteger(part.index)&&part.index>=0&&part.index<16,'Model requested too many tools or an invalid tool index.',502);
        const call=calls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};
        assert(!part.type||part.type==='function','Unsupported local model tool type.',502);
        for(const [target,key,value] of [[call,'id',part.id],[call.function,'name',part.function?.name],[call.function,'arguments',part.function?.arguments]]){
          if(value!=null){assert(typeof value==='string','Invalid local model tool fragment.',502);target[key]+=value;}
        }
        assert(call.id.length<=160&&call.function.name.length<=200&&call.function.arguments.length<=300000,'Local model tool request exceeded its size limit.',502);
        calls.set(part.index,call);
      }
    };
    const line=value=>{
      value=value.replace(/\r$/,'');
      if(!value){event();return;}
      if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));
    };
    for await(const chunk of response.body){
      combined.throwIfAborted();bytes+=chunk.length;
      assert(bytes<=MAX_BYTES,'Model response exceeded 8 MiB',502);
      buffer+=decoder.decode(chunk,{stream:true});
      if(!streaming)continue;
      let end;while(!done&&(end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end));buffer=buffer.slice(end+1);}
      if(done)break;
    }
    combined.throwIfAborted();buffer+=decoder.decode();
    // Some compatible servers ignore stream=true. Accept their complete JSON
    // without issuing a second inference request or losing reported usage.
    if(!streaming){const result=parse(buffer);assert(!result.error,'The local model server reported a generation error. Check its server logs.',502);if(result.choices?.[0]?.finish_reason==='length')throw failure('The local model reached its output token limit before finishing. Increase Maximum Output Tokens or lower its reasoning budget. No tools from this incomplete response were run.','MODEL_OUTPUT_LIMIT');return result;}
    if(!done){if(buffer)line(buffer);event();}
    assert(done||finished,'The local model connection ended before its response was complete. No tools from this incomplete response were run.',502);
    assert(content.trim()||calls.size,'The local model finished without a reply or tool request. Try a lower reasoning budget or a larger output token limit.',502);
    const tool_calls=[...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>call);
    for(const call of tool_calls){
      assert(call.id&&call.function.name,'The local model returned an incomplete tool request.',502);
      const args=parse(call.function.arguments);assert(args&&typeof args==='object'&&!Array.isArray(args),'The local model returned invalid tool arguments.',502);
    }
    return {model,usage,choices:[{message:{role:'assistant',content,...(tool_calls.length?{tool_calls}:{})}}]};
  }catch(error){
    if(signal?.aborted)throw signal.reason;
    if(deadline.signal.aborted)throw deadline.signal.reason;
    if(['UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(error.cause?.code))throw failure(`The local model server ${receiving?'stopped responding':'took too long to start responding'}. Check its server, then try again. This request was not retried automatically.`,'MODEL_TRANSPORT_TIMEOUT');
    throw error;
  }finally{
    clearTimeout(idleTimer);clearTimeout(totalTimer);
    if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
  }
}
