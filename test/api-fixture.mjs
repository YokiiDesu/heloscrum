import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {ControlPlane} from '../lib/control-plane.mjs';
import {ApiV1} from '../lib/api-v1.mjs';
import {projectId} from '../lib/api-access.mjs';
import {HeloClient} from '../cli/client.mjs';
import {validRequest} from '../lib/security.mjs';

export async function apiFixture({history=false}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-api-')),plane=await new ControlPlane(root).init({history});
  await plane.git.command(root,['init','-b','main']);await plane.git.command(root,['config','user.name','API Test']);await plane.git.command(root,['config','user.email','test@example.invalid']);
  await writeFile(path.join(root,'.gitignore'),'.heloscrum/\nother/\n');await writeFile(path.join(root,'brief.md'),'# A portable brief\nBuild and verify the account page.\n');
  await plane.git.command(root,['add','.']);await plane.git.command(root,['commit','-m','fixture']);
  const other=path.join(root,'other');await mkdir(other);await plane.git.command(other,['init','-b','main']);plane.projects.remember(root);plane.projects.remember(other);
  const [tree]=await plane.git.worktrees(root);
  const agents=['Builder','QA','Other'].map((role,i)=>({id:'agent-'+i,title:role,role,kind:'codex',project:i===2?other:root,path:i===2?other:root,worktreeId:tree.id,branch:'main',pane:'pane-'+i,phase:'launched',prompt:'Fixture instructions'}));
  plane.data.tasks=agents;const prompts=[];
  plane.herdr={list:async()=>agents.map(a=>({pane_id:a.pane,interactive_ready:true,agent_status:'idle'})),prompt:async(...args)=>prompts.push(args),interrupt:async()=>{}};
  plane.transcripts.read=async task=>({events:[{id:'user-'+task.id,type:'message',role:'user',text:'Build an accessible account page.'},{id:'tool-'+task.id,type:'tool',name:'read_file',status:'completed',input:{path:'brief.md'},output:'Requirements loaded'},{id:'reply-'+task.id,type:'message',role:'assistant',text:'## Ready to work\nI have read **brief.md**.\n```js\nconst ready = true;\n```'}]});
  let api;const server=http.createServer((req,res)=>{if(!validRequest(req,server.address().port)){res.writeHead(403);res.end('{}');return;}api.handle(req,res,new URL(req.url,plane.baseUrl));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});plane.baseUrl='http://127.0.0.1:'+server.address().port;
  api=await new ApiV1(plane).init();const owner=JSON.parse(await readFile(path.join(root,'.heloscrum/api-owner.json'),'utf8')),client=new HeloClient(owner),base='/projects/'+projectId(root);
  const credential=async(scopes,agentId='agent-0')=>client.request('/tokens',{method:'POST',body:{name:'Test identity',kind:'agent',agentId,projects:[projectId(agents.find(a=>a.id===agentId).project)],scopes}});
  return {root,other,plane,agents,prompts,api,server,owner,client,base,credential,async close(){await api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));plane.transcripts.close();await plane.mcp.close();await plane.saveQueue;await plane.history?.close();await rm(root,{recursive:true,force:true});}};
}
