import {expect,mock,test} from 'claude-code/testing';

const pane={plugin:'heloscrum-activity',component:'Pane',requestId:'heloscrum-activity',viewport:{columns:100,rows:40},props:{title:'HeloScrum',isFocused:true,bodyColumns:48,placement:'inline',scroll:{offset:0,bodyRows:24},view:{}}} as const;
const band={plugin:'heloscrum-activity',component:'AbovePrompt',viewport:{columns:100,rows:40},props:{hasSurvey:false,isWorking:false,maxRows:4,bodyColumns:100,scroll:{offset:0,bodyRows:4},view:{}}} as const;

test('visual panel tabs, pinning and close work on terminal and Desktop',async($,on)=>{
  mock.clock(on);
  let opened=0,closed=0;
  on('session.id',()=>({value:'current-session'}));
  on('session.usage',()=>({value:{context:{window:200000,tokens:48000,percent:24}}}));
  on('command.register',()=>({value:undefined}));
  on('session.start',()=>({cwd:'/work'}));
  on('ui.open',()=>{opened++;return {value:{isPlaced:true}};});
  on('ui.close',()=>{closed++;return {value:undefined};});
  on('ui.render',()=>({type:'Text',props:{},children:['Native UI']}));
  on('tool.call',()=>({result:'updated',text:'updated'}));
  await $.session.start({cwd:'/work',surface:'terminal',isInteractive:true});
  await $.tool.call({tool:'Edit',tool_use_id:'edit-1',file_path:'/work/example.md',old_string:'before',new_string:'after'});
  await $.command.run({command:'heloscrum',args:''});
  expect(opened).toBe(1);
  for(const surface of ['terminal','desktop'] as const){
    const ui=await $.ui.mount({...pane,surface});
    await ui.press({key:'tab-changes'});
    expect(await ui.find({type:'Text',text:'/work/example.md'})).toBeDefined();
    await ui.press({key:'tab-context'});
    expect(await ui.find({type:'Text',text:'24% of context used'})).toBeDefined();
    await ui.press({key:'pin-band'});
    const strip=await $.ui.mount({...band,surface});
    expect(await strip.find({key:'open-panel'})).toBeDefined();
    await ui.press({key:'pin-band'});
    await strip.unmount();
    await ui.press({key:'close-panel'});
    await ui.unmount();
  }
  expect(closed).toBe(2);
});

test('unknown context never appears as an empty measured window and the strip leaves native UI alone',async($,on)=>{
  on('ui.render',()=>({type:'Text',props:{},children:['Native UI']}));
  const ui=await $.ui.mount({...pane,surface:'terminal'});
  await ui.press({key:'tab-context'});
  expect(await ui.find({type:'Text',text:'Waiting for request usage'})).toBeDefined();
  expect(await ui.find({type:'Text',text:'0% of context used'})).toBeUndefined();
  const strip=await $.ui.mount({...band,surface:'terminal'});
  expect(await strip.find({type:'Text',text:'Native UI'})).toBeDefined();
  await strip.unmount();await ui.unmount();
});

test('native role views show sourced evidence and guides without granting review authority',async($,on)=>{
  mock.clock(on);
  on('session.id',()=>({value:'current-session'}));
  on('session.usage',()=>({value:{context:{}}}));
  on('command.register',()=>({value:undefined}));
  on('session.start',()=>({cwd:'/work'}));
  on('ui.render',()=>({type:'Text',props:{},children:['Native UI']}));
  on('mcp.call',()=>({value:{content:[{type:'text',text:JSON.stringify({schemaVersion:1,panels:[{id:'qa-reviewer',name:'QA / Independent Reviewer',eyebrow:'Evidence before acceptance',metrics:[{label:'Eligible for you',value:0}],sections:[{title:'Review eligibility',total:1,items:[{title:'Candidate UI',text:'Independent reviewer required',label:'Review unavailable',eligible:false,source:{revision:4}}]}],guide:['Do not self-approve.'],sources:[{title:'Demo plan',revision:4}]}]})}]}}));
  await $.session.start({cwd:'/work',surface:'terminal',isInteractive:true});
  for(const surface of ['terminal','desktop'] as const){
    const ui=await $.ui.mount({...pane,surface});
    await ui.press({key:'tab-roles'});
    expect(await ui.find({type:'Text',text:'Candidate UI'})).toBeDefined();
    expect(await ui.find({type:'Text',text:'Review unavailable · r4'})).toBeDefined();
    expect(await ui.find({type:'Text',text:'Independent reviewer required'})).toBeDefined();
    await ui.press({key:'role-guide'});
    expect(await ui.find({type:'Text',text:'1. Do not self-approve.'})).toBeDefined();
    await ui.press({key:'role-guide'});
    await ui.unmount();
  }
});

test('all eight native roles remain reachable and large views read past eight pages',async($,on)=>{
  mock.clock(on);
  on('session.id',()=>({value:'current-session'}));
  on('session.usage',()=>({value:{context:{}}}));
  on('command.register',()=>({value:undefined}));
  on('session.start',()=>({cwd:'/work'}));
  on('ui.render',()=>({type:'Text',props:{},children:['Native UI']}));
  const names=['Orchestration','Scrum Master','UI / UX Design','Game Design','QA / Independent Reviewer','Data Architect','DevSecOps','Knowledge Manager'];
  const text=JSON.stringify({schemaVersion:1,panels:names.map((name,i)=>({id:'pack-'+i,name,eyebrow:'Evidence '+i,metrics:[],sections:[],guide:['Guide '+i],sources:[]})),padding:'x'.repeat(72000)});
  let pages=0,broken=false;
  on('mcp.call',(_$,e)=>{
    if(e.tool!=='context_read')return {value:{content:[{type:'text',text:JSON.stringify({offloaded:true,reference:'role-view'})}]}};
    pages++;const offset=Number(e.args.offset),end=Math.min(offset+8000,text.length);
    return {value:{content:[{type:'text',text:JSON.stringify({text:text.slice(offset,end),nextOffset:broken?offset:end===text.length?null:end})}]}};
  });
  await $.session.start({cwd:'/work',surface:'terminal',isInteractive:true});
  expect(pages>8).toBe(true);
  for(const surface of ['terminal','desktop'] as const){
    const ui=await $.ui.mount({...pane,surface});await ui.press({key:'tab-roles'});
    for(let i=0;i<names.length;i++){
      expect(await ui.find({type:'Text',text:(i+1)+' / 8 · '+names[i]})).toBeDefined();
      await ui.press({key:'role-guide'});expect(await ui.find({type:'Text',text:'1. Guide '+i})).toBeDefined();
      await ui.press({key:'next-role'});
    }
    expect(await ui.find({type:'Text',text:'1 / 8 · Orchestration'})).toBeDefined();
    await ui.press({key:'previous-role'});expect(await ui.find({type:'Text',text:'8 / 8 · Knowledge Manager'})).toBeDefined();
    await ui.press({key:'next-role'});await ui.unmount();
  }
  broken=true;pages=0;
  const ui=await $.ui.mount({...pane,surface:'terminal'});await ui.press({key:'tab-roles'});await ui.press({key:'refresh-roles'});
  expect(pages).toBe(1);
  expect(await ui.find({type:'Text',text:'Role view unavailable. Activity and native tools continue normally.'})).toBeDefined();
  await ui.unmount();
});
