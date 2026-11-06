import {assert,string} from './adapters.mjs';
import {fingerprint} from './patch.mjs';
import {geminiUsage} from './gemini.mjs';

export const geminiPlanSource=state=>{
  const entries=state?.plan?.entries||[],text=state?.planText||entries.map(e=>'- '+e.content).join('\n');
  return text?{text,entries,at:state.planAt||null,expected:fingerprint(JSON.stringify([text,entries]))}:null;
};
export class GeminiControls {
  constructor(plane){this.plane=plane;}
  task(id){const task=this.plane.task(id);assert(task.kind==='gemini','Choose a Gemini CLI session');return task;}
  async inspect(id){
    const task=this.task(id),managed=this.plane.managed,s=managed.sessions.get(task.pane)||await managed.load(task),state=s.geminiState||{};
    const online=managed.sessions.has(task.pane)&&!s.gemini?.failure;
    return {taskId:id,sessionId:s.id,role:task.role||task.title,online,ready:online&&task.phase==='launched'&&['idle','done'].includes(s.status),status:s.status||'offline',mode:state.currentModeId||null,modes:state.modes||[],models:state.models||[],commands:state.commands||[],usage:geminiUsage(s.usageRecords,state.context),plan:geminiPlanSource(state),imports:state.imports||{},expected:fingerprint(JSON.stringify([s.id,state.currentModeId||null])),agents:this.plane.work.agents(task.project).map(t=>({id:t.id,name:t.role||t.title})),project:task.project};
  }
  async idle(id,fn){
    const p=this.plane,task=this.task(id),s=p.managed.get(task.pane);
    assert(task.phase==='launched'&&['idle','done'].includes(s.status),'Wait for Gemini to finish or interrupt it before changing session controls',409);
    assert(!p.collaboration.delivering.has(id)&&!p.promptingTasks?.has(id)&&!p.respondingTasks?.has(id)&&!p.agentSettings.changing.has(id),'Another session operation is in progress',409);
    const previous=s.status;s.status='working';
    try{return await fn(task,s);}finally{s.status=previous;}
  }
  async mode(id,input){return this.idle(id,async(task,s)=>{
    assert(input.expected===fingerprint(JSON.stringify([s.id,s.geminiState?.currentModeId||null])),'Gemini mode or session changed. Refresh these controls.',409);
    assert(!s.gemini?.failure&&s.geminiState?.modes?.some(m=>m.id===input.modeId),'Choose a mode advertised by the connected Gemini CLI',409);
    await s.gemini.setMode(input.modeId);await s.geminiEvents;
    await this.plane.managed.persist(s);await this.plane.record('Gemini mode changed',`${task.role||task.title} · ${input.modeId}`,task.project);
    return {ok:true,mode:input.modeId};
  });}
  async importPlan(id,input){return this.idle(id,async(task,s)=>{
    assert(input.sessionId===s.id,'The Gemini session changed. Review its plan again.',409);
    const source=geminiPlanSource(s.geminiState);assert(source&&source.expected===input.expectedPlan,'Gemini’s plan changed. Refresh and review the new plan.',409);
    const existing=s.geminiState.imports?.[source.expected];
    if(existing)return {planId:existing,reused:true,project:task.project};
    const title=string(input.title,'board plan title',160),planText=string(input.planText,'reviewed plan',28000);
    assert(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=100,'Enter between 1 and 100 board tasks');
    const ownerId=input.ownerId||null,participants=[...new Set([task.id,...(ownerId?[ownerId]:[])])];
    const items=input.items.map(title=>({title:string(title,'task title',160),ownerId,status:'todo'}));
    const plan=await this.plane.work.saveDraft(this.plane.work.human(task.project),{requestId:'gemini:'+s.id+':'+source.expected,title,kind:'plan',strategy:'assigned',changePolicy:'review',participantIds:participants,instructions:task.prompt.slice(0,32000),planText:`${planText}\n\nSource: Gemini CLI session ${s.id}; plan ${source.expected}; captured ${source.at||'unknown'}. Imported after human review.`,items});
    (s.geminiState.imports||={})[source.expected]=plan.id;await this.plane.managed.persist(s);
    return {planId:plan.id,project:task.project};
  });}
}
