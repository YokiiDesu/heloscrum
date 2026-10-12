import {atomicPrivateWrite} from './private-files.mjs';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
import path from 'node:path';
import {assert,idFor,string} from './adapters.mjs';
import {API_SCOPES} from './api-contract.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const projectId=project=>'prj_'+idFor(project);
export async function privateJSON(file,value){
  await atomicPrivateWrite(file,JSON.stringify(value,null,2)+'\n');
}
export class ApiAccess {
  constructor(plane){this.plane=plane;plane.data.api||={};plane.data.api.credentials||=[];}
  get records(){return this.plane.data.api.credentials;}
  async init(){
    const file=path.join(this.plane.root,'.heloscrum/api-owner.json');let saved;
    try{saved=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    let owner=this.records.find(r=>r.id==='local-owner');
    if(!owner){owner={id:'local-owner',kind:'owner',name:'Local owner',createdAt:new Date().toISOString(),projects:['*'],scopes:['*']};this.records.push(owner);}
    const token=saved?.token&&hash(saved.token)===owner.hash?saved.token:'hs_'+randomBytes(32).toString('hex');
    owner.hash=hash(token);await this.plane.save();
    await privateJSON(file,{url:this.plane.baseUrl,token,id:owner.id,kind:'owner'});
    return this;
  }
  public(record){const {hash,...value}=record;return value;}
  current(id){
    const record=this.records.find(r=>r.id===id);
    assert(record&&!record.revokedAt&&(!record.expiresAt||Date.parse(record.expiresAt)>Date.now()),'Credential is invalid, expired, or revoked',401);
    if(record.kind==='agent')assert(this.plane.data.tasks.some(t=>t.id===record.agentId&&!t.archivedAt&&!t.trashedAt&&!t.organizing),'Agent session is no longer active',403);
    return record;
  }
  authenticate(header){
    assert(typeof header==='string'&&/^Bearer hs_[a-f0-9]{64}$/.test(header),'Use a HeloScrum bearer credential',401);
    const candidate=Buffer.from(hash(header.slice(7)),'hex');
    const record=this.records.find(r=>r.hash&&timingSafeEqual(Buffer.from(r.hash,'hex'),candidate));
    return this.current(record?.id);
  }
  project(id){const project=this.plane.projects.known().find(p=>projectId(p)===id);assert(project,'Project not found',404);return project;}
  allows(record,project){return record.kind==='owner'||record.projects.includes(projectId(project));}
  permit(principal,route,project){
    const record=this.current(principal.id);
    assert(!route.owner||record.kind==='owner','This action requires the local owner',403);
    assert(!route.human||record.kind!=='agent','An agent cannot use an owner or operator action',403);
    assert(!route.scope||record.scopes.includes('*')||record.scopes.includes(route.scope),'Credential does not include '+route.scope,403);
    if(project)assert(this.allows(record,project),'Project is outside this credential',403);
    return record;
  }
  actor(principal,project){
    const record=this.current(principal.id);
    if(record.kind==='agent'){
      const task=this.plane.data.tasks.find(t=>t.id===record.agentId&&t.project===project);assert(task,'Agent does not belong to this project',403);return task;
    }
    return {id:record.kind==='owner'?'human':record.id,human:true,role:record.kind==='owner'?'You':record.name,project};
  }
  async create(input){
    const name=string(input.name,'credential name',100);
    assert(input.projects.length>0&&input.projects.every(id=>this.plane.projects.known().some(p=>projectId(p)===id)),'Choose registered project IDs');
    assert(input.scopes.length>0&&input.scopes.every(s=>API_SCOPES.includes(s)),'Choose supported scopes; wildcard grants are reserved for the local owner');
    assert(['agent','operator'].includes(input.kind),'Choose an agent or operator credential');
    if(input.kind==='agent'){
      const task=this.plane.data.tasks.find(t=>t.id===input.agentId&&!t.archivedAt&&!t.trashedAt);
      assert(task&&input.projects.length===1&&input.projects[0]===projectId(task.project),'Bind the credential to one active agent and its project');
    }else assert(!input.agentId,'Operator credentials cannot impersonate an agent');
    const expiresAt=input.expiresAt?new Date(input.expiresAt).toISOString():null;
    assert(!expiresAt||Date.parse(expiresAt)>Date.now(),'Expiry must be in the future');
    const token='hs_'+randomBytes(32).toString('hex'),record={id:randomUUID(),kind:input.kind,name,projects:[...new Set(input.projects)],scopes:[...new Set(input.scopes)],agentId:input.agentId||null,createdAt:new Date().toISOString(),expiresAt,hash:hash(token)};
    this.records.push(record);try{await this.plane.save();}catch(error){this.plane.data.api.credentials=this.records.filter(r=>r!==record);throw error;}return {...this.public(record),token,url:this.plane.baseUrl};
  }
  async revoke(id){const record=this.records.find(r=>r.id===id);assert(record&&record.kind!=='owner','Choose a delegated credential',404);record.revokedAt=new Date().toISOString();await this.plane.save();return this.public(record);}
}
