import {randomUUID} from 'node:crypto';
import {assert, string} from './adapters.mjs';
import {sessionKey} from './session-identity.mjs';

// Questions for the project owner are messages, not permission grants. Nothing
// executes on the owner's behalf when they answer a question here.
export class UserRequests {
  constructor(registry){this.registry=registry;registry.data.userRequests ||= [];}
  receipt(request){return {requestId:request.id,threadId:request.threadId,status:request.status,question:request.question,response:request.response||null,replyMessageId:request.replyMessageId||null,receiptOnly:true,nextStep:request.status==='pending'?'The user was notified. Continue independent work, then finish your turn. Read this group at the next handoff; do not poll.':'Read the recorded response or conversation status.'};}
  async ask(actor,input){
    const r=this.registry,thread=r.groups.available(actor,input.threadId);
    assert(thread.kind==='group','Choose a group chat');
    const question=string(input.question,'question for the user',4000),options=input.options||[];
    assert(Array.isArray(options)&&options.length<=5&&options.every(o=>typeof o==='string'&&o.trim()&&o.length<=300)&&new Set(options).size===options.length,'Provide up to five distinct, nonempty answer choices');
    const requestId=input.requestId?string(input.requestId,'request ID',120):null;
    const prior=r.data.userRequests.find(q=>q.project===actor.project&&q.from===actor.id&&(requestId?q.clientRequestId===requestId:q.status==='pending'&&q.threadId===thread.id&&q.question===question));
    if(prior){assert(prior.threadId===thread.id&&prior.question===question&&JSON.stringify(prior.options)===JSON.stringify(options),'Request ID belongs to a different question',409);await r.plane.save();return this.receipt(prior);}
    assert(thread.status!=='closed','Conversation is closed. Reopen it for new requirements first.',409);
    assert(r.data.userRequests.filter(q=>q.project===actor.project&&q.from===actor.id&&q.status==='pending').length<3,'You already have three unanswered questions. Wait for the user.',429);
    const id=randomUUID(),at=new Date().toISOString(),fromRole=actor.role||actor.title;
    const request={id,project:actor.project,threadId:thread.id,from:actor.id,fromRole,fromSessionKey:sessionKey(actor),question,options,status:'pending',clientRequestId:requestId,at};
    r.data.userRequests.push(request);
    r.data.messages.push({id,groupMessageId:id,threadId:thread.id,threadName:thread.name,project:actor.project,from:actor.id,fromRole,to:'human',toRole:'You',fromSessionKey:sessionKey(actor),text:question,replyTo:null,at,kind:'request',requiresReply:true,delivery:'awaiting-user',humanRequestId:id});
    await r.notify('human-request',fromRole,`${fromRole} needs your input: ${question}`,actor.project,{threadId:thread.id,requestId:id});
    return this.receipt(request);
  }
  async answer(actor,input){
    assert(actor.human,'Only the user can answer this request',403);
    const r=this.registry,request=r.data.userRequests.find(q=>q.project===actor.project&&q.id===input.requestId);
    assert(request,'Question not found in this project',404);
    const response=string(input.response,'answer',16000);
    if(request.status==='answered'){assert(request.response===response,'This question already has a different answer',409);await r.plane.save();return {...r.groupReceipt(request.replyMessageId),requestId:request.id,status:'answered'};}
    assert(request.status==='pending','This question is no longer awaiting an answer',409);
    const receipt=r.prepareGroup(actor,null,response,{threadId:request.threadId,replyTo:request.id,kind:'result',requiresReply:false,requestId:`user-answer:${request.id}`});
    for(const delivery of r.data.messages)if(delivery.groupMessageId===receipt.id)delivery.replyQuestion={requestId:request.id,fromRole:request.fromRole,text:request.question};
    Object.assign(request,{status:'answered',response,answeredAt:new Date().toISOString(),replyMessageId:receipt.id});
    const message=r.data.messages.find(m=>m.id===request.id);message.delivery='answered';
    // Answer, request state, and all recipient deliveries share one commit.
    await r.plane.save();return {...receipt,requestId:request.id,status:'answered'};
  }
}
