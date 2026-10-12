import {plainText,wrapText,transcriptRows} from '../dist/tui-model.js';

export const tabs=['Agents','Tasks','Conversations','Changes','Calendar','Tools'];
export const colors={accent:'#ffab76',mint:'#85d8c6',text:'#e8edf0',muted:'#9daeb7',border:'#44545d',blue:'#a6c9fa',error:'#f3a0a0',purple:'#c5a4eb'};
export const tone=status=>/error|failed|overdue|blocked/.test(status||'')?'error':/review|awaiting/.test(status||'')?'accent':/done|completed|idle|active/.test(status||'')?'mint':'muted';
export const safe=value=>plainText(value??'');
export const documentRows=(text,width)=>transcriptRows([{id:'document',type:'message',role:'assistant',text:safe(text)}],width);
export const textRows=(text,width)=>wrapText(safe(text),width).map(text=>({text}));
export function itemsFor(tab,data){
  if(tab==='Agents')return (data.agents||[]).filter(a=>a.state==='active').map(a=>({...a,label:a.role||a.title,subtitle:a.kind+' · '+a.status}));
  if(tab==='Tasks')return (data.plans||[]).flatMap(plan=>[
    {...plan,id:plan.id,type:'plan',plan,label:plan.title,subtitle:`${plan.status} · revision ${plan.revision}`},
    ...(plan.items||[]).map(item=>({...item,type:'task',plan,label:'  '+item.title,subtitle:item.status})),
    ...(plan.proposals||[]).filter(p=>p.status==='pending').map(p=>({...p,type:'proposal',plan,label:'  Review: '+(p.input?.title||p.operation),subtitle:'Needs Review'}))
  ]);
  if(tab==='Conversations')return (data.conversations||[]).map(t=>({...t,label:t.name,subtitle:`${t.kind} · ${t.count} messages`}));
  if(tab==='Changes')return (data.worktrees||[]).flatMap(t=>t.files.length?t.files.map(f=>({...f,id:t.id+':'+f.path,tree:t,label:f.path,subtitle:(f.staged?'staged':'working')+' · '+t.branch})):[{id:t.id,tree:t,label:t.branch,subtitle:'Clean worktree'}]);
  if(tab==='Calendar')return (data.calendar?.entries||[]).filter(e=>e.startDate||e.dueDate).sort((a,b)=>(a.dueAt??a.startAt)-(b.dueAt??b.startAt)).map(e=>({...e,label:e.title,subtitle:(e.overdue?'Overdue · ':'')+(e.dueDate||e.startDate)}));
  if(tab==='Tools')return [...(data.tools?.mcps||[]).map(s=>({...s,id:'mcp:'+s.id,type:'mcp',label:s.name,subtitle:`MCP · ${s.tools?.length||0} tools · ${s.scope}`})),...(data.tools?.tools||[]).filter(t=>!t.sourceId).map(t=>({...t,id:t.name,type:'tool',label:t.name,subtitle:t.scope||'Agent tool'}))];
  return [];
}
export function detailRows(tab,item,detail,width,{expanded=false}={}){
  if(!item)return documentRows(tab==='Tasks'?'## Your next idea starts here\nPress **n** to prepare a brief. Add instructions or a file, choose your team, then review and dispatch it.':'Nothing here yet. Switch projects with **p** or refresh with **r**.',width);
  if(tab==='Agents'){
    if(!detail)return textRows('Loading session…',width);
    const events=detail.events||detail.transcript?.events||[];
    return events.length?transcriptRows(events,width,expanded?new Set(events.filter(e=>e.type==='tool').map(e=>e.id)):new Set(),{task:item}):documentRows(detail.error||item.summary||'No transcript yet. Press m to send direction, or o to resume a saved session.',width);
  }
  if(tab==='Tasks'){
    const plan=item.plan;
    if(item.type==='proposal')return documentRows(`## Proposed ${item.operation}\nFrom ${item.actorName}\n\n${JSON.stringify(item.input,null,2)}\n\nPress **a** to review this proposal.`,width);
    if(item.type==='task')return documentRows(`## ${item.title}\n${item.status} · ${plan.title}\nOwner: ${item.ownerId||'Unassigned'}\n\n${item.description||''}\n\n### Acceptance\n${item.acceptance||'Not specified'}\n\n### Latest evidence\n${item.note||item.verification?.evidence||'No evidence recorded'}\n\n${item.dependsOn?.length?'Dependencies: '+item.dependsOn.join(', '):''}`,width);
    const done=plan.items.filter(t=>t.status==='done').length,total=plan.items.length;
    return documentRows(`## ${plan.title}\n${plan.status} · ${plan.management?.method||'Flexible'} · ${plan.changePolicy==='review'?'Scope changes need review':'Agents may organize work'}\n\n${'■'.repeat(total?Math.round(done/total*16):0)}${'░'.repeat(16-(total?Math.round(done/total*16):0))} ${done}/${total} complete\n\n${plan.instructions||plan.planText||''}\n\n### Team\n${plan.participantIds.join(', ')||'Choose agents before dispatching'}\n\n### Recent activity\n${(plan.audit||[]).slice(-5).map(e=>`${e.title||e.action||''}: ${e.detail||''}`).join('\n')}`,width);
  }
  if(tab==='Conversations')return detail?.messages?.length?documentRows(detail.messages.map(m=>`### ${m.fromRole||m.from}\n${m.text}\n`).join('\n'),width):textRows('Loading conversation…',width);
  if(tab==='Changes')return textRows(item.path?(detail?.preview?.error||detail?.preview?.diff||'Loading diff…'):`${item.tree.branch}\nNo changes in this worktree.`,width).map(row=>({...row,tone:row.text.startsWith('+')?'mint':row.text.startsWith('-')?'error':row.text.startsWith('@@')?'blue':'text'}));
  if(tab==='Calendar')return documentRows(`## ${item.title}\n${item.planTitle}\n\n${item.kind} · ${item.status}${item.overdue?' · OVERDUE':''}\nStart: ${item.startDate||'Unscheduled'}\nDue: ${item.dueDate||'Unscheduled'}\nTimezone: ${item.timeZone}\n\nDates and reminders are shared with the web calendar and agents. The backend continues checking reminders while this terminal is closed.`,width);
  if(tab==='Tools')return documentRows(item.type==='mcp'?`## ${item.name}\nMCP · ${item.scope} · ${item.assignment==='selected'?'Assigned agents':'All eligible agents'}\n\n${item.tools.map(t=>`### ${t.name}\n${t.description||''}`).join('\n\n')}`:`## ${item.name}\n${item.description||''}\n\n### Input schema\n\`\`\`json\n${JSON.stringify(item.inputSchema||{},null,2)}\n\`\`\``,width);
  return [];
}
