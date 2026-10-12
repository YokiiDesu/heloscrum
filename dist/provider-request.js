import {diffHTML} from './diff-view.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function codexShellRequest(output){
  const lines=String(output||'').replace(/\r/g,'').split('\n');
  // Codex shell approvals have a different menu from MCP approvals. Match
  // the complete current tail, including wrapped permission-prefix labels.
  const shellStart=lines.findLastIndex(line=>/^\s*Would you like to run the following command\?\s*$/.test(line));
  if(shellStart>=0){
    const tail=lines.slice(shellStart).filter(line=>line.trim());
    if(/^\s*Press enter to confirm or esc to cancel\s*$/.test(tail.at(-1)||'')){
      const first=tail.findIndex(line=>/^\s*[›❯>]?\s*1\.\s+Yes, proceed \(y\)\s*$/.test(line));
      const rows=[];
      for(const line of tail.slice(first+1,-1)){
        const row=/^\s*([›❯>]?)\s*([1-3])\.\s+(.+?)\s*$/.exec(line);
        if(row)rows.push({id:row[2],label:row[3],selected:!!row[1]});
        else if(rows.length&&/^\s+\S/.test(line))rows.at(-1).label+=' '+line.trim();
        else rows.push({id:'invalid',label:line});
      }
      const initial=first>=0?/^\s*([›❯>]?)\s*1\.\s+(.+?)\s*$/.exec(tail[first]):null;
      if(initial)rows.unshift({id:'1',label:initial[2],selected:!!initial[1]});
      const valid=first>0&&rows.length===3&&rows.every((row,i)=>row.id===String(i+1))&&rows.filter(row=>row.selected).length===1&&
        rows[0].label==='Yes, proceed (y)'&&/^Yes, and don't ask again for commands that start with .+ \(p\)$/.test(rows[1].label)&&rows[2].label==='No, and tell Codex what to do differently (esc)';
      if(valid){
        const details=tail.slice(0,first).join('\n').trim(),command=/^[ \t]*\$[ \t]+([\s\S]+)$/m.exec(details)?.[1]?.trim();
        if(command){
          const options=rows.map(row=>({...row,description:''}));
          return {type:'tool-approval',title:'Run command',details,options,tool:{name:'shell',arguments:command},identity:JSON.stringify([details,rows.map(({id,label})=>({id,label}))])};
        }
      }
    }
  }
  return null;
}

// A response token includes the current selection; a prompt identity does not.
// Keep a sent prompt disabled even when native selection or scrollback changes.
export function permissionIdentity(data){
  const request=data?.request;
  // Older running backends may still expose a raw native prompt. Stabilize
  // its display without changing the server-owned response token or choices.
  return request?.identity||codexShellRequest(request?.details)?.identity||data?.fingerprint||null;
}
export const permissionAnswered=slot=>!!slot.requestSent&&slot.requestSent===permissionIdentity(slot.request);
export function observePermission(slot,data){
  const changed=data?.pending&&(!slot.request?.pending||permissionIdentity(slot.request)!==permissionIdentity(data));
  if(changed){
    slot.requestSequence=(slot.requestSequence||0)+1;
    slot.requestSent=null;
    slot.requestNotice=slot.requestSequence>1?'New request received. Review this request before responding.':'';
  }else if(!data?.pending){slot.requestSent=null;slot.requestNotice='';}
  slot.requestError='';
  slot.request=data;
}

// Terminal scrollback and response tokens change without changing the menu.
// Preserve button nodes (including a pointer-down/focus) for the same request.
export function permissionKey(slot,task){
  const data=slot.request,r=data?.request;
  return JSON.stringify([task.status,task.error,task.canRetryStart,data?.pending,r?.identity||r?.details,r?.options,r?.queue,r?.tool,r?.scope,slot.expanded,slot.requestError,slot.requestNotice,!!slot.responding,slot.requestSequence,permissionAnswered(slot)]);
}
export function permissionHTML({request:r,slot,role,provider,expanded,workspace,disabled,notice,error,sequence=1}){
  const attrs=`data-slot="${slot}"`,disabledAttr=disabled?'disabled':'',tool=r.tool;
  // Keep native choice IDs intact while placing the long prefix approval on its own row.
  const shellMenu=tool?.name==='shell'&&r.options.length===3&&r.options[0].label==='Yes, proceed (y)'&&r.options[1].label.startsWith("Yes, and don't ask again for commands that start with ")&&r.options[2].label==='No, and tell Codex what to do differently (esc)';
  const choices=shellMenu?[r.options[0],r.options[2],r.options[1]]:r.options;
  const queue=r.queue?`Request ${r.queue.position} of ${r.queue.total}`:`Request ${Number.isSafeInteger(sequence)&&sequence>0?sequence:1}`;
  const target=tool?`<dl class="request-target"><div><dt>Tool</dt><dd><code>${esc(tool.name)}</code></dd></div>${tool.operation?`<div><dt>Operation</dt><dd><code>${esc(tool.operation)}</code></dd></div>`:''}${tool.server?`<div><dt>MCP server</dt><dd>${esc(tool.server)}</dd></div>`:''}${r.scope?`<div><dt>Scope</dt><dd>${esc(r.scope)}</dd></div>`:''}</dl>`:'';
  const content=tool?`<h4>${tool.name==='shell'?'Command':'Arguments'}</h4>${tool.arguments?`<pre>${esc(tool.arguments)}</pre>`:'<p class="request-hint">The provider has not included arguments in this prompt. Review the native request before granting access.</p>'}<details class="request-native"><summary>Native request</summary>${diffHTML(r.details)}</details>`:diffHTML(r.details);
  return `<div class="request-heading"><div><strong>${esc(provider)} · ${r.type==='tool-approval'?'Tool permission':'Provider request'}</strong><span class="request-counter" role="status">${queue}</span></div><button type="button" class="request-expand" data-pack="expand" ${attrs} aria-pressed="${!!expanded}">${expanded?(workspace?'Restore workspace':'Restore grid'):'Expand card'}</button></div>${target}<div class="request-content">${content}</div>${notice?`<p class="request-hint request-feedback" role="status">${esc(notice)}</p>`:''}${error?`<p class="request-error" role="alert">${esc(error)}</p>`:''}${r.options.length?`<div class="request-choices${shellMenu?' request-choices-shell':''}">${choices.map(o=>`<button type="button" data-pack="request-choice" ${attrs} data-choice="${esc(o.id)}" ${disabledAttr}><strong>${esc(o.label==='Allow'?'Allow once':o.label)}</strong>${o.description?`<small>${esc(o.description)}</small>`:''}</button>`).join('')}</div>`:`<p class="request-hint">Use the provider’s selection controls below. Confirm applies to the highlighted native option.</p><div class="request-keys">${[['up','↑','Previous option'],['down','↓','Next option'],['enter','Confirm selection','Confirm selection'],['escape','Esc','Escape']].map(([key,label,title])=>`<button type="button" data-pack="request-key" ${attrs} data-key="${key}" aria-label="${esc(title+' for '+role)}" ${disabledAttr}>${label}</button>`).join('')}</div>`}<p class="request-hint">${r.queue?'The provider’s pending count updates after each response.':'Numbered as requests are observed in this session. The provider has not reported a total.'}</p>`;
}
