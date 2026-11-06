// Shared presentation only: never rewrite a patch or a provider permission request.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function diffLines(value,{diff=false,contentOnly=false}={}){
  let old=0,next=0,indent='',patch=false;
  return String(value??'').split('\n').map(text=>{
    if(contentOnly)return {text,kind:text.startsWith('+')?'add':text.startsWith('-')?'remove':'context'};
    let kind='context';
    const hunk=text.match(/^(\s*)@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if(hunk){indent=hunk[1];old=Number(hunk[3]??1);next=Number(hunk[5]??1);kind='hunk';}
    else if(/^\s*\*\*\* (?:Begin Patch|End Patch|Update File:|Add File:|Delete File:|Move to:)/.test(text)){
      patch=!/^\s*\*\*\* End Patch/.test(text);kind='meta';
    }else if(old>0||next>0){
      const line=text.startsWith(indent)?text.slice(indent.length):text;
      if(line.startsWith('+')){kind='add';next--;}
      else if(line.startsWith('-')){kind='remove';old--;}
      else if(line.startsWith(' ')){old--;next--;}
      else if(!line.startsWith('\\')){old=0;next=0;}
    }else if(/^\s*(?:diff --git |index [a-f\d]+|---\s|\+\+\+\s|(?:new|deleted) file mode |(?:old|new) mode |(?:rename|copy) (?:from|to) |(?:dis)?similarity index |Binary files |GIT binary patch)/.test(text))kind='meta';
    else if(diff||patch){if(text.startsWith('+'))kind='add';else if(text.startsWith('-'))kind='remove';}
    // Kiro/Claude previews put the change marker after the source line number.
    if(kind==='context'&&/^\s*\d+[+-](?:\s|$)/.test(text))kind=/^\s*\d+\+/.test(text)?'add':'remove';
    return {text,kind};
  });
}

export function diffHTML(value,options={}){
  return `<pre class="diff-preview${options.plain?' plain-diff':''}">${diffLines(value,options).map(line=>`<span class="diff-line diff-${line.kind}">${esc(line.text)}</span>`).join('\n')}</pre>`;
}

// Compare lines for presentation without rewriting the provider's edit payload.
export function editLineKinds(a,b){
  const before=Array(a.length).fill('context'),after=Array(b.length).fill('context');
  let start=0,end=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  const n=a.length-start-end,m=b.length-start-end;
  before.fill('remove',start,a.length-end);after.fill('add',start,b.length-end);
  if(!n||!m)return {before,after,region:false};
  if(n*m>1000000)return {before,after,region:true};
  const grid=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)grid[i][j]=a[start+i]===b[start+j]?1+grid[i+1][j+1]:Math.max(grid[i+1][j],grid[i][j+1]);
  let i=0,j=0;while(i<n&&j<m){if(a[start+i]===b[start+j]){before[start+i++]='context';after[start+j++]='context';}else if(grid[i+1][j]>=grid[i][j+1])i++;else j++;}
  return {before,after,region:false};
}
export function editDiffHTML(edits=[]){
  return edits.map(edit=>{
    const before=edit.oldText??'',after=edit.newText,lines=text=>text===''?[]:text.replace(/\n$/,'').split('\n'),a=lines(before),b=lines(after),kinds=editLineKinds(a,b);
    const pane=(text,rows,label,side,changes)=>{
      const row=(line,i)=>`<span class="edit-line edit-${changes[i]}"><span class="edit-number" aria-hidden="true">${i+1}</span><span class="edit-marker" aria-hidden="true">${changes[i]==='add'?'+':changes[i]==='remove'?'−':' '}</span><code>${esc(line)||' '}</code></span>`;
      const rendered=[];
      for(let i=0;i<rows.length;){
        if(changes[i]!=='context'){rendered.push(row(rows[i],i++));continue;}
        let end=i;while(end<rows.length&&changes[end]==='context')end++;
        const leading=i===0?0:3,trailing=end===rows.length?0:3,hidden=end-i-leading-trailing;
        if(hidden>6){
          for(let k=i;k<i+leading;k++)rendered.push(row(rows[k],k));
          // Omitted context must not allocate thousands of hidden DOM rows.
          // The original provider payload remains intact in the transcript.
          rendered.push(`<div class="edit-context">Unchanged lines not shown <span>(${hidden})</span></div>`);
          for(let k=end-trailing;k<end;k++)rendered.push(row(rows[k],k));
        }else for(let k=i;k<end;k++)rendered.push(row(rows[k],k));
        i=end;
      }
      return `<section class="edit-side-${side}"><h5>${label}<span>${side==='remove'?'− Removed':'+ Added'}</span></h5><div class="edit-code" tabindex="0" role="region" aria-label="${esc(label+' '+edit.path)}">${rendered.join('')}</div><small>${rows.length} lines · ${text===''?'Empty file':text.endsWith('\n')?'Ends with newline':'No final newline'}</small></section>`;
    };
    return `<div class="edit-review"><h4>${esc(edit.path)}${edit.oldText===null?' · New file':''}</h4><p>Before / after · ${kinds.region?'highlighted replacement region':'removed and added lines highlighted'}</p><div class="edit-columns">${pane(before,a,'Before','remove',kinds.before)}${pane(after,b,'After','add',kinds.after)}</div></div>`;
  }).join('');
}

const statuses={A:['added','Added'],D:['deleted','Deleted'],M:['modified','Modified'],R:['renamed','Renamed'],C:['copied','Copied'],U:['conflict','Unmerged'],T:['typechanged','Type changed'],'?':['unknown','Changed']};
export function fileStatus(file){
  const raw=file.status||'',conflict=file.conflict||['DD','AU','UD','UA','DU','AA','UU'].includes(raw);
  const code=conflict?'U':file.untracked||raw==='??'?'A':['D','R','C','A','T','M'].find(code=>raw.includes(code))||'?';
  const [kind,label]=statuses[code];
  const details=[label+(file.untracked||raw==='??'?' (untracked)':''),file.original?`${file.original} → ${file.path}`:file.path];
  if(raw&&raw!=='??')details.push(...[...raw].flatMap((status,i)=>statuses[status]?[`${i?'Unstaged':'Staged'}: ${statuses[status][1].toLowerCase()}`]:[]));
  return {code,kind,label,title:details.join(' · ')};
}

export function fileLabelHTML(file){
  const status=fileStatus(file);
  return `<span class="file-symbol" aria-label="${status.label}">${status.code}</span><span class="file-name">${esc(file.path)}</span>`;
}

export function changedFileHTML(file,selected){
  const status=fileStatus(file);
  return `<button type="button" class="file-change file-${status.kind}" data-action="file" data-file="${esc(file.path)}" aria-pressed="${file.path===selected}" title="${esc(status.title)}">${fileLabelHTML(file)}${file.staged?'<i class="staged-dot" title="Contains staged changes">●</i>':''}</button>`;
}
