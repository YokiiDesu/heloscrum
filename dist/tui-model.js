import {diffLines} from './diff-view.js';
import {toolPresentation,thinkingPresentation} from './workspace-model.js';
import {agentColor} from './agent-appearance.js';
// The TUI consumes exactly the same normalized events as the Chat renderer.
// Transcript text is untrusted data; only our renderer may emit ANSI controls.
export function plainText(value) {
  return String(value??'').replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\t/g,'    ');
}
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
const segments=text=>[...segmenter.segment(text)].map(s=>s.segment);
export function cellWidth(text) {
  return segments(plainText(text)).reduce((sum,c)=>sum+(/^[\p{Mark}\u200d\ufe0f]+$/u.test(c)?0:/[\p{Extended_Pictographic}\p{Regional_Indicator}\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(c)?2:1),0);
}
export function fitText(text,width){let result='',used=0;for(const c of segments(plainText(text).replace(/\n/g,' '))){const size=cellWidth(c);if(used+size>width)break;result+=c;used+=size;}return result+' '.repeat(Math.max(0,width-used));}
export function wrapText(text,width){
  const rows=[];width=Math.max(2,width);
  for(const line of plainText(text).split('\n')){let row='',used=0;for(const c of segments(line)){const size=cellWidth(c);if(used+size>width){rows.push(row);row='';used=0;}row+=c;used+=size;}rows.push(row);}
  return rows;
}

export const TUI_COLORS={background:'#282e3a',text:'#e5e5e8',purple:'#bf98f5',blue:'#2997ff',green:'#08c98d',muted:'#989eaa',error:'#ff9c90',user:'#232526',code:'#242a35',selection:'#383d50',divider:'#424957',rail:'#737f98',diffAdd:'#ade0c5',diffRemove:'#efb2b9',diffAddBackground:'#1e4030',diffRemoveBackground:'#44272c'};
export const TUI_LIGHT_COLORS={background:'#f5f7f8',text:'#192c38',purple:'#76439f',blue:'#195c9c',green:'#176344',muted:'#506775',error:'#a52b3c',user:'#e7eef2',code:'#eaf0f4',selection:'#d6e6f0',divider:'#c5d1d8',rail:'#647784',diffAdd:'#185b3b',diffRemove:'#922d3d',diffAddBackground:'#dcefe3',diffRemoveBackground:'#f8e0e4'};
export function tuiForeground(run,colors=TUI_COLORS){return run.color?(colors===TUI_LIGHT_COLORS?blend(run.color,colors.text,.55):run.color):colors[run.tone]||colors.text;}
const span=(text,tone='text',bold=false)=>({text:plainText(text),tone,bold});

// A small text renderer for terminal Markdown. These spans are data, never ANSI.
export function inlineSpans(text){
  const out=[],source=plainText(text),pattern=/(`+)([^`\n]+)\1|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\[([^\]\n]+)\]\(([^)\n]+)\)|(https?:\/\/[^\s]+|(?:~\/|\/(?:Users|home|tmp|private)\/)[^\s,;)]+)/g;
  let start=0;
  for(const match of source.matchAll(pattern)){
    if(match.index>start)out.push(span(source.slice(start,match.index)));
    if(match[2])out.push(span(match[2],'blue'));
    else if(match[3]||match[4])out.push(span(match[3]||match[4],'text',true));
    else if(match[5])out.push(span(match[5]+(match[5]===match[6]?'':' ('+match[6]+')'),'blue'));
    else out.push(span(match[7],'blue'));
    start=match.index+match[0].length;
  }
  if(start<source.length)out.push(span(source.slice(start)));
  return out.length?out:[span('')];
}
function wrapSpans(spans,width){
  width=Math.max(2,width);const result=[];let line=[],used=0;
  const emit=()=>{const compact=[];for(const c of line){const last=compact.at(-1);if(last&&last.tone===c.tone&&last.bold===c.bold&&last.color===c.color)last.text+=c.text;else compact.push({...c});}result.push(compact);line=[];used=0;};
  for(const run of spans)for(const c of segments(plainText(run.text))){
    if(c==='\n'){emit();continue;}
    const size=cellWidth(c);
    if(used+size>width){
      // Prefer word boundaries; long paths and code still wrap without loss.
      const split=line.findLastIndex(cell=>cell.text===' ');
      if(split>line.length/3){const rest=line.splice(split+1);emit();line=rest;used=line.reduce((n,cell)=>n+cellWidth(cell.text),0);}
      else emit();
    }
    line.push({...run,text:c});used+=size;
  }
  emit();return result;
}
function toolPreview(input){
  const text=plainText(typeof input==='string'?input:JSON.stringify(input??''));
  try{const value=JSON.parse(text);if(value&&typeof value==='object')return String(value.file_path||value.path||value.command||value.query||'');}catch{}
  return text.startsWith('{')?'':text.split('\n')[0];
}
export function transcriptRows(events,width,expanded=new Set(),{task}={}){
  const rows=[];width=Math.max(2,width);
  const add=(runs,kind,eventId,{prefix='',continuation='',prefixTone='text',prefixColor,...extra}={})=>{
    const prefixWidth=prefix?cellWidth(prefix):0;
    for(const [i,parts] of wrapSpans(runs,Math.max(2,width-prefixWidth)).entries()){
      const spans=[...(prefix?[{...span(i===0?prefix:continuation||' '.repeat(prefixWidth),i===0?prefixTone:'rail'),...(i===0&&prefixColor?{color:prefixColor}:{})}]:[]),...parts];
      rows.push({text:spans.map(s=>s.text).join(''),spans,kind,eventId,...extra,toolHeader:!!extra.toolHeader&&i===0,responseHeader:!!extra.responseHeader&&i===0});
    }
  };
  const markdownBody=(text,eventId,{prefix='  ',continuation='  ',background}={})=>{
    let inCode=false;
    for(const line of plainText(text).split('\n')){
      const fence=line.match(/^\s*(```+|~~~+)(.*)$/);
      if(fence){inCode=!inCode;if(inCode&&fence[2].trim())add([span(fence[2].trim(),'muted')],'code',eventId,{prefix,continuation});continue;}
      const heading=line.match(/^#{1,6}\s+(.+)/),body=heading?heading[1]:line;
      const parts=inCode?[span(line,'blue')]:inlineSpans(body).map(s=>heading?{...s,bold:true}:s);
      add(parts,inCode?'code':'text',eventId,{prefix,continuation,prefixTone:'rail',...(inCode?{background:'code'}:background?{background}:{})});
    }
  };
  const gap=eventId=>rows.push({text:'',spans:[],kind:'text',eventId});
  const connector=eventId=>rows.push({text:'│',spans:[span('│','rail')],kind:'connector',eventId});
  // Connect adjacent calls in the same turn; never suggest a link across user turns.
  const linked=(a,b)=>a&&b?.type==='tool'&&(!a.turnId||!b.turnId||a.turnId===b.turnId);
  for(const [index,event] of (events||[]).entries()){
    if(event.type==='session'){
      gap(event.id);add([span('─'.repeat(width),'divider')],'divider',event.id);add([span(event.text,'muted')],'session',event.id);gap(event.id);
    }else if(event.type==='message'&&event.communication){
      const message=event.communication;
      if(rows.length)gap(event.id);
      add([{...span(message.kind==='group'?`${message.fromRole} → ${message.threadName||'Group chat'}`:`${message.fromRole} messaged ${message.toRole}`,'blue',true),...(message.from&&message.from!=='human'?{color:agentColor(message.from)}:{})}],'message-header',event.id,{prefix:'╭ ',prefixTone:'rail'});
      markdownBody(event.text,event.id,{prefix:'│ ',continuation:'│ '});
      add([span('╰─','rail')],'connector',event.id);gap(event.id);
    }else if(event.type==='message'&&event.role==='user'){
      if(rows.length)add([span('─'.repeat(width),'divider')],'divider',event.id);
      markdownBody(event.text,event.id,{background:'user'});gap(event.id);
    }else if(event.type==='message'){
      let first=true,inCode=false;const connects=linked(event,events[index+1]);
      for(const line of plainText(event.text).split('\n')){
        const fence=line.match(/^\s*(```+|~~~+)(.*)$/);
        if(fence){inCode=!inCode;if(inCode&&fence[2].trim())add([span(fence[2].trim(),'muted')],'code',event.id,{prefix:'  '});continue;}
        const heading=line.match(/^#{1,6}\s+(.+)/),body=heading?heading[1]:line;
        const parts=inCode?[span(line,'blue')]:inlineSpans(body).map(s=>heading?{...s,bold:true}:s);
        add(parts,inCode?'code':'text',event.id,{prefix:first?'● ':connects?'│ ':'  ',continuation:connects?'│ ':'',prefixTone:first?'purple':'rail',prefixColor:first&&task?agentColor(task):undefined,responseHeader:first,...(inCode?{background:'code'}:{})});first=false;
      }
      if(event.agentState)add([span('↳ '+event.agentState.state,'muted')],'state',event.id,{prefix:connects?'│ ':'  ',prefixTone:'rail'});
      if(connects)connector(event.id);else gap(event.id);
    }else if(event.type==='state'){
      add([span(event.report.state,'purple'),span(' · '+event.report.reason,'muted')],'state',event.id,{prefix:'◇ ',prefixTone:'purple'});
      if(event.report.nextStep)add([span('Next: '+event.report.nextStep,'muted')],'state',event.id,{prefix:'  '});gap(event.id);
    }else if(event.type==='thinking'||event.type==='reasoning'){
      const meta=thinkingPresentation(event),{available,kind}=meta,open=available&&expanded.has(event.id);
      add([span('Thinking','purple'),span(available?'  '+(open?'▾ hide':'▸ show')+' '+kind:' · '+meta.unavailable,'muted')],'thinking',event.id,{prefix:'◇ ',prefixTone:'purple',toolHeader:available});
      if(open)markdownBody(event.text,event.id,{prefix:'│ ',continuation:'│ '});
      gap(event.id);
    }else if(event.type==='tool'){
      const open=expanded.has(event.id),failed=event.failed||event.status==='failed',complete=['completed','success'].includes(event.status),status=failed?'failed':event.status||'pending',connects=linked(event,events[index+1]);
      const name=event.name.replace(/^heloscrum\s*\/\s*/,''),preview=toolPreview(event.input);
      add([span(name),...(preview?[span(' '+preview,'blue')]:[]),span('  '+(open?'▾':'▸'),'muted'),...(failed?[span(' failed','error')]:[])],'tool',event.id,{prefix:'● ',continuation:connects||open?'│ ':'',prefixTone:failed?'error':complete?'green':'text',toolHeader:true,status});
      if(open){
        const rail={prefix:'│ ',continuation:'│ ',prefixTone:'rail'};
        add([span('INPUT','muted')],'tool-detail',event.id,rail);add([span(typeof event.input==='string'?event.input:JSON.stringify(event.input??{}),'blue')],'tool-detail',event.id,rail);
        add([span('OUTPUT · '+status,'muted')],'tool-detail',event.id,rail);
        const output=plainText(event.output|| (complete?'No output recorded.':'Waiting for output…'));
        if(toolPresentation(event).kind==='edit'){
          for(const line of diffLines(output,{diff:true})){
            const changed=line.kind==='add'||line.kind==='remove',tone=line.kind==='add'?'diffAdd':line.kind==='remove'?'diffRemove':line.kind==='hunk'?'blue':line.kind==='meta'?'muted':failed?'error':'text';
            add([span(line.text,tone)],'tool-detail',event.id,{...rail,...(changed?{background:tone+'Background'}:{})});
          }
        }else add([span(output,failed?'error':'text')],'tool-detail',event.id,rail);
        if(!connects)add([span('└─','rail')],'connector',event.id);
      }
      if(connects)connector(event.id);else gap(event.id);
    }
  }
  while(rows.length&&!rows.at(-1).text)rows.pop();
  return rows;
}
function ansiColor(hex,background=false){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16));return `\x1b[${background?48:38};2;${rgb.join(';')}m`;}
const paintedRows=new WeakMap();
const plainRows=new WeakMap();
function rowText(row,cols){const cached=plainRows.get(row);if(cached?.cols===cols)return cached.text;const text=fitText(row.text,cols);plainRows.set(row,{cols,text});return text;}
function paintRow(row,cols,colors){
  const cached=paintedRows.get(row);if(cached?.cols===cols&&cached.colors===colors)return cached.ansi;
  const background=row.backgroundColor||colors[row.background]||colors.background;
  let ansi='\x1b[0m'+ansiColor(background,true)+'\x1b[2K',used=0;
  for(const run of row.spans||[span(row.text)]){
    ansi+='\x1b['+(run.bold?'1':'22')+'m'+ansiColor(tuiForeground(run,colors));
    for(const c of segments(plainText(run.text))){const size=cellWidth(c);if(used+size>cols)break;ansi+=c;used+=size;}
    if(used>=cols)break;
  }
  ansi+=' '.repeat(Math.max(0,cols-used));paintedRows.set(row,{cols,colors,ansi});return ansi;
}
const spinner=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
function blend(a,b,mix){return '#'+a.slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-mix)+parseInt(b.slice(1+i*2,3+i*2),16)*mix).toString(16).padStart(2,'0')).join('');}
export function activeEvents(events,task){
  const start=events.findLastIndex(e=>e.type==='message'&&e.role==='user'),last=events.at(-1),working=task.status==='working';
  const tools=working?events.slice(start+1).filter(e=>e.type==='tool'&&!e.failed&&['running','inProgress'].includes(e.status)&&(!last?.turnId||!e.turnId||last.turnId===e.turnId)):[];
  return {tools:new Set(tools.map(e=>e.id)),latestTool:tools.at(-1),response:working&&last?.type==='message'&&last.role==='assistant'?last.id:null};
}
function animateRow(row,{tick=0,enabled=true}={},activity){
  if(!enabled)return row;
  const running=row.toolHeader&&activity.tools.has(row.eventId),responding=row.responseHeader&&activity.response===row.eventId;
  if(!running&&!responding)return row;
  const spans=row.spans.map(run=>({...run})),pulse=(Math.sin(tick/2.8)+1)/2;
  if(running){spans[0].text=spinner[tick%spinner.length]+' ';spans[0].color=blend('#389f91','#a0ffe0',pulse);}
  else if(responding)spans[0].color=blend('#8965b7','#e2caff',pulse);
  return {...row,spans,text:spans.map(s=>s.text).join('')};
}
// Time-based easing behaves the same on 60 Hz and high-refresh-rate displays.
export function scrollStep(current,target,elapsed,reducedMotion=false){
  const next=reducedMotion?target:current+(target-current)*(1-Math.exp(-Math.max(0,elapsed)/55));
  return Math.abs(target-next)<.008?target:next;
}
export function framePatch(frame,previous){
  let ansi='';for(let i=0;i<frame.painted.length;i++)if(frame.cols!==previous?.cols||frame.painted[i]!==previous?.painted[i])ansi+=`\x1b[${i+1};1H`+frame.painted[i];
  return ansi?'\x1b[?25l'+ansi+'\x1b[0m':'';
}
export function screenFrame({cols,rows,task={},events=[],expanded=new Set(),top=0,follow=true,selected=null,error='',loaded=false,preparedHistory,activity=activeEvents(events,task),motion={enabled:false},footer=true,visibleRows,position,colors=TUI_COLORS}){
  cols=Math.max(2,cols);rows=Math.max(1,rows);
  const history=preparedHistory?.length?preparedHistory:transcriptRows(events,cols,expanded);
  if(!history.length)for(const text of wrapText(error||(loaded?'Send a message to get started.':'Loading conversation…'),cols))history.push({text,spans:[span(text,error?'error':'muted')],kind:error?'error':'muted'});
  const tick=motion.tick||0,moving=motion.enabled,mark=moving?spinner[tick%spinner.length]:'●',dots=moving?'.'.repeat(1+Math.floor(tick/3)%3).padEnd(3):'…  ';
  const progress=error?'! '+error:task.status==='working'?`${mark} ${activity.latestTool?.name||'Working'}${dots}  (esc to interrupt)`:task.status==='blocked'?'● Waiting for approval · View request':task.status==='starting'?`${mark} Starting session${dots}`:task.status==='setup-error'?'● Session needs setup · View request':'';
  const footerRows=footer&&rows>=3&&(progress||!follow)?1:0;
  const bodyRows=Math.max(1,visibleRows??rows-footerRows),maxTop=Math.max(0,history.length-bodyRows),offset=Math.floor(Math.min(maxTop,Math.max(0,position??(follow?maxTop:top))));
  const frame=Array.from({length:rows-footerRows},(_,i)=>{const row=history[offset+i]||{text:'',spans:[],kind:'text'};return animateRow(row.toolHeader&&row.eventId===selected?{...row,background:'selection'}:row,motion,activity);});
  const text=follow?progress:`↑ History ${offset+1}–${Math.min(history.length,offset+bodyRows)}/${history.length} · End to follow`;
  const status={text,spans:[{...span(text,error?'error':follow?'purple':'muted'),...(moving&&follow&&!error&&['working','starting'].includes(task.status)?{color:blend('#aa83d5','#e2caff',(Math.sin(tick/3)+1)/2)}:{})}],kind:'progress'};
  if(footerRows){frame.push({text:'',spans:[],kind:'text'});const row=follow?Math.min(rows-1,history.length-offset+1):rows-1;frame[row]=status;}
  const painted=frame.map(row=>paintRow(row,cols,colors));
  const result={cols,painted,lines:frame.map(row=>rowText(row,cols)),history,top:offset,maxTop,bodyRows,status};
  return {...result,ansi:framePatch(result)};
}
