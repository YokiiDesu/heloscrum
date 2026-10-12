import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = ['server.mjs'];
for (const dir of ['dist', 'lib', 'scripts', 'test', 'bin', 'cli', 'website', 'desktop']) {
  files.push(...(await readdir(dir)).filter(file => /\.[cm]?js$/.test(file)).map(file => `${dir}/${file}`));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
