#!/usr/bin/env node
import {readFile, mkdir, realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const codeRoot = fileURLToPath(new URL('../', import.meta.url));
const home = process.env.HELOSCRUM_DESKTOP_HOME || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/HeloScrum') : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'heloscrum'));
try {
  if (process.platform === 'win32') throw Error('Native Windows support is not ready. See docs/PLATFORM_TESTING.md.');
  const args = process.argv.slice(2);
  if (args.some((arg, i) => i % 2 === 0 && !['--root', '--port'].includes(arg)) || args.length % 2) throw Error('Usage: npm run desktop -- [--root /absolute/workspace] [--port 0]');
  let saved = {};
  try {saved = JSON.parse(await readFile(path.join(home, 'launcher.json'), 'utf8'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
  const options = Object.fromEntries(Array.from({length: args.length / 2}, (_, i) => [args[i * 2].slice(2), args[i * 2 + 1]]));
  const root = options.root || saved.root;
  if (!root || !path.isAbsolute(root)) throw Error('Choose a workspace first: bash scripts/setup-desktop.sh');
  await mkdir(home, {recursive: true, mode: 0o700});
  const require = createRequire(path.join(codeRoot, 'desktop/package.json'));
  let electron;
  try {electron = require('electron');} catch {throw Error('Electron is not installed. Run bash scripts/setup-desktop.sh.');}
  const config = {node: process.execPath, home, root: await realpath(root)};
  if (options.port !== undefined) {config.port = Number(options.port); if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw Error('Port must be between 0 and 65535.');}
  const env = {...process.env, HELOSCRUM_DESKTOP_CONFIG: JSON.stringify(config), PATH: [path.dirname(process.execPath), path.join(home, 'bin'), path.join(home, 'tools/bin'), path.join(os.homedir(), '.local/bin'), saved.path || '', process.env.PATH || ''].filter(Boolean).join(path.delimiter)};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(electron, [path.join(codeRoot, 'desktop')], {cwd: codeRoot, env, stdio: 'inherit'});
  child.on('error', error => {console.error(`Cannot launch Electron: ${error.message}`); process.exitCode = 1;});
  child.on('exit', (code, signal) => {process.exitCode = code ?? (signal ? 1 : 0);});
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch (error) {console.error(error.message); process.exitCode = 1;}
