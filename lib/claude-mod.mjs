import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile),versions=new Map();
export function supportsActivityMod(version){const m=String(version).match(/(\d+)\.(\d+)\.(\d+)/);return !!m&&(Number(m[1])>2||Number(m[1])===2&&(Number(m[2])>1||Number(m[2])===1&&Number(m[3])>=286));}
export async function claudeModConfig(task,executable,codeRoot){
  if(process.env.HELOSCRUM_CLAUDE_ACTIVITY==='0'||process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS==='0')return {args:[]};
  // Honor the user's explicit hook switch; never rewrite their settings.
  for(const file of [path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'settings.json'),path.join(task.path,'.claude/settings.json'),path.join(task.path,'.claude/settings.local.json')]){
    try{const s=JSON.parse(await readFile(file,'utf8'));if(s.disableAllHooks||String(s.env?.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS)==='0')return {args:[]};}catch(error){if(error.code!=='ENOENT')return {args:[]};}
  }
  try{
    const key=executable||'claude';let cached=versions.get(key);
    if(!cached||Date.now()-cached.at>60000){const {stdout}=await exec(key,['--version'],{timeout:5000,maxBuffer:4096});cached={at:Date.now(),version:stdout};versions.set(key,cached);}
    if(!supportsActivityMod(cached.version))return {args:[]};
    return {args:['--plugin-dir',path.join(codeRoot,'plugins/heloscrum-activity')],env:{CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'}};
  }catch{return {args:[]};}
}
