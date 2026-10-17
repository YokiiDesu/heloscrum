import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {assert,string} from './adapters.mjs';
import {privateJSON} from './api-access.mjs';

// External contacts have mailboxes, not managed runtimes, worktrees, or task
// permissions. Keep this allowlist independent of managed-agent tool policy.
export const EXTERNAL_CONTACT_TOOLS=new Set(['attachment_upload','ack_inbox','attachment_read','contact_identity','contact_book','read_inbox','send_message','create_group','list_groups','read_group','send_group_message','set_chat_status','start_proposal','cast_vote','start_debate','take_position','record_decision','toolbox','invoke_tool','context_read','context_search']);

export class ExternalContacts {
  constructor(registry){this.registry=registry;registry.data.externalContacts||=[];}
  get records(){return this.registry.data.externalContacts;}
  active(project){return this.records.filter(c=>!c.revokedAt&&(!project||c.project===project));}
  public(contact){const {id,role,summary,project,client,externalSessionId,createdAt,revokedAt}=contact;return {id,role,summary,project,client,externalSessionId,createdAt,revokedAt,external:true,deliveryMode:'pull'};}
  available(project,id){const contact=this.active(project).find(c=>c.id===id);assert(contact,'External contact not found',404);return contact;}
  async register(project,input){
    const r=this.registry,name=string(input.name,'contact name',100),summary=input.summary?string(input.summary,'contact summary',1000):'An external chat connected through MCP. Messages are read from its inbox; automatic wake-up is not connected.';
    assert(['codex','generic'].includes(input.client),'Choose codex or generic');
    const externalSessionId=string(input.externalSessionId,'external session ID',200);
    const existing=this.active(project).find(c=>c.client===input.client&&c.externalSessionId===externalSessionId);
    if(existing){assert(existing.role===name&&existing.summary===summary,'This external session is already registered with different contact details',409);return this.connection(project,existing.id);}
    assert(this.active(project).length<20,'This project already has 20 external contacts',429);
    const contact={id:randomUUID(),role:name,title:name,summary,prompt:'',project,client:input.client,externalSessionId,kind:input.client,external:true,roleType:'external',phase:'external',deliveryMode:'pull',createdAt:new Date().toISOString()};
    r.data.credentials[contact.id]=randomBytes(32).toString('hex');this.records.push(contact);
    await r.notify('contact',name,`${name} connected as an external contact`,project,{contactId:contact.id});
    return this.connection(project,contact.id);
  }
  async connection(project,id){
    const r=this.registry,contact=this.available(project,id),dir=path.join(r.root,'.heloscrum/external-contacts',id);
    await r.plane.save();
    await mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,'connection.json');
    await privateJSON(file,{url:r.plane.baseUrl||'http://127.0.0.1:4173',token:r.data.credentials[id],contactId:id,client:contact.client,externalSessionId:contact.externalSessionId});
    // Only the file path is returned. Never put a bearer credential in an
    // operation result, command line, MCP config, or the browser snapshot.
    return {contact:this.public(contact),mcp:{command:process.execPath,args:[path.join(r.codeRoot,'scripts/mcp-bridge.mjs'),file],...(contact.client==='codex'?{env_vars:['CODEX_THREAD_ID','CODEX_SESSION_ID']}:{} )}};
  }
  async revoke(project,id){
    const r=this.registry,contact=this.records.find(c=>c.project===project&&c.id===id);assert(contact,'External contact not found',404);
    if(!contact.revokedAt){contact.revokedAt=new Date().toISOString();delete r.data.credentials[id];r.connections.delete(id);
      for(const m of r.data.messages)if(m.project===project&&m.to===id&&['queued','delivering'].includes(m.delivery)){m.delivery='cancelled';m.error='External contact disconnected before delivery';}
    }
    await r.notify('contact',contact.role,`${contact.role} disconnected`,project,{contactId:id});
    await rm(path.join(r.root,'.heloscrum/external-contacts',id,'connection.json'),{force:true});
    return this.public(contact);
  }
}
