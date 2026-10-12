import test from 'node:test';
import assert from 'node:assert/strict';
import {replyThreads} from '../dist/chat-threads.js';

const message=(id,replyTo=null,delivery=id)=>({id,replyTo,deliveries:[{id:delivery}]});
test('replies resolve recipient delivery IDs and nested responses to one root',()=>{
  const messages=[message('root',null,'recipient-a'),message('reply','recipient-a','recipient-b'),message('nested','recipient-b'),message('unrelated')];
  const original=structuredClone(messages),result=replyThreads(messages);
  assert.deepEqual(result.roots.map(m=>m.id),['root','unrelated']);
  assert.deepEqual(result.replies.get('root').map(m=>m.id),['reply','nested']);
  assert.equal(result.rootById.get('nested'),'root');assert.deepEqual(messages,original);
});
test('unloaded parents stay visible and join their thread when older history loads',()=>{
  const recent=[message('reply','old-delivery'),message('nested','reply')];
  assert.deepEqual(replyThreads(recent).roots.map(m=>m.id),['reply']);
  const all=replyThreads([message('old',null,'old-delivery'),...recent]);
  assert.deepEqual(all.roots.map(m=>m.id),['old']);assert.equal(all.replies.get('old').length,2);
});
test('self references and malformed cycles terminate without losing messages',()=>{
  const messages=[message('a','b'),message('b','a'),message('self','self'),message('unlinked')],result=replyThreads(messages);
  const visible=[...result.roots,...[...result.replies.values()].flat()];
  assert.equal(visible.length,messages.length);assert.equal(new Set(visible.map(m=>m.id)).size,messages.length);
  assert.deepEqual(result.roots.map(m=>m.id),['a','self','unlinked']);
});
test('message wording or ack type cannot invent a reply relationship',()=>{
  const messages=[message('root'),{...message('ack'),kind:'ack',text:'Reply to root: received'}];
  assert.equal(replyThreads(messages).roots.length,2);
});
