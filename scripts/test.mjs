import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Enumerate in Node rather than relying on Bash glob expansion on Windows.
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await readdir(new URL('../test/',import.meta.url)))
  .filter(name=>name.endsWith('.test.mjs')).sort().map(name=>`test/${name}`);
// Keep Git fixture bytes deterministic without changing the developer's Git
// configuration. Production still honors each user's line-ending settings.
const env={...process.env},count=Number(env.GIT_CONFIG_COUNT||0);
env.GIT_CONFIG_COUNT=String(count+1);env['GIT_CONFIG_KEY_'+count]='core.autocrlf';env['GIT_CONFIG_VALUE_'+count]='false';
const child=spawn(process.execPath,['--test','--test-concurrency=2',...process.argv.slice(2),...files],{cwd:root,stdio:'inherit',env});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
