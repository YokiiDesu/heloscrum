import {providerIds} from './providers.mjs';
import {WORK_TOOLS,WORK_STATUSES} from './work-management.mjs';

export const API_SCOPES=['projects:read','agents:read','agents:write','work:read','work:write','work:review','messages:read','messages:write','memory:read','memory:write','tools:read','tools:invoke','reviews:read','reviews:write','schedule:read','events:read'];
const str={type:'string'},bool={type:'boolean'},revision={type:'integer',minimum:1};
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const strings={type:'array',items:str,maxItems:100};
const tool=name=>WORK_TOOLS.find(t=>t.name===name).inputSchema;
const item={...tool('work_update_task').properties};delete item.planId;delete item.itemId;
const schedule=tool('work_update_schedule').properties.schedule;
const draft=object({id:str,requestId:str,expectedRevision:revision,title:str,instructions:str,acceptance:str,planText:str,kind:{enum:['task','plan']},strategy:{enum:['assigned','orchestrator','team']},changePolicy:{enum:['review','autonomous']},participantIds:strings,orchestratorId:{type:['string','null']},resourceIds:strings,links:strings,items:{type:'array',items:{type:'object'},maxItems:100},schedule,management:{type:['object','null']} });
const routes=[];
function add(method,path,id,scope,summary,{input,owner=false,human=false,entity}={}){routes.push({method,path,id,scope,summary,input,owner,human,entity});}
add('GET','/me','me',null,'Read the authenticated identity and its scope');
add('GET','/projects','projects','projects:read','List accessible projects');
add('POST','/projects','projectOpen',null,'Register an existing Git repository without switching the web workspace',{owner:true,input:object({path:str},['path'])});
add('GET','/tokens','tokens',null,'List access credentials without their secrets',{owner:true});
add('POST','/tokens','tokenCreate',null,'Create a scoped credential; the secret is returned once',{owner:true,input:object({name:str,kind:{enum:['agent','operator']},projects:strings,scopes:strings,agentId:str,expiresAt:str},['name','kind','projects','scopes'])});
add('DELETE','/tokens/{tokenId}','tokenRevoke',null,'Revoke a credential',{owner:true,input:object()});
add('GET','/operations/{operationId}','operation',null,'Read a durable operation result');
add('GET','/operations','operations',null,'List your operations or recover one using its request key');
const p='/projects/{projectId}';
add('GET',p+'/external-contacts','externalContacts','agents:read','List external contacts without their credentials',{human:true});
add('POST',p+'/external-contacts','externalContactCreate',null,'Register a project-scoped external MCP contact without launching a session',{owner:true,input:object({name:str,summary:str,client:{enum:['codex','generic']},externalSessionId:str},['name','client','externalSessionId'])});
add('GET',p+'/external-contacts/{contactId}/connection','externalContactConnection',null,'Recover the local connection-file path and MCP setup',{owner:true});
add('DELETE',p+'/external-contacts/{contactId}','externalContactRevoke',null,'Disconnect an external contact and revoke its capability',{owner:true,input:object()});
add('GET',p+'/agents','agents','agents:read','List project agent sessions');
add('POST',p+'/agents','agentCreate','agents:write','Create an agent session and isolated worktree',{human:true,input:object({title:str,role:str,summary:str,prompt:str,branch:str,kind:{enum:providerIds},connectionId:str,model:str,effort:str,roleType:str,profileId:str,nativeSetup:object({kiroEngine:{enum:['v2','v3']},cursorMode:{enum:['headless','interactive']},codexEngine:{enum:['terminal','app-server']},profile:{type:['string','null'],maxLength:130},files:{type:'array',items:{type:'string',maxLength:500},maxItems:256}})},['title','prompt','branch','kind'])});
add('GET',p+'/agents/{agentId}/transcript','transcript','agents:read','Read normalized events from an agent session');
add('GET',p+'/agents/{agentId}/request','agentRequest','agents:read','Read the current provider approval request',{human:true});
add('POST',p+'/agents/{agentId}/message','agentMessage','agents:write','Send human direction to an agent session',{human:true,input:object({text:str,attachments:{type:'array',items:str,maxItems:4},mode:{enum:['queue','steer']},requestId:str},['text'])});
add('POST',p+'/agents/{agentId}/messages/{messageId}/cancel','agentMessageCancel','agents:write','Cancel an unsent human session message',{human:true});
add('POST',p+'/agents/{agentId}/interrupt','agentInterrupt','agents:write','Interrupt a running agent',{human:true,input:object()});
add('POST',p+'/agents/{agentId}/resume','agentResume','agents:write','Resume the verified saved provider session',{human:true,input:object()});
add('POST',p+'/agents/{agentId}/state','agentState','agents:write','Archive, restore, or trash a session',{human:true,input:object({state:{enum:['active','archived','trash']}},['state'])});
add('POST',p+'/agents/{agentId}/decision','agentDecision','agents:write','Answer a reviewed provider request using its current fingerprint',{human:true,input:object({choice:str,expected:str},['choice','expected'])});
add('GET',p+'/plans','plans','work:read','List accessible task briefs and plans');
add('POST',p+'/plans','planCreate','work:write','Create or revise a draft brief; never dispatches agents',{human:true,input:draft,entity:'plan'});
add('GET',p+'/plans/{planId}','plan','work:read','Read a plan with tasks, proposals, and audit history');
add('POST',p+'/plans/{planId}/start','planStart','work:write','Submit a reviewed draft to its selected team',{human:true,input:object({expectedRevision:revision},['expectedRevision']),entity:'plan'});
add('POST',p+'/plans/{planId}/state','planState','work:write','Complete, archive, or restore a plan',{human:true,input:object({expectedRevision:revision,status:{enum:['active','completed','archived']}},['expectedRevision','status']),entity:'plan'});
add('GET',p+'/plans/{planId}/export','planExport','work:read','Export a portable JSON or Markdown brief');
add('POST',p+'/plans/{planId}/tasks','taskCreate','work:write','Create or propose a task',{input:object({...item,requestId:str},['expectedRevision','title']),entity:'plan'});
add('PATCH',p+'/plans/{planId}/tasks/{itemId}','taskUpdate','work:write','Update progress or propose scope changes',{input:object(item,['expectedRevision']),entity:'plan'});
add('POST',p+'/plans/{planId}/tasks/{itemId}/verify','taskVerify','work:review','Independently verify completion with evidence',{input:object({expectedRevision:revision,passed:bool,evidence:str},['expectedRevision','passed','evidence']),entity:'plan'});
add('POST',p+'/plans/{planId}/proposals/{proposalId}/review','proposalReview','work:review','Approve or reject a proposed change',{human:true,input:object({expectedRevision:revision,decision:{enum:['approve','reject']},reason:str},['expectedRevision','decision']),entity:'plan'});
add('POST',p+'/plans/{planId}/schedule','planSchedule','work:write','Update or propose dates under the plan policy',{input:object({expectedRevision:revision,schedule,note:str},['expectedRevision','schedule']),entity:'plan'});
add('POST',p+'/plans/{planId}/reviewers','planReviewers','work:review','Delegate independent task review to selected teammates',{human:true,input:object({expectedRevision:revision,reviewerIds:{type:'array',items:str,maxItems:20,uniqueItems:true}},['expectedRevision','reviewerIds']),entity:'plan'});
add('POST',p+'/plans/{planId}/delivery','planDelivery','work:write','Manage sprint boundaries or phase gates as the sponsor',{human:true,input:object({expectedRevision:revision,action:{enum:['start_sprint','close_sprint','approve_gate']},goal:str,note:str,improvement:str,itemIds:strings,scopeBaseline:str,scheduleBaseline:str,riskRegister:str,schedule},['expectedRevision','action']),entity:'plan'});
add('GET',p+'/plans/{planId}/resources/{resourceId}','resourceRead','work:read','Read an attachment under plan membership rules');
add('POST',p+'/resources','resourceUpload','work:write','Attach a file as base64 data, at most 20 MiB',{human:true,input:object({name:str,data:{type:'string',maxLength:28*1024*1024}},['name','data'])});
add('POST',p+'/resources/reference','resourceReference','work:write','Snapshot a repository-relative resource',{human:true,input:object({path:str},['path'])});
add('GET',p+'/calendar','calendar','schedule:read','Read the shared task, milestone, and sprint calendar');
add('GET',p+'/conversations','conversations','messages:read','List visible project conversations');
add('GET',p+'/conversations/{threadId}','conversation','messages:read','Read a conversation with membership checks');
add('POST',p+'/conversations','conversationCreate','messages:write','Create a project group',{input:object({name:str,participants:strings,requestId:str},['name','participants'])});
add('POST',p+'/messages','messageSend','messages:write','Send a recorded direct or group message',{input:object({to:{type:['string','array'],items:str},threadId:str,message:str,kind:{enum:['request','result','ack']},requiresReply:bool,replyTo:str,requestId:str},['message'])});
add('GET',p+'/tools','tools','tools:read','Read the project or agent toolbox');
add('POST',p+'/tools/invoke','toolInvoke','tools:invoke','Invoke an assigned tool as the authenticated agent',{input:object({name:str,input:{type:'object'}},['name'])});
add('GET',p+'/worktrees','worktrees','reviews:read','List Git worktrees and their changed files');
add('GET',p+'/worktrees/{worktreeId}/diff','diff','reviews:read','Read a file diff and its review fingerprint');
add('POST',p+'/worktrees/{worktreeId}/review','changeReview','reviews:write','Mark the exact displayed changes reviewed',{human:true,input:object({expected:str},['expected'])});
add('POST',p+'/worktrees/{worktreeId}/stage','stage','reviews:write','Stage or unstage a file',{human:true,input:object({file:str,unstage:bool,expected:str},['file','unstage','expected'])});
add('GET',p+'/worktrees/{worktreeId}/commit-preview','commitPreview','reviews:read','Review the staged tree and current HEAD',{human:true});
add('POST',p+'/worktrees/{worktreeId}/commit','commit','reviews:write','Commit only the reviewed staged tree',{human:true,input:object({message:str,expected:object({tree:str,head:str},['tree','head'])},['message','expected'])});
add('GET',p+'/events','events','events:read','Stream resumable project change notifications over SSE');
export const API_ROUTES=routes;
export function matchRoute(method,pathname){
  const parts=pathname.replace(/^\/api\/v1/,'').split('/').slice(1);
  for(const route of routes){
    if(route.method!==method)continue;
    const template=route.path.split('/').slice(1);if(template.length!==parts.length)continue;
    const params={};let matches=true;
    for(let i=0;i<parts.length;i++){if(template[i].startsWith('{')){try{params[template[i].slice(1,-1)]=decodeURIComponent(parts[i]);}catch{matches=false;}if(!parts[i])matches=false;}else if(template[i]!==parts[i])matches=false;}
    if(matches)return {route,params};
  }
  return null;
}
export function openapi(){
  const paths={};
  const ref=name=>({$ref:'#/components/schemas/'+name}),list=name=>({type:'object',required:['items'],properties:{items:{type:'array',items:ref(name)},nextCursor:{type:['string','null']},total:{type:'integer'}}});
  const schemas={
    Error:{type:'object',required:['code','message'],properties:{code:str,message:str,status:{type:'integer'},details:{}}},
    ErrorResponse:{type:'object',required:['apiVersion','error'],properties:{apiVersion:{const:'1'},requestId:str,error:ref('Error')}},
    Operation:{type:'object',required:['id','action','status','createdAt'],properties:{id:str,action:str,callerId:str,project:{type:['string','null']},status:{enum:['queued','running','succeeded','failed','uncertain']},createdAt:str,startedAt:str,finishedAt:str,result:{},error:ref('Error')}},
    Project:object({id:str,name:str,path:str},['id','name','path']),
    Agent:{type:'object',required:['id','role','status','state'],properties:{id:str,title:str,role:str,kind:str,branch:str,worktreeId:str,status:str,state:{enum:['active','archived','trash']},appearance:object({color:str,icon:str}),providerSessionId:{type:['string','null']}}},
    Task:{type:'object',required:['id','title','status'],properties:{id:str,title:str,description:str,status:{enum:WORK_STATUSES},ownerId:{type:['string','null']},dependsOn:strings,acceptance:str,note:str,schedule,verification:{type:'object'}}},
    Plan:{type:'object',required:['id','title','revision','status'],properties:{id:str,title:str,project:str,revision,status:{enum:['draft','active','completed','archived']},kind:{enum:['plan','task']},instructions:str,participantIds:strings,strategy:{enum:['assigned','orchestrator','team']},changePolicy:{enum:['review','autonomous']},items:{type:'array',items:ref('Task')},proposals:{type:'array',items:{type:'object'}},audit:{type:'array',items:{type:'object'}},schedule,management:{type:['object','null']},resources:{type:'array',items:{type:'object'}}}},
    Credential:{type:'object',required:['id','kind','scopes','projects'],properties:{id:str,name:str,kind:{enum:['owner','operator','agent']},agentId:{type:['string','null']},projects:strings,scopes:strings,expiresAt:{type:['string','null']},revokedAt:str}},
    Transcript:{type:'object',required:['events'],properties:{sessionId:str,source:str,warning:str,events:{type:'array',items:{type:'object',properties:{id:str,type:str,role:str,text:str,name:str,input:{},output:{},status:str}}}}},
    Conversation:{type:'object',required:['id','name','kind'],properties:{id:str,name:str,kind:{enum:['dm','group']},count:{type:'integer'},participants:{type:'array',items:{type:'object'}},messages:{type:'array',items:{type:'object'}},hasMore:bool,before:{type:['string','null']}}},
    Worktree:{type:'object',required:['id','path','branch','head'],properties:{id:str,path:str,branch:str,head:str,files:{type:'array',items:{type:'object'}}}},
    Calendar:{type:'object',properties:{timeZone:str,entries:{type:'array',items:{type:'object'}},plans:{type:'array',items:{type:'object'}},notices:{type:'array',items:{type:'object'}}}},
    Event:{type:'object',properties:{id:str,cursor:str,type:{enum:['ready','workspace.changed','resync','access.revoked']},projectId:str,at:str}}
  };
  const dataSchemas={me:ref('Credential'),tokens:list('Credential'),tokenRevoke:ref('Credential'),tokenCreate:{allOf:[ref('Credential'),{type:'object',required:['token','url'],properties:{token:str,url:str}}]},operation:ref('Operation'),operations:list('Operation'),projects:list('Project'),agents:list('Agent'),plans:list('Plan'),plan:ref('Plan'),transcript:ref('Transcript'),conversations:list('Conversation'),conversation:ref('Conversation'),worktrees:list('Worktree'),calendar:ref('Calendar')};
  for(const r of routes){
    const parameters=[...r.path.matchAll(/\{(\w+)\}/g)].map(([,name])=>({name,in:'path',required:true,schema:str}));
    if(['projects','agents','plans','operations','conversations','worktrees'].includes(r.id))parameters.push(...['cursor','limit'].map(name=>({name,in:'query',schema:name==='limit'?{type:'integer',minimum:1,maximum:100}:str})));
    if(r.id==='events')parameters.push({name:'after',in:'query',schema:str});
    if(r.id==='operations')parameters.push({name:'requestId',in:'query',schema:str});
    if(['diff','planExport','conversation','resourceRead'].includes(r.id))for(const name of ({diff:['file','staged'],planExport:['format'],conversation:['before'],resourceRead:['offset']})[r.id])parameters.push({name,in:'query',schema:str});
    const queued=r.method!=='GET'&&!r.id.startsWith('token');
    if(queued)parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:1,maxLength:120}});
    const errors=Object.fromEntries([[400,'Invalid input'],[401,'Invalid, expired, or revoked credential'],[403,'Not permitted'],[404,'Not found or not visible'],[409,'Revision conflict or changed request'],[413,'Payload too large'],[429,'Limit reached'],[503,'Backend unavailable']].map(([code,description])=>[code,{description,content:{'application/json':{schema:ref('ErrorResponse')}}}]));
    (paths['/api/v1'+r.path]||={})[r.method.toLowerCase()]={operationId:r.id,summary:r.summary,description:[r.scope&&`Requires ${r.scope}.`,r.human&&'Requires an owner or explicitly delegated operator credential.',r.owner&&'Local owner only.',queued&&'Returns a durable operation. Poll its URL; uncertain operations are never automatically replayed.'].filter(Boolean).join(' '),security:[{bearerAuth:[]}],parameters,...(r.input?{requestBody:{required:true,content:{'application/json':{schema:r.input}}}}:{}),responses:{[queued?'202':'200']:{description:queued?'Accepted operation':r.id==='events'?'SSE frames; data is an Event JSON object':'Successful response',content:{[r.id==='events'?'text/event-stream':'application/json']:{schema:r.id==='events'?{type:'string'}:{type:'object',required:['apiVersion','data'],properties:{apiVersion:{const:'1'},data:queued?ref('Operation'):dataSchemas[r.id]||{}}}}}},...errors}};
  }
  return {openapi:'3.1.0',info:{title:'HeloScrum API',version:'1.0.0',description:'Local, project-scoped API shared by the CLI, TUI and agent integrations. Existing MCP tools call the same domain services.'},servers:[{url:'http://127.0.0.1:4173'}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}},schemas}};
}
