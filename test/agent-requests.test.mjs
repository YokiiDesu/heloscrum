import test from 'node:test';
import assert from 'node:assert/strict';
import {agentRequest,nativePromptReady,requestFingerprint} from '../lib/agent-requests.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';
import {fingerprint} from '../lib/patch.mjs';
import {HerdrAdapter} from '../lib/adapters.mjs';

const menu=(selected=1,tool='send_message')=>`Earlier conversation\n  Field 1/1\n  Allow the heloscrum MCP server to run tool "${tool}"?\n\n  to: QA\n  message: Review these results\n\n${['Allow','Allow for this session','Always allow','Cancel'].map((label,i)=>`  ${selected===i+1?'›':' '} ${i+1}. ${label}  ${['Run the tool and continue.','Remember this choice for this session.','Remember this choice for future calls.','Cancel this tool call'][i]}`).join('\n')}\n  enter to submit | esc to cancel\n`;
function fixture(){const plane=new ControlPlane('/project');let selected=1,tool='send_message',working=false;const keys=[];plane.data.tasks=[{id:'task',project:'/project',pane:'pane',kind:'codex',phase:'launched',title:'QA'}];plane.herdr={list:async()=>[{pane_id:'pane',agent_status:working?'working':'blocked'}],read:async()=>menu(selected,tool),key:async(_,key)=>{keys.push(key);if(key==='down')selected++;if(key==='up')selected--;}};plane.record=async()=>{};return {plane,keys,setTool:value=>tool=value,setWorking:value=>working=value};}

test('permission menus expose exact choices and a stable identity independent of selection',()=>{
 const request=agentRequest(menu());assert.equal(request.type,'tool-approval');assert.equal(request.options[0].selected,true);assert.equal(request.options[1].label,'Allow for this session');assert(!request.details.includes('Earlier conversation'));
 assert.equal(request.identity,agentRequest(menu(2)).identity);assert.notEqual(request.identity,agentRequest(menu(1,'invoke_tool')).identity);
 assert.equal(agentRequest(menu()+'\nAgent is now working').type,'provider-request');assert.equal(agentRequest(menu().replace('Always allow','Unexpected choice')).type,'provider-request');
 assert.equal(agentRequest('A numbered list:\n1. Allow\n2. Cancel').type,'provider-request');
});
test('Kiro V3 migration setup holds the original prompt until the user resolves the current menu',async()=>{
 const menu="You're on Kiro 3.0 — thanks for giving it a try.\nYour agent configs are still in the 2.0 format. Upgrade them to run on 3.0? They'll keep working in 2.0.\n❯ Enable auto-upgrade\n  Not now — I'll do it later\n";
 const request=agentRequest(menu);assert.equal(request.currentSetupMenu,true);assert.deepEqual(request.options.map(x=>x.label),['Enable auto-upgrade',"Not now — I'll do it later"]);
 assert.equal(agentRequest(menu+'Ready to chat\n').currentSetupMenu,undefined,'Old setup text must not block a ready terminal');
 const h=new HerdrAdapter('herdr','/project');let starts=0;h.json=async()=>{starts++;return {ok:true};};h.read=async()=>menu;
 await assert.rejects(h.startAgent('agent','kiro','pane',['chat','--v3']),{code:'agent_not_ready'});assert.equal(starts,1,'Do not retry or send input into setup');
 const {plane,keys}=fixture();plane.data.tasks[0].kind='kiro';plane.herdr.list=async()=>[{pane_id:'pane',agent_status:'idle'}];plane.herdr.read=async()=>menu;
 assert.equal((await plane.taskRequest('task')).pending,true);assert.deepEqual(keys,[]);
 h.json=async()=>({agents:[{agent:'kiro',pane_id:'pane',agent_status:'idle',interactive_ready:true}]});assert.equal((await h.list())[0].interactive_ready,false);
});
test('Kiro V3 approvals expose native scope and do not mistake completed menus for current requests',()=>{
 const menu='work_brief requires approval\nmcp → heloscrum/work_brief\n❯ Allow\n  Always allow\n  Deny\n  Always deny\n────────────────────\nesc to close · ↑↓ to navigate · ↵ to select · Tab to edit\n';
 const request=agentRequest(menu);assert.equal(request.type,'tool-approval');assert.deepEqual(request.options.map(o=>o.label),['Allow','Always allow','Deny','Always deny']);
 assert.equal(request.identity,agentRequest(menu.replace('❯ Allow','  Allow').replace('  Deny','❯ Deny')).identity);
 assert.equal(agentRequest(menu+'Tool finished\n').currentTrustMenu,undefined);
 assert.equal(agentRequest(menu.replace('Always deny','Unknown choice')).currentTrustMenu,undefined);
});
test('Cursor workspace trust keeps startup queued and sends only the explicitly reviewed shortcut',async()=>{
 const menu="╭─────────────────────────╮\n│ ⚠ Workspace Trust Required │\n│ Cursor Agent can execute code and access files in this directory. │\n│ This will also enable the MCP servers configured for this workspace. │\n│ Do you trust the contents of this directory? │\n│ /isolated/worktree │\n│ ▶ [a] Trust this workspace │\n│ [w] Trust this workspace, but don't enable all MCP servers │\n│ [q] Quit │\n╰─────────────────────────╯\n";
 const request=agentRequest(menu);assert.equal(request.currentSetupMenu,true);assert.deepEqual(request.options.map(o=>o.key),['a','w','q']);
 assert.equal(agentRequest(menu+'Cursor Agent\n→ Plan, search, build anything\n').currentSetupMenu,undefined);
 const h=new HerdrAdapter('herdr','/project');h.json=async()=>({ok:true});h.read=async()=>menu;
 await assert.rejects(h.startAgent('agent','cursor','pane',[]),{code:'agent_not_ready'});
 const {plane,keys}=fixture();plane.data.tasks[0].kind='cursor';plane.data.tasks[0].nativeSetup={cursorMode:'interactive'};plane.herdr.list=async()=>[{pane_id:'pane',agent_status:'idle'}];plane.herdr.read=async()=>menu;
 const current=await plane.taskRequest('task');assert.equal(current.pending,true);assert.deepEqual(keys,[]);
 await plane.chooseTaskResponse('task','2',current.fingerprint);assert.deepEqual(keys,['w'],'Do not implicitly approve MCP servers');
 await assert.rejects(plane.chooseTaskResponse('task','1',current.fingerprint),/already sent/);assert.deepEqual(keys,['w']);
 const mcp=menu.replace('Workspace Trust Required','MCP Server Approval Required').replace('Do you trust the contents of this directory?','The following MCP servers need to be approved:').replace('[a] Trust this workspace','[a] Approve all servers').replace("[w] Trust this workspace, but don't enable all MCP servers",'[c] Continue without approval');
 assert.equal(agentRequest(mcp).title,'Cursor MCP approval');assert.deepEqual(agentRequest(mcp).options.map(o=>o.key),['a','c','q']);
 plane.herdr.read=async()=>mcp;await plane.chooseTaskResponse('task','2',fingerprint(mcp));assert.deepEqual(keys,['w','c']);
});
test('native startup waits through the initial paint before a trust screen or an empty composer',async()=>{
 assert.equal(nativePromptReady('cursor','cursor-agent --resume id'),false);
 assert.equal(nativePromptReady('cursor','→ Plan, search, build anything\nAuto\n/project'),true);
 assert.equal(nativePromptReady('cursor','→ Add a follow-up\nAuto\n/project'),true);
 assert.equal(nativePromptReady('cursor','→ user is editing\nAuto\n/project'),false);
 assert.equal(nativePromptReady('kiro','› ask a question or describe a task ↵\n/sessions to resume · /copy to clipboard'),true);
 const h=new HerdrAdapter('herdr','/project');let reads=0,waits=0;h.json=async()=>({ok:true});h.waitForShell=async()=>waits++;
 h.read=async()=>++reads<3?'Starting Cursor Agent…':'→ Plan, search, build anything\nAuto\n/project';
 await h.startAgent('agent','cursor','pane',[]);assert.equal(reads,3);assert.equal(waits,2);
 const {plane}=fixture();plane.data.tasks[0].kind='cursor';plane.data.tasks[0].nativeSetup={cursorMode:'interactive'};plane.herdr.read=async()=> 'Starting Cursor Agent…';
 await assert.rejects(plane.submitInitialPrompt(plane.data.tasks[0]),{code:'agent_not_ready'});assert.equal(plane.data.tasks[0].promptAttemptedAt,undefined,'A queued startup must remain safe to dispatch after setup');
});
test('Kiro trust submenu remains visible when the provider reports idle, without accepting stale menus',async()=>{
 const trust='read requires approval · trust options\n ❯ Specific paths        /project/QA.md\n   Complete directory    /project\n   Entire tool\n────────────────────────\n esc to close · ↑↓ to navigate · ↵ to select · Tab to edit\n';
 const {plane,keys}=fixture();plane.data.tasks[0].kind='kiro';plane.herdr.list=async()=>[{pane_id:'pane',agent_status:'done'}];let output=trust;plane.herdr.read=async()=>output;
 const request=await plane.taskRequest('task');assert.equal(request.pending,true);assert.equal(request.request.currentTrustMenu,true);assert.deepEqual(keys,[]);
 const adapter=new HerdrAdapter('herdr','/project');adapter.json=async()=>({agents:[{agent:'kiro',pane_id:'pane',agent_status:'done',interactive_ready:true}]});adapter.read=async()=>output;
 assert.deepEqual((await adapter.list()).map(a=>[a.agent_status,a.interactive_ready]),[['blocked',false]],'Do not deliver queued prompts into a permission submenu');
 await plane.respondTask('task','enter',request.fingerprint);assert.deepEqual(keys,['enter']);
 output=trust+'Tool completed.\n';assert.equal((await plane.taskRequest('task')).pending,false);
 assert.equal((await adapter.list())[0].agent_status,'done');
 output=trust.replace('Entire tool','Unknown option');assert.equal((await plane.taskRequest('task')).pending,false);
 adapter.read=async()=>{throw Error('Pane changed');};assert.equal((await adapter.list())[0].interactive_ready,false,'An unavailable terminal must not receive queued messages');
 output=trust;plane.herdr.list=async()=>[{pane_id:'pane',agent_status:'working'}];assert.equal((await plane.taskRequest('task')).pending,false);
 await assert.rejects(plane.respondTask('task','enter',request.fingerprint),/Interrupt the agent/);
});
test('clicking session approval navigates and verifies the exact option before Enter',async()=>{
 const {plane,keys}=fixture();const current=await plane.taskRequest('task');await plane.chooseTaskResponse('task','2',current.fingerprint);assert.deepEqual(keys,['down','enter']);
 const repeated=await plane.taskRequest('task');await assert.rejects(plane.chooseTaskResponse('task','2',repeated.fingerprint),/already sent/);assert.deepEqual(keys,['down','enter']);
});
test('changed, unknown, and already working requests never receive a confirmation',async()=>{
 const {plane,keys,setTool,setWorking}=fixture(),current=await plane.taskRequest('task');
 setTool('invoke_tool');await assert.rejects(plane.chooseTaskResponse('task','3',current.fingerprint),/request changed/);assert.deepEqual(keys,[]);
 const fresh=await plane.taskRequest('task');await assert.rejects(plane.chooseTaskResponse('task','9',fresh.fingerprint),/not available/);assert.deepEqual(keys,[]);
 setWorking(true);await assert.rejects(plane.chooseTaskResponse('task','1',fresh.fingerprint),/request changed/);assert.deepEqual(keys,[]);
});
test('a new request arriving while selection moves aborts before Enter',async()=>{
 const {plane,keys,setTool}=fixture();const key=plane.herdr.key;plane.herdr.key=async(...args)=>{await key(...args);setTool('invoke_tool');};
 await assert.rejects(plane.chooseTaskResponse('task','2',fingerprint(menu())),/request changed/);assert.deepEqual(keys,['down']);
});
test('concurrent menu responses cannot move or confirm each other’s selection',async()=>{
 const {plane,keys}=fixture();let release;const gate=new Promise(resolve=>release=resolve),key=plane.herdr.key;plane.herdr.key=async(...args)=>{await gate;await key(...args);};
 const response=plane.chooseTaskResponse('task','2',fingerprint(menu()));
 await assert.rejects(plane.chooseTaskResponse('task','3',fingerprint(menu())),/already being sent/);
 await assert.rejects(plane.respondTask('task','enter',fingerprint(menu())),/already being sent/);
 release();await response;assert.deepEqual(keys,['down','enter']);
});


const cursorMenu=({tool='work_update_task',args='{"status":"in_progress"}',count='Approval 1 of 2',prefix='Earlier output',footer='ctrl+r to review changed files'}={})=>`${prefix}\n────────────────────────\n${count}\nheloscrum: ${tool}\n${args}\n\nRun this MCP tool?\n → Run (once) (y)\n   Allowlist MCP Tool (tab)\n   Reject & propose changes (p)\n   Skip (esc or n)\n\n←/→ to switch approval\n${footer}\n`;
test('Cursor stacked approvals expose their exact target, arguments, native keys and pending position',()=>{
 const output=cursorMenu(),request=agentRequest(output);
 assert.equal(request.type,'tool-approval');assert.deepEqual(request.queue,{position:1,total:2});
 assert.deepEqual(request.tool,{server:'heloscrum',name:'work_update_task',arguments:'{\n  "status": "in_progress"\n}'});
 assert.deepEqual(request.options.map(o=>o.key),['y','tab','p','n']);
 const advanced=agentRequest(cursorMenu({count:'Approval 1 of 1'}));assert.notEqual(request.identity,advanced.identity);assert.equal(advanced.queue.total,1);
 const changedScroll=cursorMenu({prefix:'Edited another file +200'});
 assert.equal(requestFingerprint(request,output),requestFingerprint(agentRequest(changedScroll),changedScroll));
 for(const changed of [cursorMenu({args:'{"status":"done"}'}),cursorMenu({tool:'delete_file'}),output+'Ready\n',output.replace('Allowlist MCP Tool','New permission option')])assert.notEqual(requestFingerprint(request,output),requestFingerprint(agentRequest(changed),changed));
 assert.equal(agentRequest(cursorMenu({count:''})).queue,null,'Do not invent a queue total');
});
test('Cursor approvals survive unrelated terminal updates, but a changed queued request is rejected',async()=>{
 const {plane,keys}=fixture();plane.data.tasks[0].kind='cursor';plane.data.tasks[0].nativeSetup={cursorMode:'interactive'};
 let output=cursorMenu();plane.herdr.read=async()=>output;
 const first=await plane.taskRequest('task');output=cursorMenu({prefix:'More file changes'});
 await plane.chooseTaskResponse('task','1',first.fingerprint);assert.deepEqual(keys,['y']);
 await assert.rejects(plane.chooseTaskResponse('task','1',(await plane.taskRequest('task')).fingerprint),/already sent/);
 output=cursorMenu({tool:'notebook_write',args:'{"text":"Checkpoint"}',count:'Approval 1 of 1'});
 await assert.rejects(plane.chooseTaskResponse('task','1',first.fingerprint),/already sent|request changed/);
 const second=await plane.taskRequest('task');await plane.chooseTaskResponse('task','1',second.fingerprint);assert.deepEqual(keys,['y','y']);
});
test('a failed provider key send remains retryable and is never recorded as a granted permission',async()=>{
 const {plane,keys}=fixture(),current=await plane.taskRequest('task'),key=plane.herdr.key;let fail=true;
 plane.herdr.key=async(...args)=>{if(fail){fail=false;throw Error('Terminal disconnected');}return key(...args);};
 await assert.rejects(plane.chooseTaskResponse('task','1',current.fingerprint),/Terminal disconnected/);
 assert.deepEqual(keys,[]);await plane.chooseTaskResponse('task','1',current.fingerprint);assert.deepEqual(keys,['enter']);
});
test('Kiro V3 second-stage trust menus preserve exact tool and scope, and keep idle agents blocked',async()=>{
 const output='invoke_tool requires approval · trust [session] (s to cycle)\nmcp → heloscrum/invoke_tool\n ❯ Trust "heloscrum/invoke_tool"       exact match · session\n   Trust entire tool (invoke_tool)    session\n────────────────────────\nesc to close · ↑↓ to navigate · ↵ to select · Tab to edit\n';
 const request=agentRequest(output);assert.equal(request.currentTrustMenu,true);assert.equal(request.scope,'session');assert.equal(request.tool.name,'invoke_tool');assert.equal(request.tool.arguments,null);
 assert.match(request.options[0].label,/exact match · session/);assert.notEqual(request.identity,agentRequest(output.replaceAll('session','global')).identity);
 assert.equal(agentRequest(output+'Done\n').currentTrustMenu,undefined);
 const {plane,keys}=fixture();plane.data.tasks[0].kind='kiro';plane.herdr.list=async()=>[{pane_id:'pane',agent_status:'idle'}];plane.herdr.read=async()=>output;
 const pending=await plane.taskRequest('task');assert.equal(pending.pending,true);await plane.chooseTaskResponse('task','1',pending.fingerprint);assert.deepEqual(keys,['enter']);
});
test('native shortcut adapter passes reviewed Cursor permission keys verbatim',async()=>{
 const adapter=new HerdrAdapter('herdr','/project'),sent=[];adapter.json=async args=>sent.push(args);
 for(const key of ['y','n','p','tab'])await adapter.key('pane',key);
 assert.deepEqual(sent.map(args=>args.at(-1)),['y','n','p','tab']);await assert.rejects(adapter.key('pane','trust-all'),/Unsupported/);
});

test('concurrent fallback keys cannot submit the same native prompt twice',async()=>{
 const {plane,keys}=fixture(),expected=fingerprint(menu());let release;const gate=new Promise(resolve=>release=resolve),key=plane.herdr.key;plane.herdr.key=async(...args)=>{await gate;return key(...args);};
 const first=plane.respondTask('task','enter',expected);await assert.rejects(plane.respondTask('task','enter',expected),/already being sent/);release();await first;assert.deepEqual(keys,['enter']);
});


test('Kiro descriptive shell approvals expose only the current command and preserve indented MCP metadata',()=>{
 const output='Old conversation\n Compute SHA-256 of candidate module requires approval\n shell → shasum -a 256\n /project/queue-summary.mjs\n ❯ Allow\n   Always allow\n   Deny\n   Always deny\n────────────────────────\n esc to close · ↑↓ to navigate · ↵ to select · Tab to edit\n';
 const request=agentRequest(output);
 assert.equal(request.type,'tool-approval');assert.equal(request.options.length,4);
 assert.deepEqual(request.tool,{name:'shell',arguments:'shasum -a 256\n /project/queue-summary.mjs'});
 assert(!request.details.includes('Old conversation'));
 const wrapped=output.replace('shell → shasum -a 256\n /project/queue-summary.mjs','fs_read →\n /project/queue-summary.mjs');
 assert.deepEqual(agentRequest(wrapped).tool,{name:'fs_read',arguments:'/project/queue-summary.mjs'});
 assert.equal(agentRequest(output+'Command completed\n').currentTrustMenu,undefined);
 assert.equal(agentRequest(output.replace('Always deny','Unexpected choice')).currentTrustMenu,undefined);
 const mcp=output.replace('shell → shasum -a 256\n /project/queue-summary.mjs','mcp → heloscrum/work_brief');
 assert.deepEqual(agentRequest(mcp).tool,{server:'heloscrum',name:'work_brief',arguments:null});
});


const shellMenu=({selected=1,command='node scripts/check.mjs',prefix='Earlier tool output'}={})=>`${prefix}
  Would you like to run the following command?

  Environment: local
  Reason: Inspect the actual board.

  $ ${command}

${selected===1?'›':' '} 1. Yes, proceed (y)
${selected===2?'›':' '} 2. Yes, and don't ask again for commands that start with \`node
     scripts/check.mjs\` (p)
${selected===3?'›':' '} 3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
`;
test('Codex shell prompts retain their command and exact choices with a stable identity',()=>{
 const output=shellMenu(),request=agentRequest(output);
 assert.equal(request.type,'tool-approval');assert.deepEqual(request.tool,{name:'shell',arguments:'node scripts/check.mjs'});
 assert.deepEqual(request.options.map(o=>o.id),['1','2','3']);assert.equal(request.options[0].selected,true);
 assert.match(request.options[1].label,/don't ask again.*`node scripts\/check.mjs` \(p\)/);
 assert(!request.details.includes('Earlier tool output'));assert.equal(request.queue,undefined);
 const changedScroll=shellMenu({prefix:'Another hundred lines of unrelated output'});
 assert.equal(request.identity,agentRequest(changedScroll).identity);
 assert.equal(requestFingerprint(request,output),requestFingerprint(agentRequest(changedScroll),changedScroll));
 const selection=shellMenu({selected:2});assert.equal(request.identity,agentRequest(selection).identity);
 assert.notEqual(requestFingerprint(request,output),requestFingerprint(agentRequest(selection),selection));
 assert.notEqual(request.identity,agentRequest(shellMenu({command:'node scripts/other.mjs'})).identity);
 for(const stale of [output+'Command completed\n',output.replace('Yes, proceed (y)','Yes, allow everything'),output.replace('3. No, and tell Codex what to do differently (esc)','3. Unknown choice'),output.replace('Press enter to confirm or esc to cancel','Loading...')])assert.equal(agentRequest(stale).type,'provider-request');
});
test('Codex shell decisions confirm only the chosen native option and reject duplicate or stale requests',async()=>{
 const {plane,keys}=fixture();let selected=1,command='node scripts/check.mjs';
 plane.herdr.read=async()=>shellMenu({selected,command});
 plane.herdr.key=async(_,key)=>{keys.push(key);if(key==='down')selected++;if(key==='up')selected--;};
 const first=await plane.taskRequest('task');await plane.chooseTaskResponse('task','3',first.fingerprint);
 assert.deepEqual(keys,['down','down','enter']);
 await assert.rejects(plane.chooseTaskResponse('task','3',(await plane.taskRequest('task')).fingerprint),/already sent/);
 selected=1;command='node scripts/next.mjs';
 await assert.rejects(plane.chooseTaskResponse('task','1',first.fingerprint),/already sent|request changed/);
 const next=await plane.taskRequest('task');await plane.chooseTaskResponse('task','1',next.fingerprint);
 assert.deepEqual(keys,['down','down','enter','enter']);
});
