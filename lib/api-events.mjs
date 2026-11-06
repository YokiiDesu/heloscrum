import {createHash} from 'node:crypto';
import {projectId} from './api-access.mjs';
import {assert} from './adapters.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ApiEvents {
  constructor(plane){
    this.plane=plane;this.listeners=new Set();this.streams=new Set();this.subscribers=new Map();this.signatures=new Map();this.observed=new Map();
    plane.data.api||={};plane.data.api.events||=[];plane.data.api.sequence||=0;
    for(const p of plane.projects.known())this.signatures.set(p,this.signature(p));
    plane.apiEvents=this;
  }
  signature(project){
    const d=this.plane.data,c=d.collaboration||{};
    return digest({externalContacts:c.externalContacts?.filter(t=>t.project===project),tasks:d.tasks.filter(t=>t.project===project),plans:d.workPlans?.filter(p=>p.project===project),messages:c.messages?.filter(m=>m.project===project),groups:c.threads?.filter(t=>t.project===project),structures:c.structures?.filter(s=>s.project===project),memory:c.memory?.filter(m=>m.project===project),settings:d.projectSettings,profiles:d.agentProfiles,tools:c.tools,servers:d.mcpServers?.map(({id,revision,enabled,tools})=>({id,revision,enabled,tools})),reviews:d.changeReviews?.filter(r=>r.project===project),events:d.events?.filter(e=>e.project===project),observed:this.observed.get(project)});
  }
  prepare(){
    const data=this.plane.data.api;
    for(const project of this.plane.projects.known()){
      const value=this.signature(project);if(value===this.signatures.get(project))continue;
      this.signatures.set(project,value);data.events.push({id:String(++data.sequence),type:'workspace.changed',projectId:projectId(project),at:new Date().toISOString()});
    }
    data.events=data.events.slice(-2000);
  }
  committed(events){for(const listener of this.listeners)listener(events);}
  async observe(project,value,source='history'){const hash=digest(value),previous=this.observed.get(project)||{};if(previous[source]===hash)return;this.observed.set(project,{...previous,[source]:hash});await this.plane.save();}
  start(){
    this.timer=setInterval(()=>{
      if(this.pending||!this.subscribers.size)return;
      this.pending=this.poll().catch(()=>{}).finally(()=>{this.pending=null;});
    },2500);this.timer.unref();
  }
  async poll(){
    const live=await this.plane.herdr.list();
    for(const project of this.subscribers.keys()){
      const values=[];
      for(const task of this.plane.data.tasks.filter(t=>t.project===project&&!t.archivedAt&&!t.trashedAt)){
        const agent=live.find(a=>a.pane_id===task.pane),status=agent?.agent_status||'offline';
        let events;
        if(['working','starting','blocked'].includes(status))try{events=(await this.plane.transcripts.readCurrent(task,agent)).events;}catch{}
        values.push({id:task.id,status,events});
      }
      await this.observe(project,values,'live');
    }
  }
  stream(req,res,project,check){
    const data=this.plane.data.api,last=req.headers['last-event-id']||new URL(req.url,'http://localhost').searchParams.get('after');
    assert(!last||/^\d+$/.test(last)&&Number.isSafeInteger(Number(last))&&Number(last)<=data.sequence,'Invalid event cursor');
    let cursor=last?Number(last):data.sequence,closed=false;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    this.subscribers.set(project,(this.subscribers.get(project)||0)+1);
    const close=()=>{if(closed)return;closed=true;clearInterval(timer);this.listeners.delete(deliver);this.streams.delete(close);const count=this.subscribers.get(project)-1;if(count)this.subscribers.set(project,count);else this.subscribers.delete(project);res.end();};
    const write=(type,value,id)=>{if(!res.write(`${id?'id: '+id+'\n':''}event: ${type}\ndata: ${JSON.stringify(value)}\n\n`))close();};
    const deliver=events=>{
      if(closed)return;try{check();}catch{write('access.revoked',{});close();return;}
      if(cursor<(events[0]?Number(events[0].id)-1:0)){cursor=data.sequence;write('resync',{cursor:String(cursor)},String(cursor));return;}
      for(const event of events){if(Number(event.id)<=cursor)continue;cursor=Number(event.id);if(event.projectId===projectId(project))write(event.type,event,event.id);if(closed)break;}
    };
    const timer=setInterval(()=>{deliver(this.plane.data.api.events);if(!closed)res.write(': heartbeat\n\n');},15000);timer.unref();
    this.listeners.add(deliver);this.streams.add(close);res.on('close',close);
    write('ready',{cursor:String(cursor)},String(cursor));deliver(data.events);
    return close;
  }
  async close(){clearInterval(this.timer);for(const close of [...this.streams])close();await this.pending;}
}
