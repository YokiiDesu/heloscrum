import {atomicPrivateWrite,protectPrivatePath} from './private-files.mjs';
import path from 'node:path';
import {mkdir,readFile,writeFile,rename,chmod,access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport,getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {ToolListChangedNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
import {assert,string,binary} from './adapters.mjs';
import {availableIn,assignedTo,accessSettings,grantAssignedTools} from './resource-access.mjs';

const REQUEST_TIMEOUT=20000;
export function mcpToolName(serverId,name){
  const suffix=createHash('sha256').update(name).digest('hex').slice(0,16);
  return `mcp_${serverId.replaceAll('-','').slice(0,12)}_${name.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,28)}_${suffix}`;
}
function secretMap(value,label){
  assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=64,`Enter ${label} as a JSON object`);
  assert(Object.entries(value).every(([key,val])=>/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)&&typeof val==='string'&&val.length<=8192&&!/[\x00\r\n]/.test(val)),`Invalid ${label}`);
  return value;
}
export class McpConnections {
  constructor(plane){this.plane=plane;plane.data.mcpServers||=[];this.connections=new Map();this.pending=new Map();this.changing=new Set();this.secrets={};this.secretQueue=Promise.resolve();this.configQueue=Promise.resolve();this.closed=false;}
  async init(){
    this.secretFile=path.join(this.plane.root,'.heloscrum/mcp-secrets.json');
    try{this.secrets=JSON.parse(await readFile(this.secretFile,'utf8'));await protectPrivatePath(this.secretFile);}catch(error){if(error.code!=='ENOENT')throw Error('MCP credentials could not be read. Restore mcp-secrets.json before connecting.');}
    return this;
  }
  async saveSecrets(){
    const body=JSON.stringify(this.secrets);
    this.secretQueue=this.secretQueue.catch(()=>{}).then(async()=>{await mkdir(path.dirname(this.secretFile),{recursive:true,mode:0o700});await atomicPrivateWrite(this.secretFile,body);});
    return this.secretQueue;
  }
  get(id){const server=this.plane.data.mcpServers.find(s=>s.id===id);assert(server,'MCP connection not found',404);return server;}
  public(server){
    return {...server,hasCredentials:!!Object.keys(this.secrets[server.id]?.headers||{}).length||!!Object.keys(this.secrets[server.id]?.env||{}).length,credentialNames:{headers:Object.keys(this.secrets[server.id]?.headers||{}),env:Object.keys(this.secrets[server.id]?.env||{})},status:server.enabled===false?'disabled':server.lastError?'error':server.discoveredAt?'ready':'not-connected'};
  }
  list(project){return this.plane.data.mcpServers.filter(s=>availableIn(s,project)).map(s=>this.public(s));}
  catalog(task){
    return this.plane.data.mcpServers.filter(s=>assignedTo(s,task,this.plane.data.agentProfiles)).flatMap(s=>(s.tools||[]).map(tool=>({name:mcpToolName(s.id,tool.name),description:`${s.name} · ${tool.name}\n${tool.description||''}`,inputSchema:tool.inputSchema,...(tool.annotations?{annotations:tool.annotations}:{}),source:{type:'mcp',id:s.id,name:s.name,toolName:tool.name,scope:s.scope||'project',assignment:s.assignment||'all'}})));
  }
  configure(input){
    const operation=this.configQueue.catch(()=>{}).then(()=>this.configureNext(input));this.configQueue=operation;return operation;
  }
  async configureNext(input){
    assert(!this.closed,'MCP connections are closing',503);
    const old=input.id?this.get(input.id):null;
    if(old)assert(input.expectedRevision===old.revision,'This MCP changed. Reload settings before saving.',409);
    const name=string(input.name??old?.name,'MCP name',100),transport=input.transport??old?.transport;
    assert(['http','stdio'].includes(transport),'Choose HTTP or a local command');
    const server={...old,id:old?.id||randomUUID(),name,transport,...accessSettings(this.plane,input,old||{}),revision:(old?.revision||0)+1,tools:old?.tools||[]};
    if(transport==='http'){
      let url;try{url=new URL(input.url??old?.url);}catch{throw Error('Enter a valid MCP endpoint URL');}
      assert(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)),'Use HTTPS, or HTTP for a local MCP server');
      assert(!url.username&&!url.password&&!url.hash&&!url.search,'Put authentication in Headers, not the endpoint URL');
      server.url=url.href;delete server.command;delete server.args;
    }else{
      const command=string(input.command??old?.command,'local command',4096);
      assert(path.isAbsolute(command)||/^[a-zA-Z0-9._-]+$/.test(command),'Enter an executable name or absolute path, with arguments separately');
      if(path.isAbsolute(command)){try{await access(command,constants.X_OK);assert((await stat(command)).isFile(),'Command must be an executable file');server.command=command;}catch{throw Error('Local command must be an executable file');}}
      else server.command=await binary(command,this.plane.root);
      assert(server.command,'Local command was not found on PATH');
      server.args=input.args??old?.args??[];
      assert(Array.isArray(server.args)&&server.args.length<=64&&server.args.every(a=>typeof a==='string'&&a.length<=4096&&!a.includes('\0')),'Arguments must be a JSON array of strings');
      delete server.url;
    }
    const credentials={...(this.secrets[server.id]||{})};
    if(input.headers!==undefined)credentials.headers=secretMap(input.headers,'headers');
    if(input.env!==undefined)credentials.env=secretMap(input.env,'environment variables');
    if(input.clearCredentials){credentials.headers={};credentials.env={};}
    if(transport==='http')delete credentials.env;else delete credentials.headers;
    const reconnect=!old||old.transport!==server.transport||old.url!==server.url||old.command!==server.command||JSON.stringify(old.args)!==JSON.stringify(server.args)||input.headers!==undefined||input.env!==undefined||input.clearCredentials;
    if(reconnect){server.tools=[];delete server.discoveredAt;delete server.lastError;}
    this.secrets[server.id]=credentials;await this.saveSecrets();
    if(old)Object.assign(old,server);else this.plane.data.mcpServers.push(server);
    grantAssignedTools(this.plane,server,server.tools.map(t=>mcpToolName(server.id,t.name)));
    await this.plane.collaboration.notify('tool',name,`${name} MCP settings updated`,server.project);
    await this.disconnect(server.id);
    return this.public(server);
  }
  async open(server,project){
    assert(!this.closed,'MCP connections are closing',503);
    const key=server.id+':'+project;
    if(this.connections.has(key))return this.connections.get(key);
    if(this.pending.has(key))return this.pending.get(key);
    const revision=server.revision;
    const request=(async()=>{
      const credentials=this.secrets[server.id]||{},client=new Client({name:'HeloScrum',version:'0.4.0'},{capabilities:{}});
      const transport=server.transport==='http'?new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{headers:credentials.headers||{},redirect:'error'},fetch:(url,init)=>fetch(url,init?.method==='DELETE'?{...init,signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(3000)])}:init)}):new StdioClientTransport({command:server.command,args:server.args,env:{...getDefaultEnvironment(),...credentials.env},cwd:project||this.plane.root,stderr:'pipe',maxBufferSize:2*1024*1024});
      // Never reflect a server's stderr or credential-bearing transport error into UI/history.
      transport.stderr?.on('data',()=>{});
      try{
        await client.connect(transport,{timeout:REQUEST_TIMEOUT});
        assert(!this.closed&&server.revision===revision&&server.enabled!==false,'MCP settings changed while connecting',409);
        const connection={client,transport,serverId:server.id,project,revision};this.connections.set(key,connection);
        client.onclose=()=>{if(this.connections.get(key)===connection)this.connections.delete(key);};
        client.setNotificationHandler(ToolListChangedNotificationSchema,()=>{this.discover(server.id).catch(()=>{});});
        return connection;
      }catch(error){await client.close().catch(()=>{});throw error;}
    })().finally(()=>this.pending.delete(key));
    this.pending.set(key,request);return request;
  }
  async discover(id){
    const server=this.get(id);assert(server.enabled!==false,'Enable this MCP before connecting');
    assert(!this.changing.has(id),'Tool discovery is already in progress. Try refreshing in a moment.',409);
    this.changing.add(id);const revision=server.revision;
    try{
      const {client}=await this.open(server,server.project||this.plane.root),tools=[],cursors=new Set();let cursor;
      do{
        const page=await client.listTools(cursor?{cursor}:undefined,{timeout:REQUEST_TIMEOUT});
        tools.push(...page.tools.map(t=>({name:t.name,description:(t.description||'').slice(0,4000),inputSchema:t.inputSchema,annotations:t.annotations})));
        assert(tools.length<=500&&JSON.stringify(tools).length<=1024*1024,'MCP tool catalog exceeds the supported size');
        cursor=page.nextCursor;if(cursor){assert(!cursors.has(cursor)&&cursors.size<32,'MCP tool pagination did not finish');cursors.add(cursor);}
      }while(cursor);
      assert(server.revision===revision&&server.enabled!==false,'MCP settings changed during discovery',409);
      assert(new Set(tools.map(t=>t.name)).size===tools.length,'MCP returned duplicate tool names');
      const known=new Set(server.tools.map(t=>t.name));
      server.tools=tools;server.discoveredAt=new Date().toISOString();delete server.lastError;
      grantAssignedTools(this.plane,server,tools.filter(t=>!known.has(t.name)).map(t=>mcpToolName(id,t.name)));
      await this.plane.collaboration.notify('tool',server.name,`${server.name}: ${tools.length} MCP tools discovered`,server.project);
    }catch(error){
      if(server.revision===revision){server.lastError=error.code===401||error.status===401?'Authentication required. Set the server’s authorization header or configure a local authenticated MCP command.':'Connection failed. Check the endpoint, local command, and credentials, then retry.';await this.plane.save();}
      if(server.revision===revision)await this.disconnect(id);
      throw Object.assign(new Error(server.lastError||'MCP settings changed. Retry with the current settings.'),{status:502});
    }finally{this.changing.delete(id);}
    return this.public(server);
  }
  async call(task,name,input){
    const tool=this.catalog(task).find(t=>t.name===name);assert(tool,'MCP tool is not assigned to this agent',403);
    const server=this.get(tool.source.id),revision=server.revision;
    try{
      const {client}=await this.open(server,server.transport==='stdio'?(task.path||task.project):task.project);
      assert(server.revision===revision&&this.catalog(task).some(t=>t.name===name)&&this.plane.collaboration.allowed(task,name),'MCP access changed before this call',403);
      const result=await client.callTool({name:tool.source.toolName,arguments:input},undefined,{timeout:55000});
      assert(JSON.stringify(result).length<=2*1024*1024,'MCP result exceeds 2 MiB');
      return {mcpResult:result};
    }catch(error){if(error.status===403)throw error;throw Object.assign(new Error(`${server.name} could not complete the tool call. Check its connection in Project settings.`),{status:502});}
  }
  async disconnect(id){
    const entries=[...this.connections].filter(([,c])=>c.serverId===id);
    for(const [key] of entries)this.connections.delete(key);
    await Promise.allSettled(entries.map(async([,c])=>{if(c.transport.terminateSession)await c.transport.terminateSession().catch(()=>{});await c.client.close();}));
  }
  async close(){this.closed=true;await this.configQueue.catch(()=>{});await Promise.allSettled([...this.pending.values()]);await Promise.allSettled(this.plane.data.mcpServers.map(s=>this.disconnect(s.id)));await this.secretQueue;}
}
