import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Ajv from 'ajv';
import {API_ROUTES,API_SCOPES,matchRoute,openapi} from './api-contract.mjs';
import {ApiAccess,projectId} from './api-access.mjs';
import {ApiOperations,apiError} from './api-operations.mjs';
import {ApiEvents} from './api-events.mjs';
import {ChangeReviews} from './change-reviews.mjs';
import {MAX_WORK_FILE} from './work-management.mjs';
import {assert} from './adapters.mjs';
import {appearanceFor} from '../dist/agent-appearance.js';

export function toolScope(name){
  if(['work_list','work_get','work_read_resource'].includes(name))return 'work:read';
  if(name==='work_schedule')return 'schedule:read';
  if(name==='work_verify_task')return 'work:review';
  if(name.startsWith('work_'))return 'work:write';
  if(['list_groups','read_group','read_inbox'].includes(name))return 'messages:read';
  if(['send_message','create_group','send_group_message','set_chat_status','ask_user','request_support'].includes(name)||name.startsWith('chat_'))return 'messages:write';
  if(name==='contact_book')return 'agents:read';
  if(name==='report_state')return 'agents:write';
  if(name==='memory_read')return 'memory:read';
  if(name==='memory_write')return 'memory:write';
  if(name==='toolbox')return 'tools:read';
  return 'tools:invoke';
}

const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({apiVersion:'1',...value}));};
const page=(items,url)=>{const limit=Number(url.searchParams.get('limit')||100);assert(Number.isInteger(limit)&&limit>=1&&limit<=100,'limit must be between 1 and 100');const cursor=url.searchParams.get('cursor'),index=cursor?items.findIndex(i=>i.id===cursor):-1;assert(!cursor||index>=0,'Unknown list cursor');const rows=items.slice(index+1,index+1+limit);return {items:rows,nextCursor:items.length>index+1+limit?rows.at(-1).id:null,total:items.length};};
async function body(req,limit){assert(req.headers['content-type']?.split(';')[0]==='application/json','Use application/json',415);let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;assert(size<=limit,'Request is too large',413);chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}assert(value&&typeof value==='object'&&!Array.isArray(value),'Expected a JSON object');return value;}
export class ApiV1 {
  constructor(plane,{browserAuth=()=>false}={}){
    this.plane=plane;this.browserAuth=browserAuth;this.access=new ApiAccess(plane);this.operations=new ApiOperations(plane);this.events=new ApiEvents(plane);this.reviews=new ChangeReviews(plane);
    const ajv=new Ajv({allErrors:true,strict:false});this.validators=new Map(API_ROUTES.filter(r=>r.input).map(r=>[r.id,ajv.compile(r.input)]));
  }
  async init(){await this.operations.init();await this.access.init();this.events.start();return this;}
  async close(){await this.events.close();await this.operations.close();}
  agent(project,id,principal){const task=this.plane.data.tasks.find(t=>t.id===id&&t.project===project);assert(task,'Agent not found',404);assert(principal.kind!=='agent'||principal.agentId===id,'Agents can read only their own session transcript',403);return task;}
  async agents(project){let live=[];try{live=await this.plane.herdr.list();}catch{}return this.plane.data.tasks.filter(t=>t.project===project).map(t=>({id:t.id,title:t.title,role:t.role||t.title,kind:t.kind,branch:t.branch,worktreeId:t.worktreeId,status:live.find(a=>a.pane_id===t.pane)?.agent_status||(['starting','switching'].includes(t.phase)?'starting':t.phase==='setup-error'?'setup-error':'offline'),state:t.trashedAt?'trash':t.archivedAt?'archived':'active',summary:t.agentState?.reason||t.summary||'',appearance:appearanceFor(t),providerSessionId:t.providerSessionId||null}));}
  async handle(req,res,url){
    const requestId=randomUUID();
    try{
      if(req.method==='GET'&&url.pathname==='/api/v1/openapi.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-cache'});res.end(JSON.stringify(openapi()));return;}
      if(req.method==='GET'&&url.pathname==='/api/v1'){json(res,200,{data:{name:'HeloScrum',version:'1',scopes:API_SCOPES,openapi:'/api/v1/openapi.json'}});return;}
      const match=matchRoute(req.method,url.pathname);assert(match,'Unknown API endpoint',404);const {route,params}=match;
      const principal=req.headers.authorization?this.access.authenticate(req.headers.authorization):this.browserAuth(req.headers['x-heloscrum-token'])?this.access.current('local-owner'):this.access.authenticate();
      const project=params.projectId?this.access.project(params.projectId):null;
      this.access.permit(principal,route,project);
      const input=route.input?await body(req,route.id==='resourceUpload'?29*1024*1024:512*1024):{};
      const validate=this.validators.get(route.id);if(validate&&!validate(input))throw Object.assign(new Error('Input does not match the API schema'),{status:400,details:validate.errors.map(e=>({path:e.instancePath,message:e.message}))});
      const context={principal,route,params,project,input,url,key:req.headers['idempotency-key']};
      if(route.id==='events'){this.events.stream(req,res,project,()=>this.access.permit(principal,route,project));return;}
      if(req.method==='GET'||route.id.startsWith('token')){json(res,200,{data:await this.execute(context)});return;}
      const operation=await this.operations.submit(principal,route,project,{params,input},context.key,()=>{this.access.permit(principal,route,project);return this.execute(context);});
      json(res,202,{data:operation,links:{operation:'/api/v1/operations/'+operation.id}});
    }catch(error){if(!res.headersSent)json(res,error.status||400,{requestId,error:{...apiError(error),...(error.details?{details:error.details}:{})}});else res.end();}
  }
  async execute({principal,route,params,project,input,url,key}){
    const p=this.plane,w=p.work,a=project?this.access.actor(principal,project):null,id=route.id;
    const planInput={...input,planId:params.planId,itemId:params.itemId,proposalId:params.proposalId};
    if(id==='me')return this.access.public(principal);
    if(id==='tokens')return {items:this.access.records.map(r=>this.access.public(r))};
    if(id==='tokenCreate')return this.access.create(input);
    if(id==='tokenRevoke')return this.access.revoke(params.tokenId);
    if(id==='operation')return this.operations.read(params.operationId,principal);
    if(id==='operations')return page(this.operations.list(principal,url.searchParams.get('requestId')),url);
    if(id==='projects')return page(p.projects.known().filter(pr=>this.access.allows(principal,pr)).map(pr=>({id:projectId(pr),name:path.basename(pr),path:pr})),url);
    if(id==='projectOpen'){const pr=await p.git.repository(input.path);p.projects.remember(pr);p.scheduler.ensureSettings(pr);await p.save();return {id:projectId(pr),name:path.basename(pr),path:pr};}
    if(id==='externalContacts')return {items:p.collaboration.external.active(project).map(c=>p.collaboration.external.public(c))};
    if(id==='externalContactCreate')return p.collaboration.external.register(project,input);
    if(id==='externalContactConnection')return p.collaboration.external.connection(project,params.contactId);
    if(id==='externalContactRevoke')return p.collaboration.external.revoke(project,params.contactId);
    if(id==='agents')return page(await this.agents(project),url);
    if(id==='agentCreate'){const t=await p.createTask(input,project);return {id:t.id,title:t.title,phase:t.phase,worktreeId:t.worktreeId};}
    if(id.startsWith('agent')||id==='transcript'){
      const task=this.agent(project,params.agentId,principal);
      if(id==='transcript'){let live;try{live=(await p.herdr.list()).find(t=>t.pane_id===task.pane);}catch{}return p.transcripts.read(task,live);}
      if(id==='agentRequest')return p.taskRequest(task.id,project);
      if(id==='agentMessage')return p.promptTask(task.id,input.text,project,{mode:input.mode,requestId:input.requestId||key,attachments:input.attachments});
      if(id==='agentMessageCancel')return p.collaboration.cancelPrompt(task,params.messageId);
      if(id==='agentInterrupt')return p.interruptTask(task.id,project);
      if(id==='agentResume')return p.projects.resume(project,task.id);
      if(id==='agentState')return p.projects.sessionState(project,task.id,input.state);
      if(id==='agentDecision')return p.chooseTaskResponse(task.id,input.choice,input.expected,project);
    }
    if(id==='plans')return page(w.list(a),url);
    if(id==='planCreate')return w.saveDraft(a,{...input,requestId:input.requestId||key});
    if(id==='plan')return w.detail(a,params.planId);
    if(id==='planStart')return w.start(a,planInput);
    if(id==='planState')return w.state(a,planInput);
    if(id==='planExport'){const plan=w.available(a,params.planId);return url.searchParams.get('format')==='md'?{format:'md',text:w.markdown(plan)}:w.brief(plan);}
    if(id==='taskCreate')return w.change(a,{...planInput,requestId:input.requestId||key},'create');
    if(id==='taskUpdate')return w.change(a,planInput,'update');
    if(id==='planReviewers')return w.setReviewers(a,planInput);
    if(id==='taskVerify')return w.verify(a,planInput);
    if(id==='proposalReview')return w.review(a,planInput);
    if(id==='planSchedule')return w.changeSchedule(a,planInput);
    if(id==='planDelivery')return w.delivery(a,planInput);
    if(id==='calendar')return p.scheduler.calendar(a);
    if(id==='resourceRead')return w.readResource(a,{planId:params.planId,resourceId:params.resourceId,offset:Number(url.searchParams.get('offset')||0)});
    if(id==='resourceReference')return w.repoReference(project,input.path);
    if(id==='resourceUpload'){const bytes=Buffer.from(input.data,'base64');assert(bytes.length<=MAX_WORK_FILE&&bytes.toString('base64')===input.data,'Use valid base64 containing at most 20 MiB');return w.upload(project,input.name,bytes);}
    if(id==='conversations'){let threads=p.collaboration.threadList(project);if(!a.human)threads=threads.filter(t=>t.participants.some(x=>x.id===a.id));return page(threads,url);}
    if(id==='conversation'){if(!a.human)assert(p.collaboration.threadList(project).some(t=>t.id===params.threadId&&t.participants.some(x=>x.id===a.id)),'Conversation is outside your membership',403);return p.collaboration.threadPage(project,params.threadId,url.searchParams.get('before'));}
    if(id==='conversationCreate')return p.collaboration.groups.create(a,{...input,requestId:input.requestId||key});
    if(id==='messageSend')return p.collaboration.send(a,input.to,input.message,{...input,requestId:input.requestId||key});
    if(id==='tools'){
      if(!a.human){
        const catalog=p.collaboration.catalog(a),groups=new Map();
        const tools=catalog.tools.map(tool=>{const source=tool.source;if(source?.type!=='mcp')return tool;const group=groups.get(source.id)||{id:source.id,name:source.name,scope:source.scope,tools:[]};group.tools.push(tool);groups.set(source.id,group);return {...tool,sourceId:source.id,sourceName:source.name};});
        return {...catalog,tools,mcps:[...groups.values()]};
      }
      const snapshot=p.collaboration.snapshot(project);
      return {tools:snapshot.tools.map(({name,description,inputSchema,scope,assignment,enabled,sourceName,sourceId})=>({name,description,inputSchema,scope,assignment,enabled,sourceName,sourceId})),mcps:snapshot.mcpServers.map(({id,name,scope,assignment,enabled,tools})=>({id,name,scope,assignment,enabled,tools:tools.map(({name,description,inputSchema})=>({name,description,inputSchema}))}))};
    }
    if(id==='toolInvoke'){
      assert(!a.human,'Use a credential bound to an agent to invoke its assigned tools',403);
      const name=input.name==='invoke_tool'?input.input?.name:input.name;
      assert(typeof name==='string'&&name!=='invoke_tool','Choose a tool name; nested invocation is not supported');
      this.access.permit(principal,{scope:toolScope(name)},project);
      return p.collaboration.call(a,input.name,input.input||{});
    }
    if(id==='worktrees'){
      let trees=await p.git.worktrees(project);if(!a.human)trees=trees.filter(t=>t.id===a.worktreeId);
      return page(await Promise.all(trees.map(async t=>({...t,files:await p.git.status(t.path)}))),url);
    }
    if(params.worktreeId){
      if(!a.human)assert(a.worktreeId===params.worktreeId,'Worktree is outside this agent session',403);
      if(id==='diff')return this.reviews.read(project,params.worktreeId,url.searchParams.get('file'),url.searchParams.get('staged')==='true');
      if(id==='changeReview')return this.reviews.mark(project,params.worktreeId,input.expected);
      if(id==='stage'){const current=await this.reviews.fingerprint(project,params.worktreeId);assert(current.fingerprint===input.expected,'Changes moved since review. Refresh before staging.',409);await p.git.stage(project,params.worktreeId,input.file,input.unstage);await p.record(input.unstage?'File unstaged':'File staged',input.file,project);return {file:input.file,unstaged:input.unstage};}
      if(id==='commitPreview')return p.git.commitPreview(project,params.worktreeId);
      if(id==='commit'){const result=await p.git.commit(project,params.worktreeId,input.message,input.expected);await p.record('Changes committed',input.message,project);return result;}
    }
    throw Object.assign(new Error('Unsupported operation'),{status:404});
  }
}
