import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {HistoryStore} from '../lib/history-store.mjs';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw Error('Usage: node scripts/restore-history.mjs export.json NEW-archive.duckdb');
try{await access(destination);throw Error('Destination already exists; choose a new file');}catch(error){if(error.code!=='ENOENT')throw error;}
const data=JSON.parse(await readFile(source,'utf8'));let db;
try{db=await new HistoryStore(path.resolve(destination)).init();await db.importExport(data);const summary=await db.summary(data.project);console.log(JSON.stringify({restored:db.file,sessions:summary.sessions.length,counts:summary.counts},null,2));}finally{await db?.close();}
