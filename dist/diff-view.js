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
