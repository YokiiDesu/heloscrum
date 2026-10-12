const {spawn} = require('node:child_process');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {readFileSync} = require('node:fs');

function preferredPort(root) {
  try {
    const saved=JSON.parse(readFileSync(path.join(root,'.heloscrum/api-owner.json'),'utf8'));
    const url=new URL(saved.url);
    if(saved.kind==='owner'&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>0)return Number(url.port);
  } catch {}
  return 44000 + parseInt(createHash('sha256').update(root).digest('hex').slice(0, 6), 16) % 10000;
}

// Use regular Node, not Electron's Node ABI: DuckDB and PTY stay compatible with npm ci.
function startBackend({node, codeRoot, root, port = preferredPort(root), env = process.env, log = () => {}, timeout = 45000, startEngine = false}) {
  const childEnv = {...env, PORT: String(port), HELOSCRUM_ROOT: root, HELOSCRUM_DESKTOP_CHILD: '1', HELOSCRUM_DESKTOP_ENGINE: startEngine ? '1' : '0'};
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.NODE_OPTIONS;
  const child = spawn(node, [path.join(codeRoot, 'server.mjs')], {
    cwd: codeRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let stopped = false, stopPromise, tail = '';
  const output = chunk => {tail = (tail + chunk).slice(-12000); log(String(chunk));};
  child.stdout.on('data', output);
  child.stderr.on('data', output);
  const exited = new Promise(resolve => {child.once('exit', (code, signal) => resolve({code, signal})); child.once('error', error => resolve({error}));});
  const stop = () => stopPromise ||= (async () => {
    stopped = true;
    if (child.exitCode !== null || child.signalCode || !child.pid) return;
    if (child.connected) child.send({type: 'heloscrum:shutdown'}, () => {});
    else child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    await exited;
    clearTimeout(timer);
  })();
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('The local server did not become ready within 45 seconds. See the desktop log.')), timeout);
    const fail = error => {clearTimeout(timer); reject(error);};
    child.once('error', fail);
    child.once('exit', (code, signal) => fail(Error(`Local server stopped (${signal || code}). ${tail.trim().slice(-3000)}`)));
    child.on('message', message => {
      if (message?.type !== 'heloscrum:ready') return;
      if (stopped && child.connected) child.send({type: 'heloscrum:shutdown'}, () => {});
      let url;
      try {url = new URL(message.url);} catch {return fail(Error('Invalid local-server address.'));}
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || path.resolve(message.root) !== path.resolve(root)) return fail(Error('Unexpected local-server readiness response.'));
      clearTimeout(timer);
      resolve({url: url.origin, pid: child.pid});
    });
  }).catch(async error => {await stop(); throw error;});
  let sequence=0;
  const activity=()=>new Promise(resolve=>{
    if(!child.connected)return resolve(null);
    const id=++sequence;
    const finish=value=>{clearTimeout(timer);child.off('message',receive);resolve(value);};
    const receive=message=>{if(message?.type==='heloscrum:activity'&&message.id===id)finish(message.state);};
    const timer=setTimeout(()=>finish(null),3000);
    child.on('message',receive);
    child.send({type:'heloscrum:activity',id},error=>{if(error)finish(null);});
  });
  return {child, ready, exited, stop, activity, get stopped() {return stopped;}};
}
module.exports = {startBackend, preferredPort};
