import { readFile } from 'node:fs/promises';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
let text='';for await(const part of process.stdin){text+=part;if(text.length>1000000)process.exit(1);}
try{
  const hook=JSON.parse(text);
  // SessionStart can arrive just before the transcript directory is created.
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(config.url+'/agent-api/session',{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({sessionId:hook.session_id||hook.conversation_id,transcriptPath:hook.transcript_path,cwd:hook.cwd||hook.workspace_roots?.[0]}),signal:AbortSignal.timeout(3000)});
      if(response.ok||response.status<500)break;
    }catch{}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,300));
  }
}catch{}

if(process.argv[3]==='cursor')process.stdout.write('{}\n');
