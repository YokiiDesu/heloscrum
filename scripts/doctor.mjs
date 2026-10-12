#!/usr/bin/env node
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {providerIds, providerBinary, nativeProviderIds} from '../lib/providers.mjs';

const codeRoot = fileURLToPath(new URL('../', import.meta.url));

// Checks are read-only: no agent turns, installs, credential reads, or server starts.
export async function diagnose({root = codeRoot, provider, env = process.env} = {}) {
  if (provider && !providerIds.includes(provider)) throw new Error(`Unknown provider: ${provider}. Choose ${providerIds.join(', ')}.`);
  const checks = [];
  const add = (name, status, detail) => checks.push({name, status, detail});
  const [major, minor] = process.versions.node.split('.').map(Number);
  add('Node.js', major > 22 || major === 22 && minor >= 13 ? 'pass' : 'fail', `${process.versions.node}; requires 22.13 or newer`);
  add('Platform', process.platform === 'darwin' ? 'pass' : 'warn', process.platform === 'darwin' ? 'macOS; validated desktop platform' : `${process.platform}; native agent operation is not yet validated on this platform`);
  async function executable(name, required, hint) {
    const override = env[`HELOSCRUM_${name.toUpperCase()}_BIN`];
    const binary = providerBinary(name);
    const candidates = [override, path.join(root, '.heloscrum/bin', binary), ...(env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, binary))].filter(Boolean);
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        const result = spawnSync(candidate, ['--version'], {encoding:'utf8', timeout:5000, maxBuffer:8192, env});
        if (result.error || result.status !== 0) {
          add(name, required ? 'fail' : 'warn', `Found ${candidate}, but --version failed. ${hint}`);
          return false;
        }
        const version = String(result.stdout || result.stderr || '').split('\n')[0].replace(/[\x00-\x1f\x7f]/g, '').slice(0,160);
        add(name, 'pass', `${version || 'Available'} (${candidate})`);
        return true;
      } catch (error) { if (!['ENOENT','EACCES','ENOTDIR'].includes(error.code)) throw error; }
    }
    add(name, required ? 'fail' : 'warn', `Not found. ${hint}`);
    return false;
  }
  await executable('git', true, 'Install Git and reopen your terminal.');
  for (const name of ['@duckdb/node-api','node-pty']) {
    try {
      const module = await import(name);
      if (name === '@duckdb/node-api') {
        const database = await module.DuckDBInstance.create(':memory:');
        database.closeSync();
      }
      if (name === 'node-pty' && process.platform === 'darwin') {
        const locations = ['prebuilds/darwin-'+process.arch+'/spawn-helper','build/Release/spawn-helper'];
        const available = await Promise.all(locations.map(file => access(path.join(codeRoot,'node_modules/node-pty',file),constants.X_OK).then(()=>true,()=>false)));
        if (!available.some(Boolean)) throw new Error('PTY spawn helper is missing or not executable');
      }
      add(name, 'pass', 'Native module loaded');
    } catch {
      add(name, 'fail', 'Native module unavailable. Run npm ci; see docs/GETTING_STARTED.md for native build prerequisites.');
    }
  }
  const native = nativeProviderIds.includes(provider);
  await executable('herdr', native, 'Required for Codex, Claude Code, and Kiro CLI. Install Herdr 0.9.0: https://github.com/herdrdev/herdr/releases/tag/v0.9.0');
  for (const name of provider ? [provider] : [...nativeProviderIds,'cursor']) {
    if (['ollama','llamacpp','lmstudio','bedrock','sagemaker'].includes(name)) {
      add(name, 'warn', 'Configure and Test connection in Project settings → AI & context. This diagnostic does not read credentials or call model endpoints.');
      if (['bedrock','sagemaker'].includes(name)) await executable('aws', true, 'Install AWS CLI v2 and authenticate your selected profile.');
    } else await executable(name, !!provider, 'Install and sign in to this provider separately; see docs/GETTING_STARTED.md.');
  }
  add('Provider authentication', 'warn', 'Not checked. CLI detection does not establish login or available quota; no paid model calls were made.');
  return {ok: !checks.some(c => c.status === 'fail'), checks};
}

export function formatDiagnosis(result) {
  return ['HeloScrum setup check', '', ...result.checks.map(c => `${c.status.toUpperCase().padEnd(4)}  ${c.name}: ${c.detail}`), '', result.ok ? 'Core checks passed. Follow docs/GETTING_STARTED.md to connect a provider.' : 'Fix the failed checks, then run doctor again.', ''].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const providerAt = args.indexOf('--provider');
    if (providerAt >= 0 && (!args[providerAt+1] || args[providerAt+1].startsWith('--'))) throw new Error('Supply a provider after --provider.');
    const result = await diagnose({root:process.env.HELOSCRUM_ROOT || codeRoot, provider:providerAt >= 0 ? args[providerAt+1] : undefined});
    console.log(args.includes('--json') ? JSON.stringify(result) : formatDiagnosis(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
