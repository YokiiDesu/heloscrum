import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Only contacts with an explicitly saved relay configuration opt in. No
// registration, group membership, credential creation or network exposure here.
export async function startEventRelays(plane,{launch=spawn}={}){
  const children=[];
  for(const contact of plane.collaboration.external.active()){
    if(contact.client!=='generic')continue;
    const dir=path.join(plane.root,'.heloscrum/external-contacts',contact.id),file=path.join(dir,'events-relay.json');
    try{
      const config=JSON.parse(await readFile(file,'utf8'));
      if(config.cloudChatId!==contact.externalSessionId||config.connectionFile!==path.join(dir,'connection.json'))throw Error('Cloud contact configuration mismatch');
      let running=false;
      try{const pid=Number(await readFile(path.join(dir,'relay.lock'),'utf8'));if(Number.isInteger(pid)&&pid>0){process.kill(pid,0);running=true;}}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
      if(running)continue;
      const child=launch(process.execPath,[path.join(plane.collaboration.codeRoot,'scripts/mcp-events-relay.mjs'),file],{stdio:['ignore','inherit','inherit']});
      child.on('error',()=>console.error('HeloScrum cloud inbox relay could not start.'));children.push(child);
    }catch(error){if(error.code!=='ENOENT')console.error('HeloScrum cloud inbox relay configuration needs attention.');}
  }
  return {close(){for(const child of children)child.kill('SIGTERM');},count:children.length};
}
