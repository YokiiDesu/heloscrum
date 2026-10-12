import {Temporal} from '@js-temporal/polyfill';
import {assert} from './adapters.mjs';

export const defaultScheduleSettings=()=>({revision:0,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',enabled:true,leadMinutes:1440,overdue:true,checkInMinutes:0,agentTarget:'none',cooldownMinutes:60,quietHours:{enabled:true,start:'22:00',end:'08:00'},resumeInactive:false});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const policyKeys=['enabled','leadMinutes','overdue','checkInMinutes','agentTarget','cooldownMinutes','quietHours'];
export function normalizePolicy(input,base=defaultScheduleSettings(),project=false){
  assert(object(input),'Provide reminder settings');
  const keys=project?[...policyKeys,'timeZone','resumeInactive','revision']:policyKeys;
  assert(Object.keys(input).every(key=>keys.includes(key)),'Unknown reminder setting');
  if(input.quietHours!==undefined)assert(object(input.quietHours)&&Object.keys(input.quietHours).every(k=>['enabled','start','end'].includes(k)),'Provide quiet-hour settings');
  const next={...base,...input,quietHours:{...base.quietHours,...input.quietHours}};
  for(const key of ['enabled','overdue',...(project?['resumeInactive']:[])])assert(typeof next[key]==='boolean','Reminder switches must be true or false');
  for(const [key,min,max] of [['leadMinutes',0,43200],['checkInMinutes',0,10080],['cooldownMinutes',15,10080]])assert(Number.isInteger(next[key])&&next[key]>=min&&next[key]<=max,`Invalid ${key}`);
  assert(next.checkInMinutes===0||next.checkInMinutes>=15,'Check-ins must be at least 15 minutes apart');
  assert(['none','owner','coordinator'].includes(next.agentTarget),'Choose notifications only, task owners, or the coordinator');
  assert(object(next.quietHours)&&typeof next.quietHours.enabled==='boolean'&&['start','end'].every(k=>typeof next.quietHours[k]==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(next.quietHours[k])),'Choose valid quiet hours');
  assert(!next.quietHours.enabled||next.quietHours.start!==next.quietHours.end,'Quiet hours must have different start and end times');
  if(project){
    assert(typeof next.timeZone==='string'&&next.timeZone.length<=100&&!/^[+-]/.test(next.timeZone),'Choose an IANA time zone, such as America/Los_Angeles');
    try{Temporal.Now.zonedDateTimeISO(next.timeZone);}catch{assert(false,'Unknown project time zone');}
  }
  return Object.fromEntries(keys.filter(k=>k!=='revision').map(k=>[k,next[k]]));
}

// Date-only deadlines expire at the end of that local day, including 23/25-hour
// DST days. Repeated clock times use the earlier occurrence; offsets are exact.
export function scheduleInstant(value,timeZone,end=false){
  if(!value)return null;
  try{
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
      const day=Temporal.PlainDate.from(value,{overflow:'reject'});
      return end?day.add({days:1}).toZonedDateTime(timeZone).epochMilliseconds-1:day.toZonedDateTime(timeZone).epochMilliseconds;
    }
    if(/(?:Z|[+-]\d{2}:\d{2})$/.test(value))return Temporal.Instant.from(value).epochMilliseconds;
    const local=Temporal.PlainDateTime.from(value,{overflow:'reject'}),zoned=local.toZonedDateTime(timeZone,{disambiguation:'compatible'});
    assert(local.equals(zoned.toPlainDateTime()),'This clock time does not exist during a daylight-saving change. Choose another time.');
    return zoned.epochMilliseconds;
  }catch(error){if(error.status)throw error;assert(false,'Use a valid date or ISO date/time in the project time zone');}
}
export function normalizeSchedule(input,old,timeZone,{policy=false}={}){
  assert(object(input),'Provide schedule dates');
  assert(Object.keys(input).every(k=>['start','due','milestone','version',...(policy?['overrides']:[])].includes(k)),'Only the user can change reminder rules');
  const next={start:old?.start||null,due:old?.due||null,milestone:old?.milestone||false,...(policy?{overrides:old?.overrides||null}:{})};
  for(const key of ['start','due'])if(input[key]!==undefined){
    const value=input[key];assert(value==null||typeof value==='string'&&value.length<=40&&(value===''||/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)),'Use a date or ISO date/time');
    next[key]=value||null;
  }
  if(input.milestone!==undefined){assert(typeof input.milestone==='boolean','Milestone must be true or false');next.milestone=input.milestone;}
  if(policy&&input.overrides!==undefined)next.overrides=input.overrides===null?null:normalizePolicy(input.overrides);
  const start=scheduleInstant(next.start,timeZone),due=scheduleInstant(next.due,timeZone,true);
  assert(start==null||due==null||due>=start,'The deadline must be on or after the start');
  assert(!next.milestone||next.due,'Give milestones a deadline');
  const previous=old&&Object.fromEntries(Object.keys(next).map(k=>[k,old[k]??(k==='milestone'?false:null)]));
  next.version=(old?.version||0)+(JSON.stringify(previous)===JSON.stringify(next)?0:1);return next;
}
export function localDate(ms,timeZone){return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone).toPlainDate().toString();}
export function quietUntil(ms,settings){
  const q=settings.quietHours;if(!q.enabled)return ms;
  const time=Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(settings.timeZone),clock=time.toPlainTime().toString().slice(0,5);
  const wraps=q.start>q.end,quiet=wraps?(clock>=q.start||clock<q.end):(clock>=q.start&&clock<q.end);
  if(!quiet)return ms;
  const date=time.toPlainDate().add({days:wraps&&clock>=q.start?1:0});
  return date.toPlainDateTime(q.end).toZonedDateTime(settings.timeZone,{disambiguation:'compatible'}).epochMilliseconds;
}
