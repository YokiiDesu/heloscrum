import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'output/platform-validation');
await mkdir(output,{recursive:true});
const report={startedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,
  osRelease:os.release(),node:process.version,checks:[],
  limitations:['No provider authentication or paid model calls.','No authenticated builder/reviewer workflow.','No interactive desktop browser or OS credential-store verification.']};
for(const [name,args] of [
  ['syntax',['scripts/check.mjs']],
  ['release',['scripts/release-check.mjs']],
  ['tests',['scripts/test.mjs','--test-reporter=tap']],
  ['server-restart',['scripts/platform-smoke.mjs']],
]){
  console.log(`\nPlatform check: ${name}`);
  const log=createWriteStream(path.join(output,`${name}.log`));
  const started=Date.now();
  const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,TZ:'UTC'},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{process.stdout.write(chunk);log.write(chunk);});
  let timedOut=false;
  const timeout=setTimeout(()=>{
    timedOut=true;
    if(!child.pid)return;
    // Stop only this check's process tree, including a stuck test subprocess.
    try{
      if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:10000});
      else process.kill(-child.pid,'SIGKILL');
    }catch{child.kill();}
  // Windows applies and verifies native ACLs for the persistence fixtures.
  // The full suite takes longer there; individual PTY lifecycle tests retain
  // their own short deadlines, so a stuck terminal still fails promptly.
  },name==='tests'?(process.platform==='win32'?600000:360000):60000);
  const exitCode=await new Promise(resolve=>{
    child.once('error',error=>{log.write(error.message+'\n');resolve(1);});
    child.once('close',code=>resolve(code??1));
  });
  clearTimeout(timeout);log.end();await finished(log);
  report.checks.push({name,exitCode,timedOut,status:exitCode===0&&!timedOut?'pass':'fail',durationMs:Date.now()-started});
  report.ok=report.checks.every(check=>check.status==='pass');
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(`\nPlatform checks: ${report.ok?'PASS':'FAIL'} (${process.platform}/${process.arch}). Evidence: output/platform-validation/`);
process.exitCode=report.ok?0:1;
