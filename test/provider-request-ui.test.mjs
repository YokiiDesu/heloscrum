import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionHTML,permissionKey,permissionIdentity,permissionAnswered,observePermission} from '../dist/provider-request.js';
const request={type:'tool-approval',identity:'one',details:'native prompt',tool:{name:'write_file',server:'files',arguments:'{"path":"<img onerror=bad>"}'},queue:{position:1,total:3},options:[{id:'allow',label:'Allow',description:'Only this call'}]};
test('permission card shows queue position, exact tool, arguments and explicit scopes without active HTML',()=>{
 const html=permissionHTML({request,slot:0,role:'Builder',provider:'Cursor',notice:'Response sent',error:'Request changed'});
 for(const text of ['Request 1 of 3','write_file','MCP server','files','Arguments','Only this call','role="alert"','role="status"','Allow once'])assert(html.includes(text),text);
 assert(!html.includes('<img'));assert(html.includes('&lt;img'));
 const next=permissionHTML({request:{...request,queue:{position:1,total:2}},slot:0,disabled:true});assert(next.includes('Request 1 of 2'));assert(next.includes('disabled'));
 const unknown=permissionHTML({request:{...request,queue:null,tool:{...request.tool,arguments:null}},slot:0});assert(unknown.includes('has not reported a total'));assert(unknown.includes('has not included arguments'));assert(!unknown.includes('1 of 1'));
});
test('request button DOM key ignores scrollback but changes for the menu, queue, response or error',()=>{
 const task={status:'blocked'},slot={request:{pending:true,request,output:'old',fingerprint:'old'}};
 const key=permissionKey(slot,task);assert.equal(key,permissionKey({...slot,request:{...slot.request,output:'new file output',fingerprint:'new'}},task));
 for(const change of [{requestError:'failed'},{responding:true},{expanded:true},{requestSent:'one'},{requestSequence:2},{request:{...slot.request,request:{...request,queue:{position:1,total:2}}}}])assert.notEqual(key,permissionKey({...slot,...change},task));
});


test('native shell permissions show the command without pretending it is an MCP server',()=>{
 const html=permissionHTML({request:{...request,tool:{name:'shell',arguments:'shasum -a 256 /project/module.mjs'}},slot:0,provider:'Kiro'});
 assert(html.includes('<h4>Command</h4>'));assert(html.includes('shasum -a 256 /project/module.mjs'));
 assert(!html.includes('MCP server'));assert(!html.includes('undefined'));
});


test('observed request numbering changes for a new prompt, not terminal updates or selection',()=>{
 const slot={},data={pending:true,request,fingerprint:'selection-1'};
 observePermission(slot,data);assert.equal(slot.requestSequence,1);
 slot.requestSent=permissionIdentity(slot.request);slot.requestNotice='Response sent';
 observePermission(slot,{...data,fingerprint:'selection-2',request:{...request,options:[{...request.options[0],selected:true}]}});
 assert.equal(slot.requestSequence,1);assert.equal(slot.requestNotice,'Response sent');assert.equal(permissionAnswered(slot),true);
 const html=permissionHTML({request:{...slot.request.request,queue:null},slot:0,sequence:slot.requestSequence,disabled:permissionAnswered(slot)});
 assert(html.includes('Request 1'));assert(html.includes('disabled'));assert(!html.includes('1 of 1'));
 observePermission(slot,{...data,request:{...request,identity:'next'},fingerprint:'next'});
 assert.equal(slot.requestSequence,2);assert.equal(permissionAnswered(slot),false);assert.match(slot.requestNotice,/New request/);
 assert(permissionHTML({request:{...slot.request.request,queue:null},slot:0,sequence:slot.requestSequence}).includes('Request 2'));
 observePermission(slot,{pending:false});assert.equal(slot.requestSequence,2);assert.equal(slot.requestNotice,'');
 observePermission(slot,{...data,request:{...request,identity:'next'},fingerprint:'next'});
 assert.equal(slot.requestSequence,3,'An identical prompt after a confirmed gap is a new request');
});
test('restoring a cached agent keeps request numbering and its submitted state',()=>{
 const slot={};observePermission(slot,{pending:true,request,fingerprint:'first'});
 slot.requestSent=permissionIdentity(slot.request);
 const restored=JSON.parse(JSON.stringify(slot));
 observePermission(restored,{pending:true,request,fingerprint:'new-selection'});
 assert.equal(restored.requestSequence,1);assert.equal(permissionAnswered(restored),true);
});

test('raw Codex prompts from a running backend keep their number and sent state across scrollback updates',()=>{
 const menu="Would you like to run the following command?\n  $ node check.mjs\n› 1. Yes, proceed (y)\n  2. Yes, and don't ask again for commands that start with `node check.mjs` (p)\n  3. No, and tell Codex what to do differently (esc)\n  Press enter to confirm or esc to cancel";
 const raw=(prefix,command='check.mjs')=>({pending:true,fingerprint:prefix,request:{type:'provider-request',details:prefix+'\n'+menu.replaceAll('check.mjs',command),options:[]}});
 const slot={};observePermission(slot,raw('first output'));slot.requestSent=permissionIdentity(slot.request);
 observePermission(slot,raw('more output'));assert.equal(slot.requestSequence,1);assert.equal(permissionAnswered(slot),true);
 observePermission(slot,raw('new command','next.mjs'));assert.equal(slot.requestSequence,2);assert.equal(permissionAnswered(slot),false);
});
