import {createHash} from 'node:crypto';
import {lstat,open,readlink,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assert,inside} from './adapters.mjs';

// Review marks describe an exact working tree AND index, including binary and
// untracked content. They never stage files, create commits, or approve tools.
export class ChangeReviews {
  constructor(plane){this.plane=plane;}
  async fingerprint(project,id){
    const git=this.plane.git,w=await git.resolve(project,id),files=await git.status(w.path);
    assert(files.length<=500,'Review marks are limited to 500 changed files. Individual file review is still available.');
    const hash=createHash('sha256').update(JSON.stringify([w.head,files]));
    const diffs=await Promise.all([
      git.command(w.path,['diff','--binary','--no-ext-diff','--no-textconv','--no-color']),
      git.command(w.path,['diff','--cached','--binary','--no-ext-diff','--no-textconv','--no-color'])
    ]);
    for(const diff of diffs)hash.update('\0').update(diff);
    const root=await realpath(w.path);
    let untrackedBytes=0;
    for(const file of files.filter(f=>f.untracked)){
      const full=path.resolve(root,file.path);assert(inside(root,full),'File path is outside worktree');
      assert(inside(root,await realpath(path.dirname(full))),'File directory resolves outside worktree');
      const stat=await lstat(full);hash.update('\0').update(file.path).update(String(stat.mode));
      if(stat.isSymbolicLink()){hash.update(await readlink(full));continue;}
      assert(stat.isFile(),'Review unavailable for this file type');
      assert(stat.size<=32*1024*1024,'Untracked file exceeds the 32 MiB review limit: '+file.path);
      untrackedBytes+=stat.size;assert(untrackedBytes<=64*1024*1024,'Untracked content exceeds the 64 MiB review limit. Individual file review is still available.');
      const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);}
      finally{await handle.close();}
    }
    // A concurrent edit must not silently remove or add a file to this review.
    assert(JSON.stringify(files)===JSON.stringify(await git.status(w.path)),'Changes moved while loading the review. Refresh and try again.',409);
    return {fingerprint:hash.digest('hex'),files:files.map(f=>f.path),head:w.head,worktreeId:id};
  }
  async read(project,id,filename,staged=false){
    const current=await this.fingerprint(project,id);
    let preview=null;
    if(filename){
      try{preview=await this.plane.git.file(project,id,filename,staged);}catch(error){preview={error:error.message};}
      const after=await this.fingerprint(project,id);
      assert(after.fingerprint===current.fingerprint,'Changes moved while loading the diff. Refresh and try again.',409);
    }
    const review=this.plane.data.changeReviews?.find(r=>r.project===project&&r.worktreeId===id)||null;
    return {...current,preview,review,reviewed:!!review&&review.fingerprint===current.fingerprint};
  }
  async mark(project,id,expected){
    assert(typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected),'Load the changes before marking them reviewed');
    const current=await this.fingerprint(project,id);
    assert(current.files.length,'No changes to review',409);
    assert(current.fingerprint===expected,'Changes moved since you opened this review. Refresh and review them again.',409);
    const review={...current,project,at:new Date().toISOString()};
    this.plane.data.changeReviews=(this.plane.data.changeReviews||[]).filter(r=>r.project!==project||r.worktreeId!==id);
    this.plane.data.changeReviews.push(review);
    await this.plane.save();
    return {...current,review,reviewed:true};
  }
}
