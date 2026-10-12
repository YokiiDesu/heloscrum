import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceEvents} from '../dist/api-events.js';

test('browser invalidations coalesce, resume cursors and pause while hidden',async()=>{
  const streams=[],requests=[];let changes=0,visible=true;
  const client={token:'browser-session',session:async()=>{throw Error('Unexpected renewal');}};
  const events=new WorkspaceEvents({client,visible:()=>visible,onChange:()=>changes++,fetch:async(url,options)=>{
    requests.push({url,token:options.headers['X-HeloScrum-Token']});
    return {ok:true,status:200,body:new ReadableStream({start(controller){streams.push(controller);options.signal.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});}})};
  }});
  const frame=(type,id)=>new TextEncoder().encode(`id: ${id}\nevent: ${type}\ndata: {}\n\n`);
  try{
    events.select('prj_one');await new Promise(r=>setImmediate(r));assert.equal(events.connected,true);
    streams[0].enqueue(frame('ready',0));streams[0].enqueue(frame('workspace.changed',1));streams[0].enqueue(frame('workspace.changed',2));
    await new Promise(r=>setTimeout(r,550));assert.equal(changes,1);assert.equal(events.cursor.get('prj_one'),'2');
    visible=false;events.visibility();await new Promise(r=>setImmediate(r));assert.equal(events.connected,false);assert.equal(requests.length,1);
    visible=true;events.visibility();await new Promise(r=>setImmediate(r));assert.match(requests[1].url,/after=2$/);
    events.select('prj_two');await new Promise(r=>setImmediate(r));assert.equal(requests[2].url,'/api/v1/projects/prj_two/events');assert.equal(requests[2].token,'browser-session');
  }finally{events.stop();}
});
