import { randomUUID } from 'node:crypto';
import { directThreadId } from './chat-messages.mjs';
import { assert, string } from './adapters.mjs';

export const deliveryProperties = {
  attachments:{type:'array',items:{type:'string'},maxItems:4,uniqueItems:true,description:'IDs returned by attachment_upload, or attachments already delivered to you. Never use server file paths.'},
  kind:{type:'string',enum:['request','result','ack'],description:'request asks for work; result supplies substantive evidence; ack only records receipt and never wakes an agent.'},
  requiresReply:{type:'boolean',description:'Set false for final results. Acknowledgements cannot require replies.'},
  replyTo:{type:'string'},requestId:{type:'string',maxLength:120}
};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const GROUP_TOOLS = [
  {name:'ask_user',description:'Ask the human project owner a question inside a group you belong to. Creates a persistent question, notification and in-app toast. Optional choices are suggestions; the user can type a different answer. Returns a receipt, never an invented answer or tool approval. Reuse requestId for retries. Continue independent work, then finish your turn; the real answer arrives as a group result.',inputSchema:schema({threadId:{type:'string'},question:{type:'string',maxLength:4000},options:{type:'array',items:{type:'string',maxLength:300},maxItems:5,uniqueItems:true},requestId:{type:'string',maxLength:120}},['threadId','question'])},
  {name:'create_group',description:'Create a named group with at least two teammates plus yourself. Returns its threadId; sends no model prompt. Use one group per shared outcome and reuse it. Set a stable requestId to retry safely.',inputSchema:schema({name:{type:'string',maxLength:100},participants:{type:'array',items:{type:'string'},minItems:2,maxItems:20,uniqueItems:true},requestId:{type:'string',maxLength:120}},['name','participants'])},
  {name:'list_groups',description:'List group chats you belong to, member IDs, status, latest message and counts. Other groups are private to their members.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'read_group',description:'Read up to 60 messages in a group you belong to, with individual delivery receipts. Use before for earlier pages. A receipt is not a teammate response. Do not poll in a tight loop.',inputSchema:schema({threadId:{type:'string'},before:{type:'string'}},['threadId']),annotations:{readOnlyHint:true}},
  {name:'send_group_message',description:'Send to all teammates in an existing group. Use kind=request for work, result for substantive findings, ack for receipt only. Set requiresReply=false when complete. Acks stay in the inbox without waking agents. Do not acknowledge acknowledgements. Closed chats reject new messages until explicitly reopened.',inputSchema:schema({threadId:{type:'string'},message:{type:'string',maxLength:16000},...deliveryProperties},['threadId','message','kind'])},
  {name:'set_chat_status',description:'Close a completed group or DM to stop follow-up loops. Queued messages are cancelled, but history is preserved. Reopen only for new evidence or requirements, with a reason. Use threadId for a group, or conversationId from a DM receipt or inbox; closing does not interrupt an already running agent.',inputSchema:schema({threadId:{type:'string'},status:{type:'string',enum:['open','closed']},reason:{type:'string',maxLength:1000}},['threadId','status','reason'])}
];

export class GroupChats {
  constructor(registry){this.registry=registry;}
  draft(actor,{name,participants,requestId}){
    const r=this.registry;
    assert(Array.isArray(participants)&&participants.length>=2&&participants.length<=20&&new Set(participants).size===participants.length&&!participants.includes(actor.id),'Choose two or more different teammates for a group chat');
    assert(participants.every(id=>r.participant(id,actor.project)),'Contact is not in your project',404);
    return {id:randomUUID(),project:actor.project,name:string(name||'Group chat','group name',100),participants:[...participants,...(actor.human?[]:[actor.id])].sort(),createdBy:actor.id,requestId:requestId?string(requestId,'request ID',120):null,createdAt:new Date().toISOString(),status:'open'};
  }
  async create(actor,input){
    const r=this.registry,group=this.draft(actor,input),old=input.requestId&&r.data.threads.find(g=>g.project===actor.project&&g.createdBy===actor.id&&g.requestId===input.requestId);
    if(old){assert(old.name===group.name&&old.participants.join()===group.participants.join(),'Request ID belongs to a different group',409);await r.plane.save();return old;}
    r.data.threads.push(group);await r.notify('group',group.name,`${group.name} group chat created`,group.project);return group;
  }
  available(actor,id){
    const thread=this.registry.threads(actor.project).find(t=>t.id===id);
    assert(thread&&(actor.human||thread.participants.some(p=>p.id===actor.id)),'Chat is not available to this agent',403);return thread;
  }
  list(actor){return this.registry.threadList(actor.project).filter(t=>t.kind==='group'&&(actor.human||t.participants.some(p=>p.id===actor.id)));}
  read(actor,input){const thread=this.available(actor,input.threadId);assert(thread.kind==='group','Choose a group chat');return this.registry.threadPage(actor.project,thread.id,input.before);}
  async status(actor,input){
    const r=this.registry,thread=this.available(actor,input.threadId),reason=string(input.reason,'conversation status reason',1000);
    assert(['open','closed'].includes(input.status),'Choose open or closed');
    const at=new Date().toISOString();r.data.conversationStates[thread.id]={status:input.status,reason,at,by:actor.id,project:actor.project};
    const group=r.data.threads.find(t=>t.id===thread.id);if(group)group.status=input.status;
    if(input.status==='closed')for(const m of r.data.messages)if(m.project===actor.project&&(m.threadId||directThreadId(m.from,m.to))===thread.id&&m.delivery==='queued'){m.delivery='cancelled';m.error='Conversation closed before delivery';}
    if(input.status==='closed')for(const q of r.data.userRequests)if(q.project===actor.project&&q.threadId===thread.id&&q.status==='pending'){q.status='cancelled';q.cancelledAt=at;const message=r.data.messages.find(m=>m.id===q.id);if(message)message.delivery='cancelled';}
    await r.plane.save();return {threadId:thread.id,...r.data.conversationStates[thread.id]};
  }
}
