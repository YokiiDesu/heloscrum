import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundEffects,SOUND_FILES,WorkspaceSoundObserver,readPreferences} from '../dist/preferences.js';

function audioFixture(options={}){
  let enabled=true,now=1000,created=0;
  const fetched=[],decoded=[],nodes=[],gains=[];
  const context={state:'running',currentTime:4,destination:{},
    async decodeAudioData(bytes){decoded.push(bytes);return {bytes,duration:1};},
    createBufferSource(){const node={connect(){},disconnect(){node.disconnected=true;},start(){node.started=true;},stop(){node.stopped=true;node.onended?.();}};nodes.push(node);return node;},
    createOscillator(){const node=this.createBufferSource();node.frequency={setValueAtTime(value){node.hz=value;},exponentialRampToValueAtTime(){}};node.stop=at=>{node.stopAt=at;};return node;},
    createGain(){const gain={gain:{setValueAtTime(value){gain.level=value;},exponentialRampToValueAtTime(){}},connect(){},disconnect(){gain.disconnected=true;}};gains.push(gain);return gain;},
  };
  const sound=new SoundEffects({enabled:()=>enabled,now:()=>now,createContext:()=>{created++;return context;},fetchAudio:async url=>{fetched.push(url);return {ok:true,arrayBuffer:async()=>new TextEncoder().encode(url).buffer};},...options});
  return {sound,context,fetched,decoded,nodes,gains,setEnabled:value=>enabled=value,advance:value=>now+=value,get created(){return created;}};
}

test('appearance defaults to dark mode and sound stays opt-in',()=>{
  assert.deepEqual(readPreferences({getItem:()=>null}),{theme:'dark',sounds:false});
  assert.deepEqual(readPreferences({getItem:()=>'{'}),{theme:'dark',sounds:false});
  assert.deepEqual(readPreferences({getItem:()=>'{"theme":"light","sounds":true}'}),{theme:'light',sounds:true});
});

test('muted sound allocates no context or network requests and stops active clips',async()=>{
  const f=audioFixture();f.setEnabled(false);
  assert.equal(await f.sound.unlock(),false);assert.equal(await f.sound.play('complete'),false);
  assert.equal(f.created,0);assert.equal(f.fetched.length,0);
  f.setEnabled(true);await f.sound.unlock();assert.equal(await f.sound.play('plan-complete'),true);
  f.setEnabled(false);f.sound.stop();
  assert(f.nodes.every(n=>n.stopped&&n.disconnected));assert(f.gains.every(g=>g.disconnected));
  assert.equal(await f.sound.play('request',{preview:true}),false);
});

test('the supplied clips are cached, decoded once, and used for their exact cues',async()=>{
  const f=audioFixture();await f.sound.unlock();await f.sound.unlock();
  assert.equal(f.fetched.length,3);assert.equal(f.decoded.length,3);
  const mappings={'plan-complete':'/sounds/project-complete-sound-effect.mp3',error:'/sounds/error-sound-effect.wav',request:'/sounds/notification-sound-effect.mp3',notification:'/sounds/notification-sound-effect.mp3'};
  assert.deepEqual(SOUND_FILES,mappings);
  for(const [kind,url] of Object.entries(mappings)){
    assert.equal(await f.sound.play(kind,{preview:true}),true);
    assert.equal(new TextDecoder().decode(f.nodes.at(-1).buffer.bytes),url);
    assert(f.gains.at(-1).level>0&&f.gains.at(-1).level<=.5);
  }
  assert.equal(f.fetched.length,3,'attention and notifications share a cached clip');
  const count=f.nodes.length;assert.equal(await f.sound.play('unknown'),false);assert.equal(await f.sound.play('click'),false);assert.equal(await f.sound.play(),false);assert.equal(f.nodes.length,count);
});

test('task completion retains the original three-note chord alongside other notification cues',async()=>{
  const f=audioFixture();await f.sound.unlock();
  assert.equal(await f.sound.play('error'),true);
  assert.equal(await f.sound.play('complete'),true);
  assert.deepEqual(f.nodes.slice(1).map(n=>[n.hz,n.stopAt]),[[392,4+.34+.01],[587.33,4+.065+.38+.01],[783.99,4+.12+.44+.01]]);
  assert.equal(await f.sound.play('complete'),false,'duplicate completion bursts are bounded');
  assert.equal(await f.sound.play('plan-complete'),true,'plan completion has its own cue');
});

test('attention and notification bursts coalesce, and clips release their audio nodes',async()=>{
  const f=audioFixture();await f.sound.unlock();
  assert.equal(await f.sound.play('request'),true);assert.equal(await f.sound.play('notification'),false);
  f.advance(200);assert.equal(await f.sound.play('notification'),true);
  assert(f.nodes[0].stopped);f.nodes[1].onended();
  assert.equal(f.sound.voices.size,0);assert(f.gains.every(g=>g.disconnected));
});

test('mute cancels pending playback even if enabled again before decoding finishes',async()=>{
  let resolve;const ready=new Promise(r=>resolve=r);
  const f=audioFixture({fetchAudio:async()=>{await ready;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});
  const unlocking=f.sound.unlock(),playing=f.sound.play('plan-complete');
  f.setEnabled(false);f.sound.stop();f.setEnabled(true);resolve();
  await unlocking;assert.equal(await playing,false);assert.equal(f.nodes.length,0);
});

test('failed loads can retry without blocking the other notification sounds',async()=>{
  let attempts=0;
  const f=audioFixture({fetchAudio:async()=>{attempts++;if(attempts===1)throw Error('offline');return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});
  await f.sound.unlock();assert.equal(attempts,3);assert.equal(f.nodes.length,0);
  assert.equal(await f.sound.play('error'),true);
  assert.equal(await f.sound.play('plan-complete',{preview:true}),true);
  assert.equal(attempts,4);
});

const snapshot=(overrides={})=>({project:{path:'/one'},tasks:[],collaboration:{userRequests:[],notifications:[]},scheduler:{notices:[]},work:{plans:[]},...overrides});
const plan=(overrides={})=>({id:'plan',kind:'plan',status:'active',revision:1,items:[{id:'task',status:'needs_review'}],...overrides});

test('task and plan transitions sound once across work views, polling and project switches',()=>{
  const heard=[],observer=new WorkspaceSoundObserver(cue=>heard.push(cue));
  observer.observe(snapshot({work:{plans:[plan()]}}));
  const done=plan({revision:2,items:[{id:'task',status:'done'}]});
  observer.observeWork('/one',[done]);observer.observe(snapshot({work:{plans:[done]}}));
  assert.deepEqual(heard,['complete']);
  const completed={...done,status:'completed',revision:3};
  observer.observeWork('/one',[completed]);observer.observe(snapshot({work:{plans:[completed]}}));
  observer.observe(snapshot({work:{plans:[plan()]}})); // stale in-flight response
  observer.observe(snapshot({work:{plans:[completed]}}));
  observer.observe(snapshot({project:{path:'/two'},work:{plans:[completed]}}));
  observer.observe(snapshot({work:{plans:[completed]}}));
  assert.deepEqual(heard,['complete','plan-complete']);
  observer.observe(snapshot({work:{plans:[{...completed,status:'active',revision:4}]}}));
  observer.observe(snapshot({work:{plans:[{...completed,revision:5}]}}));
  assert.deepEqual(heard,['complete','plan-complete','plan-complete'],'a genuinely restored and completed plan can sound again');
});

test('initial history is silent; new attention, notifications, and eligible reminders use their cue',()=>{
  const heard=[],observer=new WorkspaceSoundObserver(cue=>heard.push(cue));
  const initial=snapshot({collaboration:{notifications:[{id:'old',type:'tool'}],userRequests:[]},scheduler:{notices:[{id:'old-reminder'}]}});
  observer.observe(initial);observer.observe(initial);assert.deepEqual(heard,[]);
  const next=structuredClone(initial);next.collaboration.notifications.push({id:'new',type:'tool'});
  observer.observe(next);observer.observe(next);assert.deepEqual(heard,['notification']);
  next.collaboration.notifications.push({id:'question-notice',type:'human-request'});next.collaboration.userRequests.push({id:'question',status:'pending'});
  observer.observe(next);observer.observe(next);assert.deepEqual(heard,['notification','request']);
  next.scheduler.notices.push({id:'read',readAt:'now'},{id:'obsolete',obsolete:true},{id:'quiet',toastEligible:false});
  observer.observe(next);assert.equal(heard.length,2);
  next.scheduler.notices.at(-1).toastEligible=true;observer.observe(next);observer.observe(next);
  assert.deepEqual(heard,['notification','request','notification']);
});

test('agent completion and blocked transitions retain their cues without replaying on repeated refresh',()=>{
  const heard=[],observer=new WorkspaceSoundObserver(cue=>heard.push(cue)),state=snapshot({tasks:[{id:'agent',status:'working'}]});
  observer.observe(state);state.tasks[0].status='done';observer.observe(state);observer.observe(state);
  state.tasks[0].status='blocked';observer.observe(state);observer.observe(state);
  assert.deepEqual(heard,['complete','request']);
});

test('single-task briefs use task completion and a completed plan takes precedence over its last task',()=>{
  const heard=[],observer=new WorkspaceSoundObserver(cue=>heard.push(cue));
  observer.observe(snapshot({work:{plans:[plan(),plan({id:'single',kind:'task'})]}}));
  observer.observe(snapshot({work:{plans:[plan({status:'completed',revision:2,items:[{id:'task',status:'done'}]}),plan({id:'single',kind:'task'})]}}));
  observer.observeWork('/one',[plan({id:'single',kind:'task',status:'completed',revision:2})]);
  assert.deepEqual(heard,['plan-complete','complete']);
});
