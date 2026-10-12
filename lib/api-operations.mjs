import {randomUUID,createHash} from 'node:crypto';
import {assert,string} from './adapters.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function apiError(error){const status=Number(error.status)||400;return {code:status===401?'UNAUTHENTICATED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':status===409?'CONFLICT':status===429?'LIMIT_REACHED':status>=500?'BACKEND_ERROR':'INVALID_INPUT',message:String(error.message||error).slice(0,2000),status};}
export class ApiOperations {
  constructor(plane){this.plane=plane;plane.data.api.operations||=[];this.queue=Promise.resolve();this.accepting=true;}
  get records(){return this.plane.data.api.operations;}
  async init(){let changed=false;for(const op of this.records)if(['queued','running'].includes(op.status)){op.status='uncertain';op.error={code:'OUTCOME_UNCERTAIN',message:'Backend restarted during this operation. Inspect the resource or agent session before issuing new work.'};op.finishedAt=new Date().toISOString();changed=true;}if(changed)await this.plane.save();}
  read(id,principal){const op=this.records.find(o=>o.id===id);assert(op&&(principal.kind==='owner'||op.callerId===principal.id),'Operation not found',404);const {fingerprint,key,...value}=op;return value;}
  list(principal,key){return this.records.filter(o=>(principal.kind==='owner'||o.callerId===principal.id)&&(!key||o.key===key)).slice().reverse().map(o=>this.read(o.id,principal));}
  async submit(principal,route,project,input,key,execute){
    assert(this.accepting,'Backend is stopping',503);string(key,'Idempotency-Key',120);
    const fingerprint=createHash('sha256').update(JSON.stringify(canonical({route:route.id,project,input}))).digest('hex');
    const existing=this.records.find(o=>o.callerId===principal.id&&o.key===key);
    if(existing){assert(existing.fingerprint===fingerprint,'Idempotency-Key was already used with different input',409);return this.read(existing.id,principal);}
    const cutoff=Date.now()-30*86400000;
    this.plane.data.api.operations=this.records.filter(o=>!o.finishedAt||Date.parse(o.finishedAt)>=cutoff);
    assert(this.records.length<2000,'Operation ledger is full; retained results expire after 30 days',429);
    const op={id:randomUUID(),key,fingerprint,callerId:principal.id,project,action:route.id,status:'queued',createdAt:new Date().toISOString()};this.records.push(op);
    try{await this.plane.save();}catch(error){this.plane.data.api.operations=this.records.filter(o=>o!==op);throw error;}
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      op.status='running';op.startedAt=new Date().toISOString();
      try{
        await this.plane.save();const result=await execute();
        op.result=route.entity==='plan'?{id:result.id,title:result.title,status:result.status,revision:result.revision,itemIds:result.items.map(i=>i.id),proposalIds:result.proposals?.filter(p=>p.status==='pending').map(p=>p.id)||[]}:result;
        op.status='succeeded';
      }catch(error){
        // An adapter or persistence failure may happen after a side effect.
        // Only an explicit domain rejection is safe to report as a known failure.
        const uncertain=!error.status||error.status>=500;
        op.error=uncertain?{code:'OUTCOME_UNCERTAIN',message:'Outcome could not be confirmed: '+String(error.message).slice(0,1600)+'. Inspect the resource before issuing new work.',status:503}:apiError(error);
        op.status=uncertain?'uncertain':'failed';
      }
      op.finishedAt=new Date().toISOString();
      try{await this.plane.save();}catch{op.status='uncertain';op.error={code:'OUTCOME_UNCERTAIN',message:'The operation result could not be saved. Inspect the resource before retrying.'};}
    });
    return this.read(op.id,principal);
  }
  async close(){this.accepting=false;await this.queue;}
}
