import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionStatus} from '../dist/connection-indicator.js';

test('connection status checks the model catalog, shares in-flight checks, and can retry',async()=>{
  const connection={id:'connected-test',revision:1,baseUrl:'http://localhost:8080/v1',model:'muse'};
  const calls=[];let release;
  const api=(route,body)=>{calls.push({route,body});return new Promise(resolve=>release=resolve);};
  const first=connectionStatus(api,connection),second=connectionStatus(api,connection);
  assert.equal(calls.length,1);assert.deepEqual(calls[0],{route:'ai-connections/models',body:{id:connection.id}});
  release({models:[{id:'muse'}]});
  assert.equal((await first).label,'Connected');assert.equal((await second).state,'connected');
  await connectionStatus(api,connection);assert.equal(calls.length,1);
  const retried=connectionStatus(api,connection,{retry:true});assert.equal(calls.length,2);
  release({models:[]});assert.equal((await retried).label,'Model Unavailable');
});
test('saved and unreachable connections never receive a false connected indicator',async()=>{
  const base={revision:1,baseUrl:'http://localhost:1234/v1',model:'muse'};
  assert.equal((await connectionStatus(async()=>({models:[{id:'muse',loaded:false}]}),{...base,id:'unloaded-test'})).label,'Model Not Loaded');
  assert.equal((await connectionStatus(async()=>{throw Error('private provider error');},{...base,id:'unreachable-test'})).label,'Not Connected');
  assert.equal((await connectionStatus(()=>{throw Error('No network request expected');},{id:'cloud-test'})).label,'Connection Saved');
  assert.equal(await connectionStatus(()=>{throw Error('No network request expected');},null),null);
});
