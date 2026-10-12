import {spawn,execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--platform'&&['linux/arm64','linux/amd64'].includes(args[1])))throw Error('Usage: npm run test:linux -- [--platform linux/arm64|linux/amd64]');
const platform=args[1]||`linux/${process.arch==='arm64'?'arm64':'amd64'}`;
const image=`heloscrum-platform-check:${platform.replace('/','-')}`;
const container=`heloscrum-platform-check-${randomUUID()}`;
const evidence=path.join(root,'output',`docker-${platform.replace('/','-')}`);
const command=(options)=>new Promise((resolve,reject)=>{
  const child=spawn('docker',options,{cwd:root,stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>resolve(code??1));
});
await mkdir(evidence,{recursive:true});
const build=await command(['build','--platform',platform,'-f','Dockerfile.test','-t',image,'.']);
if(build)process.exit(build);
// No source/home/socket mounts, host ports, model credentials, or network at test time.
let cleanupStarted=false;
function cleanup(){if(cleanupStarted)return;cleanupStarted=true;try{execFileSync('docker',['rm','-f',container],{stdio:'ignore',timeout:10000});}catch{}}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{cleanup();process.exit(130);});
try{
  const code=await command(['run','--name',container,'--platform',platform,'--init','--cpus','2','--memory','3g','--pids-limit','256','--network','none',image]);
  const copied=await command(['cp',`${container}:/app/HeloScrum with spaces/output/platform-validation/.`,evidence]);
  console.log(`Linux evidence: ${evidence}`);
  process.exitCode=code||copied;
}finally{cleanup();}
