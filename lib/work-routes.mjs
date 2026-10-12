import {readFile} from 'node:fs/promises';
import {assert} from './adapters.mjs';
import {MAX_WORK_FILE} from './work-management.mjs';

// Called only after the local-origin and human capability checks in server.mjs.
export async function workUpload(req,work,url){
  assert(req.headers['content-type']?.split(';')[0]==='application/octet-stream','Upload raw file bytes',415);
  const project=work.project(url.searchParams.get('project'));let size=0;const chunks=[];
  assert(!req.headers['content-length']||Number(req.headers['content-length'])<=MAX_WORK_FILE,'Files may be at most 20 MiB',413);
  for await(const chunk of req){size+=chunk.length;assert(size<=MAX_WORK_FILE,'Files may be at most 20 MiB',413);chunks.push(chunk);}
  return work.upload(project,url.searchParams.get('name'),Buffer.concat(chunks));
}
export async function workRoute(req,res,work,url,input,json){
  const actor=work.human(input.project||url.searchParams.get('project')||work.plane.data.project),route=url.pathname;
  if(req.method==='GET'){
    if(route==='/api/work')return json(res,200,{plans:work.list(actor),calendar:work.plane.scheduler?.calendar(actor),agents:work.agents(actor.project).map(t=>({id:t.id,role:t.role||t.title,appearance:t.appearance,phase:t.phase}))});
    if(route==='/api/work/schedule')return json(res,200,work.plane.scheduler.calendar(actor,url.searchParams.get('planId')));
    if(route==='/api/work/detail')return json(res,200,work.detail(actor,url.searchParams.get('planId')));
    if(route==='/api/work/export'){
      const plan=work.available(actor,url.searchParams.get('planId')),format=url.searchParams.get('format');assert(['json','md'].includes(format),'Choose JSON or Markdown');
      res.writeHead(200,{'Content-Type':format==='json'?'application/json; charset=utf-8':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="heloscrum-${plan.id}.${format}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(format==='json'?JSON.stringify(work.brief(plan),null,2):work.markdown(plan));
    }
    if(route==='/api/work/resource'){
      const plan=work.available(actor,url.searchParams.get('planId')),id=url.searchParams.get('resourceId');assert(plan.resourceIds.includes(id),'Resource is not attached to this brief',403);const resource=work.resource(id,actor.project);
      const bytes=await readFile(work.filePath(resource));res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(resource.name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
    }
  }
  if(req.method==='POST'){
    const handlers={'/api/work/reviewers':()=>work.setReviewers(actor,input),'/api/work/schedule':()=>work.changeSchedule(actor,input),'/api/work/reminder':()=>work.plane.scheduler.reminder(actor,input),'/api/work/schedule-settings':()=>work.plane.scheduler.saveSettings(actor,input),'/api/work/delivery':()=>work.delivery(actor,input),'/api/work/verify':()=>work.verify(actor,input),'/api/work/draft':()=>work.saveDraft(actor,input),'/api/work/start':()=>work.start(actor,input),'/api/work/task':()=>work.change(actor,input,input.itemId?'update':'create'),'/api/work/review':()=>work.review(actor,input),'/api/work/state':()=>work.state(actor,input),'/api/work/reference':()=>work.repoReference(actor.project,input.path)};
    if(handlers[route])return json(res,200,await handlers[route]());
  }
  return json(res,404,{error:'Unknown work endpoint'});
}
