import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('trial server rejects cross-origin and unauthenticated requests without sending keys',async t=>{
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/voyage-memory-trial.mjs',import.meta.url))],{env:{...process.env,HELOSCRUM_VOYAGE_TRIAL_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Trial server did not start')),10000);child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Trial server exited '+code));});});
  const origin='http://127.0.0.1:'+port;
  assert.equal((await fetch(origin+'/api/state')).status,401);
  const page=await fetch(origin),cookie=page.headers.get('set-cookie').split(';')[0];assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(page.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const state=await fetch(origin+'/api/state',{headers:{cookie}}).then(r=>r.json());assert.equal(state.hasKey,false);assert.equal(state.usage,undefined);assert.equal(state.corpus.documents.length,8);
  for(const headers of [{cookie,origin:'https://untrusted.example','X-Trial-Token':state.token},{cookie,origin,'X-Trial-Token':'invalid'},{origin,'X-Trial-Token':state.token}])assert.ok([401,403].includes((await fetch(origin+'/api/run',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{"apiKey":"not-sent"}'})).status));
  const invalid=await fetch(origin+'/api/run',{method:'POST',headers:{cookie,origin,'X-Trial-Token':state.token,'Content-Type':'application/json'},body:'{"apiKey":""}'});assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/valid Voyage API key/);
  assert.equal((await fetch(origin+'/api/state',{headers:{cookie}}).then(r=>r.json())).hasKey,false);
  assert.equal((await fetch(origin+'/favicon.ico')).status,204);
});
