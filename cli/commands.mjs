import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CliError} from './client.mjs';

const booleans=new Set(['json','help','version','no-wait','follow','no-motion','plain','operator','passed','failed','unstage','no-reply','staged']);
export function parseArgs(argv){const words=[],options={};for(let i=0;i<argv.length;i++){
  const value=argv[i];if(!value.startsWith('--')){words.push(value);continue;}
  const [key,...suffix]=value.slice(2).split('=');const next=suffix.length?suffix.join('='):booleans.has(key)?true:argv[++i];
  if(next===undefined||typeof next==='string'&&next.startsWith('--'))throw new CliError('Missing value for --'+key);
  if(['attach','reference','link','participant','scope'].includes(key))(options[key]||=[]).push(next);else options[key]=next;
}return {words,options};}
export const help=`HeloScrum — connected agents, shared momentum

  heloscrum doctor [--provider codex|claude|kiro|cursor|ollama|llamacpp|lmstudio|bedrock|sagemaker] [--json]
  heloscrum serve [--root DIRECTORY] [--port 4173]
  heloscrum tui [--project PROJECT] [--no-motion] [--plain]
  heloscrum projects list | open --path REPOSITORY
  heloscrum agents list | create --file agent.json
  heloscrum agents transcript|request|interrupt|resume|archive|restore ID
  heloscrum agents message ID --text "Direction for this agent"
  heloscrum agents decision ID --choice ID --expected FINGERPRINT
  heloscrum plans list | get ID | create --file plan.json
  heloscrum plans start ID --revision N
  heloscrum plans schedule|delivery ID --revision N --file input.json
  heloscrum plans export ID [--format md] [--out FILE]
  heloscrum plans archive|restore|complete ID --revision N
  heloscrum tasks list [--plan ID]
  heloscrum tasks create --brief task.md [--participant ID] [--strategy team]
  heloscrum tasks create --plan ID --title TITLE --revision N
  heloscrum tasks update ID --plan ID --revision N --status needs_review --note EVIDENCE
  heloscrum tasks verify ID --plan ID --revision N --passed --evidence TEXT
  heloscrum proposals approve|reject ID --plan ID --revision N [--reason TEXT]
  heloscrum conversations list|get ID|create --file group.json
  heloscrum messages send --to AGENT --text TEXT
  heloscrum messages send --thread GROUP --text TEXT
  heloscrum calendar | tools list | tools invoke --name TOOL --file input.json
  heloscrum changes list|diff|review|stage|commit-preview|commit --worktree ID
  heloscrum events --follow [--after CURSOR] [--format ndjson]
  heloscrum operations get ID | list [--request-id KEY]
  heloscrum auth status
  heloscrum tokens list|revoke ID
  heloscrum tokens create --name NAME --agent ID --scope work:read --out credential.json

Every project command requires --project <ID, unique name, or absolute path>.
--credential FILE selects a scoped identity; the default is the local owner's private file.
--json produces JSON only. --file - reads JSON from stdin. Mutations wait for completion
unless --no-wait is set. --request-id KEY permits safe retries of the same operation.
Create briefs with --instructions, --brief FILE, --file JSON, --attach FILE,
--reference REPO_PATH, --link URL, --participant ID (repeatable), --strategy
assigned|orchestrator|team, and --change-policy review|autonomous. Creation saves a
draft; plans start explicitly dispatches it. Operator grants require --operator.
Use api schema for OpenAPI or api request --method METHOD --route /projects/... --file JSON.
`;
const comma=values=>(Array.isArray(values)?values:[values]).filter(Boolean).flatMap(v=>String(v).split(',')).filter(Boolean);
async function stdinText(){let result='';for await(const part of process.stdin){result+=part;if(result.length>512*1024)throw new CliError('JSON input exceeds 512 KiB');}return result;}
export async function inputFile(file){if(!file)return {};const raw=file==='-'?await stdinText():await readFile(path.resolve(file),'utf8');try{const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw new CliError('Expected a JSON object in '+file);}}
export async function createBrief(client,base,o,kind='plan'){
  const input=await inputFile(o.file);input.kind=kind;
  if(o.title)input.title=o.title;
  if(o.instructions)input.instructions=o.instructions;
  if(o.brief)input.instructions=await readFile(path.resolve(o.brief),'utf8');
  if(o.participant)input.participantIds=comma(o.participant);
  if(o.strategy)input.strategy=o.strategy;
  if(o['change-policy'])input.changePolicy=o['change-policy'];
  if(o.orchestrator)input.orchestratorId=o.orchestrator;
  if(o.method&&o.method!=='from-file')input.management=o.method==='flexible'?null:{...input.management,method:o.method};
  if(input.management===undefined)input.management={method:'scrum'};
  input.strategy||='team';input.changePolicy||='review';
  if(o.link)input.links=[...(input.links||[]),...o.link];
  input.resourceIds||=[];
  let index=0;
  for(const file of o.attach||[]){if((await stat(file)).size>20*1024*1024)throw new CliError('Attachments may be at most 20 MiB');const data=(await readFile(file)).toString('base64');const resource=await client.mutate(base+'/resources',{name:path.basename(file),data},{key:o['request-id']?createHash('sha256').update(o['request-id']+':attachment:'+(index++)).digest('hex'):undefined});input.resourceIds.push(resource.id);}
  for(const file of o.reference||[]){const resource=await client.mutate(base+'/resources/reference',{path:file},{key:o['request-id']?createHash('sha256').update(o['request-id']+':reference:'+(index++)).digest('hex'):undefined});input.resourceIds.push(resource.id);}
  return client.mutate(base+'/plans',input,{key:o['request-id'],noWait:o['no-wait']});
}
export async function command(client,words,o){
  const [area,action,id]=words,encoded=value=>encodeURIComponent(value||''),write=(route,input={},method='POST')=>client.mutate(route,input,{method,key:o['request-id'],noWait:o['no-wait']});
  if(area==='auth'&&action==='status')return client.request('/me');
  if(area==='api'&&action==='schema')return client.request('/openapi.json');
  if(area==='api'&&action==='request'){if(!o.route?.startsWith('/')||o.route.includes('://'))throw new CliError('Use an API-relative --route');const method=o.method||'GET';return method==='GET'?client.request(o.route):write(o.route,await inputFile(o.file),method);}
  if(area==='projects'){
    if(action==='list')return client.list('/projects');
    if(action==='open'){if(!o.path)throw new CliError('Choose --path');return write('/projects',{path:path.resolve(o.path)});}
  }
  if(area==='operations'&&action==='get')return client.request('/operations/'+encoded(id));
  if(area==='operations'&&action==='list')return client.list('/operations'+(o['request-id']?'?requestId='+encoded(o['request-id']):''));
  if(area==='tokens'){
    if(action==='list')return client.request('/tokens');
    if(action==='revoke')return client.request('/tokens/'+encoded(id),{method:'DELETE',body:{}});
    if(action==='create'){
      if(!o.out||!o.name||!o.agent&&!o.operator)throw new CliError('Use --name, --out, and either --agent ID or --operator');
      try{await stat(o.out);throw new CliError('Credential output already exists; choose a new --out file');}catch(e){if(e.code!=='ENOENT')throw e;}
      const project=await client.project(o.project),credential=await client.request('/tokens',{method:'POST',body:{name:o.name,kind:o.agent?'agent':'operator',agentId:o.agent,projects:[project.id],scopes:comma(o.scope),expiresAt:o.expires}});
      await writeFile(o.out,JSON.stringify(credential,null,2)+'\n',{mode:0o600,flag:'wx'});
      const {token,...safe}=credential;return {...safe,credentialFile:path.resolve(o.out)};
    }
  }
  const project=await client.project(o.project),base='/projects/'+encoded(project.id);
  const revision=()=>{const n=Number(o.revision);if(!Number.isInteger(n)||n<1)throw new CliError('Supply --revision from plans get');return n;};
  if(area==='agents'){
    if(action==='list')return client.list(base+'/agents');
    if(action==='create')return write(base+'/agents',await inputFile(o.file));
    const route=base+'/agents/'+encoded(id);
    if(['transcript','request'].includes(action))return client.request(route+'/'+action);
    if(action==='message')return write(route+'/message',{text:o.text});
    if(action==='decision')return write(route+'/decision',{choice:o.choice,expected:o.expected});
    if(['interrupt','resume'].includes(action))return write(route+'/'+action);
    if(['archive','restore','trash'].includes(action))return write(route+'/state',{state:{archive:'archived',restore:'active',trash:'trash'}[action]});
  }
  if(area==='plans'){
    if(action==='list')return client.list(base+'/plans');
    if(action==='get')return client.request(base+'/plans/'+encoded(id));
    if(action==='create')return createBrief(client,base,o);
    if(['schedule','delivery'].includes(action))return write(base+'/plans/'+encoded(id)+'/'+action,{...await inputFile(o.file),expectedRevision:revision()});
    if(['start','submit'].includes(action))return write(base+'/plans/'+encoded(id)+'/start',{expectedRevision:revision()});
    if(['archive','restore','complete'].includes(action))return write(base+'/plans/'+encoded(id)+'/state',{expectedRevision:revision(),status:{archive:'archived',restore:'active',complete:'completed'}[action]});
    if(action==='export'){const result=await client.request(base+'/plans/'+encoded(id)+'/export?format='+encoded(o.format||'json'));if(o.out){await writeFile(o.out,result.format==='md'?result.text:JSON.stringify(result,null,2)+'\n',{flag:'wx'});return {file:path.resolve(o.out)};}return result;}
  }
  if(area==='tasks'){
    if(action==='create'&&!o.plan)return createBrief(client,base,o,'task');
    if(action==='list'){const plans=o.plan?{items:[await client.request(base+'/plans/'+encoded(o.plan))]}:await client.list(base+'/plans');const items=[];for(const plan of plans.items){const detail=plan.items?plan:await client.request(base+'/plans/'+encoded(plan.id));items.push(...detail.items.map(t=>({...t,planId:plan.id,revision:detail.revision})));}return {items};}
    if(!o.plan)throw new CliError('Choose --plan');
    const route=base+'/plans/'+encoded(o.plan)+'/tasks';
    const input={...await inputFile(o.file),expectedRevision:revision()};
    for(const field of ['title','description','status','note'])if(o[field]!==undefined)input[field]=o[field];
    if(o.owner)input.ownerId=o.owner;
    if(action==='create')return write(route,input);
    if(action==='update')return write(route+'/'+encoded(id),input,'PATCH');
    if(action==='verify'){if(!!o.passed===!!o.failed)throw new CliError('Choose --passed or --failed');return write(route+'/'+encoded(id)+'/verify',{expectedRevision:revision(),passed:!!o.passed,evidence:o.evidence});}
  }
  if(area==='proposals'&&['approve','reject'].includes(action))return write(base+'/plans/'+encoded(o.plan)+'/proposals/'+encoded(id)+'/review',{expectedRevision:revision(),decision:action,reason:o.reason});
  if(area==='calendar')return client.request(base+'/calendar');
  if(area==='conversations'){
    if(action==='list')return client.list(base+'/conversations');
    if(action==='get')return client.request(base+'/conversations/'+encoded(id));
    if(action==='create')return write(base+'/conversations',await inputFile(o.file));
  }
  if(area==='messages'&&action==='send')return write(base+'/messages',{to:o.to,threadId:o.thread,message:o.text,kind:o.kind||'request',...(o['no-reply']?{requiresReply:false}:{})});
  if(area==='tools'){if(action==='list')return client.request(base+'/tools');if(action==='invoke')return write(base+'/tools/invoke',{name:o.name,input:await inputFile(o.file)});}
  if(area==='changes'){
    if(action==='list')return client.request(base+'/worktrees');
    if(!o.worktree)throw new CliError('Choose --worktree');const route=base+'/worktrees/'+encoded(o.worktree);
    if(action==='diff')return client.request(route+'/diff?file='+encoded(o.file)+(o.staged?'&staged=true':''));
    if(action==='review')return write(route+'/review',{expected:o.expected});
    if(action==='stage')return write(route+'/stage',{file:o.file,unstage:!!o.unstage,expected:o.expected});
    if(action==='commit-preview')return client.request(route+'/commit-preview');
    if(action==='commit')return write(route+'/commit',{message:o.message,expected:{tree:o.tree,head:o.head}});
  }
  throw new CliError('Unknown command. Use heloscrum --help.');
}
