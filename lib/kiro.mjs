import {protectPrivatePath} from './private-files.mjs';
import { mkdir, readFile, realpath, lstat, open, appendFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, inside, run } from './adapters.mjs';
import {kiroV3Id} from './kiro-v3.mjs';
import { responseStates } from './agent-state.mjs';
import {thinkingEvent} from './thinking-events.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const printable = value => typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
const textContent = content => typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter(c => c.kind === 'text').map(c => c.data).join('\n');
const waiting = () => Object.assign(new Error('Waiting for Kiro to save this session. Check session setup in Agents or Task details.'), {status:409});

// A local, uniquely named profile leaves the user's default agent and trust
// settings alone. Credentials stay in HeloScrum's private connection file.
export async function kiroLaunchConfig(task, server, {resumeSessionId,profile} = {}) {
  assert(uuid(task.id), 'Invalid Kiro task identifier');
  assert(!resumeSessionId || (task.nativeSetup?.kiroEngine==='v3'?kiroV3Id(resumeSessionId):uuid(resumeSessionId)), 'Invalid Kiro session identifier');
  const cwd = await realpath(task.path), name = 'heloscrum-' + task.id;
  for (const dir of [path.join(cwd, '.kiro'), path.join(cwd, '.kiro/agents')]) {
    await mkdir(dir, {recursive:true});
    assert(!(await lstat(dir)).isSymbolicLink() && inside(cwd, await realpath(dir)), 'Kiro agent directory must stay inside its worktree', 403);
  }
  const relative = '.kiro/agents/' + name + '.json', file = path.join(cwd, relative);
  assert(!profile?.mcpServers?.heloscrum, 'The native profile already defines the HeloScrum MCP name', 409);
  const tools=profile?.tools||['*'];
  const config = {...profile,name, description:'HeloScrum managed task connection', tools:tools.includes('*')||tools.includes('@heloscrum')?[...tools]:[...tools,'@heloscrum'], mcpServers:{...profile?.mcpServers,heloscrum:server}};
  let existing;
  try {
    assert(!(await lstat(file)).isSymbolicLink(), 'Kiro profile cannot be a symlink', 403);
    existing = JSON.parse(await readFile(file, 'utf8'));
    assert(existing.name === name && existing.description === config.description, 'An existing Kiro profile occupies this task path', 409);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Exclude only this generated profile, preserving ordinary .kiro project files.
  const exclude = (await run('git', ['rev-parse','--path-format=absolute','--git-path','info/exclude'], {cwd})).trim();
  await mkdir(path.dirname(exclude), {recursive:true});
  let ignored = ''; try { ignored = await readFile(exclude, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!ignored.split(/\r?\n/).includes('/' + relative)) await appendFile(exclude, '\n/' + relative + '\n');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await protectPrivatePath(file); await handle.writeFile(JSON.stringify(config, null, 2) + '\n'); } finally { await handle.close(); }
  // Pin the engine whose session format this adapter supports; never resume
  // an arbitrary "latest" chat from a worktree.
  return ['chat',task.nativeSetup?.kiroEngine==='v3'?'--v3':'--v2','--tui','--agent',name,...(resumeSessionId ? ['--resume-id',resumeSessionId] : []),...(task.model ? ['--model',task.model] : []),...(task.effort ? ['--effort',task.effort] : [])];
}

export function kiroItems(records) {
  const events = [], calls = new Map(), seen = new Set();
  for (const [rowIndex,row] of records.entries()) {
    if (!['Prompt','AssistantMessage','ToolResults'].includes(row.kind)) continue;
    const data = row.data || {}, key = row.kind + ':' + (data.message_id || rowIndex);
    if (seen.has(key)) continue;
    seen.add(key);
    const at = Number.isFinite(data.meta?.timestamp) ? new Date(data.meta.timestamp * 1000).toISOString() : undefined;
    for (const [index,item] of (Array.isArray(data.content) ? data.content : []).entries()) {
      const id = key + ':' + index, value = item.data;
      if (item.kind === 'text' && ['Prompt','AssistantMessage'].includes(row.kind)) events.push({id,type:'message',role:row.kind === 'Prompt' ? 'user' : 'assistant',text:printable(value),at});
      if(row.kind==='AssistantMessage'&&['thinking','redacted_thinking'].includes(item.kind))events.push(thinkingEvent({id,at,status:'completed'},typeof value==='string'?value:value?.text,{redacted:item.kind==='redacted_thinking'}));
      if (item.kind === 'toolUse' && value?.toolUseId) {
        const event = {id:value.toolUseId,type:'tool',name:String(value.name || 'Tool').replace(/^@([^/]+)\//, '$1 / '),input:printable(value.input),output:'',status:'running',at};
        events.push(event); calls.set(value.toolUseId, event);
      }
      if (item.kind === 'toolResult' && value?.toolUseId) {
        const result = {output:textContent(value.content) || printable(value.content),status:value.status === 'success' ? 'completed' : 'failed',failed:value.status !== 'success'};
        const call = calls.get(value.toolUseId);
        if (call) Object.assign(call, result);
        else events.push({id,type:'tool',name:'Tool result',input:'',at,...result});
      }
    }
  }
  return responseStates(events);
}

export class KiroReader {
  constructor(executable, directory = path.join(os.homedir(), '.kiro/sessions/cli')) { this.executable = executable; this.directory = directory; }
  command(args, cwd) { return run(this.executable, ['chat','--v2',...args], {cwd,timeout:15000}); }
  async models() {
    const catalog = JSON.parse(await this.command(['--list-models','--format','json']));
    assert(Array.isArray(catalog.models), 'Kiro returned an unexpected model catalog', 502);
    return catalog.models.filter(m => typeof m.model_id === 'string').map(m => ({id:m.model_id,label:m.model_name || m.model_id,description:m.description || '',isDefault:m.model_id === catalog.default_model}));
  }
  async file(id, extension, limit) {
    assert(uuid(id), 'Kiro session identifier is missing', 409);
    try {
      const base = await realpath(this.directory), file = await realpath(path.join(base, id + extension));
      assert(inside(base,file) && path.basename(file) === id + extension, 'Unexpected Kiro transcript path', 403);
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        assert(info.isFile() && info.size < limit, 'Kiro session history exceeds its reader limit', 413);
        return await handle.readFile('utf8');
      } finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') throw waiting(); throw error; }
  }
  async metadata(id, cwd) {
    let data;
    try { data = JSON.parse(await this.file(id, '.json', 8*1024*1024)); } catch (error) { if (error instanceof SyntaxError) throw waiting(); throw error; }
    assert(data.session_id === id, 'Kiro session mismatch', 403);
    assert(typeof data.cwd === 'string' && await realpath(data.cwd) === await realpath(cwd), 'Kiro session does not belong to this worktree', 403);
    return data;
  }
  async findSession(cwd, createdAt) {
    const directory = await realpath(cwd), since = Date.parse(createdAt);
    assert(Number.isFinite(since), 'Task creation time is missing; cannot identify its Kiro session.', 409);
    const groups = JSON.parse(await this.command(['--list-sessions','--format','json'], directory));
    assert(Array.isArray(groups), 'Kiro returned an unexpected session list', 502);
    const matches = [];
    for (const group of groups) {
      assert(typeof group.cwd === 'string' && await realpath(group.cwd) === directory, 'Kiro session discovery returned a different worktree', 403);
      assert(group.complete !== false, 'Kiro session list is incomplete; cannot choose its history safely', 409);
      for (const session of group.sessions || []) {
        if (session.source !== 'v2') continue;
        const meta = await this.metadata(session.sessionId, directory);
        if (Date.parse(meta.created_at) >= since - 1000) matches.push(session.sessionId);
      }
    }
    assert(matches.length, 'Waiting for Kiro to save its first message.', 409);
    assert(matches.length === 1, 'More than one Kiro session matches this worktree; cannot choose its history safely.', 409);
    return matches[0];
  }
  async read(id, cwd, {full=false} = {}) {
    const meta = await this.metadata(id, cwd), text = await this.file(id, '.jsonl', 32*1024*1024), lines = text.split('\n'), records = [];
    for (const [index,line] of lines.entries()) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch {
        assert(index === lines.length - 1, 'Kiro transcript contains an invalid record', 502); // In-flight trailing write.
      }
    }
    const model = meta.session_state?.rts_model_state?.model_info?.model_id, events = kiroItems(records);
    return {sessionId:id,source:'Kiro session history',...(model ? {model,effort:null,modelObservedAt:meta.updated_at || null} : {}),events:full ? events : events.slice(-250)};
  }
}
