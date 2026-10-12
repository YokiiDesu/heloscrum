import React,{useState,useEffect,useRef,useMemo} from 'react';
import {render,Box,Text,useInput,useApp,useWindowSize} from 'ink';
import {randomUUID} from 'node:crypto';
import {createBrief} from './commands.mjs';
import {tabs,colors,tone,safe,itemsFor,detailRows,textRows} from './tui-model.mjs';
import {agentColor,agentIdentities} from '../dist/agent-appearance.js';
import {terminalWordmark,terminalMark,useLargeBrand} from './brand.mjs';

const h=React.createElement,enc=encodeURIComponent;
const frames=['◜','◠','◝','◞','◡','◟'];
const hints={Agents:'m Message  o Resume  i Interrupt  a Approvals  t Tools  f Layout',Tasks:'n New brief  s Dispatch  u Progress  a Review  v Verify',Conversations:'m Message  b Earlier messages',Changes:'s Stage  a Mark reviewed  c Commit',Calendar:'Shared deadlines · project timezone',Tools:'MCP groups · project and agent assignments'};
const field=(name,label,value='',extra={})=>({name,label,value,...extra});

function App({client,options,initialProjects,initialProject,identity}){
  const {exit}=useApp(),{columns,rows}=useWindowSize();
  const [compactHeader,setCompactHeader]=useState(false);
  const plain=options.plain||process.env.NO_COLOR!==undefined,noMotion=options['no-motion']||plain;
  const width=Math.max(20,columns),height=Math.max(8,rows-1),largeBrand=!compactHeader&&useLargeBrand(width,rows,plain),headerHeight=largeBrand?7:3,bodyHeight=Math.max(3,height-headerHeight-6);
  const [project,setProject]=useState(initialProject),[tab,setTab]=useState('Agents'),[data,setData]=useState({}),[selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[secondary,setSecondary]=useState(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[connected,setConnected]=useState(true),[refreshing,setRefreshing]=useState(false),[busy,setBusy]=useState(false),[tick,setTick]=useState(0),[offset,setOffset]=useState(null),[expanded,setExpanded]=useState(false),[layout,setLayout]=useState('auto'),[modal,setModal]=useState(null);
  const projects=useRef(initialProjects),live=useRef({}),generation=useRef(0),refreshRef=useRef(),inflight=useRef(null),queued=useRef(false),detailVersion=useRef(0),formIndex=useRef(0);
  const color=name=>plain?undefined:colors[name]||name;
  const base=project?'/projects/'+enc(project.id):'';
  const items=useMemo(()=>itemsFor(tab,data),[tab,data]);
  const index=Math.max(0,items.findIndex(i=>i.id===selected)),item=items[index]||null;
  const split=tab==='Agents'&&layout==='split'&&width>=120,showList=width>=90&&layout!=='focus'&&!split;
  const listWidth=showList?Math.min(34,Math.floor(width*.28)):0,detailWidth=Math.max(12,Math.floor((width-listWidth-6)/(split?2:1))-(split?3:0));
  const content=useMemo(()=>detailRows(tab,item,detail,detailWidth,{expanded}),[tab,item,detail,detailWidth,expanded]);
  const nextAgent=tab==='Agents'&&items.length>1?items[(index+1)%items.length]:null;
  const visibleHeight=Math.max(1,bodyHeight-4),maxOffset=Math.max(0,content.length-visibleHeight),top=offset===null?(['Agents','Conversations'].includes(tab)?maxOffset:0):Math.min(offset,maxOffset);
  live.current={project,tab,selected:item?.id,item,base,modal,top,maxOffset};

  async function refresh(){
    if(inflight.current){queued.current=true;return inflight.current;}
    const current=live.current,gen=generation.current;if(!current.project)return;
    setRefreshing(true);
    const work=(async()=>{
      let patch={};
      if(current.tab==='Agents'){const result=await client.list(current.base+'/agents');agentIdentities.update(result.items);patch.agents=result.items;}
      if(current.tab==='Tasks'){const result=await client.list(current.base+'/plans');patch.plans=await Promise.all(result.items.map(p=>client.request(current.base+'/plans/'+enc(p.id))));}
      if(current.tab==='Conversations')patch.conversations=(await client.list(current.base+'/conversations')).items;
      if(current.tab==='Changes')patch.worktrees=(await client.list(current.base+'/worktrees')).items;
      if(current.tab==='Calendar')patch.calendar=await client.request(current.base+'/calendar');
      if(current.tab==='Tools')patch.tools=await client.request(current.base+'/tools');
      if(gen!==generation.current)return;
      setData(old=>({...old,...patch}));setConnected(true);setError('');detailVersion.current++;setTick(t=>t+1);
    })();inflight.current=work;
    try{await work;}catch(e){if(gen===generation.current){setConnected(e.status!==503);setError(e.message);}}
    finally{inflight.current=null;setRefreshing(false);if(queued.current){queued.current=false;void refreshRef.current();}}
  }
  refreshRef.current=refresh;
  useEffect(()=>{generation.current++;setSelected(null);setOffset(null);setDetail(null);setSecondary(null);void refreshRef.current();},[project?.id,tab]);
  useEffect(()=>{
    if(!project)return;const controller=new AbortController();let debounce;
    client.watch(project.id,{signal:controller.signal,onEvent:event=>{setConnected(true);if(['workspace.changed','resync','ready'].includes(event.type)){clearTimeout(debounce);debounce=setTimeout(()=>void refreshRef.current(),350);}},onReconnect:()=>setConnected(false)}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    const fallback=setInterval(()=>void refreshRef.current(),30000);
    return()=>{controller.abort();clearInterval(fallback);clearTimeout(debounce);};
  },[project?.id]);
  const revision=detailVersion.current;
  useEffect(()=>{
    let cancelled=false;if(!item||!base)return;
    const read=async()=>{
      if(tab==='Agents')return client.request(base+'/agents/'+enc(item.id)+'/transcript');
      if(tab==='Conversations')return client.request(base+'/conversations/'+enc(item.id));
      if(tab==='Changes'&&item.path)return client.request(base+'/worktrees/'+enc(item.tree.id)+'/diff?file='+enc(item.path)+(item.staged?'&staged=true':''));
      return null;
    };
    read().then(result=>{if(!cancelled)setDetail(result);}).catch(e=>{if(!cancelled){setError(e.message);setDetail({error:e.message});}});
    if(split&&nextAgent)client.request(base+'/agents/'+enc(nextAgent.id)+'/transcript').then(result=>{if(!cancelled)setSecondary(result);}).catch(()=>{});
    return()=>{cancelled=true;};
  },[base,tab,item?.id,revision,split,nextAgent?.id]);
  useEffect(()=>{if(noMotion||!busy&&!refreshing)return;const timer=setInterval(()=>setTick(t=>t+1),120);return()=>clearInterval(timer);},[busy,refreshing,noMotion]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);

  function choose(next){setSelected(items[(next+items.length)%items.length]?.id);setOffset(null);setDetail(null);}
  function form(title,fields,onSubmit,description=''){formIndex.current=0;setModal({title,fields,onSubmit,description,index:0,scroll:0,key:randomUUID()});}
  function confirm(title,description,onSubmit){form(title,[field('confirm','Confirm','Cancel',{choices:['Cancel','Confirm']})],values=>values.confirm==='Confirm'?onSubmit():undefined,description);}
  async function perform(action,success='Saved'){
    if(busy)return;setBusy(true);setError('');
    try{await action();setModal(null);await refreshRef.current();setNotice(success);}
    catch(e){setError(e.message+(e.operationId?' · operation '+e.operationId:''));}
    finally{setBusy(false);}
  }
  const mutate=(route,input,method)=>client.mutate(route,input,{method});
  async function action(key){
    const current=live.current,chosen=current.item,b=current.base;
    if(key==='p'){
      const result=await client.list('/projects');projects.current=result.items;form('Switch project',[field('project','Project',project?.id,{choices:result.items.map(p=>p.id),labels:Object.fromEntries(result.items.map(p=>[p.id,p.name]))})],values=>{setData({});setProject(projects.current.find(p=>p.id===values.project));},'Projects keep their sessions and work. This does not change the browser’s selected project.');return;
    }
    if(key==='n'&&tab==='Tasks'){
      const agents=(await client.list(b+'/agents')).items.filter(a=>a.state==='active');
      form('New task brief',[
        field('title','Title (optional)'),field('instructions','Instructions'),field('brief','Markdown file (optional)'),field('file','Plan JSON file (optional)'),field('attachments','Attach files (comma separated)'),field('links','Resource links (comma separated)'),
        field('participant','Agent IDs, comma separated',agents.map(a=>a.id).join(',')),field('strategy','Coordination','team',{choices:['team','assigned','orchestrator']}),field('orchestrator','Orchestrator ID (if selected)'),field('change-policy','Changes','review',{choices:['review','autonomous']}),field('method','Delivery method','from-file',{choices:['from-file','flexible','scrum','kanban','waterfall','hybrid']})
      ],values=>createBrief(client,b,{...values,participant:[values.participant],attach:values.attachments.split(',').map(v=>v.trim()).filter(Boolean),link:values.links.split(',').map(v=>v.trim()).filter(Boolean)},'plan'),agents.map(a=>`${a.role}: ${a.id}`).join('\n')+'\nSave a draft first. Select it and press s to review dispatch. Scrum is the default delivery method.');return;
    }
    if(!chosen)return;
    if(tab==='Agents'){
      const route=b+'/agents/'+enc(chosen.id);
      if(key==='m')form('Message '+chosen.label,[field('text','Direction')],v=>mutate(route+'/message',{text:v.text}),'Sends direction to this provider session.');
      if(key==='i')confirm('Interrupt '+chosen.label,'Stop the current agent turn?',()=>mutate(route+'/interrupt',{}));
      if(key==='o')confirm('Resume '+chosen.label,'Resume this saved provider session. It may start the provider process.',()=>mutate(route+'/resume',{}));
      if(key==='a'){
        const request=await client.request(route+'/request');
        if(!request.pending){setNotice('This agent has no pending approval.');return;}
        const choices=request.request?.options||[];if(!choices.length){form('Provider needs attention',[field('close','Action','Close',{choices:['Close']})],()=>{},request.output+'\nOpen the provider terminal to answer this request.');return;}
        form('Provider approval · '+chosen.label,[field('choice','Decision','__cancel',{choices:['__cancel',...choices.map(c=>c.id)],labels:{__cancel:'Cancel',...Object.fromEntries(choices.map(c=>[c.id,c.label||c.text||c.id]))}})],v=>v.choice==='__cancel'?undefined:mutate(route+'/decision',{choice:v.choice,expected:request.fingerprint}),request.output);
      }
    }
    if(tab==='Tasks'){
      const plan=chosen.plan,route=b+'/plans/'+enc(plan.id),rev={expectedRevision:plan.revision};
      if(key==='s'&&plan.status==='draft')confirm('Dispatch '+plan.title,`Send revision ${plan.revision} to ${plan.participantIds.length} agents using ${plan.strategy} coordination?\nPolicy: ${plan.changePolicy}. This queues the brief for the selected agents.`,()=>mutate(route+'/start',rev));
      if(key==='u'&&chosen.type==='task')form('Update '+chosen.title,[field('status','Status',chosen.status,{choices:['todo','in_progress','blocked','needs_review','done','cancelled']}),field('note','Progress / evidence')],v=>mutate(route+'/tasks/'+enc(chosen.id),{...rev,...v},'PATCH'),'Revision '+plan.revision+' · Existing task ownership and verification rules apply.');
      if(key==='a'&&chosen.type==='proposal')form('Review proposal',[field('decision','Decision','reject',{choices:['reject','approve']}),field('reason','Reason')],v=>mutate(route+'/proposals/'+enc(chosen.id)+'/review',{...rev,...v}),JSON.stringify(chosen.input,null,2));
      if(key==='v'&&chosen.type==='task')form('Verify '+chosen.title,[field('result','Outcome','Changes required',{choices:['Changes required','Passed']}),field('evidence','Independent verification evidence')],v=>mutate(route+'/tasks/'+enc(chosen.id)+'/verify',{...rev,passed:v.result==='Passed',evidence:v.evidence}),'Review the submitted evidence before approving completion.');
    }
    if(tab==='Conversations'){
      if(key==='m'){
        const target=chosen.kind==='group'?{threadId:chosen.id}:{to:chosen.participants.find(p=>p.id!=='human'&&p.id!==identity.id)?.id};
        if(chosen.kind!=='group'&&!chosen.participants.some(p=>p.id==='human'||p.id===identity.id)){setNotice('Use Agents → m to start a direct conversation with an agent.');return;}
        form('Message '+chosen.name,[field('message','Message')],v=>mutate(b+'/messages',{...target,...v,kind:'request',requiresReply:true}));
      }
      if(key==='b'&&detail?.hasMore){const earlier=await client.request(b+'/conversations/'+enc(chosen.id)+'?before='+enc(detail.before));setDetail({...earlier,messages:[...earlier.messages,...detail.messages]});setOffset(0);}
    }
    if(tab==='Changes'){
      const route=b+'/worktrees/'+enc(chosen.tree.id);
      if(key==='s'&&chosen.path&&detail?.fingerprint)confirm(chosen.staged?'Unstage file':'Stage file',chosen.path+'\nThe fingerprint must still match these changes.',()=>mutate(route+'/stage',{file:chosen.path,unstage:!!chosen.staged,expected:detail.fingerprint}));
      if(key==='a'&&detail?.fingerprint)confirm('Mark worktree reviewed',`This marks all ${detail.files.length} files in ${chosen.tree.branch} reviewed. Inspect each file before confirming.`,()=>mutate(route+'/review',{expected:detail.fingerprint}));
      if(key==='c'){
        const preview=await client.request(route+'/commit-preview');
        form('Commit staged changes',[field('message','Commit message'),field('confirm','Confirm','Cancel',{choices:['Cancel','Commit']})],v=>v.confirm==='Commit'?mutate(route+'/commit',{message:v.message,expected:{tree:preview.tree,head:preview.head}}):undefined,preview.files.map(f=>f.path).join('\n')+'\nOnly this staged tree will be committed.');
      }
    }
  }

  useInput((input,key)=>{
    if(key.ctrl&&input==='c'){exit();return;}
    if(busy)return;
    if(modal){
      if(key.escape){setModal(null);setError('');return;}
      if(key.pageUp||key.pageDown){const total=textRows(modal.description,width-6).length,shown=Math.min(total,Math.max(2,Math.floor((bodyHeight-5)/2)));setModal(m=>({...m,scroll:Math.max(0,Math.min(Math.max(0,total-shown),m.scroll+(key.pageUp?-4:4)))}));return;}
      if(key.ctrl&&input==='s'){const values=Object.fromEntries(modal.fields.map(f=>[f.name,f.value]));void perform(()=>modal.onSubmit(values),'Action completed');return;}
      const active=modal.fields[modal.index];
      if(key.tab||key.return||key.upArrow||key.downArrow){const step=key.shift||key.upArrow?-1:1;setModal(m=>({...m,index:(m.index+step+m.fields.length)%m.fields.length}));return;}
      if(active.choices){if(key.leftArrow||key.rightArrow||input===' '){const at=active.choices.indexOf(active.value),step=key.leftArrow?-1:1;setModal(m=>({...m,fields:m.fields.map((f,i)=>i===m.index?{...f,value:f.choices[(at+step+f.choices.length)%f.choices.length]}:f)}));}return;}
      if(key.ctrl&&input==='u'){setModal(m=>({...m,fields:m.fields.map((f,i)=>i===m.index?{...f,value:''}:f)}));return;}
      if(key.ctrl||key.meta||key.leftArrow||key.rightArrow)return;
      setModal(m=>({...m,fields:m.fields.map((f,i)=>i===m.index?{...f,value:key.backspace||key.delete?[...f.value].slice(0,-1).join(''):(f.value+safe(input)).slice(0,16000)}:f)}));return;
    }
    if(input==='q'){exit();return;}
    if(input==='h'){setCompactHeader(value=>!value);return;}
    if(/^[1-6]$/.test(input)){setTab(tabs[Number(input)-1]);return;}
    if(key.tab){setTab(tabs[(tabs.indexOf(tab)+(key.shift?5:1))%6]);return;}
    if(key.upArrow||input==='k'){if(items.length)choose(index-1);return;}
    if(key.downArrow||input==='j'){if(items.length)choose(index+1);return;}
    if(key.pageUp||key.ctrl&&input==='b'){setOffset(Math.max(0,top-visibleHeight+1));return;}
    if(key.pageDown||key.ctrl&&input==='f'){setOffset(Math.min(maxOffset,top+visibleHeight-1));return;}
    if(input==='g'){setOffset(0);return;}if(input==='G'){setOffset(null);return;}
    if(input==='r'){void refreshRef.current();return;}
    if(input==='t'&&tab==='Agents'){setExpanded(v=>!v);return;}
    if(input==='f'&&tab==='Agents'){setLayout(l=>l==='auto'?'focus':l==='focus'?'split':'auto');return;}
    if(input==='?'){form('Keyboard guide',[field('close','Action','Close',{choices:['Close']})],()=>{},'1–6 / Tab: change section\n↑↓ or j/k: select item\nPgUp/PgDn: scroll detail · g: top · G: follow latest\np: switch project · r: refresh · h: compact header · q: leave TUI\n'+hints[tab]+'\n\nForms: Tab changes fields, ←→ changes choices, Ctrl+U clears input, Ctrl+S submits, Esc cancels.\nThe backend and agent sessions keep running when this TUI closes.');return;}
    void action(input).catch(e=>setError(e.message));
  });

  const renderRow=(row,i)=>h(Text,{key:i,wrap:'truncate',color:color(row.tone||'text')},row.spans?row.spans.map((s,j)=>h(Text,{key:j,color:color(s.color||({green:'mint',rail:'border',divider:'border'}[s.tone]||s.tone)),bold:s.bold},safe(s.text))):safe(row.text));
  const panel=(title,lines,position,subtitle,identityColor)=>h(Box,{flexDirection:'column',borderStyle:plain?'single':'round',borderColor:color('border'),width:split?'50%':undefined,flexGrow:1,minWidth:0,paddingX:1,height:bodyHeight},
    h(Text,{bold:true,color:color(identityColor||'accent'),wrap:'truncate'},safe(title)),h(Text,{color:color('muted'),wrap:'truncate'},safe(subtitle||'')),
    h(Box,{height:visibleHeight,flexDirection:'column',overflow:'hidden'},...lines.slice(position,position+visibleHeight).map(renderRow)));
  let body;
  if(modal){
    const description=textRows(modal.description,width-6),descriptionHeight=modal.description?Math.min(description.length,Math.max(2,Math.floor((bodyHeight-5)/2))):0;
    const available=Math.max(1,bodyHeight-descriptionHeight-5),start=Math.max(0,modal.index-Math.floor(available/2)),fields=modal.fields.slice(start,start+available);
    body=h(Box,{flexDirection:'column',borderStyle:plain?'single':'round',borderColor:color('accent'),height:bodyHeight,paddingX:1},h(Text,{bold:true,color:color('accent')},modal.title),
      ...description.slice(modal.scroll,modal.scroll+descriptionHeight).map((l,i)=>h(Text,{key:'desc'+i,color:color('muted'),wrap:'truncate'},l.text)),
      ...fields.map((f,i)=>{const active=start+i===modal.index,label=f.labels?.[f.value]||f.value;return h(Text,{key:f.name,color:color(active?'accent':'text'),bold:active,wrap:'truncate'},`${active?'›':' '} ${f.label}: ${f.choices?'‹ ':''}${safe(active&&!f.choices?label.slice(-Math.max(8,width-f.label.length-10)):label)}${f.choices?' ›':active?'▏':''}`);}),
      h(Box,{flexGrow:1}),h(Text,{color:color('muted'),wrap:'truncate'},'Tab fields · ←→ choices · Ctrl+S submit · Esc cancel'),h(Text,{color:color('muted'),wrap:'truncate'},description.length>descriptionHeight?`PgUp/PgDn review details · ${modal.scroll+1}–${Math.min(modal.scroll+descriptionHeight,description.length)} of ${description.length}`:''));
  }else body=h(Box,{height:bodyHeight},
    showList?h(Box,{width:listWidth,flexShrink:0,flexDirection:'column',paddingRight:1},h(Text,{color:color('muted')},`${items.length} ${tab.toLowerCase()}`),...items.slice(Math.max(0,index-Math.floor((bodyHeight-2)/2)),Math.max(0,index-Math.floor((bodyHeight-2)/2))+bodyHeight-2).map(entry=>h(Text,{key:entry.id,wrap:'truncate',bold:entry.id===item?.id,color:color(tab==='Agents'?agentColor(entry):entry.id===item?.id?'accent':'text')},(entry.id===item?.id?'› ':'  ')+safe(entry.label)))):null,
    panel(item?.label||tab,content,top,(item?.subtitle||'')+`  ${item?index+1:0}/${items.length} · ${top+1}–${Math.min(top+visibleHeight,content.length)} of ${content.length}`,tab==='Agents'&&item?agentColor(item):undefined),
    split?panel(nextAgent?.label||'Second agent',nextAgent?detailRows('Agents',nextAgent,secondary,detailWidth,{expanded}):textRows('Select a project with two active agents.',detailWidth),Math.max(0,(secondary?.events?detailRows('Agents',nextAgent,secondary,detailWidth,{expanded}).length:0)-visibleHeight),nextAgent?.subtitle,nextAgent?agentColor(nextAgent):undefined):null);
  if(columns<50||rows<16)return h(Box,{flexDirection:'column'},h(Text,{color:color('accent')},'HeloScrum'),h(Text,null,'Resize to at least 50 × 16.'),h(Text,null,'q quit · CLI --json works at any size'));
  const layoutLabel=split?'Split':layout==='auto'&&width>=90?'Adaptive':'Focus';
  return h(Box,{flexDirection:'column',width,height},
    h(Box,{justifyContent:'space-between',height:headerHeight,paddingX:1},
      largeBrand?h(Box,{flexDirection:'column'},
        h(Box,{gap:2},h(Box,{flexDirection:'column'},...terminalMark.map((line,i)=>h(Text,{key:i},h(Text,{color:color('accent')},line.slice(0,4)),h(Text,{color:color('mint')},line.slice(4))))),
          h(Box,{flexDirection:'column'},...terminalWordmark.map((line,i)=>h(Text,{key:i},h(Text,{color:['#ffcfaf','#ffc199','#ffb888','#ffab76','#ed9e6d'][i]},line.helo+'  '),h(Text,{color:['#b4ebdf','#a4e5d7','#95dfcf','#85d8c6','#75c7b6'][i]},line.scrum))))),
        h(Text,{color:color('muted')},'         H E L O S C R U M  ·  Connected agents. Shared momentum.')):
        h(Box,{gap:2},h(Box,{flexDirection:'column'},...['╷ ╭╮','├──┤','╰╯ ╵'].map((line,i)=>h(Text,{key:i},h(Text,{color:color('accent')},plain?(i===1?'[H]':'   '):line.slice(0,2)),h(Text,{color:color('mint')},plain?'':line.slice(2))))),h(Box,{flexDirection:'column'},h(Text,{bold:true,color:color('accent')},width>=70?'H E L O S C R U M':'HELOSCRUM'),h(Text,{color:color('muted')},width>=90?'Connected agents. Shared momentum.':'Connected agents.'))),
      h(Text,{color:color(connected?'mint':'error'),wrap:'truncate'},(busy||refreshing?(noMotion?'…':frames[tick%frames.length]):'●')+' '+(busy?'Saving':connected?'Connected':'Reconnecting'))),
    h(Text,{color:color('muted'),wrap:'truncate'},' '+safe(project?.name||'No registered project')+'  /  '+tab+'  ·  '+(identity.kind==='agent'?'Agent identity':identity.name)+'  ·  p switch project'),
    h(Box,{height:2,gap:width<90?1:3,paddingX:1},...tabs.map((name,i)=>h(Text,{key:name,bold:name===tab,color:color(name===tab?'accent':'muted'),underline:name===tab},`${i+1} ${width<70?name.slice(0,3):name}`))),
    body,
    h(Text,{color:color('muted'),wrap:'truncate'},' '+hints[tab]),
    h(Text,{color:color(error?'error':notice?'mint':'muted'),wrap:'truncate'},' '+safe(error||notice||(offset===null?'Live updates · reading position preserved':'Reading history · G follows latest'))),
    h(Text,{color:color('muted'),wrap:'truncate'},' ↑↓ select · PgUp/PgDn scroll'+(width>=90?' · G follow · h header':'')+' · ? help · q quit'+(tab==='Agents'?' · '+layoutLabel:'')));
}

export async function runTui(client,options={}){
  const [identity,all]=await Promise.all([client.request('/me'),client.list('/projects')]);
  const project=options.project?await client.project(options.project):all.items[0];
  if(!project)throw new Error('No accessible projects. Use projects open --path /path/to/repository first.');
  // The CLI requires a real TTY. An inherited CI flag must not hide its live frames.
  const instance=render(h(App,{client,options,identity,initialProjects:all.items,initialProject:project}),{interactive:true,alternateScreen:true,exitOnCtrlC:false,patchConsole:false,maxFps:15,incrementalRendering:true});
  try{await instance.waitUntilExit();}finally{client.close();}
}
