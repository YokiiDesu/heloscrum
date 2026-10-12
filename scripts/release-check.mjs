import {readFile, access, lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
for (const name of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','SECURITY.md','CONTRIBUTING.md','docs/GETTING_STARTED.md','website/index.html','.github/workflows/ci.yml']) {
  try {await access(path.join(root,name));} catch {errors.push(`Missing ${name}`);}
}
const pkg = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if (pkg.license !== 'Apache-2.0') errors.push('Expected the approved Apache-2.0 license.');
const names = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for (const name of new Set(names)) {
  if (/(^|\/)(\.heloscrum|node_modules|\.openai|benchmarks)(\/|$)|(^|\/)\.env($|\.)|\.(log|pem|key)$/.test(name) && !name.endsWith('.env.example')) {errors.push(`Private or generated file in candidate: ${name}`);continue;}
  if ((await lstat(path.join(root,name))).isSymbolicLink()) {errors.push(`Symbolic link in candidate: ${name}; package a portable file instead.`);continue;}
  const bytes = await readFile(path.join(root,name));
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  if (/(?:\/(?:Users|home)\/|[A-Za-z]:[\\/]+Users[\\/]+)[^/\\\s"'<>`]+[/\\]/i.test(text)) errors.push(`Absolute home-directory path in ${name}; use a portable example or resolve the user's home at runtime.`);
  if (!name.endsWith('.md')) continue;
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    try {await access(path.resolve(root,path.dirname(name),decodeURIComponent(target)));}
    catch {errors.push(`Missing local link in ${name}: ${target}`);}
  }
}
if (errors.length) {console.error(errors.join('\n')); process.exitCode=1;}
else console.log(`Release metadata and local documentation links checked (${new Set(names).size} candidate files).`);
