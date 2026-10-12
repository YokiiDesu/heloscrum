// No credentials, network endpoints, or permission overrides. The host supplies
// this session's scoped MCP connection. Reports never enter the model prompt.
  let sessionId='',pending=[],busy=false,lastError='',lastDelivered=null,timer;
let recent=[],lastContext={},paneTab='activity',pinBand=false,interactive=true;
const PANE='heloscrum-activity';
const redraw=$=>{try{$.ui.invalidate('ui.render');}catch{/* Presentation must not interrupt a native tool. */}};
const inputOf=event=>{try{return JSON.parse(event.input||'{}');}catch{return {};}};
const labelOf=event=>{const input=inputOf(event);return input.description||input.file_path||input.pattern||event.name||'Tool call';};
  const clip=value=>{const text=String(value??'');return text.length<=12000?text:text.slice(0,5000)+'\n… bounded activity excerpt …\n'+text.slice(-6900);};
  const enqueue=event=>{
    const existing=pending.findIndex(p=>p.id===event.id);
    if(existing>=0&&pending[existing].sequence<=event.sequence)pending.splice(existing,1);
    pending.push({...event,sessionId});pending=pending.slice(-128);
    if(event.kind==='tool'){recent=recent.filter(item=>item.id!==event.id);recent.push(event);recent=recent.slice(-24);}
  };
  const flush=async $=>{
    if(busy||!sessionId)return;busy=true;const was=pending.length+'|'+lastError+'|'+lastDelivered;
    try{for(let n=0;n<16&&pending.length;n++){
      const event=pending[0],result=await $.mcp.call('heloscrum','activity_report',event);
      if(result.isError)throw Error('HeloScrum rejected an activity report');
      const index=pending.indexOf(event);if(index>=0)pending.splice(index,1);lastDelivered=new Date().toISOString();lastError='';
    }}catch{lastError='Activity delivery unavailable; native Claude tools continue normally.';}finally{busy=false;if(was!==pending.length+'|'+lastError+'|'+lastDelivered)redraw($);}
  };
  const measure=async ($,id)=>{
    try{const usage=await $.session.usage(),context={};for(const key of ['tokens','window','percent'])if(Number.isFinite(usage.context?.[key]))context[key]=usage.context[key];
      lastContext=context;enqueue({id,sequence:Date.now(),kind:'context',status:'completed',context});redraw($);
    }catch{lastError='Context measurement unavailable.';}
  };
let roleData=null,roleError='',roleLoading=false,roleIndex=0,showRoleGuide=false;
const parseRoleResult=result=>{if(result.isError)throw Error('Role view unavailable');return result.structuredContent||JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));};
const loadRoles=async($,sync=false)=>{
  if(roleLoading||!sessionId)return;roleLoading=true;roleError='';redraw($);
  try{
    let data=parseRoleResult(await $.mcp.call('heloscrum',sync?'role_pack_sync':'role_pack_view',{sessionId}));
    if(data.offloaded){
      let text='',offset=0,complete=false;
      for(let i=0;i<64;i++){
        const page=parseRoleResult(await $.mcp.call('heloscrum','context_read',{reference:data.reference,offset,limit:8000}));
        if(typeof page.text!=='string'||page.text.length>8000)throw Error('Invalid role page');
        text+=page.text;
        if(page.nextOffset===null){data=JSON.parse(text);complete=true;break;}
        if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw Error('Invalid role offset');
        offset=page.nextOffset;
      }
      if(!complete)throw Error('Role view exceeds the bounded reader');
    }
    if(data.schemaVersion!==1||!Array.isArray(data.panels))throw Error('Unsupported role view');
    roleData=data;roleIndex=Math.min(roleIndex,Math.max(0,data.panels.length-1));
  }catch{roleData=null;roleError='Role view unavailable. Activity and native tools continue normally.';}finally{roleLoading=false;redraw($);}
};
const roleRows=($,e)=>{
  const {Box,Text,Button}=$.ui.resolve(e),rows=[];
  if(roleLoading)rows.push(Text({color:'cyan',children:['◌ Refreshing role workspace…']}));
  if(roleError)rows.push(Text({color:'yellow',children:[roleError]}));
  const panels=roleData?.panels||[],panel=panels[roleIndex];
  if(!panel)rows.push(Text({dimColor:true,children:[roleData?.eligible?.reason||'Choose role packs in HeloScrum → agent settings. Off, Manual and Jev Auto are available.']}));
  else{
    rows.push(Text({bold:true,children:[String(roleIndex+1)+' / '+panels.length+' · '+panel.name]}));
    if(panels.length>1)rows.push(Box({flexDirection:'row',columnGap:2,children:[
      Button({key:'previous-role',label:'Previous role',plain:true,hotkey:'5',onPress:()=>{roleIndex=(roleIndex+panels.length-1)%panels.length;showRoleGuide=false;redraw($);}}),
      Button({key:'next-role',label:'Next role',plain:true,hotkey:'6',onPress:()=>{roleIndex=(roleIndex+1)%panels.length;showRoleGuide=false;redraw($);}})
    ]}));
    rows.push(Text({bold:true,color:'cyan',children:['◈ '+panel.eyebrow]}));
    rows.push(Box({flexDirection:'row',columnGap:2,children:panel.metrics.map(m=>Box({flexDirection:'column',children:[Text({bold:true,color:'cyan',children:[String(m.value)]}),Text({dimColor:true,children:[m.label]})]}))}));
    if(showRoleGuide){for(const [i,text] of panel.guide.entries())rows.push(Text({children:[String(i+1)+'. '+text]}));}
    else for(const section of panel.sections){
      rows.push(Text({bold:true,children:[section.title+' · '+section.total]}));
      if(!section.items.length)rows.push(Text({dimColor:true,children:[section.empty]}));
      for(const item of section.items.slice(0,3)){
        rows.push(Text({color:item.eligible===false?'yellow':undefined,bold:true,children:[item.title]}));
        rows.push(Text({dimColor:true,children:[item.label+(item.source?.revision!==undefined?' · r'+item.source.revision:'')]}));
        rows.push(Text({children:[String(item.text||'No evidence recorded.').slice(0,230)]}));
      }
      if(section.total>3)rows.push(Text({dimColor:true,children:['Showing up to 3 records. Open the web workspace for more.']}));
    }
    rows.push(Text({dimColor:true,children:[panel.sources.map(p=>p.title+' · r'+p.revision).join(' / ')||'No active shared plan']}));
    rows.push(Button({key:'role-guide',label:showRoleGuide?'Show evidence':'Role guide',plain:true,onPress:()=>{showRoleGuide=!showRoleGuide;redraw($);}}));
  }
  rows.push(Button({key:'refresh-roles',label:'Refresh roles',plain:true,onPress:()=>loadRoles($,true)}));
  rows.push(Text({dimColor:true,children:['Read-only views. Review authority stays on the board.']}));
  return rows;
};

export function register(on) {
  on('session.start',async ($,e,next)=>{
    sessionId=await $.session.id();interactive=e.isInteractive!==false;
    await $.command.register({name:'heloscrum-status',description:'Check the HeloScrum activity bridge without a model call'});
    await $.command.register({name:'heloscrum',description:'Open the HeloScrum activity, context and role workspaces'});
    enqueue({id:'bridge',sequence:Date.now(),kind:'session',status:'connected',name:'Activity bridge connected'});
    await measure($,'context-initial');
    await loadRoles($,true);
    timer=$.clock.every(1000,()=>flush($));
    return next(e);
  });
  on('command.run',{command:'heloscrum-status'},async $=>{
    await measure($,'context-status');await flush($);
    return {text:lastError||`HeloScrum activity bridge connected. Last delivery: ${lastDelivered||'waiting'}. ${pending.length} reports pending.`};
  });
  on('tool.call',async ($,e,next)=>{
    if(e.agentId||e.tool?.startsWith('mcp__heloscrum__')||!e.tool_use_id)return next(e);
    const started=Date.now(),{tool,tool_use_id,agentId,...input}=e;
    enqueue({id:tool_use_id,sequence:0,kind:'tool',status:'running',name:tool,input:clip(JSON.stringify(input,null,2))});
    redraw($);
    // next is invoked exactly once. A bridge failure must not rerun a tool.
    try{const result=await next(e);
      enqueue({id:tool_use_id,sequence:1,kind:'tool',status:result.deny?'denied':result.isError?'failed':'completed',name:tool,input:clip(JSON.stringify(input,null,2)),output:clip(result.deny||result.text||''),durationMs:Date.now()-started});
      redraw($);return result;
    }catch(error){enqueue({id:tool_use_id,sequence:1,kind:'tool',status:'failed',name:tool,durationMs:Date.now()-started});redraw($);throw error;}
  });
  on('command.run',{command:'heloscrum'},async ($,e)=>{
    if(!interactive)return {text:'The HeloScrum visual panel needs an interactive Claude session. Live cards are also available in HeloScrum Chat.'};
    await measure($,'context-panel');
    await loadRoles($);
    await $.ui.open({id:PANE,title:'HeloScrum',focus:true,closeOnEscape:true,rows:18,columns:48});
    return {};
  });
  on('ui.render',{component:'Pane'},async ($,e,next)=>{
    if(e.requestId!==PANE)return next(e);
    const {Box,Text,Button}=$.ui.resolve(e);
    const tabs=['activity','changes','context','roles'].map((name,index)=>Button({key:'tab-'+name,label:name[0].toUpperCase()+name.slice(1),hotkey:String(index+1),plain:true,dimColor:paneTab!==name,onPress:()=>{paneTab=name;redraw($);}}));
    const rows=[];
    if(paneTab==='roles'){rows.push(...roleRows($,e));}
    else if(paneTab==='context'){
      const known=Number.isFinite(lastContext.percent),percent=known?lastContext.percent:0,used=Math.round(percent/100*24);
      rows.push(Text({bold:true,color:'cyan',children:[known?Math.round(percent)+'% of context used':'Waiting for request usage']}));
      rows.push(Text({color:'cyan',children:[known?'▰'.repeat(used)+'▱'.repeat(24-used):'· '.repeat(12)]}));
      rows.push(Text({children:[Number.isFinite(lastContext.tokens)?lastContext.tokens.toLocaleString()+' tokens used':'Claude has not reported a token count yet.']}));
      if(lastContext.window)rows.push(Text({dimColor:true,children:[lastContext.window.toLocaleString()+' token capacity']}));
      rows.push(Text({dimColor:true,children:['Latest request measurement, not a billing total.']}));
    }else{
      const selected=recent.filter(item=>paneTab==='activity'||/^(Edit|Write)$/.test(item.name)).slice(-7).reverse();
      rows.push(Text({bold:true,children:[paneTab==='changes'?'Recent file changes':'Recent tool activity']}));
      if(!selected.length)rows.push(Text({dimColor:true,children:[paneTab==='changes'?'Edits and written files will appear here.':'Tool calls will appear as Claude works.']}));
      for(const item of selected){
        const mark=item.status==='running'?'◌':item.status==='completed'?'✓':'!';
        rows.push(Box({flexDirection:'row',columnGap:1,children:[Text({color:item.status==='completed'?'green':item.status==='running'?'cyan':'red',children:[mark]}),Text({wrap:'truncate-end',children:[labelOf(item)]})]}));
        rows.push(Text({dimColor:true,children:['  '+item.name+' · '+item.status+(Number.isFinite(item.durationMs)?' · '+(item.durationMs/1000).toFixed(1)+'s':'')]}));
      }
    }
    return Box({flexDirection:'column',rowGap:1,paddingX:1,children:[
      Box({flexDirection:'row',columnGap:1,children:[Text({color:'cyan',bold:true,children:['◈ HELOSCRUM']}),Text({dimColor:true,children:['/ Claude activity']})]}),
      Box({flexDirection:'row',columnGap:2,children:tabs}),
      Box({flexDirection:'column',rowGap:0,children:rows}),
      Text({dimColor:true,children:[lastError?'Delivery paused · native work continues':pending.length?pending.length+' activity reports queued':lastDelivered?'Activity delivered to HeloScrum':'Awaiting first delivery']}),
      Box({flexDirection:'row',columnGap:2,children:[Button({key:'pin-band',label:pinBand?'Unpin status strip':'Pin status strip',plain:true,onPress:()=>{pinBand=!pinBand;redraw($);}}),Button({key:'close-panel',label:'Close',plain:true,onPress:async()=>{await $.ui.close({id:PANE});}})]})
    ]});
  });
  on('ui.render',{component:'AbovePrompt'},async ($,e,next)=>{
    if(!pinBand||e.props.hasSurvey||e.props.view?.agentId)return next(e);
    const {Box,Text,Button}=$.ui.resolve(e),active=recent.findLast(item=>item.status==='running');
    return Box({flexDirection:'row',columnGap:2,children:[
      Text({color:'cyan',children:['◈ '+(active?'Working':'HeloScrum')]}),
      Text({dimColor:true,wrap:'truncate-end',children:[active?labelOf(active):Number.isFinite(lastContext.percent)?Math.round(lastContext.percent)+'% context used':'Activity ready']}),
      Button({key:'open-panel',label:'Details',plain:true,onPress:async()=>{await $.ui.open({id:PANE,title:'HeloScrum',focus:true,closeOnEscape:true,rows:18,columns:48});}})
    ]});
  });
  on('turn.complete',async ($,e,next)=>{
    if(!e.agentId){await measure($,'context:'+e.turnId);await loadRoles($,true);}
    return next(e);
  });
}
