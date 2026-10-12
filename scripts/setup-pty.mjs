import { chmod, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
if(process.platform==='darwin')for(const location of [`../node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`,'../node_modules/node-pty/build/Release/spawn-helper']){const target=fileURLToPath(new URL(location,import.meta.url));try{await access(target);await chmod(target,0o755);}catch(error){if(error.code!=='ENOENT')throw error;}}
