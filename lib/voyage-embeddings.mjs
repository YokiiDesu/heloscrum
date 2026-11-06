import {assert} from './adapters.mjs';

export const EMBEDDING_MODEL='voyage-context-4';
export const EMBEDDING_DIMENSION=512;
export const EMBEDDING_REQUEST_BYTES=28000;
const validResponse=(condition,message)=>{if(!condition)throw Object.assign(Error(message),{status:502,code:'EMBEDDING_RESPONSE'});};
export function validVector(value){if(!Array.isArray(value)||value.length!==EMBEDDING_DIMENSION||!value.every(Number.isFinite))return false;const norm=value.reduce((n,x)=>n+x*x,0);return norm>0&&Number.isFinite(norm);}
export function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return dot/Math.sqrt(aa*bb);}

export async function voyageEmbed(connection,key,inputs,inputType,{fetcher=fetch,signal}={}){
  assert(connection.kind==='voyage'&&key,'Save a Voyage API key in Settings → AI & Context',409);
  assert(connection.model===EMBEDDING_MODEL,'Choose the supported contextual embedding model');
  assert(['document','query'].includes(inputType)&&Array.isArray(inputs)&&inputs.length>0&&inputs.length<=64&&inputs.every(doc=>Array.isArray(doc)&&doc.length>0&&doc.length<=64&&doc.every(t=>typeof t==='string'&&t.length>0)&&(inputType!=='query'||doc.length===1)),'Invalid embedding inputs');
  const body=JSON.stringify({model:EMBEDDING_MODEL,inputs,input_type:inputType,output_dimension:EMBEDDING_DIMENSION,output_dtype:'float'});
  assert(Buffer.byteLength(body)<=EMBEDDING_REQUEST_BYTES,'Embedding request exceeds the fixed byte budget');
  const response=await fetcher('https://api.voyageai.com/v1/contextualizedembeddings',{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body});
  if(!response.ok){await response.body?.cancel();throw Object.assign(Error('Voyage returned HTTP '+response.status+'. Check the saved key and account limits.'),{status:502,code:'EMBEDDING_SERVICE'});}
  let bytes=0,text='';const decoder=new TextDecoder();
  for await(const chunk of response.body){bytes+=chunk.length;assert(bytes<=2*1024*1024,'Embedding response exceeds 2 MiB',502);text+=decoder.decode(chunk,{stream:true});}text+=decoder.decode();
  let result;try{result=JSON.parse(text);}catch{throw Object.assign(Error('Voyage returned invalid JSON'),{code:'EMBEDDING_RESPONSE',status:502});}
  const vectors=Array(inputs.length),seen=new Set();
  validResponse(Array.isArray(result.data)&&result.data.length===inputs.length,'Voyage returned incomplete document embeddings');
  for(const doc of result.data){
    validResponse(Number.isInteger(doc.index)&&doc.index>=0&&doc.index<inputs.length&&!seen.has(doc.index),'Voyage returned invalid document indexes');seen.add(doc.index);
    validResponse(Array.isArray(doc.data)&&doc.data.length===inputs[doc.index].length,'Voyage returned incomplete chunk embeddings');
    const chunks=Array(doc.data.length),indexes=new Set();
    for(const chunk of doc.data){validResponse(Number.isInteger(chunk.index)&&chunk.index>=0&&chunk.index<chunks.length&&!indexes.has(chunk.index)&&validVector(chunk.embedding),'Voyage returned invalid chunk embeddings');indexes.add(chunk.index);chunks[chunk.index]=chunk.embedding;}
    vectors[doc.index]=chunks;
  }
  validResponse(!result.model||result.model===EMBEDDING_MODEL,'Voyage returned a different embedding model');
  return {vectors,model:result.model||EMBEDDING_MODEL,usage:result.usage||null};
}
