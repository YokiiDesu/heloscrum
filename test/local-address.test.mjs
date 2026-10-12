import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateJSON} from '../lib/api-access.mjs';
import {refreshLocalAddress, localAddress} from '../lib/local-address.mjs';

test('actual local address is published without changing connection identities or credentials', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-address '));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const id='12345678-1234-1234-1234-123456789abc';
  await mkdir(path.join(root,'.heloscrum/agents',id),{recursive:true});
  const files=['api-owner.json',`agents/${id}/connection.json`];
  const original={url:'http://127.0.0.1:0',token:'keep-capability',taskId:id};
  for(const file of files)await privateJSON(path.join(root,'.heloscrum',file),original);
  await refreshLocalAddress(root,'http://127.0.0.1:54545');
  for(const file of files)assert.deepEqual(JSON.parse(await readFile(path.join(root,'.heloscrum',file),'utf8')),{...original,url:'http://127.0.0.1:54545'});
  assert.equal(localAddress('https://example.com:444/'),false);
  assert.equal(localAddress('http://127.0.0.1:444@evil.test:444/'),false);
  await assert.rejects(refreshLocalAddress(root,'http://remote.test:444'));
});

test('a running MCP bridge follows a changed local port but refuses a changed identity', {timeout:15000}, async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'heloscrum-mcp-address '));
  t.after(()=>rm(root,{recursive:true,force:true}));
  async function endpoint(name){
    const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer same-token');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/catalog')?{revision:1,tools:[{name,description:name,inputSchema:{type:'object'}}]}:{ok:true}));});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const first=await endpoint('before_restart'),next=await endpoint('after_restart');
  const file=path.join(root,'connection.json'),config={url:first,token:'same-token',taskId:'same-agent'};
  await privateJSON(file,config);
  const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url)),file],{stdio:['pipe','pipe','pipe']});
  t.after(()=>{child.stdin.end();child.kill();});
  const pending=new Map();let id=0;
  createInterface({input:child.stdout}).on('line',line=>{const message=JSON.parse(line),p=pending.get(message.id);if(!p)return;clearTimeout(p.timer);pending.delete(message.id);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);});
  child.stderr.on('data',()=>{});
  function call(){return new Promise((resolve,reject)=>{const number=++id,timer=setTimeout(()=>reject(Error('MCP response timed out')),5000);pending.set(number,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:number,method:'tools/list'})+'\n');});}
  assert.equal((await call()).tools[0].name,'before_restart');
  await privateJSON(file,{...config,url:next});
  assert.equal((await call()).tools[0].name,'after_restart');
  await privateJSON(file,{...config,url:next,taskId:'another-agent'});
  await assert.rejects(call(),/identity changed/);
});
