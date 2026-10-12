import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as pty from './pty.mjs';
import {managedProvider} from './providers.mjs';
import { assert } from './adapters.mjs';
import { validRequest } from './security.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const codeRoot=fileURLToPath(new URL('..',import.meta.url));
export class Terminals {
  constructor(server,plane,port,authenticate,{spawn=pty.spawn}={}){this.spawn=spawn;this.plane=plane;this.pending=new Map();this.live=new Set();this.nativeConnections=new Map();this.wss=new WebSocketServer({noServer:true,maxPayload:64000,handleProtocols:()=> 'heloscrum'});
    server.on('upgrade',(req,socket,head)=>{
      const protocols=(req.headers['sec-websocket-protocol']||'').split(',').map(s=>s.trim());const id=new URL(req.url,'http://localhost').pathname.match(/^\/terminal\/([a-f0-9-]+)$/)?.[1],ticket=this.pending.get(id);
      if(!validRequest(req,typeof port==='function'?port():port)||!req.headers.origin||protocols[0]!=='heloscrum'||!authenticate(protocols[1])||!ticket||ticket.expires<Date.now()){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      this.pending.delete(id);this.wss.handleUpgrade(req,socket,head,ws=>this.attach(ws,ticket));
    });
  }
  async ticket(id,{cols=80,rows=24}={}){
    assert(this.live.size+this.pending.size<8,'Too many terminal connections',409);
    const task=this.plane.task(id);assert(!task.kind||['codex','claude','kiro','cursor'].includes(task.kind)&&!managedProvider(task),'This launch mode has no interactive native terminal',409);
    assert(task.phase!=='switching','Wait for the session change to finish',409);assert(task.pane,'Agent is still starting',409);
    assert(Number.isInteger(cols)&&Number.isInteger(rows),'Terminal dimensions must be integers');
    const previous=this.nativeConnections.get(id);
    // Wait only for a client that is already detaching. Never take over an
    // actively used terminal in another tab, card or external provider window.
    if(previous&&(previous.closing||previous.ws.readyState>=2)){let timer;await Promise.race([previous.exited,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);clearTimeout(timer);}
    const available=()=>assert(!this.nativeConnections.has(id)&&![...this.pending.values()].some(t=>t.task?.id===id),'This agent terminal is already open in another view. Close that terminal, then reconnect here.',409);
    available();const terminal=await this.plane.herdr.terminal(task.pane);available();
    const ticket=randomUUID();this.pending.set(ticket,{task,terminal,cols:Math.max(20,Math.min(300,cols)),rows:Math.max(1,Math.min(100,rows)),expires:Date.now()+15000});
    setTimeout(()=>this.pending.delete(ticket),16000).unref();return {id:ticket};
  }

  tuiTicket({project=this.plane.data.project,cols=120,rows=34,motion=true}={}){
    assert(this.live.size+this.pending.size<8,'Too many terminal connections',409);
    this.plane.projects.project(project);
    assert(Number.isInteger(cols)&&Number.isInteger(rows),'Terminal dimensions must be integers');
    const id=randomUUID();this.pending.set(id,{type:'tui',project,cols:Math.max(50,Math.min(300,cols)),rows:Math.max(16,Math.min(100,rows)),motion:motion!==false,expires:Date.now()+15000});
    setTimeout(()=>this.pending.delete(id),16000).unref();return {id};
  }
  attach(ws,ticket){
    const {task,terminal}=ticket;
    let client;try{
      if(ticket.type==='tui'){
        const env={...process.env,TERM:'xterm-256color',COLORTERM:'truecolor',FORCE_COLOR:'3'};delete env.NO_COLOR;
        client=this.spawn(process.execPath,[path.join(codeRoot,'bin/heloscrum.mjs'),'tui','--credential',path.join(this.plane.root,'.heloscrum/api-owner.json'),'--project',ticket.project,...(ticket.motion?[]:['--no-motion'])],{name:'xterm-256color',cols:ticket.cols,rows:ticket.rows,cwd:codeRoot,env});
      }else client=this.spawn(this.plane.tools.herdr,['--session',this.plane.herdr.session,'terminal','attach',terminal],{name:'xterm-256color',cols:ticket.cols,rows:ticket.rows,cwd:task.path,env:{...this.plane.herdr.env,TERM:'xterm-256color'}});
    }catch(error){ws.send(JSON.stringify({error:error.message}));ws.close();return;}
    let released;const connection=task?{ws,closing:false,exited:new Promise(resolve=>{released=resolve;})}:null;if(connection)this.nativeConnections.set(task.id,connection);
    this.live.add(client);const out=client.onData(data=>{if(ws.readyState===1){if(ws.bufferedAmount>1024*1024)ws.close(1013,'Output overflow');else ws.send(JSON.stringify({data}));}});
    client.onExit(({exitCode})=>{this.live.delete(client);if(connection&&this.nativeConnections.get(task.id)===connection)this.nativeConnections.delete(task.id);released?.();if(ws.readyState===1){ws.send(JSON.stringify({exitCode}));ws.close();}});
    ws.on('message',raw=>{try{const message=JSON.parse(raw);if(typeof message.data==='string'&&message.data.length<=16000)client.write(message.data);if(Number.isInteger(message.cols)&&Number.isInteger(message.rows))client.resize(Math.max(20,Math.min(300,message.cols)),Math.max(1,Math.min(100,message.rows)));}catch{ws.close(1008,'Invalid terminal message');}});
    ws.on('close',()=>{out.dispose();if(connection)connection.closing=true;try{client.kill();}catch{}});ws.on('error',()=>ws.close());
  }
  close(){for(const client of this.live)try{client.kill();}catch{}this.wss.close();}
}
