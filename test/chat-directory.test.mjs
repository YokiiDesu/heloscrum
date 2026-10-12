import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chatTimestamp,filterChats,groupChats} from '../dist/chat-directory.js';
import {Collaboration} from '../lib/collaboration.mjs';

const now=new Date(2026,8,12,0,10),make=(id,project,at,extra={})=>({id,project,projectName:project.split('/').at(-1),name:id,kind:'group',status:'open',lastAt:at,participants:[{name:'QA'}],...extra});
test('calendar labels include Today, Yesterday, older dates and years in local time',()=>{
  assert.match(chatTimestamp(new Date(2026,8,12,0,1).toISOString(),now),/^Today · /);
  assert.match(chatTimestamp(new Date(2026,8,11,23,59).toISOString(),now),/^Yesterday · /);
  assert.match(chatTimestamp(new Date(2025,8,11,12).toISOString(),now),/2025/);
  assert.equal(chatTimestamp(null,now),'No activity yet');assert.equal(chatTimestamp('invalid',now),'No activity yet');
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {chatTimestamp} from ${JSON.stringify(new URL('../dist/chat-directory.js',import.meta.url).href)};console.log(chatTimestamp('2026-03-08T08:30:00Z',new Date('2026-03-09T07:10:00Z')))`],{env:{...process.env,TZ:'America/Los_Angeles'},encoding:'utf8'});
  assert.equal(result.status,0);assert.match(result.stdout,/^Yesterday · /,'short DST day is still yesterday');
});
test('filters intersect date, project, kind, status and search without mutating source chats',()=>{
  const today=new Date(2026,8,12,0,2).toISOString(),yesterday=new Date(2026,8,11,23,59).toISOString();
  const threads=[make('a','/one/Pack',today),make('b','/two/Pack',yesterday,{kind:'dm',status:'closed'}),make('c','/one/Pack',null,{createdAt:today}),make('old','/one/Pack',new Date(2026,8,4).toISOString()),make('unknown','/one/Pack',null)];
  const original=structuredClone(threads);
  assert.deepEqual(filterChats(threads,{date:'today'},now).map(t=>t.id),['a','c']);
  assert.deepEqual(filterChats(threads,{date:'yesterday',project:'/two/Pack',kind:'dm',status:'closed',query:'QA'},now).map(t=>t.id),['b']);
  assert.deepEqual(filterChats(threads,{date:'week'},now).map(t=>t.id),['a','b','c']);
  assert.deepEqual(filterChats(threads,{project:'/missing'},now),[]);assert.deepEqual(threads,original);
});
test('sorting groups by activity or project preserves distinct same-name projects and stable ties',()=>{
  const threads=[make('z-old','/Zebra','2026-09-01'),make('a-new','/Alpha','2026-09-12'),make('z-new','/Zebra','2026-09-11'),make('unknown','/Zebra',null),make('other','/other/Alpha','2026-09-10')];
  assert.deepEqual(groupChats(threads,'newest').map(g=>g.id),['/Alpha','/Zebra','/other/Alpha']);
  assert.deepEqual(groupChats(threads,'oldest').map(g=>g.id),['/Zebra','/other/Alpha','/Alpha']);
  assert.deepEqual(groupChats(threads,'oldest')[0].threads.map(t=>t.id),['z-old','z-new','unknown']);
  assert.deepEqual(groupChats(threads,'project-asc').map(g=>g.id),['/Alpha','/other/Alpha','/Zebra']);
  assert.deepEqual(groupChats(threads,'project-desc').map(g=>g.id),['/Zebra','/other/Alpha','/Alpha']);
});
test('human chat directory includes saved projects while agent lists and reads remain project scoped',async()=>{
  const tasks=['/one/Pack','/two/Pack'].flatMap((project,p)=>[0,1,2].map(i=>({id:`p${p}-${i}`,role:'QA '+i,project,prompt:'Verify',summary:'Verify'})));
  const plane={root:'/tmp',data:{project:tasks[0].project,tasks},save:async()=>{}},c=new Collaboration(plane);
  const a=await c.groups.create(tasks[0],{name:'First',participants:tasks.slice(1,3).map(t=>t.id)}),b=await c.groups.create(tasks[3],{name:'Second',participants:tasks.slice(4).map(t=>t.id)});
  const directory=c.threadDirectory();assert.equal(directory.projects.length,2);assert.equal(directory.threads.length,2);assert.equal(directory.threads[1].projectName,'Pack');assert(directory.threads.every(t=>t.createdAt));
  assert.equal(c.threadList(tasks[0].project).length,1);assert.equal(c.groups.list(tasks[0]).length,1);
  assert.throws(()=>c.groups.read(tasks[0],{threadId:b.id}),e=>e.status===403);
  assert.throws(()=>c.threadPage(tasks[0].project,b.id),e=>e.status===404);
  assert.throws(()=>c.chatProject('/arbitrary/path'),e=>e.status===404);
  assert.equal(c.threadPage(c.chatProject(tasks[3].project),b.id).name,'Second');
  assert.equal(plane.data.project,tasks[0].project,'browsing another chat project does not switch the active workspace');
  const receipt=await c.sendGroup({id:'human',human:true,role:'You',project:c.chatProject(tasks[3].project)},null,'Specific to project two',{threadId:b.id,kind:'ack'});
  assert.equal(receipt.deliveries.length,3);assert.equal(c.threadPage(tasks[0].project,a.id).count,0);
});
