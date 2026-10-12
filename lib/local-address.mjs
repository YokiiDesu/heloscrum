import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {privateJSON} from './api-access.mjs';

export function localAddress(value) {
  try {const url=new URL(value);return url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!!url.port&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;} catch {return false;}
}
// Publish the actual listening address after port 0 or a desktop port fallback.
// Tokens and identity fields stay unchanged; only known connection files are read.
export async function refreshLocalAddress(root, url) {
  if(!localAddress(url))throw Error('Expected a loopback server address');
  const base=path.join(root,'.heloscrum');
  const files=[path.join(base,'api-owner.json')];
  for(const directory of ['agents','external-contacts']){
    let entries=[];try{entries=await readdir(path.join(base,directory),{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const entry of entries)if(entry.isDirectory()&&/^[a-f0-9-]{36}$/i.test(entry.name))files.push(path.join(base,directory,entry.name,'connection.json'));
  }
  for(const file of files){
    let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(saved.url!==url)await privateJSON(file,{...saved,url});
  }
}
