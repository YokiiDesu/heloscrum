import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inside } from './adapters.mjs';
import { sessionKey } from './session-identity.mjs';

// A read-only collector. Runs without a browser and never starts agent turns.
export class HistoryCollector {
  constructor(plane) { this.plane=plane;this.pending=null;this.errors=[]; }
  collect() {
    if(this.pending)return this.pending;
    this.pending=this.run().finally(()=>{this.pending=null;});return this.pending;
  }
  async run() {
    const p=this.plane;this.errors=[];await p.history.captureState(p.data);
    let live=[];try{live=await p.herdr.list();}catch{}
    const observations=new Map();
    for(const task of [...p.data.tasks]) {
      try {
        if(task.providerSessionId||task.pane){
        const revision=task.sessionRevision||0;const history=await p.transcripts.readCurrent(task,live.find(a=>a.pane_id===task.pane),{full:true});
        if((task.sessionRevision||0)!==revision)throw Error('Session changed during collection');await p.history.captureTranscript(task,history,{messages:p.data.collaboration?.messages||[]});
        const rows=observations.get(task.project)||[];rows.push({id:task.id,revision,status:live.find(a=>a.pane_id===task.pane)?.agent_status||'offline',events:history.events});observations.set(task.project,rows);}
      } catch(error) { this.errors.push({taskId:task.id,area:'transcript',error:error.message});await p.history.markError(task,error); }
      try { await this.captureWorktree(task); }
      catch(error) { this.errors.push({taskId:task.id,area:'worktree',error:error.message}); }
    }
    for(const [project,value] of observations)await p.apiEvents?.observe(project,value);
    this.lastCapturedAt=new Date().toISOString();return {at:this.lastCapturedAt,errors:this.errors};
  }
  async captureWorktree(task) {
    const p=this.plane,records=[],base={project:task.project,taskId:task.id,sessionId:sessionKey(task)};
    // Resolve through Git's worktree registry; never trust a stale arbitrary path.
    const worktree=await p.git.resolve(task.project,task.worktreeId),cwd=await realpath(worktree.path);
    const commits=await p.git.command(cwd,['log','--format=%H%x00%P%x00%aI%x00%an%x00%s']);
    for(const line of commits.trim().split('\n').filter(Boolean)) {
      const [sha,parents,at,author,subject]=line.split('\0');
      records.push({...base,kind:'commit',id:`${task.id}:${sha}`,at,provenance:'observed-in-worktree-history',body:{sha,parents:parents.split(' ').filter(Boolean),at,author,subject}});
    }
    records.push({...base,kind:'worktree-head',id:`${task.id}:${worktree.head}`,provenance:'observed-not-authorship',body:{branch:worktree.branch,sha:worktree.head,path:cwd}});
    const files=await p.git.status(cwd);let bytes=0;
    for(const file of files) {
      const full=path.resolve(cwd,file.path);let snapshot={path:file.path,status:file.status};
      try {
        if(!inside(cwd,full))throw Error('Outside worktree');
        const stat=await lstat(full);
        if(!stat.isFile()||stat.isSymbolicLink()||!inside(cwd,await realpath(full)))throw Error('Not a regular file inside this worktree');
        if(stat.size>1024*1024||bytes+stat.size>8*1024*1024)throw Error('Snapshot size limit (1 MiB/file, 8 MiB/task)');
        const content=await readFile(full);bytes+=content.length;
        snapshot={...snapshot,sha256:createHash('sha256').update(content).digest('hex'),encoding:'base64',content:content.toString('base64'),bytes:content.length};
      } catch(error) { snapshot.omitted=error.code==='ENOENT'?'File deleted':error.message; }
      records.push({...base,kind:'artifact',id:`${task.id}:${file.path}`,provenance:'worktree-snapshot',body:snapshot});
    }
    await p.history.captureRecords(records);
  }
}
