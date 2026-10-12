import { execFile, spawn } from 'node:child_process';
import { access, realpath, lstat, readFile, mkdir, open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import os from 'node:os';
import { providerIds, providerBinary } from './providers.mjs';
import { parsePatch, selectHunk } from './patch.mjs';
import { agentRequest,nativePromptReady } from './agent-requests.mjs';
const exec = promisify(execFile);
export const idFor = value => createHash('sha256').update(value).digest('hex').slice(0,24);
export function assert(condition, message, status=400) { if (!condition) throw Object.assign(new Error(message), {status}); }
export function string(value, name, max=500) { assert(typeof value==='string' && value.trim() && value.length<=max && !value.includes('\0'), `Invalid ${name}`); return value.trim(); }
export const inside = (base, target) => { const rel=path.relative(base,target);return rel==='' || (!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)); };
export async function binary(name, root) {
  const override=process.env[`HELOSCRUM_${name.toUpperCase()}_BIN`];
  name=providerBinary(name);
  for (const candidate of [override,path.join(root,'.heloscrum/bin',name),...(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,name)),...(name==='cursor-agent'?[path.join(os.homedir(),'.local/bin/cursor-agent')]:[])].filter(Boolean)) {
    try { await access(candidate,constants.X_OK);return candidate; } catch {}
  }
  return null;
}
export async function run(executable,args,options={}) {
  assert(executable,'Required executable is not installed',503);
  try { const result=await exec(executable,args,{timeout:options.timeout||15000,maxBuffer:4*1024*1024,...options,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',GIT_OPTIONAL_LOCKS:'0',GIT_LITERAL_PATHSPECS:'1',...options.env}});return result.stdout; }
  catch(error){ throw Object.assign(new Error((error.stderr||error.stdout||error.message).toString().slice(0,2000)),{status:502,code:error.code,stdout:error.stdout,stderr:error.stderr}); }
}
// Herdr reports protocol errors as JSON even when its CLI exits nonzero.
export function herdrError(error){
  for(const raw of [error.stdout,error.stderr,error.message]){
    try{const detail=JSON.parse(String(raw)).error;if(typeof detail?.code==='string'&&typeof detail.message==='string')return Object.assign(new Error(detail.message),{status:502,code:detail.code});}catch{}
  }
  return error;
}
export function parseStatus(output) {
  const records=output.split('\0'),files=[];
  for(let i=0;i<records.length;i++) {const r=records[i];if(!r)continue;const status=r.slice(0,2),file=r.slice(3);const rename=/[RC]/.test(status);files.push({path:file,status,original:rename?records[++i]:null,staged:status[0]!==' '&&status[0]!=='?',unstaged:status[1]!==' ',untracked:status==='??',conflict:['DD','AU','UD','UA','DU','AA','UU'].includes(status)});}
  return files;
}
export class GitAdapter {
  constructor(root){this.root=root;}
  async command(cwd,args,options={}){return run('git',['--no-pager','-c','core.fsmonitor=false','-c','diff.external=','-c','core.hooksPath=/dev/null',...args],{...options,cwd});}
  async repository(candidate){const resolved=await realpath(string(candidate,'repository path',4096));const top=(await this.command(resolved,['rev-parse','--show-toplevel'],{env:{LC_ALL:'C'}})).trim();return realpath(top);}
  async worktrees(repo){const result=await this.command(repo,['worktree','list','--porcelain','-z']);return (await Promise.all(result.split('\0\0').filter(Boolean).map(async block=>{const fields=block.split('\0');const raw=fields.find(x=>x.startsWith('worktree '))?.slice(9);if(!raw)return null;const pathname=await realpath(raw).catch(()=>path.resolve(raw));return {id:idFor(pathname),path:pathname,branch:fields.find(x=>x.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//,'')||'(detached)',head:fields.find(x=>x.startsWith('HEAD '))?.slice(5)||'',locked:fields.some(x=>x.startsWith('locked')),bare:fields.includes('bare')};}))).filter(w=>w&&!w.bare);}
  async resolve(repo,id){const w=(await this.worktrees(repo)).find(w=>w.id===id);assert(w,'Worktree is not part of this repository',404);return w;}
  async status(cwd){return parseStatus(await this.command(cwd,['status','--porcelain=v1','-z','--untracked-files=all']));}
  async files(repo,id){const w=await this.resolve(repo,id);return {worktree:w,files:await this.status(w.path)};}
  async commitPreview(repo,id){const w=await this.resolve(repo,id),files=await this.status(w.path);assert(files.some(f=>f.staged),'Stage at least one file first',409);assert(!files.some(f=>f.conflict),'Resolve conflicts before committing',409);const tree=(await this.command(w.path,['write-tree'])).trim();return {worktree:w,files:files.filter(f=>f.staged),tree,head:w.head};}
  async commit(repo,id,message,expected){string(message,'commit message',500);assert(expected&&typeof expected.tree==='string'&&typeof expected.head==='string','Review staged changes before committing');const preview=await this.commitPreview(repo,id);assert(preview.tree===expected.tree&&preview.head===expected.head,'Staged changes moved since review. Review again.',409);await this.command(preview.worktree.path,['commit','-m',message]);return {head:(await this.command(preview.worktree.path,['rev-parse','HEAD'])).trim()};}
  async mergePreview(repo,id){repo=await realpath(repo);const source=await this.resolve(repo,id),target=(await this.worktrees(repo)).find(w=>w.path===repo);assert(target&&target.id!==source.id,'Choose an agent worktree to merge',409);assert(source.branch!=='(detached)','Source worktree has no branch');assert(!(await this.status(source.path)).length,'Commit or resolve changes in the task worktree first',409);assert(!(await this.status(repo)).length,'The destination worktree must be clean',409);await this.command(repo,['merge-base','--is-ancestor',target.head,source.head]);assert(source.head!==target.head,'No new commits to merge',409);return {source,target};}
  async merge(repo,id,expected){const preview=await this.mergePreview(repo,id);assert(preview.source.head===expected?.sourceHead&&preview.target.head===expected?.targetHead,'A branch changed since review. Review again.',409);await this.command(repo,['merge','--ff-only','--',preview.source.head]);return preview;}
  async file(repo,id,filename,staged=false){
    const w=await this.resolve(repo,id),file=(await this.status(w.path)).find(f=>f.path===filename);
    assert(file,'File is no longer changed. Refresh the review.',409);
    if(file.untracked){
      const full=path.resolve(w.path,file.path);assert(inside(w.path,full),'File path is outside worktree');
      const stat=await lstat(full);assert(stat.isFile()&&!stat.isSymbolicLink(),'Preview unavailable for this file type');
      assert(inside(await realpath(w.path),await realpath(full)),'File resolves outside worktree');
      assert(stat.size<=512*1024,'File too large to preview; preview is limited to 512 KiB');
      const bytes=await readFile(full);return {file,binary:bytes.includes(0),diff:bytes.includes(0)?'Binary file':bytes.toString('utf8').split('\n').map(l=>'+'+l).join('\n')};
    }
    const diff=await this.command(w.path,['diff','--no-ext-diff','--no-textconv','--no-color',...(staged?['--cached']:[]),'--',file.path,...(file.original?[file.original]:[])]);
    return {file,diff,patch:parsePatch(diff)};
  }
  async stageHunk(repo,id,filename,hunkId,expected,unstage=false){
    assert(Number.isInteger(hunkId)&&typeof expected==='string','Choose a reviewed section');
    const w=await this.resolve(repo,id),preview=await this.file(repo,id,filename,unstage);
    assert(!preview.file.conflict&&preview.patch?.partial,'This change requires whole-file staging',409);
    assert(preview.patch.fingerprint===expected,'The file changed since review. Refresh before staging.',409);
    const patch=selectHunk(preview.patch,hunkId),dir=await mkdtemp(path.join(os.tmpdir(),'heloscrum-hunk-'));
    try {
      const file=path.join(dir,'change.patch');await writeFile(file,patch,{mode:0o600});
      const args=['apply','--cached',...(unstage?['--reverse']:[])];
      await this.command(w.path,[...args,'--check',file]);
      await this.command(w.path,[...args,file]);
    } finally {await rm(dir,{recursive:true,force:true});}
    return this.files(repo,id);
  }
  async stage(repo,id,filename,unstage=false){const w=await this.resolve(repo,id);const changed=await this.status(w.path);const selected=changed.find(f=>f.path===filename);assert(selected,'File is no longer changed',409);assert(!selected.conflict,'Resolve this conflict before staging',409);const names=[selected.path,...(selected.original?[selected.original]:[])];
    if(unstage){let born=true;try{await this.command(w.path,['rev-parse','--verify','HEAD']);}catch{born=false;}await this.command(w.path,born?['reset','-q','HEAD','--',...names]:['rm','--cached','--',...names]);}
    else await this.command(w.path,['add','--',...names]);
    return this.files(repo,id);
  }
  async create(repo,branch){string(branch,'branch',80);assert(!branch.startsWith('-')&&!branch.includes('..'),'Invalid branch');await this.command(repo,['check-ref-format','--branch',branch]);
    await this.command(repo,['rev-parse','--verify','HEAD']);
    const target=path.join(this.root,'.heloscrum/worktrees',idFor(repo),idFor(branch));await mkdir(path.dirname(target),{recursive:true});
    await this.command(repo,['worktree','add','-b',branch,'--',target,'HEAD']);const canonical=await realpath(target);return {id:idFor(canonical),path:canonical,branch};
  }
}
function jsonLines(s){return s.trim()?s.trim().split('\n').map(line=>JSON.parse(line)):[];}
export class DockerAdapter {
  constructor(executable){this.executable=executable;}
  command(args,options){return run(this.executable,args,options);}
  async list(){
    const rows=jsonLines(await this.command(['ps','-a','--no-trunc','--format','{{json .}}']));
    const running=rows.filter(c=>c.State==='running');let stats=[],statsError=null;
    if(running.length)try{stats=jsonLines(await this.command(['stats','--no-stream','--format','{{json .}}',...running.map(c=>c.ID)],{timeout:12000}));}catch(e){statsError=e.message;}
    return {containers:rows.map(c=>{const stat=stats.find(s=>s.ID===c.ID||c.ID.startsWith(s.ID));const labels=Object.fromEntries((c.Labels||'').split(',').filter(Boolean).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1)];}));return {id:c.ID,name:c.Names,image:c.Image,status:c.State,description:c.Status,ports:c.Ports,cpu:stat?.CPUPerc||null,memory:stat?.MemUsage||null,project:labels['com.docker.compose.project']||null,workingDir:labels['com.docker.compose.project.working_dir']||null,taskId:labels['dev.heloscrum.task']||null};}),statsError};
  }
  async validate(id){assert(typeof id==='string'&&/^[a-f0-9]{12,64}$/.test(id),'Invalid container');const list=jsonLines(await this.command(['ps','-a','--no-trunc','--format','{{json .}}']));assert(list.some(c=>c.ID===id),'Container is no longer available',404);}
  async logs(id){await this.validate(id);try {const {stdout,stderr}=await exec(this.executable,['logs','--tail','200','--timestamps',id],{timeout:10000,maxBuffer:2*1024*1024});return stdout+stderr;}catch(e){throw Object.assign(new Error(e.message),{status:502});}}
  async action(id,action){assert(['start','stop','restart'].includes(action),'Unsupported container action');await this.validate(id);await this.command([action,id],{timeout:45000});}
}
export class HerdrAdapter {
  constructor(executable,root){this.executable=executable;this.root=root;this.config=path.join(root,'.heloscrum/herdr/config.toml');this.session='heloscrum';this.env={...process.env,TERM:'xterm-256color',COLORTERM:'truecolor',FORCE_COLOR:'3',HERDR_CONFIG_PATH:this.config};delete this.env.NO_COLOR;delete this.env.HERDR_SOCKET;delete this.env.HERDR_SOCKET_PATH;}
  async command(args,timeout=15000){return run(this.executable,['--session',this.session,...args],{cwd:this.root,env:this.env,timeout});}
  async json(args,timeout){let raw;try{raw=await this.command(args,timeout);}catch(error){throw herdrError(error);}if(!raw.trim())return {ok:true};const result=JSON.parse(raw);if(result.error)throw Object.assign(new Error(result.error.message),{status:502,code:result.error.code});assert(result.result,'Unexpected Herdr response',502);return result.result;}
  async list(){
    const r=await this.json(['agent','list']);assert(Array.isArray(r.agents),'Unsupported Herdr agent-list response',502);
    // Some Herdr versions omit interactive_ready. Require positive screen
    // evidence rather than treating an idle terminal title as readiness.
    this.readiness ||= new Map();
    for(const pane of this.readiness.keys())if(!r.agents.some(a=>a.pane_id===pane))this.readiness.delete(pane);
    return Promise.all(r.agents.map(async agent=>{
      if(['kiro','cursor'].includes(agent.agent)&&['idle','done'].includes(agent.agent_status)){
        try{
          const output=await this.read(agent.pane_id),request=agentRequest(output);
          if(agent.agent==='cursor'&&!request.currentSetupMenu&&!request.currentTrustMenu&&!nativePromptReady('cursor',output))return {...agent,interactive_ready:false};
          if(request.currentTrustMenu||request.currentSetupMenu)return {...agent,agent_status:'blocked',interactive_ready:false};
        }catch{return {...agent,interactive_ready:false};}
      }
      if(typeof agent.interactive_ready==='boolean'||!['idle','done'].includes(agent.agent_status))return agent;
      const key=JSON.stringify([agent.agent,agent.revision,agent.state_change_seq]),cached=this.readiness.get(agent.pane_id);
      if(cached?.key===key&&Date.now()-cached.at<1000)return {...agent,interactive_ready:cached.ready};
      let ready=false;
      try{const detail=JSON.parse(await this.command(['agent','explain',agent.pane_id,'--json']));ready=detail.agent===agent.agent&&detail.visible_idle===true&&detail.visible_blocker===false&&detail.visible_working===false&&detail.skip_state_update!==true&&['idle','done'].includes(detail.state);}catch{}
      this.readiness.set(agent.pane_id,{key,at:Date.now(),ready});return {...agent,interactive_ready:ready};
    }));
  }
  async startServer(){assert(this.executable,'Herdr is not installed',503);try{await this.list();return {started:false};}catch{}
    await mkdir(path.dirname(this.config),{recursive:true});
    const log=await open(path.join(this.root,'.heloscrum/herdr-supervisor.log'),'a',0o600);
    const child=spawn(this.executable,['--session',this.session,'server'],{cwd:this.root,env:this.env,detached:true,stdio:['ignore',log.fd,log.fd]});child.on('error',()=>{});child.unref();await log.close();
    for(let attempt=0;attempt<30;attempt++){await new Promise(r=>setTimeout(r,150));try{await this.list();return {started:true};}catch{}}
    throw Object.assign(new Error('Herdr did not become ready. Check .heloscrum/herdr-supervisor.log.'),{status:503});
  }
  async createWorkspace(cwd,label){
    // Kiro's shell init checks this flag before replacing zsh with kiro-cli-term.
    // Keep Herdr's managed PTY as the owner; leave the user's shell config intact.
    // Explicit color flags also override an already-running supervisor launched
    // under a noninteractive parent (for example TERM=dumb / NO_COLOR=1).
    const result=await this.json(['workspace','create','--cwd',cwd,'--label',label,'--env','PROCESS_LAUNCHED_BY_Q=1','--env','TERM=xterm-256color','--env','COLORTERM=truecolor','--env','FORCE_COLOR=3','--env','NO_COLOR=','--no-focus']);assert(result.root_pane?.pane_id,'Herdr did not return a pane',502);return result;
  }
  waitForShell(){return new Promise(resolve=>setTimeout(resolve,250));}
  async startAgent(name,kind,pane,args=[]){
    assert(providerIds.includes(kind),'Unsupported agent');
    for(let attempt=0;attempt<20;attempt++){
      try{
        const result=await this.json(['agent','start',name,'--kind',kind,'--pane',pane,'--timeout','30000','--',...args],40000);
        if(kind==='cursor'||kind==='kiro'&&args.includes('--v3')){
          let ready=false;
          for(let check=0;check<20;check++){
            const output=await this.read(pane),request=agentRequest(output);
            if(request.currentSetupMenu||request.currentTrustMenu)break;
            if(nativePromptReady(kind,output)){ready=true;break;}
            await this.waitForShell();
          }
          if(!ready)throw Object.assign(new Error('Complete native provider setup before sending the task'),{code:'agent_not_ready',status:409});
        }
        return result;
      }
      catch(error){if(error.code!=='agent_pane_busy'||attempt===19)throw error;await this.waitForShell();}
    }
  }
  async wrappedShell(pane,cwd){
    const {process_info:info}=await this.json(['pane','process-info','--pane',pane]);
    const processes=info?.foreground_processes||[],shell=processes[0];
    return processes.length===1&&info.foreground_process_group_id===info.shell_pid&&shell.pid===info.shell_pid&&/^(?:-?zsh|bash) \(kiro-cli-term\)$/.test(shell.cmdline||'')&&shell.cwd===cwd;
  }
  async read(pane){return this.command(['pane','read',pane,'--source','recent-unwrapped','--lines','150']);}
  async prompt(pane,prompt){return this.json(['agent','prompt',pane,prompt]);}
  async interrupt(pane){return this.json(['agent','send-keys',pane,'ctrl+c']);}
  async exitAgent(pane){
    const live=(await this.list()).find(a=>a.pane_id===pane);
    assert(live&&live.interactive_ready&&['idle','done'].includes(live.agent_status),'Wait for the agent to finish or interrupt it before switching',409);
    await this.prompt(pane,'/exit');
    for(let attempt=0;attempt<40;attempt++){
      if(!(await this.list()).some(a=>a.pane_id===pane))return;
      await this.waitForShell();
    }
    throw Object.assign(new Error('The old session has not exited. Resolve its request before trying again; no replacement was started.'),{status:409});
  }
  async terminal(pane){const r=await this.json(['pane','get',pane]);assert(r.pane?.terminal_id,'Agent terminal is unavailable',404);return r.pane.terminal_id;}
  async key(pane,key){assert(['up','down','enter','escape','a','c','w','q','y','n','p','tab'].includes(key),'Unsupported response key');return this.json(['agent','send-keys',pane,key]);}
}
