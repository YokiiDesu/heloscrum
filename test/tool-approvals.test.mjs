import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolApprovals,approvalDefaults,approvalMode,automaticChoice,validateApprovalRules} from '../lib/tool-approvals.mjs';
import {Collaboration} from '../lib/collaboration.mjs';
import {ControlPlane} from '../lib/control-plane.mjs';

const catalog={tools:[{name:'memory_read'},{name:'memory_write'},{name:'invoke_tool'}]};
const collaboration={rawCatalog:()=>catalog,allowed:(task,name)=>!task.denied?.includes(name)};
const task=()=>({id:'a',project:'/project',path:'/project',pane:'p',kind:'kiro',phase:'launched',role:'Builder',toolPolicy:{revision:1,approvals:approvalDefaults()}});
const request=(name,server='heloscrum',extra={})=>({type:'tool-approval',identity:'request',tool:{name,...(server?{server}:{}),...extra},options:[{id:'1',label:'Allow'},{id:'2',label:'Always allow'}]});

test('toolbox approvals persist with optimistic revisions, remain agent scoped, and never enable disabled access',async()=>{
 const a=task(),b={...task(),id:'b',pane:'other'};a.prompt=b.prompt='Fixture';a.title=b.title='Fixture';let saves=0;
 const plane={root:'/project',data:{tasks:[a,b]},save:async()=>saves++};const registry=new Collaboration(plane);
 const rules=approvalDefaults();rules.shared.tools.memory_read='allow';rules.native.tools.shell='allow';
 await registry.setScope(a,{expectedRevision:1,mode:'selected',allowed:['memory_read'],approvals:rules});
 assert.equal(registry.scope(a).approvals.shared.tools.memory_read,'allow');assert.equal(approvalMode(b,'shared','memory_read'),'ask');assert(saves>0);
 assert.equal(registry.allowed(a,'memory_write'),false);
 assert.equal(automaticChoice(a,request('memory_write'),registry),null);
 await assert.rejects(registry.setScope(a,{expectedRevision:1,mode:'all',allowed:[],approvals:rules}),/changed/);
 await registry.setScope(a,{expectedRevision:2,mode:'selected',allowed:['memory_read']});
 assert.equal(approvalMode(a,'native','shell'),'allow','An access-only save preserves approval rules');
 const persisted=JSON.parse(JSON.stringify(a));assert.equal(approvalMode(persisted,'shared','memory_read'),'allow');
});
test('blanket rules accept known native prompts, ask exceptions override them, and questions never get answered',()=>{
 const a=task();assert.equal(automaticChoice(a,request('shell',null),collaboration),null);
 a.toolPolicy.approvals.native.default='allow';assert.equal(automaticChoice(a,request('shell',null),collaboration).choice,'1');
 a.toolPolicy.approvals.native.tools.shell='ask';assert.equal(automaticChoice(a,request('Bash',null),collaboration),null);
 for(const changed of [{type:'provider-request'},{identity:null},{currentSetupMenu:true},{scope:'global'},{tool:null},{options:[{id:'2',label:'Always allow'}]}])assert.equal(automaticChoice(a,{...request('fs_write',null),...changed},collaboration),null);
});
test('shared dispatcher checks the actual tool, retains access checks, and does not bypass an ask exception',()=>{
 const a=task();a.toolPolicy.approvals.shared.tools.memory_read='allow';
 assert.equal(automaticChoice(a,request('memory_read','heloscrum'),collaboration).target.name,'memory_read');
 const wrapped=request('invoke_tool','heloscrum',{arguments:JSON.stringify({name:'memory_read',input:{key:'contract'}})});
 assert.equal(automaticChoice(a,wrapped,collaboration).target.name,'memory_read');
 a.denied=['memory_read'];assert.equal(automaticChoice(a,wrapped,collaboration),null);delete a.denied;
 assert.equal(automaticChoice(a,request('invoke_tool'),collaboration),null);
 a.toolPolicy.approvals.shared.default='allow';a.toolPolicy.approvals.shared.tools.memory_write='ask';
 assert.equal(automaticChoice(a,request('invoke_tool'),collaboration),null,'Missing arguments cannot conceal an ask-only operation');
 delete a.toolPolicy.approvals.shared.tools.memory_write;assert.equal(automaticChoice(a,request('invoke_tool'),collaboration).choice,'1');
 a.denied=['memory_read'];assert.equal(automaticChoice(a,wrapped,collaboration),null,'A blanket rule does not approve a named disabled tool');delete a.denied;
 assert.equal(automaticChoice(a,request('invoke_tool','heloscrum',{arguments:JSON.stringify({name:'unknown'})}),collaboration),null);
 assert.equal(automaticChoice(a,request('not_in_catalog'),collaboration),null);
});
test('external native MCP rules remain distinct from shared and shell tools',()=>{
 const a=task();a.toolPolicy.approvals.native.tools['mcp:docs/search']='allow';
 assert.equal(automaticChoice(a,request('search','docs'),collaboration).choice,'1');
 assert.equal(automaticChoice(a,request('search','other'),collaboration),null);assert.equal(automaticChoice(a,request('shell',null),collaboration),null);
});
test('approval settings reject unknown tools and invalid modes without changing saved rules',()=>{
 const a=task(),input=approvalDefaults();input.native.tools.shell='allow';assert.equal(validateApprovalRules(input,a,catalog).native.tools.shell,'allow');
 input.shared.tools.not_a_tool='allow';assert.throws(()=>validateApprovalRules(input,a,catalog),/Unknown/);delete input.shared.tools.not_a_tool;
 input.native.default='bypass';assert.throws(()=>validateApprovalRules(input,a,catalog),/Choose/);assert.equal(approvalMode(a,'native','shell'),'ask');
});
test('background approval uses the exact fingerprint and stops when the saved policy changes before sending',async()=>{
 const a=task();a.toolPolicy.approvals.native.tools.shell='allow';const sent=[],events=[];
 const plane={data:{tasks:[a]},collaboration,taskRequest:async()=>({pending:true,fingerprint:'exact',request:request('shell',null)}),chooseTaskResponse:async(id,choice,expected,project,guard)=>{guard();sent.push({id,choice,expected,project});},record:async(...args)=>events.push(args)};
 const approvals=new ToolApprovals(plane);await approvals.drain();assert.deepEqual(sent,[{id:'a',choice:'1',expected:'exact',project:'/project'}]);assert.equal(events[0][0],'Tool automatically allowed');
 plane.chooseTaskResponse=async(id,choice,expected,project,guard)=>{a.toolPolicy.revision++;a.toolPolicy.approvals.native.tools.shell='ask';guard();sent.push('bad');};
 await approvals.drain();assert.equal(sent.length,1,'Policy revocation wins over an in-flight automatic approval');
});
test('failed automatic sends remain manual and do not loop, but saving a new policy permits a retry',async()=>{
 const a=task();a.toolPolicy.approvals.shared.tools.memory_read='allow';let attempts=0;
 const plane={data:{tasks:[a]},collaboration,taskRequest:async()=>({pending:true,fingerprint:'one',request:request('memory_read')}),chooseTaskResponse:async()=>{attempts++;throw Error('Terminal disconnected');},record:async()=>{}};
 const approvals=new ToolApprovals(plane);await approvals.drain();await approvals.drain();assert.equal(attempts,1);a.toolPolicy.revision++;await approvals.drain();assert.equal(attempts,2);
});
test('automatic approval guard is checked at the final native key boundary',async()=>{
 const p=new ControlPlane('/project');const a=task();p.data.tasks=[a];let sends=0,allowed=true;
 const output='Read File requires approval\n fs_read → /project/file\n ❯ Allow\n   Always allow\n   Deny\n   Always deny\n────────────────────\nesc to close · ↑↓ to navigate · ↵ to select · Tab to edit';
 p.herdr={list:async()=>[{pane_id:'p',agent_status:'blocked'}],read:async()=>output,key:async()=>sends++};p.record=async()=>{};
 const r=await p.taskRequest('a');allowed=false;
 await assert.rejects(p.chooseTaskResponse('a','1',r.fingerprint,'/project',()=>assert(allowed,'Settings changed')),/Settings changed/);assert.equal(sends,0);
 allowed=true;await p.chooseTaskResponse('a','1',r.fingerprint,'/project',()=>assert(allowed));assert.equal(sends,1);
});
