// Presentation of observed Claude activity. Never infer task acceptance from a
// shell exit, and never treat a missing measurement as zero.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=value=>String(value??'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r\n/g,'\n');
const number=value=>Number.isFinite(value)?value.toLocaleString():'—';
const compact=value=>value>=1e6?`${+(value/1e6).toFixed(1)}m`:value>=1e3?`${+(value/1e3).toFixed(1)}k`:number(value);
const duration=value=>Number.isFinite(value)?value<1000?`${Math.round(value)} ms`:`${(value/1000).toFixed(1)} s`:'';
const paths={
  spark:'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8',
  check:'m5 12 4 4L19 6',cross:'m6 6 12 12M6 18 18 6',skip:'m7 6 8 6-8 6V6m11 0v12',
  flask:'M9 3h6m-5 0v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3M8 14h8',
  file:'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5',
  code:'m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z',
  chevron:'m9 5 7 7-7 7',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',terminal:'m5 7 5 5-5 5m8 0h6',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
};
const icon=name=>`<svg class="mod-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.code}"/></svg>`;
const validSummary=s=>s&&['total','passed','failed','skipped','cancelled','todo'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0)&&s.passed+s.failed+s.skipped+s.cancelled+s.todo===s.total;

export function activityTestReport(output,supplied){
  const text=clean(output).slice(0,500000);
  const count=key=>{const matches=[...text.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];return matches.length===1?Number(matches[0][1]):null;};
  const parsed={total:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),cancelled:count('cancelled'),todo:count('todo'),format:'Node TAP'};
  const summary=validSummary(parsed)?parsed:validSummary(supplied)&&supplied.format==='Node TAP'?supplied:null;
  if(!summary)return null;
  const rows=text.split('\n'),cases=[];
  for(let i=0;i<rows.length&&cases.length<200;i++){
    const match=rows[i].match(/^(\s*)(not ok|ok) \d+ - (.+)$/);if(!match)continue;
    const indent=match[1].length,block=[];
    for(let j=i+1;j<rows.length&&j<i+100;j++){
      if(rows[j].trim()&&rows[j].search(/\S/)<=indent)break;
      block.push(rows[j]);if(/^\s*\.\.\.\s*$/.test(rows[j]))break;
    }
    const detail=block.join('\n');
    // TAP also reports containing suites. They are not additional test cases.
    if(/^\s*type:\s*['"]?suite['"]?\s*$/m.test(detail))continue;
    let header=i-1;while(header>=0&&!(rows[header].startsWith(match[1]+'# Subtest: ')&&rows[header].search(/\S/)===indent))header--;
    if(header>=0&&rows.slice(header+1,i).some(line=>/^\s*(?:not ok|ok) \d+ - /.test(line)&&line.search(/\S/)>indent))continue;
    const name=match[3].replace(/\s+# (?:SKIP|TODO)\b.*$/i,'');
    const status=/# SKIP\b/i.test(match[3])?'skipped':/# TODO\b/i.test(match[3])?'todo':/failureType:\s*['"]?cancelledByParent/.test(detail)?'cancelled':match[2]==='not ok'?'failed':'passed';
    const ms=detail.match(/^\s*duration_ms:\s*([\d.]+)/m);
    const errorAt=block.findIndex(line=>/^\s*error:/.test(line));let error='';
    if(errorAt>=0){
      const line=block[errorAt],level=line.search(/\S/),value=line.replace(/^\s*error:\s*/,'');
      if(/^[|>][-+]?\s*$/.test(value)){
        const lines=[];for(let n=errorAt+1;n<block.length&&lines.length<10;n++){if(block[n].trim()&&block[n].search(/\S/)<=level)break;lines.push(block[n].slice(level+2));}error=lines.join('\n').trim();
      }else error=value.replace(/^(['"])(.*)\1$/,'$2');
    }
    cases.push({name,status,durationMs:ms?Number(ms[1]):null,error:error.slice(0,700)});
  }
  // Excerpts may omit cases, but they must not contradict the complete footer.
  const coherent=['passed','failed','skipped','cancelled','todo'].every(k=>cases.filter(c=>c.status===k).length<=summary[k]);
  return {...summary,cases:coherent?cases:[],partial:!coherent||cases.length<summary.total};
}

const lines=value=>String(value).replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n').filter((line,i,all)=>all.length!==1||line!=='');
export function activityChange(input){
  if(typeof input.old_string==='string'&&typeof input.new_string==='string'){
    const before=lines(input.old_string),after=lines(input.new_string);let start=0,end=0;
    while(start<before.length&&start<after.length&&before[start]===after[start])start++;
    while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
    const removed=before.slice(start,before.length-end),added=after.slice(start,after.length-end);
    return {mode:'edit',added:added.length,removed:removed.length,replaceAll:input.replace_all===true,rows:[...before.slice(Math.max(0,start-1),start).map(text=>({kind:'context',text})),...removed.map(text=>({kind:'remove',text})),...added.map(text=>({kind:'add',text})),...after.slice(after.length-end,after.length-end+1).map(text=>({kind:'context',text}))]};
  }
  if(typeof input.content==='string')return {mode:'write',count:lines(input.content).length,rows:lines(input.content).map(text=>({kind:'context',text}))};
  return null;
}

export function activityModel(event){
  let input={};try{const value=JSON.parse(event.input||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))input=value;}catch{/* Bounded or non-JSON inputs remain available in Details. */}
  const name=String(event.name||'Tool'),command=typeof input.command==='string'?input.command:'',file=typeof input.file_path==='string'?input.file_path:typeof input.path==='string'?input.path:'';
  const tests=activityTestReport(event.output,event.tests),change=/^(Edit|Write)$/.test(name)?activityChange(input):null;
  const category=tests||(/Bash|Shell/.test(name)&&/(?:\b(?:test|pytest|vitest|jest|cargo test|go test)\b|--test\b)/.test(command))?'tests':change?'change':/^Read$/.test(name)?'read':/Grep|Glob|Search/.test(name)?'search':/WebFetch|Fetch/.test(name)?'web':'command';
  const description=typeof input.description==='string'?input.description.trim():'';
  return {input,name,command,file,tests,change,category,description,status:['running','completed','failed','denied'].includes(event.status)?event.status:'reported'};
}

function head(event,{symbol,kicker,title,subtitle='',status}){
  const live=event.status==='running',state=status||({running:'In progress',completed:'Complete',failed:'Needs attention',denied:'Not allowed'}[event.status]||'Reported');
  return `<header class="mod-head"><div class="mod-emblem ${live?'is-live':''}">${icon(symbol)}</div><div class="mod-heading"><span class="mod-eyebrow">${esc(kicker)}</span><h3>${esc(title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><span class="mod-state">${live?'<i class="mod-live-dot" aria-hidden="true"></i>':icon(event.status==='failed'||event.status==='denied'||state==='Review results'?'cross':'check')}${esc(state)}</span></header>`;
}
function details(event,model){
  return `<details class="mod-details" data-event="${esc(event.id)}:details"><summary>${icon('terminal')}<span>Command & details</span>${Number.isFinite(event.durationMs)?`<time>${duration(event.durationMs)}</time>`:''}${icon('chevron')}</summary><div class="mod-raw">${event.input?`<h4>${model.command?'Command':'Input'}</h4><pre tabindex="0">${esc(model.command||event.input)}</pre>`:''}<h4>Output</h4><pre tabindex="0">${esc(event.output||'Awaiting the tool result.')}</pre><small>Claude Code · ${esc(model.name)}${model.tests?' · Test results are command evidence, not task approval.':''}</small></div></details>`;
}
function caseRow(item){return `<li class="mod-case case-${item.status}"><span class="mod-case-mark">${icon(item.status==='failed'||item.status==='cancelled'?'cross':item.status==='passed'?'check':'skip')}</span><div><span>${esc(item.name)}</span>${item.status!=='passed'?`<small>${esc({failed:'Failed',skipped:'Skipped',cancelled:'Cancelled',todo:'To do'}[item.status])}</small>`:''}${item.error?`<pre class="mod-failure-message">${esc(item.error)}</pre>`:''}</div>${Number.isFinite(item.durationMs)?`<time>${duration(item.durationMs)}</time>`:''}</li>`;}
function testsBody(event,model){
  const t=model.tests;
  if(!t)return `<div class="mod-pending"><div class="mod-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div><strong>${model.status==='running'?'Waiting for the test runner':model.status==='failed'?'The check command stopped':'Command returned'}</strong><p>${model.status==='running'?'Results will appear here as soon as the tool returns.':'A complete test summary was not reported. Open Details to inspect the output.'}</p></div></div>`;
  const metrics=[['passed','Passed'],['failed','Failed'],['skipped','Skipped'],...(t.cancelled?[['cancelled','Cancelled']]:[]),...(t.todo?[['todo','To do']]:[])];
  const sorted=[...t.cases].sort((a,b)=>(a.status==='failed'?0:a.status==='cancelled'?1:a.status==='passed'?2:3)-(b.status==='failed'?0:b.status==='cancelled'?1:b.status==='passed'?2:3));
  const first=sorted.slice(0,3),rest=sorted.slice(3);
  return `<div class="mod-test-body"><div class="mod-test-score"><div class="mod-test-total"><strong>${number(t.total)}</strong><span>tests reported</span></div><div class="mod-test-metrics">${metrics.map(([key,label])=>`<div class="metric-${key}"><strong>${number(t[key])}</strong><span>${label}</span></div>`).join('')}</div></div><div class="mod-result-bar" role="img" aria-label="${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped${t.cancelled?', '+t.cancelled+' cancelled':''}${t.todo?', '+t.todo+' todo':''}">${metrics.filter(([key])=>t[key]).map(([key])=>`<span class="segment-${key}" style="flex-grow:${t[key]}"></span>`).join('')||'<span class="segment-empty"></span>'}</div>${sorted.length?`<ul class="mod-cases">${first.map(caseRow).join('')}</ul>${rest.length?`<details class="mod-more" data-event="${esc(event.id)}:cases"><summary>View ${rest.length} more result${rest.length===1?'':'s'} ${icon('chevron')}</summary><ul class="mod-cases">${rest.map(caseRow).join('')}</ul></details>`:''}`:''}${t.partial?'<p class="mod-note">Showing the results available in this excerpt. Totals come from the full test summary.</p>':''}</div>`;
}
const diffRows=rows=>`<div class="mod-diff" tabindex="0" aria-label="File change preview">${rows.map(row=>`<div class="mod-diff-line diff-${row.kind}"><span aria-hidden="true">${row.kind==='add'?'+':row.kind==='remove'?'−':' '}</span><code>${esc(row.text)||' '}</code></div>`).join('')}</div>`;
function changeBody(event,model){
  const c=model.change,preview=c.rows.slice(0,8),remaining=c.rows.slice(8),applied=model.status==='completed';
  return `<div class="mod-change-body"><div class="mod-file-strip">${icon('file')}<span title="${esc(model.file)}">${esc(model.file||'File')}</span><div class="mod-change-count">${c.mode==='edit'?`<span class="mod-added">+${c.added}</span><span class="mod-removed">−${c.removed}</span>`:`<span>${c.count} lines</span>`}</div></div>${!applied?`<p class="mod-note">${model.status==='running'?'Proposed change · waiting for the tool result.':'Requested change · this tool did not report success.'}</p>`:''}${diffRows(preview)}${remaining.length?`<details class="mod-more" data-event="${esc(event.id)}:diff"><summary>View ${remaining.length} more line${remaining.length===1?'':'s'} ${icon('chevron')}</summary>${diffRows(remaining)}</details>`:''}${c.replaceAll?'<p class="mod-note">Change shown for one match; this call replaces all matching text.</p>':''}</div>`;
}
function contextCard(event){
  const c=event.context||{},known=Number.isFinite(c.percent)&&c.percent>=0&&c.percent<=100,pct=known?c.percent:0,tone=known&&pct>=85?'tight':known&&pct>=65?'filling':'roomy';
  const title=!known?'Waiting for usage':tone==='tight'?'Context is nearly full':tone==='filling'?'Context is filling up':'Room to keep working';
  const caption=!known?'A reading will appear when Claude reports request usage.':tone==='tight'?'Consider a checkpoint before continuing a longer task.':tone==='filling'?'A good moment to keep important decisions in a checkpoint.':'The latest request fits comfortably in the context window.';
  return `<section class="mod-card mod-context context-${tone}${known?'':' context-unknown'}" aria-label="Claude context usage"><div class="mod-context-orbit"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="mod-orbit-track" cx="60" cy="60" r="48"/><circle class="mod-orbit-value" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${pct} 100"/></svg><div>${known?`<strong>${Math.round(pct)}<small>%</small></strong><span>context used</span>`:`${icon('layers')}<span>awaiting usage</span>`}</div></div><div class="mod-context-copy"><span class="mod-eyebrow">CONTEXT WINDOW</span><h3>${title}</h3><p>${caption}</p><div class="mod-context-stats"><span>${Number.isFinite(c.tokens)?`<b>${compact(c.tokens)}</b> tokens used`:'Usage not yet reported'}</span>${Number.isFinite(c.window)?`<span><b>${compact(c.window)}</b> capacity</span>`:''}${known?`<span><b>${+(100-pct).toFixed(1)}%</b> available</span>`:''}</div><div class="mod-context-cells" aria-hidden="true">${Array.from({length:32},(_,i)=>`<i${known&&i/32*100<pct?' class="filled"':''}></i>`).join('')}</div><small class="mod-context-source">Latest reported request · Claude Code</small></div></section>`;
}

export function activityCard(event){
  if(event.kind==='session')return `<div class="mod-connection">${icon('spark')}<strong>Claude Mods</strong><span class="mod-connection-dot" aria-hidden="true"></span><span>Activity connected</span><span class="mod-connection-line" aria-hidden="true"></span></div>`;
  if(event.kind==='context')return contextCard(event);
  const m=activityModel(event),state=m.status,failed=state==='failed'||state==='denied';let header,body='';
  if(m.category==='tests'){
    const t=m.tests,title=t?(t.failed||t.cancelled?'Some checks need attention':t.passed===t.total&&t.total?(failed?'Checks passed; command failed':'All checks passed'):t.total?'Test run complete':'No tests reported'):state==='running'?'Running checks':failed?'Check command failed':'Check command finished';
    header=head(event,{symbol:'flask',kicker:'CLAUDE / TEST RUN',title,subtitle:m.description,status:t?.failed||t?.cancelled?'Review results':undefined});body=testsBody(event,m);
  }else if(m.category==='change'){
    header=head(event,{symbol:'file',kicker:'CLAUDE / FILE CHANGE',title:state==='running'?'Preparing a file change':failed?'File change stopped':m.change.mode==='write'?'File written':'Change applied',subtitle:m.file.split('/').pop()});body=changeBody(event,m);
  }else{
    const type={read:['file','READING','Read file'],search:['search','EXPLORING','Search workspace'],web:['globe','RESEARCH','Read a web page'],command:['terminal','TOOL ACTIVITY',m.name==='Bash'?'Run a command':m.name]}[m.category];
    header=head(event,{symbol:type[0],kicker:'CLAUDE / '+type[1],title:m.description||type[2],subtitle:m.file||m.input.pattern||m.input.url||''});
    if(m.command)body=`<div class="mod-command-line">${icon('terminal')}<code>${esc(m.command)}</code></div>`;
    if(state==='running')body+='<div class="mod-flow" aria-label="Tool requested, awaiting result"><span class="is-done">Requested</span><i aria-hidden="true"></i><span class="is-current">Awaiting result<span class="mod-ellipsis" aria-hidden="true">…</span></span></div>';
  }
  return `<article class="mod-card mod-${m.category} mod-status-${state}${m.tests?.failed?' has-failures':''}" aria-label="Claude ${m.category==='tests'?'test results':m.category==='change'?'file change':'tool activity'}">${header}${body}${details(event,m)}</article>`;
}
