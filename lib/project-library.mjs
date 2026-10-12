import path from 'node:path';
import {lstat,realpath,mkdir,rmdir,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assert,string,run,binary} from './adapters.mjs';
import {agentColors,agentIcons,appearanceFor,agentIdentityRecords} from '../dist/agent-appearance.js';

export function remoteIdentity(value,hosting='auto'){
  if(!value||path.isAbsolute(value))return null;
  let url;try{url=new URL(value.includes('://')?value:value.replace(/^([^@\s]+@)?([^:\s]+):(.+)$/,'ssh://$1$2/$3'));}catch{return null;}
  if(!['https:','ssh:'].includes(url.protocol)||url.password||url.search||url.hash)return null;
  if(url.protocol==='https:'&&url.username)return null;
  const repository=url.pathname.replace(/^\/+|\/+$/g,'').replace(/\.git$/,'');
  if(!repository||repository.split('/').some(p=>!p||p==='.'||p==='..'))return null;
  const provider=hosting==='auto'?(url.hostname==='github.com'?'github':url.hostname==='gitlab.com'?'gitlab':'git'):hosting;
  const web=`https://${url.protocol==='https:'?url.host:url.hostname}/${repository.split('/').map(encodeURIComponent).join('/')}`;
  return {host:url.hostname,repository,provider,web,requestsUrl:provider==='github'?web+'/pulls':provider==='gitlab'?web+'/-/merge_requests':null};
}
export function validateRemote(value){
  const remote=string(value,'repository URL',2048);
  assert(!/[\s\x00-\x1f]/.test(remote),'Repository URLs must not contain whitespace');
  assert(path.isAbsolute(remote)||remoteIdentity(remote),'Use an HTTPS or SSH repository URL, or an absolute local repository path. Keep credentials in Git or your SSH agent.');
  return remote;
}
export class ProjectLibrary {
  constructor(plane){this.plane=plane;this.moving=new Set();this.cloning=new Set();}
  identities(){return agentIdentityRecords(this.plane.collaboration?.participants()||this.plane.data.tasks);}
  known(){const p=this.plane;return [...new Set([p.root,p.data.project,...(p.data.projects||[]).map(x=>x.path),...p.data.tasks.map(t=>t.project),...(p.data.events||[]).map(e=>e.project),...(p.collaboration?.chatProjects()||[]).map(x=>x.id)].filter(Boolean))];}
  project(candidate){assert(this.known().includes(candidate),'Open this project before managing it',404);return candidate;}
  remember(project){this.plane.data.projects||=[];let record=this.plane.data.projects.find(p=>p.path===project);if(!record){record={path:project};this.plane.data.projects.push(record);}return record;}
  async resolveLocal(candidate,{initialize=false}={}){
    const requested=string(candidate,'project folder',4096);
    assert(path.isAbsolute(requested),'Choose a folder or enter its full path.');
    let directory;
    try{directory=await realpath(requested);assert((await lstat(directory)).isDirectory(),'Choose a folder, not a file.');}
    catch(error){
      if(['ENOENT','ENOTDIR'].includes(error.code))throw Object.assign(Error('That folder could not be found. Choose an existing folder.'),{status:404});
      if(['EACCES','EPERM'].includes(error.code))throw Object.assign(Error('HeloScrum cannot access that folder. Check its permissions or choose another folder.'),{status:403});
      throw error;
    }
    try{return await this.plane.git.repository(directory);}
    catch(error){
      if(!/not a git repository/i.test(error.message))throw error;
      if(!initialize)throw Object.assign(Error("This folder isn't a Git repository yet. You can initialize Git here to use it with HeloScrum."),{status:422,code:'PROJECT_NEEDS_GIT'});
    }
    // Claim fresh metadata exclusively. Never reinitialize someone else's .git,
    // stage existing files, or create a remote while opening a local project.
    const metadata=path.join(directory,'.git');
    try{await mkdir(metadata,{mode:0o700});}
    catch(error){if(error.code==='EEXIST')throw Object.assign(Error('This folder already has Git metadata. Reopen it or repair its existing repository first.'),{status:409});throw error;}
    try{await this.plane.git.command(directory,['init','--initial-branch=main','--template=']);}
    catch(error){
      // Release only our empty claim so a corrected setup can be retried.
      // rmdir cannot remove a populated repository or any of the user's files.
      try{await rmdir(metadata);}catch{/* Retain any partial/nonempty Git metadata for repair. */}
      throw error;
    }
    await mkdir(path.join(metadata,'info'),{recursive:true});
    await appendFile(path.join(metadata,'info/exclude'),'\n.heloscrum/\n');
    await this.plane.git.command(directory,['-c','user.name=HeloScrum','-c','user.email=setup@localhost','-c','commit.gpgsign=false','commit','--allow-empty','--only','-m','Initialize local project']);
    return this.plane.git.repository(directory);
  }
  async directory(){
    const p=this.plane;let agents=[],engineError=null;try{agents=await p.herdr.list();}catch(e){engineError=e.message;}
    const projects=this.known().map(project=>{
      const record=p.data.projects?.find(x=>x.path===project)||{};
      const sessions=p.data.tasks.filter(t=>t.project===project).map(t=>{
        const live=agents.find(a=>a.pane_id===t.pane),status=live?.agent_status||(['starting','switching'].includes(t.phase)?'starting':t.phase==='setup-error'?'setup-error':'offline');
        return {id:t.id,title:t.title,role:t.role||t.title,kind:t.kind,branch:t.branch,worktreeId:t.worktreeId,status,state:t.trashedAt?'trash':t.archivedAt?'archived':'active',createdAt:t.createdAt,updatedAt:t.lastOpenedAt||t.archivedAt||t.createdAt,sessionId:t.providerSessionId||null,appearance:appearanceFor(t),summary:t.agentState?.reason||t.summary||'',canResume:status==='offline'&&!!t.providerSessionId};
      }).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
      return {id:project,path:project,name:path.basename(project),pinned:!!record.pinned,hosting:record.hosting||'auto',lastOpenedAt:record.lastOpenedAt||p.data.events?.find(e=>e.project===project)?.at||null,sessions};
    }).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.lastOpenedAt||'').localeCompare(a.lastOpenedAt||'')||a.name.localeCompare(b.name));
    return {projects,current:p.data.project,engineError,agentIdentities:this.identities()};
  }
  async pin(project,pinned){this.project(project);this.remember(project).pinned=!!pinned;await this.plane.save();return {ok:true};}
  async appearance(id,input){const task=this.plane.task(id);assert(agentColors.some(c=>c.id===input.color)&&agentIcons.includes(input.icon),'Choose a color and icon from the appearance picker');task.appearance={color:input.color,icon:input.icon};task.appearanceRevision=(task.appearanceRevision||0)+1;const profile=this.plane.data.agentProfiles?.find(p=>p.id===task.profileId);if(profile){profile.appearance={...task.appearance};profile.revision++;for(const peer of this.plane.data.tasks.filter(t=>t.profileId===profile.id&&t!==task)){peer.appearance={...task.appearance};peer.appearanceRevision=(peer.appearanceRevision||0)+1;}}await this.plane.save();return {...task.appearance,agentIdentities:this.identities()};}
  async sessionState(project,id,state){
    this.project(project);assert(['active','archived','trash'].includes(state),'Choose Active, Archived, or Trash');
    const p=this.plane,t=p.data.tasks.find(t=>t.project===project&&t.id===id);assert(t,'Session not found',404);
    assert(!this.moving.has(id)&&!p.agentSettings?.changing.has(id)&&!p.promptingTasks?.has(id)&&!p.collaboration?.delivering.has(id),'Wait for the session update to finish',409);
    this.moving.add(id);t.organizing=true;
    try{
      if(state!=='active'){
        assert(!['starting','switching','awaiting-setup'].includes(t.phase),'Finish session setup before archiving',409);
        const live=t.pane?(await p.herdr.list()).find(a=>a.pane_id===t.pane):null;
        assert(!live||['idle','done'].includes(live.agent_status),'Wait for this agent to finish or interrupt it before archiving',409);
      }
      delete t.archivedAt;delete t.trashedAt;
      if(state==='archived')t.archivedAt=new Date().toISOString();
      if(state==='trash')t.trashedAt=new Date().toISOString();
      delete t.organizing;await p.save();return {id,state};
    }finally{delete t.organizing;this.moving.delete(id);}
  }
  async resume(project,id){
    this.project(project);const p=this.plane,t=p.data.tasks.find(t=>t.id===id&&t.project===project);
    assert(t&&!t.archivedAt&&!t.trashedAt,'Restore the session before resuming it',409);
    assert(!this.moving.has(id)&&!['starting','switching','awaiting-setup'].includes(t.phase),'A session update is already in progress',409);this.moving.add(id);
    const previous=structuredClone(t);
    try{
      const live=(await p.herdr.list()).find(a=>a.pane_id===t.pane);assert(!live,'This session is already running',409);
      assert(t.providerSessionId,'This session has no verified provider history to resume',409);
      const history=await p.transcripts.readCurrent(t,null);assert(history.sessionId===t.providerSessionId,'Saved session identity changed. Inspect History before resuming.',409);
      t.phase='starting';
      const args=await p.collaboration.launchConfig(t,{resumeSessionId:t.providerSessionId});
      t.previousPanes=[...(t.previousPanes||[]),{pane:t.pane,workspace:t.workspace}];t.pane=null;t.workspace=null;t.name='wp-'+randomUUID().slice(0,8);t.resumeOnly=true;
      delete t.error;delete t.errorCode;await p.save();p.dispatch(t,args);return {id:t.id};
    }catch(e){for(const key of Object.keys(t))delete t[key];Object.assign(t,previous);throw e;}finally{this.moving.delete(id);}
  }
  async clone(input){
    const remote=validateRemote(input.remote),destination=path.resolve(string(input.destination,'clone destination',4096));
    assert(path.isAbsolute(input.destination),'Enter an absolute destination path');
    assert(!this.cloning.has(destination),'This destination is already being cloned',409);this.cloning.add(destination);
    try{
      let exists=false;try{await lstat(destination);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
      assert(!exists,'Choose a new destination folder; existing folders are never overwritten',409);await realpath(path.dirname(destination));
      await run('git',['-c','core.hooksPath=/dev/null','-c','protocol.ext.allow=never','clone','--',remote,destination],{cwd:this.plane.root,timeout:120000,env:{GIT_SSH_COMMAND:'ssh -o BatchMode=yes'}});
      return this.plane.selectProject(destination);
    }finally{this.cloning.delete(destination);}
  }
  async repository(project){
    this.project(project);const p=this.plane,remotes=(await p.git.command(project,['remote'])).trim().split('\n').filter(Boolean),record=this.remember(project),name=remotes.includes(record.remote)?record.remote:remotes.includes('origin')?'origin':remotes[0];
    assert(!name||/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name),'Unsupported remote name');
    const remote=name?(await p.git.command(project,['remote','get-url',name])).trim():null,identity=remoteIdentity(remote,record.hosting||'auto');
    const worktrees=await p.git.worktrees(project);
    return {project,remoteName:name||null,remotes,remote:remote?(identity?remote.replace(/\/\/[^/@]+:[^/@]+@/,'//[redacted]@'):(path.isAbsolute(remote)?remote:'Unsupported or credential-bearing remote')):null,identity,worktrees};
  }
  async connect(project,input){
    this.project(project);const name=string(input.name||'origin','remote name',80);assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name),'Invalid remote name');
    const hosting=input.hosting||'auto';assert(['auto','github','gitlab','git'].includes(hosting),'Choose a supported hosting service');
    const remote=validateRemote(input.remote),p=this.plane,current=(await p.git.command(project,['remote'])).trim().split('\n');
    assert(!current.includes(name),'This remote already exists. Use a different name; existing remotes are preserved.',409);
    await p.git.command(project,['remote','add',name,remote]);Object.assign(this.remember(project),{remote:name,hosting});await p.save();return this.repository(project);
  }
  async configure(project,input){this.project(project);assert(['auto','github','gitlab','git'].includes(input.hosting),'Choose a hosting service');const repo=await this.repository(project);assert(repo.remotes.includes(input.remote),'Choose an existing remote');Object.assign(this.remember(project),{hosting:input.hosting,remote:input.remote});await this.plane.save();return this.repository(project);}
  async requests(project){
    const repo=await this.repository(project),identity=repo.identity;
    if(!identity||!['github','gitlab'].includes(identity.provider))return {...repo,requests:[],notice:'Choose GitHub or GitLab for this remote to list pull or merge requests.'};
    const cli=await binary(identity.provider==='github'?'gh':'glab',this.plane.root);
    if(!cli)return {...repo,requests:[],notice:`Install ${identity.provider==='github'?'GitHub CLI (gh)':'GitLab CLI (glab)'} and sign in to list private requests here. You can still open the repository in your browser.`};
    try{
      const rows=JSON.parse(await run(cli,identity.provider==='github'?['pr','list','--repo',identity.web,'--state','open','--limit','50','--json','number,title,url,headRefName,baseRefName,isDraft,updatedAt']:['mr','list','--repo',identity.web,'--output','json','--per-page','50'],{cwd:project,timeout:20000}));
      const requests=rows.map(r=>({number:r.number||r.iid,title:r.title,url:r.url||r.web_url,branch:r.headRefName||r.source_branch,base:r.baseRefName||r.target_branch,draft:r.isDraft||r.draft,updatedAt:r.updatedAt||r.updated_at})).filter(r=>{try{return new URL(r.url).origin===new URL(identity.web).origin;}catch{return false;}});
      return {...repo,requests};
    }catch(error){return {...repo,requests:[],notice:'Could not load requests with your current CLI account. '+error.message};}
  }
  async newRequest(project,id){
    const repo=await this.repository(project),w=await this.plane.git.resolve(project,id),identity=repo.identity;
    assert(identity?.requestsUrl,'Connect a GitHub or GitLab remote first');assert(w.branch!=='(detached)','Choose a branch before opening a request');
    const output=await run('git',['ls-remote','--heads','--',repo.remoteName,'refs/heads/'+w.branch],{cwd:project,timeout:20000,env:{GIT_SSH_COMMAND:'ssh -o BatchMode=yes'}});
    assert(output.split(/\s/)[0]===w.head,'Push this branch’s current commit to the selected remote before opening its pull request.',409);
    return {url:identity.provider==='github'?`${identity.web}/compare/${encodeURIComponent(w.branch)}?expand=1`:`${identity.web}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(w.branch)}`,branch:w.branch};
  }
  async pushPreview(project,id){const repo=await this.repository(project),worktree=await this.plane.git.resolve(project,id);assert(repo.remoteName,'Connect a Git remote first');assert(worktree.branch!=='(detached)','Choose a branch to publish');const remote=validateRemote((await this.plane.git.command(project,['remote','get-url','--push',repo.remoteName])).trim());return {project,worktreeId:id,head:worktree.head,branch:worktree.branch,remoteName:repo.remoteName,remote};}
  async push(project,id,expected){
    const preview=await this.pushPreview(project,id);assert(expected&&['head','branch','remoteName','remote'].every(k=>expected[k]===preview[k]),'The branch or remote changed. Review the publish details again.',409);
    validateRemote(preview.remote);const w=await this.plane.git.resolve(project,id);
    await run('git',['-c','core.hooksPath=/dev/null','push','--porcelain','--',preview.remoteName,`${preview.head}:refs/heads/${preview.branch}`],{cwd:w.path,timeout:120000,env:{GIT_SSH_COMMAND:'ssh -o BatchMode=yes'}});
    return {ok:true,branch:preview.branch};
  }
}
