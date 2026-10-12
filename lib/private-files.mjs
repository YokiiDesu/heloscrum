import {chmod,mkdir,open,rename,rm,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
const aclScript=fileURLToPath(new URL('../scripts/private-path.ps1',import.meta.url));

export async function protectPrivatePath(file,{directory=false,mode=directory?0o700:0o600}={}){
  if(process.platform!=='win32'){await chmod(file,mode);return;}
  await lstat(file); // Preserve ENOENT for optional WAL/connection files.
  // Windows mode bits do not restrict other users. Set a protected DACL before
  // writing private content; retain access for this user, SYSTEM and admins.
  await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',aclScript,'-TargetPath',file,...(directory?['-Directory']:[])],{windowsHide:true,timeout:30000});
}
export async function privateDirectory(directory){
  await mkdir(directory,{recursive:true,mode:0o700});
  await protectPrivatePath(directory,{directory:true});
}
export async function writePrivateFile(file,body,{flag='w',mode=0o600}={}){
  const handle=await open(file,flag,mode);
  try{await protectPrivatePath(file,{mode});await handle.writeFile(body);}finally{await handle.close();}
}
export async function atomicPrivateWrite(file,body){
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
    await writePrivateFile(temporary,body,{flag:'wx'});
    // Windows readers/antivirus may briefly hold a delete-sharing lock. Retry
    // the atomic replacement; never remove the live file as a workaround.
    for(let attempt=0;;attempt++){
      try{await rename(temporary,file);return;}
      catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=8)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(250,15*2**attempt)));}
    }
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
}
