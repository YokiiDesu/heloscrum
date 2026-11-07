import {open,lstat,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {sourceHash} from './source-pages.mjs';
import {atomicPrivateWrite,protectPrivatePath} from './private-files.mjs';

const MAX_BYTES=20*1024*1024;
const CHECKPOINT_BYTES=64*1024;
async function safeRead(file){
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await handle.stat();if(!info.isFile()||info.size>MAX_BYTES*6)throw Error('Invalid source checkpoint or file');return await handle.readFile();}finally{await handle.close();}
}
async function absent(file){try{await lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}const e=Error('Destination already exists');e.code='EEXIST';throw e;}

// Shared by native materialization and the contact download helper. Never replace
// an existing destination; an explicitly reusable copy must match byte for byte.
export async function writeVerifiedSource(file,bytes,{sha256,reuse=false,readOnly=false}={}){
  if(sourceHash(bytes)!==sha256)throw Error('Downloaded source checksum does not match');
  let handle;
  try{
    handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await protectPrivatePath(file);await handle.writeFile(bytes);await handle.sync();
    if(readOnly&&process.platform!=='win32')await handle.chmod(0o400);
  }catch(e){if(e.code!=='EEXIST'||!reuse)throw e;const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Source destination must be a regular file');}
  finally{await handle?.close();}
  if(sourceHash(await safeRead(file))!==sha256)throw Error('Local source copy changed; it was not overwritten');
  return {path:file,size:bytes.length,sha256};
}

// Checkpoints remain local to this process and never enter model context. A
// resumed request reauthorizes access on the server and pins the same hash.
export async function downloadSource(call,source,destination){
  const output=path.resolve(destination),checkpoint=output+'.heloscrum-partial.json',lock=checkpoint+'.lock';
  await absent(output);
  const guard=await open(lock,'wx',0o600);
  try{
    await protectPrivatePath(lock);
    const identity={...source};delete identity.sha256;
    let saved;
    try{saved=JSON.parse((await safeRead(checkpoint)).toString('utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(saved&&(saved.version!==1||JSON.stringify(saved.identity)!==JSON.stringify(identity)||sourceHash(saved.text)!==saved.partialHash||saved.offset!==saved.text.length||saved.offset>saved.totalCharacters||Buffer.byteLength(saved.text)>MAX_BYTES||source.sha256&&source.sha256!==saved.sha256))throw Error('Stale or invalid download checkpoint; choose a new output path');
    let text=saved?.text||'',offset=saved?.offset||0,sha256=saved?.sha256||source.sha256,total=saved?.totalCharacters,calls=0;
    let savedOffset=offset,savedBytes=Buffer.byteLength(text);
    const checkpointProgress=async()=>{
      if(offset===savedOffset)return;
      await atomicPrivateWrite(checkpoint,JSON.stringify({version:1,identity,sha256,totalCharacters:total,offset,text,partialHash:sourceHash(text)}));
      savedOffset=offset;savedBytes=Buffer.byteLength(text);
    };
    try{for(;;){
      const page=await call('source_read',{source:{...identity,...(sha256?{sha256}:{})},offset,limit:40000});calls++;
      if(page.format!=='heloscrum-source-page'||typeof page.text!=='string'||page.offset!==offset||page.endOffset!==offset+page.text.length||!Number.isInteger(page.totalCharacters)||page.totalCharacters<page.endOffset||!(/^[a-f0-9]{64}$/).test(page.sha256)||sha256&&page.sha256!==sha256||total!==undefined&&page.totalCharacters!==total)throw Error('Source changed or returned an invalid continuation');
      if(page.nextOffset===null){if(page.endOffset!==page.totalCharacters)throw Error('Source ended before the expected range');}
      else if(page.nextOffset!==page.endOffset||page.nextOffset<=offset)throw Error('Source returned a non-progressing continuation');
      if(Buffer.byteLength(text)+Buffer.byteLength(page.text)>MAX_BYTES)throw Error('Source exceeds 20 MiB');
      sha256=page.sha256;total=page.totalCharacters;text+=page.text;
      offset=page.endOffset;
      if(page.nextOffset===null)break;
      // Tiny transport pages must not each rewrite the entire growing file or
      // launch PowerShell for another protected temporary file on Windows.
      // Abrupt termination can replay at most one batch; ordinary errors flush
      // all validated progress before they propagate.
      if(Buffer.byteLength(text)-savedBytes>=CHECKPOINT_BYTES)await checkpointProgress();
    }}catch(error){
      try{await checkpointProgress();}catch(checkpointError){throw new AggregateError([error,checkpointError],error.message+'; could not save download progress');}
      throw error;
    }
    const result=await writeVerifiedSource(output,Buffer.from(text),{sha256});await rm(checkpoint,{force:true});
    return {...result,source:{...identity,sha256},resumed:saved!==undefined,calls,note:'Exact local copy. Delivery does not certify reading or review.'};
  }finally{await guard.close();await rm(lock,{force:true});}
}
