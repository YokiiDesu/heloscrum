import {protectPrivatePath} from './private-files.mjs';
import os from 'node:os';
import {parseDocument} from 'yaml';
import {managedProvider} from './providers.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {readdir,lstat,realpath,open,mkdir,readFile,appendFile,unlink} from 'node:fs/promises';
import {assert,inside,run} from './adapters.mjs';

const CLI=['codex','claude','kiro','cursor'], MAX_FILE=1024*1024, MAX_TOTAL=5*MAX_FILE;
const hash=data=>createHash('sha256').update(data).digest('hex');
const nameOK=value=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(value);
const roots={codex:['.codex','.agents/skills','AGENTS.md','AGENTS.override.md'],claude:['.claude','.mcp.json','CLAUDE.md','CLAUDE.local.md'],kiro:['.kiro','AGENTS.md'],cursor:['.cursor','.agents/skills','AGENTS.md']};
const patterns={
  codex:/^(?:AGENTS(?:\.override)?\.md|\.codex\/(?:config\.toml|hooks\.json|(?:skills|rules|agents|hooks)\/.+)|\.agents\/skills\/.+)$/,
  claude:/^(?:CLAUDE(?:\.local)?\.md|\.mcp\.json|\.claude\/(?:CLAUDE\.md|settings(?:\.local)?\.json|(?:agents|skills|commands|hooks|rules)\/.+))$/,
  kiro:/^(?:AGENTS\.md|\.kiro\/(?:(?:agents|steering|skills|hooks)\/.+|settings\/(?:mcp|cli)\.json|permissions\.ya?ml))$/,
  cursor:/^(?:AGENTS\.md|\.cursor\/(?:(?:mcp|cli|hooks)\.json|(?:rules|agents|skills|commands|hooks)\/.+)|\.agents\/skills\/.+)$/
};
const forbidden=/(?:^|\/)(?:\.git|node_modules|\.env(?:\..*)?|auth(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|sessions?|history|tokens?)(?:\/|$)|\.(?:pem|key|p12)$/i;
function allowed(kind,file){return typeof file==='string'&&file.length<=500&&!file.includes('\\')&&!/[\x00-\x1f\x7f]/.test(file)&&!file.split('/').some(p=>p==='..'||p==='.'||!p)&&patterns[kind]?.test(file)&&!forbidden.test(file)&&!/^\.kiro\/agents\/heloscrum-/.test(file);}
export function nativeSelection(kind,value){
  if(value==null)return {profile:null,files:[]};
  assert(typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['profile','files','kiroEngine','cursorMode'].includes(k)),'Invalid native setup');
  const profile=value.profile===''?null:value.profile??null,files=value.files??[];
  assert(profile===null||typeof profile==='string'&&/^(user|project):[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(profile),'Choose a discovered native profile');
  assert(Array.isArray(files)&&files.length<=256&&files.every(f=>allowed(kind,f)),'Choose supported project configuration files');
  assert(CLI.includes(kind)||!profile&&!files.length,'This provider uses an endpoint, not a native CLI');
  assert(!profile||kind!=='cursor','Cursor uses its native configuration without a named profile');
  assert(!profile||kind!=='codex'||profile.startsWith('user:'),'Codex profiles are user configuration files');
  assert(value.kiroEngine===undefined||kind==='kiro'&&['v2','v3'].includes(value.kiroEngine),'Choose Kiro engine V2 or V3');
  assert(value.cursorMode===undefined||kind==='cursor'&&['headless','interactive'].includes(value.cursorMode),'Choose Cursor headless or interactive mode');
  return {profile,files:[...new Set(files)].sort(),...(value.kiroEngine==='v3'?{kiroEngine:'v3'}:{}),...(value.cursorMode==='interactive'?{cursorMode:'interactive'}:{})};
}
// Never follow links in a selected file or any of its containing directories.
async function safePath(base,relative,{missing=false}={}){
  const root=await realpath(base),target=path.resolve(root,relative);assert(inside(root,target)&&target!==root,'Configuration must stay inside its root',403);
  let current=root;
  for(const part of path.relative(root,target).split(path.sep)){
    current=path.join(current,part);
    try{assert(!(await lstat(current)).isSymbolicLink(),'Configuration links are not copied',403);}
    catch(error){if(error.code==='ENOENT'&&missing)return target;throw error;}
  }
  return target;
}
async function bytes(base,relative){
  const file=await safePath(base,relative),handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const meta=await handle.stat();assert(meta.isFile()&&meta.size<=MAX_FILE,'Configuration must be a regular file under 1 MiB');return {data:await handle.readFile(),mode:meta.mode};}finally{await handle.close();}
}
async function exists(file){try{return !(await lstat(file)).isSymbolicLink();}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function json(data){try{const value=JSON.parse(data);assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid profile');return value;}catch{throw Object.assign(new Error('Native profile is not a valid JSON object'),{status:400});}}
function claudeName(data){
  const front=data.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const named=front?.match(/^name:\s*(["']?)([A-Za-z0-9][A-Za-z0-9_.-]{0,119})\1\s*$/m);
  assert(named,'Claude agent needs a simple name field in its YAML frontmatter');return named[2];
}
export function kiroProfileConfig(data,markdown=false){
  if(!markdown)return json(data);
  const match=data.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);assert(match,'Kiro Markdown profile needs YAML frontmatter');
  const doc=parseDocument(match[1],{uniqueKeys:true});assert(!doc.errors.length,'Invalid Kiro YAML frontmatter');
  const config=doc.toJS({maxAliasCount:30});assert(config&&typeof config==='object'&&!Array.isArray(config),'Invalid Kiro profile');
  if(match[2].trim())config.prompt=match[2].trim();return config;
}
function kiroCompatible(config,engine='v2'){
  assert(config.tools===undefined||Array.isArray(config.tools)&&config.tools.every(v=>typeof v==='string'),'Invalid Kiro tool list');
  assert(engine==='v3'||!['permissions','excludedTools','includeMcpJson','includePowers','welcomeMessage'].some(k=>k in config)&&!(config.tools||[]).some(t=>['read','write','shell','web'].includes(t)),'This profile needs Kiro V3. Select the V3 engine.');
  assert(!config.mcpServers||typeof config.mcpServers==='object'&&!Array.isArray(config.mcpServers),'Invalid Kiro MCP configuration');
  assert(!config.mcpServers?.heloscrum,'The profile already defines the heloscrum connection. Rename that MCP connection before adding HeloScrum.');
}

export class NativeSetup {
  constructor(plane,{home=os.homedir(),codexHome=process.env.CODEX_HOME||path.join(home,'.codex'),claudeHome=process.env.CLAUDE_CONFIG_DIR||path.join(home,'.claude')}={}){Object.assign(this,{plane,home,codexHome,claudeHome});}
  profileRoots(kind,project){return kind==='codex'?[['user',this.codexHome]]:kind==='claude'?[['user',path.join(this.claudeHome,'agents')],['project',path.join(project,'.claude/agents')]]:kind==='kiro'?[['user',path.join(this.home,'.kiro/agents')],['project',path.join(project,'.kiro/agents')]]:[];}
  async profiles(kind,project,engine='v2'){
    const result=[];
    for(const [scope,dir] of this.profileRoots(kind,project)){
      let entries;try{if(!(await exists(dir)))continue;if(scope==='project')await safePath(project,path.relative(project,dir));entries=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'||error.status===403)continue;throw error;}
      for(const entry of entries){
        const suffix=kind==='codex'?'.config.toml':kind==='claude'?'.md':entry.name.endsWith('.md')?'.md':'.json';
        if(!entry.isFile()||!entry.name.endsWith(suffix))continue;
        const name=entry.name.slice(0,-suffix.length);if(!nameOK(name)||name.startsWith('heloscrum-'))continue;
        let note=kind==='kiro'&&suffix==='.md'&&engine!=='v3'?'Select V3 for Markdown profiles':null;
        if(kind==='kiro'&&!note)try{kiroCompatible(kiroProfileConfig((await bytes(dir,entry.name)).data,suffix==='.md'),engine);}catch(error){note=error.status?error.message:'Native profile could not be read';}
        let displayName=name;if(kind==='claude')try{displayName=claudeName((await bytes(dir,entry.name)).data);}catch(error){note=error.status?error.message:'Native agent could not be read';}
        result.push({id:scope+':'+name,name:displayName,scope,filename:entry.name,file:scope==='project'?path.relative(project,path.join(dir,entry.name)).split(path.sep).join('/'):null,available:!note,note});
      }
    }
    // Native Claude resolves project agents before user agents of the same name.
    if(kind==='claude')for(const item of result){
      if(item.scope==='user'&&result.some(p=>p.scope==='project'&&p.name===item.name)){item.available=false;item.note='Overridden by the project agent with this name';}
      if(result.some(p=>p!==item&&p.scope===item.scope&&p.name===item.name)){item.available=false;item.note='Multiple native agent files declare this name';}
    }
    if(kind==='kiro'&&engine==='v3')for(const item of result)if(result.some(p=>p!==item&&p.id===item.id)){item.available=false;item.note='Both JSON and Markdown profiles have this name; give them distinct filenames';}
    return result.sort((a,b)=>a.id.localeCompare(b.id)||Number(b.available)-Number(a.available));
  }
  async files(kind,project){
    const found=[],skipped=[];let visited=0;
    const walk=async(relative,depth=0)=>{
      if(depth>8||found.length>=256||++visited>2048){if(!skipped.includes('Additional files exceed the discovery limit'))skipped.push('Additional files exceed the discovery limit');return;}
      let meta;try{await safePath(project,relative);meta=await lstat(path.join(project,relative));}catch(error){if(error.code==='ENOENT')return;if(error.status===403){skipped.push(relative+' (link)');return;}throw error;}
      if(forbidden.test(relative))return;
      if(meta.isDirectory()){for(const entry of await readdir(path.join(project,relative)))await walk(relative+'/'+entry,depth+1);return;}
      if(!allowed(kind,relative))return;
      if(!meta.isFile()||meta.size>MAX_FILE){skipped.push(relative+' (size or type)');return;}
      found.push({path:relative,bytes:meta.size});
    };
    for(const root of roots[kind]||[])await walk(root);
    const tracked=new Set((await run('git',['ls-files','-z'],{cwd:project})).split('\0'));
    return {files:found.map(f=>({...f,tracked:tracked.has(f.path),shared:kind==='claude'&&f.path==='.claude/settings.local.json'})).sort((a,b)=>a.path.localeCompare(b.path)),skipped:[...new Set(skipped)].slice(0,20)};
  }
  async report(kind,project,task,options={}){
    assert(CLI.includes(kind),'Choose a native CLI provider');this.plane.projects.project(project);
    const engine=options.kiroEngine||task?.nativeSetup?.kiroEngine||'v2';assert(['v2','v3'].includes(engine),'Invalid Kiro engine');
    const [profiles,local]=await Promise.all([this.profiles(kind,project,engine),this.files(kind,project)]);
    const globalRoots=kind==='codex'?[this.codexHome,path.join(this.home,'.agents/skills')]:kind==='claude'?[this.claudeHome]:[path.join(this.home,'.'+kind)];
    const sources=[];for(const root of globalRoots)if(await exists(root))sources.push(root);
    const config=kind==='codex'?[path.join(this.codexHome,'config.toml')]:kind==='claude'?[path.join(this.claudeHome,'settings.json')]:kind==='kiro'?[path.join(this.home,'.kiro/settings/cli.json'),path.join(this.home,'.kiro/settings/mcp.json')]:[path.join(this.home,'.cursor/cli-config.json'),path.join(this.home,'.cursor/mcp.json')];
    const detected=[];for(const file of config)if(await exists(file))detected.push(file);
    return {kind,installed:!!this.plane.tools[kind],profiles,...local,sources,detected,selection:nativeSelection(kind,task?.kind===kind?task.nativeSetup:null),copied:task?.nativeSetupSnapshot?.files||[],terminal:task?.kind===kind&&!!task?.pane&&!managedProvider(task),
      checks:[{name:'Native configuration',state:detected.length||local.files.length?'Detected':'Needs setup',detail:'The CLI loads its own configuration. File discovery does not verify authentication, plugins, hooks, or MCP startup.'},
        {name:'Skills and MCPs',state:'Provider controlled',detail:'Native discovery and permissions stay with the CLI. HeloScrum does not inject every skill or tool description into the prompt.'},
        {name:'Interactive commands',state:kind==='cursor'&&task?.nativeSetup?.cursorMode!=='interactive'?'Choose interactive mode':'Native terminal',detail:kind==='cursor'?'Interactive mode runs Cursor’s real CLI in its worktree, with native approvals and slash commands. Headless sessions keep their existing launch mode.':'Open the running CLI to inspect tools, manage plugins, or use supported slash commands.'},
        ...(kind==='kiro'?[{name:'Kiro engine',state:engine.toUpperCase(),detail:engine==='v3'?'V3 uses native permissions, hooks, and JSON or Markdown agents. History is read through Kiro’s advertised ACP export.':'Existing V2 sessions remain resumable. Select V3 for a new session using the current harness.'}]:[])],
      notes:[...(kind==='codex'?['Project configuration still requires Codex workspace trust. Selected file profiles use CODEX_HOME/<name>.config.toml.']:[]),...(kind==='claude'?['Recent Claude Code versions share the main checkout’s settings.local.json across Git worktrees. Check /status in the native terminal.']:[])]};
  }
  async inspect(kind,project,value,{worktree,existing}={}){
    const selection=nativeSelection(kind,value),files=[];let total=0,profile;
    if(existing)assert(JSON.stringify(selection.files)===JSON.stringify(existing.kind===kind?nativeSelection(existing.kind,existing.nativeSetup).files:[]),'Local file selection is fixed after worktree creation');
    if(!selection.profile&&!selection.files.length)return {selection,files,profile:null,fingerprint:hash(JSON.stringify(selection))};
    const tracked=new Set((await run('git',['ls-files','-z'],{cwd:project})).split('\0'));
    for(const relative of existing?[]:selection.files){
      assert(!tracked.has(relative),'Tracked configuration already comes from Git: '+relative);
      assert(!(kind==='claude'&&relative==='.claude/settings.local.json'),'Claude Code shares settings.local.json from the main checkout; it is not copied');
      const source=await bytes(project,relative);total+=source.data.length;assert(total<=MAX_TOTAL,'Selected native files must fit within 5 MiB');
      if(worktree){let current;try{current=await bytes(worktree,relative);}catch(error){if(error.code!=='ENOENT')throw error;}assert(!current||source.data.equals(current.data),'Existing worktree configuration differs: '+relative,409);}
      files.push({path:relative,...source,sha256:hash(source.data)});
    }
    if(selection.profile){
      const choices=await this.profiles(kind,project,selection.kiroEngine),selected=choices.find(p=>p.id===selection.profile&&p.available)||choices.find(p=>p.id===selection.profile);assert(selected?.available,selected?.note||'Native profile is missing or unavailable for this launch mode');
      const [scope,name]=selection.profile.split(':');let base=this.profileRoots(kind,project).find(([s])=>s===scope)[1];
      const filename=selected.filename;
      if(scope==='project'&&worktree&&await exists(path.join(worktree,selected.file)))base=path.dirname(path.join(worktree,selected.file));
      const raw=selected.file&&tracked.has(selected.file)&&!worktree?{data:Buffer.from(await run('git',['show','HEAD:'+selected.file],{cwd:project}))}:await bytes(base,filename);
      assert(raw.data.length<=MAX_FILE,'Native profile must fit within 1 MiB');profile={id:selected.id,name,scope,sha256:hash(raw.data),source:path.join(base,filename)};
      if(kind==='claude')profile.agentName=claudeName(raw.data);
      if(selected.file&&!tracked.has(selected.file))assert(selection.files.includes(selected.file)||(worktree&&await exists(path.join(worktree,selected.file))),'Select the local profile file to copy into this worktree: '+selected.file);
      if(kind==='kiro'){profile.config=kiroProfileConfig(raw.data,filename.endsWith('.md'));kiroCompatible(profile.config,selection.kiroEngine);}
    }
    return {selection,files,profile,fingerprint:hash(JSON.stringify({selection,files:files.map(f=>[f.path,f.sha256]),profile:profile?.sha256}))};
  }
  async prepare(task,{expected,existing}={}){
    const plan=await this.inspect(task.kind,task.project,task.nativeSetup,{worktree:task.path,existing});
    if(expected)assert(expected===plan.fingerprint,'Native configuration changed since review. Review the change again.',409);
    const created=[];
    try{
      for(const file of plan.files){
        const target=await safePath(task.path,file.path,{missing:true});
        await mkdir(path.dirname(target),{recursive:true,mode:0o700});await safePath(task.path,file.path,{missing:true});
        let handle;try{handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,file.mode&0o111?0o700:0o600);}catch(error){if(error.code!=='EEXIST')throw error;assert((await bytes(task.path,file.path)).data.equals(file.data),'Configuration appeared during setup; review it again',409);continue;}
        created.push(target);try{await protectPrivatePath(target,{mode:file.mode&0o111?0o700:0o600});await handle.writeFile(file.data);}finally{await handle.close();}
      }
      if(plan.files.length){
        const exclude=(await run('git',['rev-parse','--path-format=absolute','--git-path','info/exclude'],{cwd:task.path})).trim();await mkdir(path.dirname(exclude),{recursive:true});
        let content='';try{content=await readFile(exclude,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
        const lines=plan.files.map(f=>'/'+f.path.replace(/[\\*?[\]#! ]/g,'\\$&')).filter(line=>!content.split(/\r?\n/).includes(line));if(lines.length)await appendFile(exclude,'\n'+lines.join('\n')+'\n');
      }
      let profileHash=null;
      if(task.kind==='kiro'&&plan.profile){
        const config=structuredClone(plan.profile.config);
        // Kiro prompt URIs are relative to the profile file, not the launch cwd.
        if(typeof config.prompt==='string'&&config.prompt.startsWith('file://')&&!path.isAbsolute(config.prompt.slice(7))){
          const base=plan.profile.scope==='user'?path.dirname(plan.profile.source):path.join(task.path,'.kiro/agents');config.prompt='file://'+path.resolve(base,config.prompt.slice(7));
        }
        const data=JSON.stringify(config);profileHash=hash(data);const dir=await this.snapshotDir(task);let handle;
        try{handle=await open(path.join(dir,profileHash+'.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await protectPrivatePath(path.join(dir,profileHash+'.json'));await handle.writeFile(data);}catch(error){if(error.code!=='EEXIST')throw error;}finally{await handle?.close();}
      }
      task.nativeSetup=plan.selection;task.nativeSetupSnapshot={at:new Date().toISOString(),profileHash,agentName:plan.profile?.agentName||null,profileSourceHash:plan.profile?.sha256||null,files:existing?.nativeSetupSnapshot?.files||plan.files.map(f=>({path:f.path,sha256:f.sha256}))};
    }catch(error){for(const file of created)await unlink(file).catch(()=>{});throw error;}
  }
  async snapshotDir(task){assert(/^[a-f0-9-]{36}$/.test(task.id),'Invalid task ID');const relative='.heloscrum/agents/'+task.id+'/native';const dir=await safePath(this.plane.root,relative,{missing:true});await mkdir(dir,{recursive:true,mode:0o700});await safePath(this.plane.root,relative);return dir;}
  async kiroProfile(task){
    if(!task.nativeSetup?.profile)return null;
    const digest=task.nativeSetupSnapshot?.profileHash;assert(/^[a-f0-9]{64}$/.test(digest||''),'Prepare the selected Kiro profile before launch');
    const {data}=await bytes(await this.snapshotDir(task),digest+'.json');assert(hash(data)===digest,'Saved native profile changed',409);const config=json(data);kiroCompatible(config,task.nativeSetup?.kiroEngine);return config;
  }
}
