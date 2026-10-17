import {createHash} from 'node:crypto';
import {assert} from './adapters.mjs';
import {hostedProvider,providerName} from './providers.mjs';
import {agentRequest} from './agent-requests.mjs';
import {sessionKey} from './session-identity.mjs';

const item=(name,description,{args='',usesModel=false,note=''}={})=>({name,description,args,usesModel,note});
export const COMMAND_SOURCES={
  codex:'https://learn.chatgpt.com/docs/developer-commands#built-in-slash-commands',
  claude:'https://code.claude.com/docs/en/commands',
  kiro:'https://kiro.dev/docs/reference/slash-commands/',
  cursor:'https://cursor.com/docs/cli/reference/slash-commands',
};
const catalogs={
  codex:[
    item('/status','Session, model and usage'),item('/diff','Inspect workspace changes'),item('/mcp','Inspect MCP connections'),
    item('/goal','View or manage a persistent objective',{args:'Objective, pause, resume, or clear',usesModel:true,note:'Requires Goals support in this CLI and its configuration. An active goal can continue work across turns.'}),
    item('/plan','Enter planning mode',{args:'Optional planning request',usesModel:true}),item('/compact','Compact this native session',{usesModel:true}),
    item('/review','Open a code review',{usesModel:true}),item('/model','Choose model and effort'),item('/skills','Browse native skills'),
    item('/plugins','Browse plugins'),item('/hooks','Inspect lifecycle hooks'),item('/permissions','Manage native permissions'),item('/memories','Manage native memory'),
  ],
  claude:[
    item('/help','Show native command help'),item('/status','Session and connection status'),item('/context','Inspect context use'),
    item('/cost','Inspect session usage'),item('/usage','Inspect account usage'),item('/mcp','Manage MCP connections'),
    item('/compact','Compact this native session',{args:'Optional summary instructions',usesModel:true}),item('/plan','Enter planning mode'),
    item('/model','Choose the native model'),item('/memory','Manage project instructions and native memory'),item('/permissions','Manage native permissions'),
    item('/agents','Manage native agent definitions'),item('/plugin','Manage plugins'),
  ],
  kiro:[
    item('/help','Show native command help'),item('/context','Inspect context use'),item('/usage','Inspect usage and credits'),
    item('/mcp','Inspect MCP servers'),item('/tools','Inspect tool permissions'),item('/model','Choose model and reasoning'),item('/plan','Enter planning mode'),
    item('/compact','Compact this native session',{usesModel:true}),item('/knowledge','Manage native knowledge'),item('/prompts','Browse reusable prompts'),
  ],
  cursor:[
    item('/help','Show native command help'),item('/about','Show CLI and session information'),item('/mcp','Inspect MCP connections'),
    item('/goal','Set a persistent objective',{args:'Optional objective',usesModel:true,note:'Provider rollout dependent. An active goal can continue work across turns.'}),
    item('/plan','Enter planning mode',{args:'Optional planning request',usesModel:true}),item('/ask','Toggle read-only question mode'),
    item('/debug','Enter debugging mode',{args:'Optional debugging request',usesModel:true}),item('/summarize','Compact this native session',{usesModel:true}),
    item('/model','Choose the native model'),item('/plugin','Manage plugins'),item('/config','Manage CLI settings'),item('/sandbox','Manage native sandbox settings'),
    item('/show-thinking','Toggle thinking display'),
  ],
};
export function commandCatalog(task){
  const commands=(catalogs[task.kind]||[]).map(command=>({...command}));
  if(task.kind==='kiro'&&task.nativeSetup?.kiroEngine!=='v3'){
    const help=commands.find(c=>c.name==='/help');help.name='/help --legacy';help.note='Classic help avoids invoking the Kiro Help Agent.';
  }
  return {provider:task.kind,providerLabel:providerName(task.kind),taskId:task.id,role:task.role||task.title,commands,source:COMMAND_SOURCES[task.kind]||null,reviewed:'2026-10-07',
    supported:commands.length>0&&!hostedProvider(task),
    note:'Commands belong to the installed provider CLI. Availability depends on its version and enabled features. Native menus remain interactive; their selections may change settings or start work.'};
}
export function nativeCommandText(task,name,args=''){
  const command=commandCatalog(task).commands.find(c=>c.name===name);assert(command,'Choose a command from this provider’s library');
  assert(typeof args==='string'&&args.length<=4000&&!/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(args),'Use one line of command arguments without control characters');
  assert(command.args||!args.trim(),'This command opens a native panel; use its controls there');
  return command.name+(args.trim()?' '+args.trim():'');
}
export function commandPromptReady(task,output){
  const tail=String(output||'').replace(/\r/g,'').split('\n').filter(l=>l.trim()).slice(-10);
  const mark=task.kind==='cursor'?'→':task.kind==='claude'?'❯':'›';
  const last=tail.findLast(l=>l.trim().startsWith(mark));
  if(task.kind==='codex')return /^\s*›\s*Ask Codex to do anything\s*$/.test(last||'');
  if(task.kind==='claude')return /^\s*❯\s*(?:Try "edit <filepath> to\.\.\.")?\s*$/.test(last||'');
  if(task.kind==='cursor')return /^\s*→\s*(?:Plan, search, build anything|Add a follow-up(?: — \/plan to review and build)?)\s*$/.test(last||'');
  if(task.kind==='kiro')return /^\s*›\s*ask a question or describe a task(?: ↵)?\s*$/.test(last||'')||task.nativeSetup?.kiroEngine!=='v3'&&/^\s*>\s*$/.test(tail.findLast(l=>l.trim().startsWith('>'))||'');
  return false;
}
const identity=task=>createHash('sha256').update(JSON.stringify([task.id,task.kind,task.pane,sessionKey(task)])).digest('hex');
export class NativeCommands {
  constructor(plane){this.plane=plane;this.requests=new Map();}
  task(id){return this.plane.task(id);}
  async inspect(id){
    const task=this.task(id),catalog=commandCatalog(task);let ready=false,reason;
    if(!catalog.supported)reason='This launch mode has no interactive native command session.';
    else if(task.phase!=='launched'||!task.pane)reason='Finish provider setup before running a command.';
    else{
      const live=(await this.plane.herdr.list()).find(a=>a.pane_id===task.pane);
      if(!live?.interactive_ready||!['idle','done'].includes(live.agent_status))reason='Wait for the agent to finish and close any native dialog.';
      else{const output=await this.plane.herdr.read(task.pane);const request=agentRequest(output);ready=commandPromptReady(task,output)&&!request.currentTrustMenu&&!request.currentSetupMenu;if(!ready)reason='Close the native dialog or finish the terminal draft before running a command.';}
    }
    return {...catalog,ready,reason:reason||null,expected:identity(task)};
  }
  async run(id,{name,args='',expected,requestId}={}){
    const plane=this.plane,task=this.task(id),text=nativeCommandText(task,name,args);
    assert(typeof requestId==='string'&&/^[\w-]{8,100}$/.test(requestId),'Provide a command request ID');
    const key=task.id+':'+requestId,signature=JSON.stringify([expected,text]),previous=this.requests.get(key);
    if(previous){assert(previous.signature===signature,'This request ID was used for a different command',409);assert(previous.result,'Command delivery is unconfirmed. Check the native terminal before trying again.',409);return previous.result;}
    const deliver=async()=>{
      assert(!plane.collaboration.delivering.has(id)&&!plane.promptingTasks?.has(id)&&!plane.respondingTasks?.has(id),'Another input is being sent to this agent',409);
      plane.collaboration.delivering.add(id);
      try{
        const current=await this.inspect(id);
        assert(current.supported,current.reason,409);assert(current.ready,current.reason,409);
        assert(expected===current.expected,'The provider session changed. Refresh the command library.',409);
        assert(task===this.task(id)&&identity(task)===expected&&task.phase==='launched','The session changed before delivery',409);
        assert(!this.requests.has(key),'This command is already being sent',409);
        const receipt={signature,result:null};this.requests.set(key,receipt);if(this.requests.size>200)this.requests.delete(this.requests.keys().next().value);
        try{await plane.herdr.prompt(task.pane,text);}catch{throw Object.assign(new Error('Command delivery is unconfirmed. Check the native terminal before trying again.'),{status:502});}
        receipt.result={ok:true,delivery:'sent',command:name,taskId:id};
        await plane.record('Native command sent',(task.role||task.title)+' · '+name,task.project);
        return receipt.result;
      }finally{plane.collaboration.delivering.delete(id);}
    };
    return plane.work?plane.work.serial(deliver):deliver();
  }
}
