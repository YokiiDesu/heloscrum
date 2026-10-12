// Calendar days, rather than elapsed 24-hour periods, keep Today/Yesterday
// correct around midnight and daylight-saving changes in the user's timezone.
const day=date=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
const parsed=value=>value?new Date(value):null;
const valid=date=>date&&!Number.isNaN(date.getTime());
export class ProjectVisibility {
  constructor(saved={}){this.collapsed=new Set(Array.isArray(saved.collapsed)?saved.collapsed.filter(x=>typeof x==='string'):[]);this.hidden=new Set(Array.isArray(saved.hidden)?saved.hidden.filter(x=>typeof x==='string'):[]);}
  toggle(id){if(this.collapsed.has(id))this.collapsed.delete(id);else this.collapsed.add(id);}
  hide(id){this.hidden.add(id);}
  reveal(id){this.hidden.delete(id);this.collapsed.delete(id);}
  snapshot(){return {collapsed:[...this.collapsed],hidden:[...this.hidden]};}
}
export const activityAt=thread=>thread.lastAt||thread.createdAt||null;
export function chatTimestamp(value,now=new Date()){
  const date=parsed(value);if(!valid(date))return 'No activity yet';
  const difference=(day(now)-day(date))/86400000;
  const label=difference===0?'Today':difference===1?'Yesterday':date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})});
  return `${label} · ${date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`;
}
export function filterChats(threads,{kind='all',project='all',date='all',status='all',query=''}={},now=new Date()){
  const search=query.trim().toLocaleLowerCase();
  return threads.filter(thread=>{
    if(kind!=='all'&&thread.kind!==kind||project!=='all'&&thread.project!==project||status!=='all'&&thread.status!==status)return false;
    const stamp=parsed(activityAt(thread)),age=valid(stamp)?(day(now)-day(stamp))/86400000:null;
    if(date==='today'&&age!==0||date==='yesterday'&&age!==1||date==='week'&&(age===null||age<0||age>6))return false;
    return !search||[thread.name,thread.projectName,thread.project,...thread.participants.map(p=>p.name)].join(' ').toLocaleLowerCase().includes(search);
  });
}
export function groupChats(threads,sort='newest'){
  const groups=new Map(),stamp=t=>{const value=Date.parse(activityAt(t));return Number.isFinite(value)?value:null;};
  const compareDate=(a,b)=>{const x=stamp(a),y=stamp(b);return x===null?(y===null?a.id.localeCompare(b.id):1):y===null?-1:(sort==='oldest'?x-y:y-x)||a.id.localeCompare(b.id);};
  for(const thread of threads){if(!groups.has(thread.project))groups.set(thread.project,{id:thread.project,name:thread.projectName||thread.project||'Project',threads:[]});groups.get(thread.project).threads.push(thread);}
  const list=[...groups.values()];for(const group of list)group.threads.sort(compareDate);
  return list.sort((a,b)=>sort.startsWith('project')?((a.name.localeCompare(b.name)||a.id.localeCompare(b.id))*(sort==='project-desc'?-1:1)):compareDate(a.threads[0],b.threads[0])||a.id.localeCompare(b.id));
}
