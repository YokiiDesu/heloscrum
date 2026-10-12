import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {websiteDemoHeaders} from '../lib/website-demos.mjs';

test('published original matches the recorded artifact and the playable copy only adds isolation metadata',async()=>{
  const source=await readFile(new URL('../website/demos/red-ball-original.html',import.meta.url),'utf8');
  const demo=await readFile(new URL('../website/demos/red-ball.html',import.meta.url),'utf8');
  assert.equal(Buffer.byteLength(source),4862);
  assert.equal(createHash('sha256').update(source).digest('hex'),'5f9a5c765a5c83dc5b235f58a1375a34db833434d1dbd8a1b72bcb17279e505e');
  assert.equal(demo.replace(/\n<meta http-equiv="Content-Security-Policy"[^>]+>/,'').replace(/\n<meta name="referrer"[^>]+>/,''),source);
  const headers=websiteDemoHeaders('demos/red-ball.html');
  const meta=demo.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  for(const tag of ['script','style']){
    const content=demo.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];
    const hash=createHash('sha256').update(content).digest('base64');
    for(const policy of [meta,headers['Content-Security-Policy']])assert(policy.includes(`${tag}-src 'sha256-${hash}'`));
  }
  assert.match(meta,/default-src 'none'/);
  assert.match(meta,/connect-src 'none'/);
  for(const file of [undefined,'index.html','blog/local-llms.html','demos/unreviewed.html','../demos/red-ball.html','demos/red-ball.html/extra'])assert.deepEqual(websiteDemoHeaders(file),{});
});
