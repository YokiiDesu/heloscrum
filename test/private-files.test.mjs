import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import {atomicPrivateWrite} from '../lib/private-files.mjs';
import {assertPrivate} from './private-file-assert.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function lockReplacement(file,t){
  // Allow readers but deny delete-sharing, as a Windows scanner can do.
  const script="$ErrorActionPreference='Stop'; $file=[System.IO.File]::Open($env:HELOSCRUM_LOCK_TEST_PATH,'Open','Read','ReadWrite'); try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null } finally { $file.Dispose() }";
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,HELOSCRUM_LOCK_TEST_PATH:file},stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill());
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise(resolve=>child.once('close',code=>resolve(code)));
  await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>reject(Error(`Lock helper exited (${code}): ${stderr}`)));
    createInterface({input:child.stdout}).on('line',line=>{if(line==='locked')resolve();});
  });
  return async()=>{child.stdin.end('\n');assert.equal(await exited,0,stderr);};
}

test('private replacement preserves file permissions and cleans temporary files',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-private-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'connection.json');
  await atomicPrivateWrite(file,'old');await atomicPrivateWrite(file,'new');
  assert.equal(await readFile(file,'utf8'),'new');await assertPrivate(file);
  assert.deepEqual(await readdir(root),['connection.json']);
});

test('Windows private replacement survives a reader lock longer than the old retry window',{skip:process.platform!=='win32',timeout:20000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-private-lock-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'connection.json');await atomicPrivateWrite(file,'old');
  const unlock=await lockReplacement(file,t);
  let settled=false;
  const replacing=atomicPrivateWrite(file,'new').then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  try{
    // Start the hold after the replacement bytes exist, excluding ACL setup.
    let ready=false;
    for(let i=0;i<200&&!ready;i++){
      const temporary=(await readdir(root)).find(name=>name.endsWith('.tmp'));
      if(temporary)ready=await readFile(path.join(root,temporary),'utf8').then(text=>text==='new',()=>false);
      if(!ready)await delay(25);
    }
    assert(ready,'replacement bytes should be ready while the target is locked');
    await delay(1800);
    assert.equal(await readFile(file,'utf8'),'old','the live file stays readable throughout retry');
    assert.equal(settled,false,'a transient lock must not exhaust the retry window');
  }finally{await unlock();await replacing;}
  const error=await replacing;if(error)throw error;
  assert.equal(await readFile(file,'utf8'),'new');await assertPrivate(file);
  assert.deepEqual(await readdir(root),['connection.json']);
});

test('Windows private replacement gives up on persistent locks without removing the live file',{skip:process.platform!=='win32',timeout:20000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-private-locked-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'connection.json');await atomicPrivateWrite(file,'old');
  const unlock=await lockReplacement(file,t);
  try{
    await assert.rejects(atomicPrivateWrite(file,'new'),error=>['EPERM','EACCES','EBUSY'].includes(error.code));
    assert.equal(await readFile(file,'utf8'),'old');await assertPrivate(file);
    assert.deepEqual(await readdir(root),['connection.json']);
  }finally{await unlock();}
});
