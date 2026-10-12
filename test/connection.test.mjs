import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient,ConnectionError,RefreshLoop,RefreshFeedback} from '../dist/connection.js';

const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const expired=()=>reply({error:'Refresh HeloScrum to reconnect'},401);

test('session renewal recognizes the HeloScrum notice and the stable error code without replaying arbitrary authorization failures',async()=>{
  for(const expiration of [{error:'Refresh HeloScrum to reconnect'},{code:'SESSION_EXPIRED',error:'Localized session notice'}]){
    let sessions=0,writes=0;
    const client=new ApiClient({fetch:async(route,options)=>{
      if(route==='/api/session')return reply({token:String(++sessions)});
      assert.equal(options.headers['X-HeloScrum-Token'],String(sessions));
      assert.deepEqual(Object.keys(options.headers),['X-HeloScrum-Token']);
      writes++;return writes===1?reply(expiration,401):reply({saved:true});
    }});
    assert.deepEqual(await client.request('work/draft',{method:'POST',body:'{}'}),{saved:true});
    assert.equal(sessions,2);assert.equal(writes,2);
  }
  let calls=0;
  const denied=new ApiClient({fetch:async route=>{
    if(route==='/api/session')return reply({token:'one'});
    calls++;return reply({error:'Permission denied'},401);
  }});
  await assert.rejects(denied.request('work/draft',{method:'POST',body:'{}'}),/Permission denied/);
  assert.equal(calls,1);
});

test('concurrent requests share session renewal after a server restart',async()=>{
  let token='original',sessions=0;const sends=[];
  const client=new ApiClient({fetch:async(route,options)=>{
    if(route==='/api/session'){sessions++;await new Promise(resolve=>setImmediate(resolve));return reply({token});}
    sends.push(options.headers['X-HeloScrum-Token']);
    return options.headers['X-HeloScrum-Token']===token?reply({ok:true}):expired();
  }});
  await Promise.all([client.request('state'),client.request('chat')]);assert.equal(sessions,1);
  token='restarted';await Promise.all([client.request('state'),client.request('chat'),client.request('work')]);
  assert.equal(sessions,2);assert.equal(client.token,'restarted');assert.equal(sends.filter(t=>t==='restarted').length,3);
});

test('network failures never replay writes and explicitly flag uncertain outcomes',async()=>{
  let writes=0;const failures=[];
  const client=new ApiClient({onUnavailable:error=>failures.push(error),fetch:async route=>{
    if(route==='/api/session')return reply({token:'session'});writes++;throw new TypeError('Failed to fetch');
  }});
  await assert.rejects(client.request('tasks/prompt',{method:'POST',body:'{}'}),error=>error instanceof ConnectionError&&error.uncertain&&/may have completed/.test(error.message));
  assert.equal(writes,1);assert.equal(failures.length,1);
});

test('writes retry once only when the server explicitly rejects an expired token',async()=>{
  let sessions=0,writes=0;const client=new ApiClient({fetch:async route=>{
    if(route==='/api/session')return reply({token:String(++sessions)});
    writes++;return writes===1?expired():reply({saved:true});
  }});
  assert.deepEqual(await client.request('work/draft',{method:'POST',body:'{}'}),{saved:true});assert.equal(writes,2);
  const rejected=new ApiClient({fetch:async route=>route==='/api/session'?reply({token:'bad'}):expired()});
  await assert.rejects(rejected.request('state'),/Refresh HeloScrum/);
});

test('domain failures remain actionable and are not treated as outages or retried',async()=>{
  let failures=0,writes=0;const client=new ApiClient({onUnavailable:()=>failures++,fetch:async route=>{
    if(route==='/api/session')return reply({token:'session'});writes++;return reply({error:'Review is stale'},409);
  }});
  await assert.rejects(client.request('change-review',{method:'POST'}),error=>error.status===409&&error.message==='Review is stale');
  assert.equal(writes,1);assert.equal(failures,0);
  const olderServer=new ApiClient({onUnavailable:()=>failures++,fetch:async route=>route==='/api/session'?reply({token:'session'}):reply({error:'Not found'},404)});
  await assert.rejects(olderServer.request('role-packs?task=fixture'),error=>error.status===404&&error.message==='Not found');assert.equal(failures,0);
});
test('Git and tool rejections keep the app connected; failed gateways retain uncertain write protection',async()=>{
  for(const status of [422,502,503,504]){
    let failures=0,writes=0;
    const client=new ApiClient({onUnavailable:()=>failures++,fetch:async route=>{
      if(route==='/api/session')return reply({token:'session'});
      writes++;return reply({error:'Choose a Git folder',code:'PROJECT_NEEDS_GIT'},status);
    }});
    await assert.rejects(client.request('project',{method:'POST',body:'{}'}),error=>error.status===status&&error.code==='PROJECT_NEEDS_GIT'&&!(error instanceof ConnectionError));
    assert.equal(writes,1);assert.equal(failures,0);
  }
  for(const body of [()=>{throw SyntaxError('HTML gateway response');},()=>({message:'Gateway unavailable'})]){
    let writes=0,failures=0;
    const client=new ApiClient({onUnavailable:()=>failures++,fetch:async route=>{
      if(route==='/api/session')return reply({token:'session'});
      writes++;return {ok:false,status:502,json:async()=>body()};
    }});
    await assert.rejects(client.request('project',{method:'POST',body:'{}'}),error=>error instanceof ConnectionError&&error.uncertain);
    assert.equal(writes,1);assert.equal(failures,1);
  }
});

test('read deadlines cover the response body and clear the stalled request',async()=>{
  let aborted=false;const client=new ApiClient({timeout:10,fetch:async(route,{signal})=>route==='/api/session'?reply({token:'session'}):{
    ok:true,status:200,json:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('Aborted'),{name:'AbortError'}));}))
  }});
  await assert.rejects(client.request('state'),error=>error instanceof ConnectionError&&!error.uncertain&&/too long/.test(error.message));assert(aborted);
});

test('upload and download requests use the same renewal and error handling',async()=>{
  const payload=new Blob(['brief']),headers=[];let first=true;
  const client=new ApiClient({fetch:async(route,options)=>{
    if(route==='/api/session')return reply({token:first?'old':'new'});
    headers.push(options.headers);
    if(first){first=false;return expired();}
    return {ok:true,status:200,blob:async()=>payload,json:async()=>({uploaded:true})};
  }});
  assert.equal(await client.request('work/export',{},'blob'),payload);
  assert.deepEqual(await client.request('work/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:payload}),{uploaded:true});
  assert.equal(headers.at(-1)['Content-Type'],'application/octet-stream');assert.equal(headers.at(-1)['X-HeloScrum-Token'],'new');
});

test('refresh backs off, pauses in hidden tabs, and catches up once on return',async()=>{
  let clock=10000,hidden=false,fail=true,calls=0,recovered=0,scheduled,delay;
  const loop=new RefreshLoop({now:()=>clock,paused:()=>hidden,setTimer:(callback,ms)=>{scheduled=callback;delay=ms;},clearTimer(){},onRecovered:()=>recovered++,refresh:async()=>{calls++;if(fail)throw new ConnectionError();}});
  assert.equal(await loop.run(),false);assert.equal(delay,2000);assert.equal(loop.state.phase,'disconnected');
  await scheduled();assert.equal(delay,4000);
  for(let i=0;i<8;i++)await scheduled();assert.equal(delay,30000);
  hidden=true;const before=calls;await scheduled();assert.equal(calls,before);
  hidden=false;fail=false;await Promise.all([loop.wake(),loop.wake(),loop.wake()]);
  assert.equal(calls,before+1);assert.equal(loop.state.phase,'connected');assert.equal(loop.state.lastSync,clock);assert.equal(recovered,1);assert.equal(delay,15000);
  await loop.wake();assert.equal(calls,before+1,'focus immediately after visibility does not duplicate refresh');
  clock+=5000;await scheduled();assert.equal(recovered,1,'routine success stays quiet');loop.stop();
});

test('manual refresh bypasses a paused poll and concurrent clicks coalesce',async()=>{
  let finish,calls=0;
  const loop=new RefreshLoop({paused:()=>true,setTimer(){},clearTimer(){},refresh:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
  const first=loop.run({manual:true}),second=loop.run({manual:true});assert.equal(first,second);
  await Promise.resolve();assert.equal(calls,1);finish();assert.equal(await first,true);loop.stop();
});

test('a child view network failure cannot be overwritten by a successful state refresh',async()=>{
  const loop=new RefreshLoop({setTimer(){},clearTimer(){},refresh:async()=>{loop.unavailable(new ConnectionError());}});
  assert.equal(await loop.run(),false);assert.equal(loop.state.phase,'disconnected');assert.equal(loop.state.failures,1);loop.stop();
});

function fakeClock(){
  let clock=0,sequence=0;const timers=new Map();
  return {
    now:()=>clock,
    setTimer:(callback,delay)=>{const id=++sequence;timers.set(id,{at:clock+delay,callback});return id;},
    clearTimer:id=>timers.delete(id),
    advance(ms){
      const end=clock+ms;
      for(;;){
        const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;const [id,timer]=next;clock=timer.at;timers.delete(id);timer.callback();
      }
      clock=end;
    },
    pending:()=>timers.size
  };
}

test('manual refresh shows progress for three seconds without delaying data, then glows for ten seconds',async()=>{
  const clock=fakeClock(),feedback=new RefreshFeedback(clock);let calls=0;
  const loop=new RefreshLoop({...clock,refresh:async()=>{calls++;},onChange:state=>feedback.update(state)});
  await loop.run();clock.advance(10000);
  assert.equal(feedback.state.busy,false);assert.equal(feedback.state.pulsing,false);
  const pending=loop.run({manual:true});assert.equal(feedback.state.busy,true);
  await pending;assert.equal(calls,2);assert.equal(loop.state.refreshing,false,'network has already settled');
  clock.advance(2999);assert.equal(feedback.state.busy,true);
  clock.advance(1);assert.equal(feedback.state.busy,false);assert.equal(feedback.state.pulsing,true);
  clock.advance(9999);assert.equal(feedback.state.pulsing,true);
  clock.advance(1);assert.equal(feedback.state.pulsing,false);
  loop.stop();feedback.stop();assert.equal(clock.pending(),0);
});

test('slow and failed manual requests keep progress until the request actually finishes',async()=>{
  const clock=fakeClock(),feedback=new RefreshFeedback(clock);let fail;
  const loop=new RefreshLoop({...clock,refresh:()=>new Promise((resolve,reject)=>{fail=reject;}),onChange:state=>feedback.update(state)});
  const pending=loop.run({manual:true});await Promise.resolve();clock.advance(6000);
  assert.equal(feedback.state.busy,true);fail(new ConnectionError());assert.equal(await pending,false);
  assert.equal(feedback.state.busy,false);assert.equal(feedback.state.tone,'pending');assert.equal(feedback.state.pulsing,true);
  loop.stop();feedback.stop();assert.equal(clock.pending(),0);
});

test('healthy background refreshes stay quiet and a manual click joins one without duplicate requests',async()=>{
  const clock=fakeClock(),feedback=new RefreshFeedback(clock);let finish,calls=0;
  const loop=new RefreshLoop({...clock,refresh:()=>{calls++;return new Promise(resolve=>finish=resolve);},onChange:state=>feedback.update(state)});
  let pending=loop.run();await Promise.resolve();finish();await pending;clock.advance(10000);
  pending=loop.run();await Promise.resolve();assert.equal(feedback.state.busy,false);
  assert.equal(feedback.state.pulsing,false,'routine polling does not restart the status glow');
  assert.equal(loop.run({manual:true}),pending);assert.equal(feedback.state.busy,true);
  finish();await pending;assert.equal(calls,2);clock.advance(3000);assert.equal(feedback.state.busy,false);
  loop.stop();feedback.stop();assert.equal(clock.pending(),0);
});

test('reconnect retries keep the same status tone and do not restart its ten-second glow',()=>{
  const clock=fakeClock(),feedback=new RefreshFeedback(clock);
  feedback.update({phase:'connected'});clock.advance(10000);
  feedback.update({phase:'disconnected'});assert.equal(feedback.state.pulsing,true);
  clock.advance(2000);feedback.update({phase:'reconnecting',refreshing:true});
  clock.advance(500);feedback.update({phase:'disconnected'});
  clock.advance(7499);assert.equal(feedback.state.pulsing,true);
  clock.advance(1);assert.equal(feedback.state.pulsing,false);
  feedback.update({phase:'reconnecting',refreshing:true});clock.advance(100);
  feedback.update({phase:'connected'});assert.equal(feedback.state.tone,'connected');assert.equal(feedback.state.pulsing,true);
  assert.equal(feedback.state.busy,true,'recovery also respects the minimum progress time');
  clock.advance(2900);assert.equal(feedback.state.busy,false);
  feedback.stop();assert.equal(clock.pending(),0);
});

test('poll cadence adapts to activity and focus events only refresh stale data',async()=>{
  let clock=0,active=false,calls=0,delay;
  const loop=new RefreshLoop({now:()=>clock,interval:()=>active?15000:30000,setTimer:(callback,ms)=>{delay=ms;},clearTimer(){},refresh:async()=>{calls++;}});
  await loop.run();assert.equal(delay,30000);
  clock=5000;await loop.wake();assert.equal(calls,1,'switching windows does not cause a redundant refresh');
  clock=30000;await Promise.all([loop.wake(),loop.wake()]);assert.equal(calls,2);
  active=true;clock=45000;await loop.wake();assert.equal(delay,15000);assert.equal(calls,3);
  await loop.wake({force:true});assert.equal(calls,4,'network restoration can immediately check the connection');
  loop.stop();
});
