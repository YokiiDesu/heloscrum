import '../scripts/setup-pty.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from '../lib/pty.mjs';

test('quiet PTYs exit after repeated close requests and ignore late input', {timeout:15000}, async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('READY');setInterval(()=>{},1000)"],{cols:80,rows:24,cwd:process.cwd(),env:process.env});
  const exited=new Promise(resolve=>child.onExit(resolve));
  try{
    await new Promise(resolve=>{const listener=child.onData(data=>{if(data.includes('READY')){listener.dispose();resolve();}});});
    child.kill();child.kill();child.write('late input');child.resize(90,30);
    await exited;
    child.kill();child.write('after exit');
  }finally{child.kill();}
});

test('naturally exited PTYs close without a second native kill', {timeout:15000}, async()=>{
  const child=spawn(process.execPath,['-e',"process.stdout.write('DONE')"],{cols:80,rows:24,cwd:process.cwd(),env:process.env});
  let output='';child.onData(data=>{output+=data;});
  try{
    const result=await new Promise(resolve=>child.onExit(resolve));
    assert.equal(result.exitCode,0);assert.match(output,/DONE/);
    child.kill();child.resize(90,30);child.write('late input');
  }finally{child.kill();}
});
