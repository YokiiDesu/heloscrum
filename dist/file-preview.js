import {markdown,enhanceMarkdown} from './rich-text.js';
import {resourcePreview,fileReference,FilePreviewHistory} from './resource-preview.js';
import {libraryIcon} from './agent-appearance.js';
import {loadingState} from './loading-state.js';
import {isDocumentPreview,renderDocumentPreview} from './document-preview.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=value=>value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-');

export function installFilePreviews({api,project}){
  let active,history;
  const show=async(entry,trigger)=>{
    const {reference,context}=entry,returnFocus=active?.trigger||trigger;
    active?.close(false);
    const dialog=document.createElement('dialog');dialog.className='work-dialog work-resource-dialog workspace-file-dialog';dialog.setAttribute('aria-label','File preview');
    dialog.innerHTML=`<header class="work-dialog-head"><span class="work-dialog-mark">${libraryIcon('file',24)}</span><div><span class="eyebrow">FILE PREVIEW</span><h2>${esc(reference.path.split('/').at(-1))}</h2></div><nav class="workspace-file-navigation" aria-label="File history"><button type="button" class="icon-button" data-file-nav="-1" aria-label="Back to previous file" title="Back to previous file" ${history.canBack?'':'disabled'}>${libraryIcon('chevron-left',20)}</button><button type="button" class="icon-button" data-file-nav="1" aria-label="Forward to next file" title="Forward to next file" ${history.canForward?'':'disabled'}>${libraryIcon('chevron-right',20)}</button></nav><button type="button" aria-label="Close file preview">${libraryIcon('x',20)}</button></header><div class="work-dialog-body"><div class="work-resource-toolbar"><span class="workspace-file-location">${esc(reference.path)}</span><div class="workspace-file-actions"><button type="button" data-file-action="source" hidden aria-pressed="false">Source</button><button type="button" data-file-action="copy" disabled>Copy path</button><button type="button" data-file-action="download" disabled>Download</button></div></div><div class="work-resource-preview" role="region" aria-label="File content" tabindex="0" aria-busy="true">${loadingState('Opening file')}</div></div><p class="work-error" role="status"></p>`;
    const host=dialog.querySelector('.work-resource-preview'),status=dialog.querySelector('.work-error');let imageURL,file,blob,preview,source=false;const rendering=new AbortController();
    const capture=()=>{
      if(!preview)return;
      const code=host.querySelector('.work-file-text'),pdfPage=host.querySelector('.document-pdf-page');entry.view||={positions:{}};entry.view.source=source;
      entry.view.positions[source?'source':'formatted']={top:host.scrollTop,left:host.scrollLeft,codeTop:code?.scrollTop||0,codeLeft:code?.scrollLeft||0,pdfTop:pdfPage?.scrollTop||0,pdfLeft:pdfPage?.scrollLeft||0};
    };
    const close=(restore=true)=>{capture();rendering.abort();if(imageURL)URL.revokeObjectURL(imageURL);dialog.close();dialog.remove();if(active?.dialog===dialog)active=null;if(restore)history=null;if(restore&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};
    active={dialog,close,trigger:returnFocus};dialog.querySelector('[aria-label="Close file preview"]').onclick=()=>close();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    const anchor=fragment=>{const heading=[...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h=>slug(h.textContent)===fragment);heading?.scrollIntoView({block:'start'});};
    const render=async()=>{
      host.className='work-resource-preview';host.replaceChildren();
      if(preview.kind==='markdown'&&!source){host.classList.add('markdown','document-markdown');host.innerHTML=markdown(preview.text,{document:true});await enhanceMarkdown(host);if(reference.fragment)anchor(reference.fragment);}
      else if(isDocumentPreview(preview)&&!source){
        entry.view||={positions:{}};entry.view.document||={};
        await renderDocumentPreview(host,preview,{signal:rendering.signal,state:entry.view.document});
      }
      else if(preview.kind==='text'||preview.kind==='markdown'||preview.kind==='mermaid'){
        const pre=document.createElement('pre'),code=document.createElement('code');pre.className='work-file-text';pre.append(code);host.append(pre);
        if(reference.line){const lines=preview.text.split('\n'),index=reference.line-1;if(index<lines.length){code.append(document.createTextNode(lines.slice(0,index).join('\n')+(index?'\n':'')));const mark=document.createElement('mark');mark.textContent=lines[index]||' ';code.append(mark,document.createTextNode(index<lines.length-1?'\n'+lines.slice(index+1).join('\n'):''));mark.scrollIntoView({block:'center'});}else code.textContent=preview.text;}
        else code.textContent=preview.text;
      }else if(preview.kind==='image'){imageURL||=URL.createObjectURL(preview.blob);const img=document.createElement('img');img.src=imageURL;img.alt=file.name;img.className='workspace-file-image';host.append(img);}
      else{const p=document.createElement('p');p.setAttribute('role','status');p.textContent=preview.reason;host.append(p);}
      const position=entry.view?.positions[source?'source':'formatted'];
      if(position){host.scrollTop=position.top;host.scrollLeft=position.left;const code=host.querySelector('.work-file-text');if(code){code.scrollTop=position.codeTop;code.scrollLeft=position.codeLeft;}const pdfPage=host.querySelector('.document-pdf-page');if(pdfPage){pdfPage.scrollTop=position.pdfTop||0;pdfPage.scrollLeft=position.pdfLeft||0;}}
    };
    dialog.addEventListener('click',async event=>{
      const navigation=event.target.closest('[data-file-nav]');
      if(navigation){const next=history.move(Number(navigation.dataset.fileNav));if(next)await show(next,returnFocus);return;}
      const local=event.target.closest('a[href^="#"]');if(local){event.preventDefault();anchor(decodeURIComponent(local.getAttribute('href').slice(1)));return;}
      const button=event.target.closest('[data-file-action]');if(!button||!file)return;
      try{
        if(button.dataset.fileAction==='source'){capture();source=!source;button.setAttribute('aria-pressed',String(source));button.textContent=source?(preview.kind==='mermaid'?'Diagram':'Formatted'):'Source';await render();}
        if(button.dataset.fileAction==='copy'){await navigator.clipboard.writeText(file.path);status.textContent='File path copied.';}
        if(button.dataset.fileAction==='download'){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='Download started.';}
      }catch(error){status.textContent=error.message;}
    });
    document.body.append(dialog);dialog.showModal();
    try{
      const params=new URLSearchParams({project:context.project,path:encodeURI(reference.path).replace(/#/g,'%23').replace(/\?/g,'%3F'),...(context.taskId?{taskId:context.taskId}:{}),...(context.base?{base:context.base}:{})});
      file=await api('workspace-file?'+params);if(!dialog.isConnected)return;
      blob=new Blob([Uint8Array.from(atob(file.content),c=>c.charCodeAt(0))]);preview=await resourcePreview(blob,file.name);if(!dialog.isConnected)return;
      dialog.dataset.fileProject=file.project;dialog.dataset.fileBase=file.path;
      dialog.querySelector('.eyebrow').textContent=file.worktree.label+' · '+file.worktree.branch;
      dialog.querySelector('.workspace-file-location').textContent=file.path+' · '+Math.max(1,Math.ceil(file.size/1024))+' KiB · Current file';
      dialog.querySelectorAll('[data-file-action]').forEach(button=>button.disabled=false);
      const toggle=dialog.querySelector('[data-file-action="source"]');toggle.hidden=!['markdown','mermaid'].includes(preview.kind);source=['markdown','mermaid'].includes(preview.kind)&&(entry.view?.source??!!reference.line);toggle.textContent=source?(preview.kind==='mermaid'?'Diagram':'Formatted'):'Source';toggle.setAttribute('aria-pressed',String(source));
      host.removeAttribute('aria-busy');await render();
    }catch(error){if(dialog.isConnected){host.removeAttribute('aria-busy');host.replaceChildren();const message=document.createElement('p');message.setAttribute('role','status');message.textContent=error.message;host.append(message);}}
  };
  const click=event=>{
    const link=event.target.closest('a[data-file-link]');if(!link||event.button>0)return;
    const reference=fileReference(link.getAttribute('href'));if(!reference)return;
    event.preventDefault();
    const projectHost=link.closest('[data-file-project]'),sender=link.closest('[data-agent-identity]'),taskHost=link.closest('[data-file-task]'),baseHost=link.closest('[data-file-base]');
    const context={project:projectHost?.dataset.fileProject||project(),taskId:sender?.dataset.agentIdentity||taskHost?.dataset.fileTask,base:baseHost?.dataset.fileBase};
    if(!active?.dialog.contains(link)){active?.close();history=new FilePreviewHistory();}
    show(history.open({reference,context}),link);
  };
  document.addEventListener('click',click);
  return ()=>{document.removeEventListener('click',click);active?.close();};
}
