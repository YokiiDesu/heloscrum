import {codexShellRequest} from '../dist/provider-request.js';
import { fingerprint } from './patch.mjs';

// Positive evidence of an empty native composer. Process/title detection alone
// can say idle before a startup trust dialog has finished rendering.
export function nativePromptReady(kind,output){
  const tail=String(output||'').replace(/\r/g,'').split('\n').filter(line=>line.trim()).slice(-10);
  if(kind==='cursor')return tail.some(line=>/^\s*→\s*(?:Plan, search, build anything|Add a follow-up(?: — \/plan to review and build)?)\s*$/.test(line));
  if(kind==='kiro')return tail.some(line=>/^\s*›\s*ask a question or describe a task(?: ↵)?\s*$/.test(line));
  return false;
}

// Recognize the provider's current permission menu, not numbered prose earlier
// in the transcript. Unknown prompts keep the reviewed raw-key fallback.
// A recognized menu is stable while unrelated terminal output keeps arriving.
// Keep selection and the provider's queue position in the response token.
export function requestFingerprint(request,output){
  return request.identity?fingerprint(JSON.stringify([request.identity,request.options.map(o=>[o.id,!!o.selected]),request.queue||null])):fingerprint(output);
}
export function agentRequest(output){
  const request=parseAgentRequest(output),details=request.details||'';
  const cursor=/^([\w.-]+):\s+([\w.-]+)\s*\n?/.exec(details);
  const codex=/^Allow the (.+) MCP server to run tool "([^"]+)"\?\s*\n?/.exec(details);
  const kiro=/^[ \t]*mcp → ([^/\s]+)\/([^\s]+)\s*$/m.exec(details);
  const match=cursor||codex||kiro;
  if(match&&request.type==='tool-approval'){
    const args=details.slice(match.index+match[0].length).trim();
    let formatted=args;try{formatted=JSON.stringify(JSON.parse(args),null,2);}catch{}
    request.tool={server:match[1],name:match[2],arguments:formatted||null};
    if(match[2]==='invoke_tool'){try{const input=JSON.parse(args);if(typeof input.name==='string')request.tool.operation=input.name;}catch{}}
  }
  if(!request.tool&&request.type==='tool-approval'){
    const native=/^[ \t]*([\w.-]+) →[ \t]*([\s\S]+)$/.exec(details.split('\n').slice(1).join('\n'));
    if(native&&native[1]!=='mcp')request.tool={name:native[1],arguments:native[2].trim()||null};
  }
  if(request.title==='Kiro permission scope')request.scope=/trust \[([^\]]+)\]/.exec(details)?.[1]||null;
  return request;
}
function parseAgentRequest(output){
  const lines=String(output||'').replace(/\r/g,'').split('\n');
  // Cursor may keep editing other files while this approval is visible. Only
  // the current menu belongs in its identity, never changing scrollback.
  const cursorToolStart=lines.findLastIndex(line=>/^\s*[\w.-]+:\s+[\w.-]+\s*$/.test(line));
  if(cursorToolStart>=0){
    const tail=lines.slice(cursorToolStart).filter(line=>line.trim());
    while(/^(?:←\/→ to switch approval|ctrl\+r to review changed files)$/.test(tail.at(-1)?.trim()||''))tail.pop();
    const question=tail.findIndex(line=>line.trim()==='Run this MCP tool?');
    const labels=['Run (once) (y)','Allowlist MCP Tool (tab)','Reject & propose changes (p)','Skip (esc or n)'];
    const rows=tail.slice(question+1).map(line=>/^\s*([→]?)\s*(.*?)\s*$/.exec(line));
    if(question>0&&rows.length===4&&rows.every((row,i)=>row?.[2]===labels[i])&&rows.filter(row=>row[1]).length===1){
      const details=tail.slice(0,question).join('\n').trim(),keys=['y','tab','p','n'];
      const counter=/Approval (\d+) of (\d+)/.exec(lines.slice(Math.max(0,cursorToolStart-3),cursorToolStart).join('\n'));
      const queue=counter&&Number(counter[1])>0&&Number(counter[1])<=Number(counter[2])?{position:Number(counter[1]),total:Number(counter[2])}:null;
      const names=['Run once','Allowlist MCP tool','Reject and propose changes','Skip'];
      const options=rows.map((row,i)=>({id:String(i+1),label:names[i],key:keys[i],selected:!!row[1],description:['Run only this call.','Open Cursor’s allowlist settings and review the rule.','Reject this call and provide revised instructions.','Skip this call.'][i]}));
      return {type:'tool-approval',title:tail[0].trim(),details,options,queue,currentTrustMenu:true,identity:fingerprint(JSON.stringify([details,names,queue]))};
    }
  }
  // Cursor's trust dialog uses letter shortcuts, not an arrow-key selection.
  // Herdr can classify it as idle. A complete box at the current tail is required.
  const cursorStart=lines.findLastIndex(line=>line.includes('Workspace Trust Required')||line.includes('MCP Server Approval Required'));
  if(cursorStart>=0){
    const raw=lines.slice(cursorStart).filter(line=>line.trim());
    const tail=raw.slice(0,-1).map(line=>line.trim().replace(/^│\s*/, '').replace(/\s*│$/, '').trim().replace(/^[▶›❯]\s*/, '')).filter(Boolean);
    const mcp=tail[0]?.includes('MCP Server Approval Required');
    const labels=mcp?['Approve all servers','Continue without approval','Quit']:['Trust this workspace',"Trust this workspace, but don't enable all MCP servers",'Quit'],keys=mcp?['a','c','q']:['a','w','q'];
    const choices=tail.filter(line=>/^\[[acwq]\]/.test(line));
    if(/^\s*╰─+╯\s*$/.test(raw.at(-1)||'')&&tail.includes(mcp?'The following MCP servers need to be approved:':'Do you trust the contents of this directory?')&&choices.length===3&&choices.every((line,i)=>line===`[${keys[i]}] ${labels[i]}`)){
      const busy=tail.some(line=>line.includes('Trusting workspace and applying MCP approvals')||line.includes('Approving servers'));
      const details=tail.filter(line=>!choices.includes(line)).join('\n');
      return {type:'provider-setup',title:mcp?'Cursor MCP approval':'Cursor workspace trust',details,currentSetupMenu:true,options:busy?[]:labels.map((label,i)=>({id:String(i+1),label,key:keys[i],selected:false,description:''})),identity:fingerprint(details)};
    }
  }
  // V3 can advertise an idle agent while its one-time migration menu still
  // owns input. Require the complete current tail, never an old menu in scrollback.
  const setupStart=lines.findLastIndex(line=>/^\s*Your agent configs are still in the 2\.0 format\. Upgrade them to run on 3\.0\? They'll keep working in 2\.0\.\s*$/.test(line));
  if(setupStart>=0){
    const tail=lines.slice(setupStart).filter(line=>line.trim());
    const labels=['Enable auto-upgrade',"Not now — I'll do it later"];
    const rows=tail.slice(1).map(line=>/^\s*([❯>]?)\s*(.*?)\s*$/.exec(line));
    if(rows.length===2&&rows.every((row,i)=>row?.[2]===labels[i])&&rows.filter(row=>row[1]).length===1){
      const options=rows.map((row,i)=>({id:String(i+1),label:row[2],description:'',selected:!!row[1]})),details=tail[0].trim();
      return {type:'provider-setup',title:'Kiro V3 setup',details,options,currentSetupMenu:true,identity:fingerprint(JSON.stringify([details,labels]))};
    }
  }
  // V3 native tool approvals keep their provider labels and permission scope.
  const approvalStart=lines.findLastIndex(line=>/^\s*\S[^\r\n]* requires approval\s*$/.test(line));
  if(approvalStart>=0){
    const tail=lines.slice(approvalStart).filter(line=>line.trim()),labels=['Allow','Always allow','Deny','Always deny'];
    const rows=tail.slice(-6,-2).map(line=>/^\s*([❯>]?)\s*(.*?)\s*$/.exec(line));
    if(tail.length>=7&&rows.length===4&&rows.every((row,i)=>row?.[2]===labels[i])&&rows.filter(row=>row[1]).length===1&&/^\s*[─━]{3,}\s*$/.test(tail.at(-2))&&/^\s*esc to close · ↑↓ to navigate · ↵ to select · Tab to edit\s*$/.test(tail.at(-1))){
      const details=tail.slice(0,-6).join('\n').trim(),options=rows.map((row,i)=>({id:String(i+1),label:row[2],description:['Run this call once.','Open Kiro’s trust settings and review the scope.','Deny this call.','Open Kiro’s deny settings and review the scope.'][i],selected:!!row[1]}));
      return {type:'tool-approval',title:tail[0].trim(),details,options,currentTrustMenu:true,identity:fingerprint(JSON.stringify([details,labels]))};
    }
  }
  // Kiro V3 opens another menu after choosing a trust option. Preserve the
  // displayed scope instead of treating the next Enter as a completed approval.
  const scopeStart=lines.findLastIndex(line=>/^\s*\S[^\r\n]* requires approval · trust \[(?:session|workspace|global)\] \(s to cycle\)\s*$/.test(line));
  if(scopeStart>=0){
    const tail=lines.slice(scopeStart).filter(line=>line.trim());
    const rows=tail.slice(-4,-2).map(line=>/^\s*([❯>]?)\s*(Trust "[^"\n]+"|Trust entire tool \([^\n)]+\))\s{2,}(.+?)\s*$/.exec(line));
    if(tail.length>=6&&rows.length===2&&rows.every(Boolean)&&rows.filter(row=>row[1]).length===1&&/^\s*[─━]{3,}\s*$/.test(tail.at(-2))&&/^\s*esc to close · ↑↓ to navigate · ↵ to select · Tab to edit\s*$/.test(tail.at(-1))){
      const details=tail.slice(0,-4).join('\n').trim(),options=rows.map((row,i)=>({id:String(i+1),label:row[2]+' · '+row[3],description:row[3],selected:!!row[1]}));
      return {type:'tool-approval',title:'Kiro permission scope',details,options,currentTrustMenu:true,identity:fingerprint(JSON.stringify([details,options.map(o=>o.label)]))};
    }
  }
  // Kiro's path-scoped trust submenu can be reported as idle by Herdr. Only
  // recognize the complete current menu at the terminal tail, never old prose.
  const trustStart=lines.findLastIndex(line=>/^\s*\S[^\r\n]* requires approval · trust options\s*$/.test(line));
  if(trustStart>=0){
    const tail=lines.slice(trustStart).filter(line=>line.trim()),choices=tail.slice(1,-2);
    if(choices.length===3&&choices.every((line,i)=>new RegExp('^\\s*[❯>]?[ \\t]*'+['Specific paths','Complete directory','Entire tool'][i]+'(?:[ \\t]+.*)?$').test(line))&&choices.filter(line=>/^\s*[❯>]/.test(line)).length===1&&/^\s*[─━]{3,}\s*$/.test(tail.at(-2))&&/^\s*esc to close · ↑↓ to navigate · ↵ to select · Tab to edit\s*$/.test(tail.at(-1))){
      return {type:'provider-request',title:'Choose permission scope',details:tail.join('\n'),options:[],currentTrustMenu:true};
    }
  }
  const shell=codexShellRequest(output);
  if(shell)return {...shell,identity:fingerprint(shell.identity)};
  const start=lines.findLastIndex(line=>/^\s*Allow the .+ MCP server to run tool ".+"\?\s*$/.test(line));
  if(start>=0){
    const tail=lines.slice(start).join('\n').trim(),end=tail.split('\n').at(-1);
    const rows=[...tail.matchAll(/^\s*([›❯>]?)\s*([1-4])\.\s+(Allow for this session|Always allow|Allow|Cancel)(?: {2,}(.*))?\s*$/gm)];
    const labels=['Allow','Allow for this session','Always allow','Cancel'];
    if(/enter to submit\s*\|\s*esc to cancel/i.test(end)&&rows.length===4&&rows.every((r,i)=>Number(r[2])===i+1&&r[3]===labels[i])&&rows.filter(r=>r[1]).length===1){
      const options=rows.map(r=>({id:r[2],label:r[3],description:r[4]||'',selected:!!r[1]}));
      const details=tail.slice(0,rows[0].index).trim();
      return {type:'tool-approval',title:lines[start].trim(),details,options,identity:fingerprint(JSON.stringify([details,options.map(({id,label,description})=>({id,label,description}))]))};
    }
  }
  return {type:'provider-request',title:'Response requested',details:lines.slice(-60).join('\n').trim(),options:[]};
}
