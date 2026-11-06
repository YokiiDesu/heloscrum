import {readFile} from 'node:fs/promises';
import {steeringHookOutput} from '../lib/steering.mjs';

// The provider calls this synchronously at its tool/model boundary. This is a
// transport hook, not an instruction asking the model to poll its inbox.
let output={};
try{
  const config=JSON.parse(await readFile(process.argv[2],'utf8')),provider=process.argv[3];
  let text='';for await(const part of process.stdin){text+=part;if(text.length>8*1024*1024)throw Error('Hook input too large');}
  const hook=JSON.parse(text),input={provider,sessionId:hook.session_id||hook.conversation_id,cwd:hook.cwd||hook.workspace_roots?.[0],event:hook.hook_event_name};
  if(provider==='gemini'&&!Array.isArray(hook.llm_request?.messages))throw Error('Missing native model request');
  const post=async body=>{
    const response=await fetch(config.url+'/agent-api/steering',{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({...input,...body}),signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw Error('Steering connection unavailable');return response.json();
  };
  const claim=await post({});
  if(claim.text){
    output=steeringHookOutput(provider,claim.text,hook);
    await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(output)+'\n',error=>error?reject(error):resolve()));
    // A lost acknowledgement remains uncertain and is never silently replayed.
    if(claim.receipt)await post({receipt:claim.receipt});
    process.exitCode=0;
  }else process.stdout.write('{}\n');
}catch{
  // Hook failure must not fail or interrupt the provider's completed tool.
  if(!Object.keys(output).length)process.stdout.write('{}\n');
}
