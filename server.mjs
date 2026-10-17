import {readWorkspaceFile} from './lib/workspace-files.mjs';
import {websiteDemoHeaders} from './lib/website-demos.mjs';
import {refreshLocalAddress} from './lib/local-address.mjs';
import {startEventRelays} from './lib/event-relays.mjs';
import {NativeCommands} from './lib/native-commands.mjs';
import {workRoute,workUpload} from './lib/work-routes.mjs';
import {ApiV1} from './lib/api-v1.mjs';
import './scripts/setup-pty.mjs';
import { Terminals } from './lib/terminals.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { ControlPlane } from './lib/control-plane.mjs';
import { assert } from './lib/adapters.mjs';
import { validRequest } from './lib/security.mjs';
import { ChangeReviews } from './lib/change-reviews.mjs';
import { messageEvents } from './lib/chat-messages.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
let port=Number(process.env.PORT||4173);
const token=randomBytes(32).toString('hex');
const plane=await new ControlPlane(process.env.HELOSCRUM_ROOT||root).init({history:true});
let desktopOwnsEngine=false,desktopEngineStart;
const reviews=new ChangeReviews(plane);
const nativeCommands=new NativeCommands(plane);
plane.baseUrl=`http://127.0.0.1:${port}`;
const files={'/role-packs.js':['dist/role-packs.js','text/javascript'],'/role-packs.css':['dist/role-packs.css','text/css'],'/role-pack-catalog.js':['dist/role-pack-catalog.js','text/javascript'],'/sounds/project-complete-sound-effect.mp3':['dist/sounds/project-complete-sound-effect.mp3','audio/mpeg'],'/sounds/notification-sound-effect.mp3':['dist/sounds/notification-sound-effect.mp3','audio/mpeg'],'/sounds/error-sound-effect.wav':['dist/sounds/error-sound-effect.wav','audio/wav'],'/preferences.js':['dist/preferences.js','text/javascript'],'/preferences.css':['dist/preferences.css','text/css'],'/theme-boot.js':['dist/theme-boot.js','text/javascript'],'/image-attachments.js':['dist/image-attachments.js','text/javascript'],'/image-attachments.css':['dist/image-attachments.css','text/css'],'/input-history.js':['dist/input-history.js','text/javascript'],'/memory.js':['dist/memory.js','text/javascript'],'/brand':['dist/brand/index.html','text/html'],'/brand.css':['dist/brand.css','text/css'],'/brand/preview.css':['dist/brand/preview.css','text/css'],'/brand/heloscrum-mark.svg':['dist/brand/heloscrum-mark.svg','image/svg+xml'],'/brand/heloscrum-icon.svg':['dist/brand/heloscrum-icon.svg','image/svg+xml'],'/brand/heloscrum-mark-mono.svg':['dist/brand/heloscrum-mark-mono.svg','image/svg+xml'],'/providers.js':['lib/providers.mjs','text/javascript'],'/effort.js':['lib/effort.mjs','text/javascript'],'/model-names.js':['dist/model-names.js','text/javascript'],'/chat-directory.js':['dist/chat-directory.js','text/javascript'],'/history.js':['dist/history.js','text/javascript'],'/conversation-structures.js':['dist/conversation-structures.js','text/javascript'],'/conversation-structures.css':['dist/conversation-structures.css','text/css'],'/chat-threads.js':['dist/chat-threads.js','text/javascript'],'/agent-settings.js':['dist/agent-settings.js','text/javascript'],'/':['dist/index.html','text/html'],'/app.js':['dist/app.js','text/javascript'],'/workspace.css':['dist/workspace.css','text/css'],'/style.css':['dist/style.css','text/css'],'/pack.js':['dist/pack.js','text/javascript'],'/transcript-tui.js':['dist/transcript-tui.js','text/javascript'],'/tui-model.js':['dist/tui-model.js','text/javascript'],'/agent-tools.js':['dist/agent-tools.js','text/javascript'],'/pack.css':['dist/pack.css','text/css'],'/vendor/xterm.js':['node_modules/@xterm/xterm/lib/xterm.js','text/javascript'],'/vendor/fit.js':['node_modules/@xterm/addon-fit/lib/addon-fit.js','text/javascript'],'/vendor/xterm.css':['node_modules/@xterm/xterm/css/xterm.css','text/css'],'/vendor/marked.js':['node_modules/marked/lib/marked.esm.js','text/javascript'],'/vendor/purify.js':['node_modules/dompurify/dist/purify.es.mjs','text/javascript']};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
function auth(value){if(typeof value!=='string')return false;const a=Buffer.from(value),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);}
const apiV1=await new ApiV1(plane,{browserAuth:auth}).init();
async function body(req,limit=32000){assert(req.headers['content-type']?.split(';')[0]==='application/json','Use JSON requests',415);let size=0,parts=[];for await(const part of req){size+=part.length;assert(size<=limit,'Request is too large',413);parts.push(part);}let result;try{result=JSON.parse(Buffer.concat(parts).toString());}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}assert(result&&typeof result==='object'&&!Array.isArray(result),'Expected a JSON object');return result;}
const server=http.createServer(async(req,res)=>{
 try{
  assert(validRequest(req,port),'Local same-origin access only',403);
  const url=new URL(req.url,`http://${req.headers.host}`),route=url.pathname;
  if(route==='/api/v1'||route.startsWith('/api/v1/'))return await apiV1.handle(req,res,url);
  if(route.startsWith('/agent-api/')){
   const task=plane.collaboration.authenticate(req.headers.authorization?.replace(/^Bearer /,''));
   const input=req.method==='POST'?await body(req,route==='/agent-api/call'?14*1024*1024:32000):{};plane.collaboration.heartbeat(task);
   if(route==='/agent-api/catalog'&&req.method==='GET')return json(res,200,plane.collaboration.catalog(task,{compact:true}));
   if(route==='/agent-api/listed'&&req.method==='POST'){plane.collaboration.seen(task,input.revision);return json(res,200,{ok:true});}
   if(route==='/agent-api/call'&&req.method==='POST')return json(res,200,await plane.collaboration.call(task,input.name,input.input));
   if(route==='/agent-api/session'&&req.method==='POST'){assert(!task.external,'External contacts do not register managed runtime sessions',403);await plane.transcripts.register(task,input);return json(res,200,{ok:true});}
   return json(res,404,{error:'Unknown agent endpoint'});
  }
  if(route==='/api/session'&&req.method==='GET')return json(res,200,{token});
  if(route.startsWith('/api/')){
   // Old open tabs can renew their session after upgrading the backend, while
   // new clients receive the new name and a stable, non-display error code.
   if(!auth(req.headers['x-heloscrum-token']))return json(res,401,{code:'SESSION_EXPIRED',error:'Refresh HeloScrum to reconnect'});
   if(url.pathname==='/api/work/upload'&&req.method==='POST')return json(res,201,await workUpload(req,plane.work,url));
   const input=req.method==='POST'?await body(req,route==='/api/message-images'?14*1024*1024:url.pathname.startsWith('/api/work/')?512000:32000):{};
   if(route==='/api/message-images'&&req.method==='POST')return json(res,201,await plane.images.upload(plane.collaboration.chatProject(input.project||plane.data.project),input));
   if(route.startsWith('/api/message-images/')&&req.method==='GET')return json(res,200,await plane.images.read(plane.collaboration.chatProject(url.searchParams.get('project')||plane.data.project),route.split('/').at(-1)));
   if(url.pathname==='/api/work'||url.pathname.startsWith('/api/work/'))return await workRoute(req,res,plane.work,url,input,json);
   if(req.method==='GET'){
    if(route==='/api/workspace-file'){const {bytes,...file}=await readWorkspaceFile(plane,Object.fromEntries(url.searchParams));return json(res,200,{...file,content:bytes.toString('base64')});}
    if(route==='/api/ai-connections')return json(res,200,plane.ai.list());
    if(route==='/api/notebook'){const task=plane.task(url.searchParams.get('task'));return json(res,200,url.searchParams.has('revision')?await plane.notebooks.history(task,Number(url.searchParams.get('revision'))):await plane.notebooks.read(task,{offset:Number(url.searchParams.get('offset')||0),limit:20,includeClosed:true}));}
    if(route==='/api/memory/search')return json(res,200,await plane.notebooks.search(plane.task(url.searchParams.get('task')),{query:url.searchParams.get('query'),scope:url.searchParams.get('scope')||'all',ranking:url.searchParams.get('ranking')||undefined,before:url.searchParams.get('before')||undefined}));
    if(route==='/api/context')return json(res,200,await plane.context.inspect(url.searchParams.get('task')));
    if(route==='/api/project-settings')return json(res,200,plane.projectSettings.directory(url.searchParams.get('project')||plane.data.project));
    if(route==='/api/projects')return json(res,200,await plane.projects.directory());
    if(route==='/api/project-repository')return json(res,200,await plane.projects.requests(url.searchParams.get('project')||plane.data.project));
    if(route==='/api/project-push-preview')return json(res,200,await plane.projects.pushPreview(url.searchParams.get('project')||plane.data.project,url.searchParams.get('worktree')));
    if(route==='/api/project-request')return json(res,200,await plane.projects.newRequest(url.searchParams.get('project')||plane.data.project,url.searchParams.get('worktree')));
    if(route==='/api/providers')return json(res,200,await plane.agentSettings.catalog({quick:url.searchParams.get('quick')==='1',kind:url.searchParams.get('kind')||undefined}));
    if(route==='/api/native-commands')return json(res,200,await nativeCommands.inspect(url.searchParams.get('task')));
    if(route==='/api/native-setup'){const task=url.searchParams.get('task')?plane.task(url.searchParams.get('task')):null;const project=url.searchParams.get('project')||task?.project||plane.data.project;assert(!task||task.project===project,'Agent belongs to another project',403);return json(res,200,await plane.nativeSetup.report(url.searchParams.get('kind')||task?.kind,project,task,{kiroEngine:url.searchParams.get('kiroEngine')||undefined}));}
    if(route==='/api/role-packs')return json(res,200,await plane.rolePacks.view(plane.task(url.searchParams.get('task')),{catalog:true}));
    if(route==='/api/agent-settings')return json(res,200,await plane.agentSettings.details(url.searchParams.get('task')));
    if(route==='/api/agent-tools')return json(res,200,plane.collaboration.scope(plane.task(url.searchParams.get('task'))));
    if(route==='/api/agent-identities')return json(res,200,{agentIdentities:plane.projects.identities()});
    if(route==='/api/chat-threads')return json(res,200,url.searchParams.get('scope')==='all'?plane.collaboration.threadDirectory():{threads:plane.collaboration.threadList(plane.data.project)});
    if(route==='/api/chat-thread')return json(res,200,{...plane.collaboration.threadPage(plane.collaboration.chatProject(url.searchParams.get('project')||plane.data.project),url.searchParams.get('thread'),url.searchParams.get('before')),agentIdentities:plane.projects.identities()});
    if(route==='/api/task-handoff'){
      const task=plane.task(url.searchParams.get('task'));
      const results=plane.collaboration.threads(task.project).flatMap(thread=>thread.messages.filter(m=>m.from===task.id&&m.kind==='result').map(message=>({threadId:thread.id,messageId:message.id,at:message.at})));
      return json(res,200,results.sort((a,b)=>b.at.localeCompare(a.at))[0]||{threadId:null});
    }
    if(route==='/api/history')return json(res,200,{agentIdentities:plane.projects.identities(),...await plane.history.summary(plane.data.project),collectionErrors:plane.historyCollector.errors,lastCapturedAt:plane.historyCollector.lastCapturedAt});
    if(route==='/api/history/session'){
      const page=await plane.history.sessionHistory(plane.data.project,url.searchParams.get('id'),{before:url.searchParams.get('before')});
      return json(res,200,{...page,events:messageEvents(page.events,{id:page.session.task_id,kind:page.session.provider,project:plane.data.project},plane.data.collaboration?.messages||[]),agentIdentities:plane.projects.identities()});
    }
    if(route==='/api/history/export')return json(res,200,await plane.history.export(plane.data.project));
    if(route==='/api/history/records'){const kind=url.searchParams.get('kind');assert(['memory','commit','commit-action','artifact','activity','conversation-status'].includes(kind),'Choose an archive record type');return json(res,200,{records:await plane.history.rows(plane.data.project,kind)});}
    if(route==='/api/chat'){const task=plane.task(url.searchParams.get('task'));let live;try{live=(await plane.herdr.list()).find(a=>a.pane_id===task.pane);}catch{}return json(res,200,await plane.transcripts.read(task,live));}
    if(route==='/api/state')return json(res,200,await plane.snapshot());
    if(route==='/api/change-review')return json(res,200,await reviews.read(plane.data.project,url.searchParams.get('worktree'),url.searchParams.get('file'),url.searchParams.get('staged')==='true'));
    if(route==='/api/changes')return json(res,200,await plane.git.files(plane.data.project,url.searchParams.get('worktree')));
    if(route==='/api/diff')return json(res,200,await plane.git.file(plane.data.project,url.searchParams.get('worktree'),url.searchParams.get('file'),url.searchParams.get('staged')==='true'));
    if(route==='/api/commit-preview')return json(res,200,await plane.git.commitPreview(plane.data.project,url.searchParams.get('worktree')));
    if(route==='/api/merge-preview')return json(res,200,await plane.git.mergePreview(plane.data.project,url.searchParams.get('worktree')));
    if(route==='/api/output')return json(res,200,await plane.taskOutput(url.searchParams.get('task')));
    if(route==='/api/request')return json(res,200,await plane.taskRequest(url.searchParams.get('task')));
    if(route==='/api/logs')return json(res,200,{output:await plane.docker.logs(url.searchParams.get('container'))});
   }
   if(req.method==='POST'){
    const human={id:'human',role:'You',human:true,project:plane.data.project};
    if(['/api/groups','/api/groups/respond','/api/groups/message','/api/chat-status','/api/structures','/api/structures/action'].includes(route))human.project=plane.collaboration.chatProject(input.project||plane.data.project);
    if(route==='/api/groups')return json(res,201,await plane.collaboration.groups.create(human,input));
    if(route==='/api/groups/respond')return json(res,200,await plane.collaboration.userRequests.answer(human,input));
    if(route==='/api/groups/message'){assert(typeof input.threadId==='string','Choose a group');return json(res,200,await plane.collaboration.sendGroup(human,null,input.message,input));}
    if(route==='/api/chat-status')return json(res,200,await plane.collaboration.groups.status(human,input));
    if(route==='/api/structures')return json(res,201,await plane.collaboration.structures.create(human,input));
    if(route==='/api/structures/action')return json(res,200,await plane.collaboration.structures.act(human,input));
    if(route==='/api/history/capture')return json(res,200,await plane.historyCollector.collect());
    if(route==='/api/ai-connections')return json(res,200,await plane.ai.configure(input));
    if(route==='/api/ai-connections/archive')return json(res,200,await plane.ai.archive(input));
    if(route==='/api/ai-connections/models')return json(res,200,await plane.ai.discover(input));
    if(route==='/api/ai-connections/test')return json(res,200,await plane.ai.test(input.id));
    if(route==='/api/notebook')return json(res,200,await plane.notebooks.write(plane.task(input.taskId),input,human));
    if(route==='/api/memory/source')return json(res,200,await plane.notebooks.readSource(plane.task(input.taskId),input));
    if(route==='/api/context/settings')return json(res,200,await plane.ai.configureContext(input));
    if(route==='/api/context/evaluate')return json(res,200,await plane.context.inspect(input.id,{evaluate:true}));
    if(route==='/api/context/checkpoint')return json(res,200,await plane.context.checkpoint(input.id));
    if(route==='/api/role-packs/configure')return json(res,200,await plane.rolePacks.configure(plane.task(input.id),input));
    if(route==='/api/role-packs/refresh'){const task=plane.task(input.id);assert(input.expectedRevision===(task.claudeRolePacks?.revision||0),'Role-pack settings changed. Refresh before selecting again.',409);await plane.rolePacks.resolve(task,{retry:true});return json(res,200,await plane.rolePacks.view(task,{catalog:true}));}
    if(route==='/api/agent-settings/preview')return json(res,200,await plane.agentSettings.preview(input.id,input));
    if(route==='/api/agent-settings/recover')return json(res,200,await plane.agentSettings.recover(input.id));
    if(route==='/api/agent-settings/change')return json(res,200,await plane.agentSettings.change(input.id,input));
    if(route==='/api/terminals')return json(res,201,await terminals.ticket(input.taskId,input));
    if(route==='/api/tui-terminal')return json(res,201,terminals.tuiTicket(input));
    if(route==='/api/contacts/refresh')return json(res,200,await plane.collaboration.refreshContacts(plane.data.project,input.taskId));
    if(route==='/api/agent-tools')return json(res,200,await plane.collaboration.setScope(plane.task(input.taskId),input));
    if(route==='/api/project-settings/conversation')return json(res,200,await plane.projectSettings.setConversation(input));
    if(route==='/api/project-settings/agent')return json(res,200,await plane.projectSettings.saveProfile(input));
    if(route==='/api/project-settings/tool')return json(res,200,await plane.projectSettings.updateTool(input));
    if(route==='/api/project-settings/mcp')return json(res,200,await plane.mcp.configure(input));
    if(route==='/api/project-settings/mcp/connect')return json(res,200,await plane.mcp.discover(input.id));
    if(route==='/api/toolbox')return json(res,201,await plane.collaboration.addTool(input,plane.data.project));
    if(route==='/api/projects/push')return json(res,200,await plane.projects.push(input.project,input.worktreeId,input.expected));
    if(route==='/api/projects/pin')return json(res,200,await plane.projects.pin(input.project,input.pinned));
    if(route==='/api/projects/clone')return json(res,201,await plane.projects.clone(input));
    if(route==='/api/projects/connect')return json(res,200,await plane.projects.connect(input.project,input));
    if(route==='/api/projects/configure')return json(res,200,await plane.projects.configure(input.project,input));
    if(route==='/api/sessions/state')return json(res,200,await plane.projects.sessionState(input.project,input.id,input.state));
    if(route==='/api/sessions/resume')return json(res,202,await plane.projects.resume(input.project,input.id));
    if(route==='/api/agent-appearance')return json(res,200,await plane.projects.appearance(input.id,input));
    if(route==='/api/project')return json(res,200,await plane.selectProject(input.path,{initialize:input.initialize===true}));
    if(route==='/api/herdr/start'){const result=await plane.herdr.startServer();await plane.record('Agent engine connected','HeloScrum’s dedicated Herdr session');return json(res,200,result);}
    if(route==='/api/tasks')return json(res,202,await plane.createTask(input));
    if(route==='/api/tasks/retry')return json(res,202,await plane.retryTask(input.id));
    if(route==='/api/tasks/prompt/cancel')return json(res,200,await plane.collaboration.cancelPrompt(plane.task(input.id),input.messageId));
    if(route==='/api/tasks/prompt')return json(res,200,await plane.promptTask(input.id,input.text,plane.data.project,{mode:input.mode,requestId:input.requestId,attachments:input.attachments}));
    if(route==='/api/tasks/respond')return json(res,200,await plane.respondTask(input.id,input.key,input.expected));
    if(route==='/api/tasks/decision')return json(res,200,await plane.chooseTaskResponse(input.id,input.choice,input.expected));
    if(route==='/api/native-commands')return json(res,200,await nativeCommands.run(input.taskId,input));
    if(route==='/api/tasks/interrupt')return json(res,200,await plane.interruptTask(input.id));
    if(route==='/api/stage-hunk'){assert(typeof input.unstage==='boolean','Missing staging action');const result=await plane.git.stageHunk(plane.data.project,input.worktreeId,input.file,input.hunkId,input.expected,input.unstage);await plane.record(input.unstage?'Section unstaged':'Section staged',input.file);return json(res,200,result);}
    if(route==='/api/stage'){assert(typeof input.unstage==='boolean','Missing staging action');const result=await plane.git.stage(plane.data.project,input.worktreeId,input.file,input.unstage);await plane.record(input.unstage?'File unstaged':'File staged',input.file);return json(res,200,result);}
    if(route==='/api/change-review')return json(res,200,await reviews.mark(plane.data.project,input.worktreeId,input.expected));
    if(route==='/api/commit'){const result=await plane.git.commit(plane.data.project,input.worktreeId,input.message,input.expected);const task=plane.data.tasks.find(t=>t.project===plane.data.project&&t.worktreeId===input.worktreeId);await plane.history.captureRecords([{project:plane.data.project,kind:'commit-action',id:result.head,taskId:task?.id||null,at:new Date().toISOString(),provenance:'human-reviewed-commit-action',body:{sha:result.head,worktreeId:input.worktreeId,message:input.message,taskId:task?.id||null,providerSessionId:task?.providerSessionId||null}}]);await plane.record('Changes committed',input.message);return json(res,200,result);}
    if(route==='/api/merge'){const task=plane.data.tasks.find(t=>t.project===plane.data.project&&t.worktreeId===input.worktreeId);if(task){const agent=(await plane.herdr.list()).find(a=>a.pane_id===task.pane);assert(agent&&['idle','done'].includes(agent.agent_status),'Agent must be idle before merging',409);}const result=await plane.git.merge(plane.data.project,input.worktreeId,input.expected);await plane.record('Branch merged',result.source.branch+' → '+result.target.branch);return json(res,200,{ok:true});}
    if(route==='/api/container/action'){await plane.docker.action(input.id,input.action);plane.dockerCache=null;await plane.record('Container '+input.action,input.id.slice(0,12));return json(res,200,{ok:true});}
    if(route==='/api/container/link')return json(res,200,await plane.linkContainer(input.id,input.taskId));

   }
   return json(res,404,{error:'Unknown API endpoint'});
  }
  assert(req.method==='GET'||req.method==='HEAD','Method not allowed',405);
  // Bundle the website's public help with the local app so tour links work
  // without a hosted website. No dot directories, arbitrary paths, or data files.
  const helpFile=route==='/help/'?'index.html':route.match(/^\/help\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:html|css|js|svg|png|webp|woff2))$/)?.[1];
  const helpTypes={html:'text/html',css:'text/css',js:'text/javascript',svg:'image/svg+xml',png:'image/png',webp:'image/webp',woff2:'font/woff2'};
  const helpEntry=helpFile?['website/'+helpFile,helpTypes[helpFile.split('.').at(-1)]]:null;
  const localModules={'/connection-indicator.js':'connection-indicator.js','/guided-tour.js':'guided-tour.js','/tour-steps.js':'tour-steps.js','/guided-tour.css':'guided-tour.css','/activity-card.js':'activity-card.js','/thinking-block.js':'thinking-block.js','/document-preview.js':'document-preview.js','/document-converter.worker.js':'document-converter.worker.js','/file-preview.js':'file-preview.js','/native-terminal.js':'native-terminal.js','/native-terminal.css':'native-terminal.css','/slash-commands.js':'slash-commands.js','/native-commands.js':'native-commands.js','/loading-state.js':'loading-state.js','/provider-request.js':'provider-request.js','/native-setup.js':'native-setup.js','/native-setup.css':'native-setup.css','/diff-view.js':'diff-view.js','/ai-settings.js':'ai-settings.js','/api-events.js':'api-events.js','/schedule-ui.js':'schedule-ui.js','/schedule.css':'schedule.css','/connection.js':'connection.js','/toasts.js':'toasts.js','/tooltips.js':'tooltips.js','/feedback.css':'feedback.css','/work-methods.js':'work-methods.js','/work-delivery.js':'work-delivery.js','/work-message.js':'work-message.js','/work-board.js':'work-board.js','/work-board.css':'work-board.css','/project-settings.js':'project-settings.js','/project-settings.css':'project-settings.css','/project-library.js':'project-library.js','/agent-appearance.js':'agent-appearance.js','/workspace-model.js':'workspace-model.js','/rich-text.js':'rich-text.js','/prose-format.js':'prose-format.js','/resource-preview.js':'resource-preview.js','/message-content.js':'message-content.js','/workspace-shell.js':'workspace-shell.js','/unified.css':'unified.css','/controls.css':'controls.css'};
  const mermaidFile=route.match(/^\/vendor\/mermaid\/((?:chunks\/mermaid\.esm\.min\/)?[\w.-]+\.mjs)$/)?.[1];
  const documentVendors={'/vendor/mammoth.js':['node_modules/mammoth/mammoth.browser.min.js','text/javascript'],'/vendor/fflate.js':['node_modules/fflate/umd/index.js','text/javascript']};
  const pdfFile=route.match(/^\/vendor\/pdfjs\/(legacy\/build\/pdf(?:\.worker)?\.mjs|cmaps\/[\w.-]+\.bcmap|standard_fonts\/[\w.-]+\.(?:pfb|ttf)|wasm\/[\w.-]+\.(?:wasm|js)|iccs\/[\w.-]+\.icc)$/)?.[1];
  const pdfType=pdfFile&&(/\.m?js$/.test(pdfFile)?'text/javascript':pdfFile.endsWith('.wasm')?'application/wasm':'application/octet-stream');
  const terminalFiles={'/cli':['dist/cli.html','text/html'],'/cli.js':['dist/cli.js','text/javascript'],'/cli.css':['dist/cli.css','text/css']};
  const entry=helpEntry||(route==='/agent-icons.svg'?['dist/agent-icons.svg','image/svg+xml']:null)||files[route]||documentVendors[route]||(pdfFile?['node_modules/pdfjs-dist/'+pdfFile,pdfType]:null)||terminalFiles[route]||(localModules[route]?['dist/'+localModules[route],route.endsWith('.css')?'text/css':'text/javascript']:null)||(mermaidFile?['node_modules/mermaid/dist/'+mermaidFile,'text/javascript']:null);assert(entry,'Not found',404);
  const content=await readFile(path.join(root,entry[0]));res.writeHead(200,{'Content-Type':entry[1]+(entry[1].startsWith('audio/')?'':'; charset=utf-8'),'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' blob: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer',...websiteDemoHeaders(helpFile)});res.end(req.method==='HEAD'?undefined:content);
 }catch(error){json(res,error.status||500,{error:error.message,...(typeof error.code==='string'?{code:error.code}:{})});}
});
const terminals=new Terminals(server,plane,()=>port,auth);
let deliveryPending=null;const delivery=setInterval(()=>{if(deliveryPending)return;deliveryPending=(async()=>{await plane.resumePendingStarts();await plane.approvals.drain();await plane.work.flush();await plane.collaboration.deliver();})().catch(()=>{}).finally(()=>{deliveryPending=null;});},1500);delivery.unref();
const capture=()=>plane.historyCollector.collect().catch(error=>console.error('History capture failed:',error.message));
const historyTimer=setInterval(capture,30000);historyTimer.unref();
let eventRelays;
server.listen(port,'127.0.0.1',async()=>{
 port=server.address().port;plane.baseUrl=`http://127.0.0.1:${port}`;
 try{
  await refreshLocalAddress(plane.root,plane.baseUrl);
  if(process.env.HELOSCRUM_DESKTOP_CHILD==='1'&&process.env.HELOSCRUM_DESKTOP_ENGINE==='1'){
   desktopEngineStart=plane.herdr.startServer().then(result=>{desktopOwnsEngine=result.started;});
   await desktopEngineStart;
   console.log(desktopOwnsEngine?'Desktop started the Herdr agent engine.':'Desktop connected to the existing Herdr agent engine.');
  }
  if(closing)return;
  startEventRelays(plane).then(value=>{eventRelays=value;if(closing)value.close();}).catch(()=>console.error('Cloud inbox relay startup failed.'));
  console.log(`HeloScrum: ${plane.baseUrl}`);
  if(process.env.HELOSCRUM_DESKTOP_CHILD==='1'&&process.connected)process.send({type:'heloscrum:ready',url:plane.baseUrl,root:plane.root});
  plane.scheduler.start();capture();
 }catch(error){console.error(error);process.exitCode=1;await close();if(process.connected)process.disconnect();}
});
server.on('error',async error=>{console.error(error);process.exitCode=1;await close();if(process.connected)process.disconnect();});
let closing=false;
async function close(){if(closing)return;closing=true;eventRelays?.close();clearInterval(delivery);clearInterval(historyTimer);await plane.scheduler.stop();await apiV1.close();await plane.managed.close();terminals.close();await plane.mcp.close();await new Promise(resolve=>server.close(resolve));await deliveryPending;await plane.historyCollector.pending?.catch(()=>{});await plane.saveQueue.catch(()=>{});plane.transcripts.close();await plane.history.close();
 await desktopEngineStart?.catch(()=>{});
 if(desktopOwnsEngine)try{if(!(await plane.herdr.list()).length)await plane.herdr.command(['server','stop']);else console.log('Native agent sessions remain in Herdr; its engine was left running.');}catch(error){console.error('Herdr cleanup:',error.message);}
}
process.once('SIGINT',()=>close().catch(console.error));process.once('SIGTERM',()=>close().catch(console.error));
// This channel exists only in the child started by the desktop supervisor.
// An orphaned desktop server must release its database and listening socket.
if(process.env.HELOSCRUM_DESKTOP_CHILD==='1'&&process.send){
 const finish=()=>close().then(()=>{if(process.connected)process.disconnect();}).catch(error=>{console.error(error);process.exitCode=1;if(process.connected)process.disconnect();});
 process.on('message',message=>{
  if(message?.type==='heloscrum:shutdown')void finish();
  if(message?.type==='heloscrum:activity'&&process.connected)process.send({type:'heloscrum:activity',id:message.id,state:{tasks:plane.data.tasks.map(({pane,phase})=>({pane,phase}))}});
 });
 process.once('disconnect',()=>void finish());
 if(!process.connected)void finish();
}
