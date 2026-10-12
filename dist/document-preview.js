import {markdown,enhanceMarkdown,documentHTML} from './rich-text.js';
import {resourcePreview} from './resource-preview.js';
import {libraryIcon} from './agent-appearance.js';
import {loadingState,loadFailure} from './loading-state.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// One saved-file viewer for task/plan resources and conversation attachments.
// Loaders keep their existing authenticated, project-scoped storage routes.
export function openResourcePreview({name,location=name,label='Saved File',load,trigger,context={},onClose=()=>{}}){
  const dialog=document.createElement('dialog');
  dialog.className='work-dialog work-resource-dialog workspace-file-dialog saved-resource-dialog';
  dialog.setAttribute('aria-label','Attachment preview');
  if(context.project)dialog.dataset.fileProject=context.project;
  if(context.taskId)dialog.dataset.fileTask=context.taskId;
  if(context.base)dialog.dataset.fileBase=context.base;
  dialog.innerHTML=`<header class="work-dialog-head"><span class="work-dialog-mark">${libraryIcon('file',24)}</span><div><span class="eyebrow">${escape(label)}</span><h2>${escape(name)}</h2></div><button type="button" aria-label="Close attachment preview">${libraryIcon('x',20)}</button></header><div class="work-dialog-body"><div class="work-resource-toolbar"><span class="workspace-file-location">${escape(location)} · Saved snapshot</span><div class="workspace-file-actions"><button type="button" data-resource-action="source" hidden aria-pressed="false">Source</button><button type="button" data-resource-action="download" disabled>${libraryIcon('download',16)} Download original</button></div></div><div class="work-resource-preview" role="region" aria-label="File content" tabindex="0" aria-busy="true"></div></div><p class="work-error" role="status"></p>`;
  const host=dialog.querySelector('.work-resource-preview'),status=dialog.querySelector('.work-error'),sourceButton=dialog.querySelector('[data-resource-action="source"]'),downloadButton=dialog.querySelector('[data-resource-action="download"]');
  let rendering=new AbortController(),blob,preview,imageURL,source=false,loading=false,closed=false;
  const close=()=>{
    if(closed)return;closed=true;rendering.abort();if(imageURL)URL.revokeObjectURL(imageURL);
    dialog.close();dialog.remove();onClose();
    const button=typeof trigger==='function'?trigger():trigger;if(button?.isConnected)button.focus({preventScroll:true});
  };
  dialog.querySelector('[aria-label="Close attachment preview"]').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  const render=async()=>{
    host.className='work-resource-preview';host.replaceChildren();
    if(preview.kind==='markdown'&&!source){host.classList.add('markdown','document-markdown');host.innerHTML=markdown(preview.text,{document:true});await enhanceMarkdown(host);}
    else if(isDocumentPreview(preview)&&!source)await renderDocumentPreview(host,preview,{signal:rendering.signal});
    else if(['markdown','mermaid','text'].includes(preview.kind)){
      const pre=document.createElement('pre'),code=document.createElement('code');pre.className='work-file-text';code.textContent=preview.text;pre.append(code);host.append(pre);
    }else if(preview.kind==='image'){
      imageURL||=URL.createObjectURL(preview.blob);
      host.innerHTML=`<div class="work-image-controls" role="group" aria-label="Image scale"><button type="button" data-resource-action="fit" aria-pressed="true">Fit image</button><button type="button" data-resource-action="actual" aria-pressed="false">Actual size</button></div><div class="work-image-viewport" tabindex="0" role="region" aria-label="Image viewport"><img src="${imageURL}" alt="${escape(name)}"></div>`;
      host.querySelector('img').onerror=()=>{host.textContent='The image could not be decoded. Download the original to inspect it.';};
    }else{const note=document.createElement('p');note.setAttribute('role','status');note.textContent=preview.reason;host.append(note);}
  };
  const open=async()=>{
    if(loading||closed)return;loading=true;source=false;sourceButton.hidden=true;downloadButton.disabled=true;status.textContent='';
    rendering.abort();rendering=new AbortController();if(imageURL){URL.revokeObjectURL(imageURL);imageURL=null;}
    host.className='work-resource-preview';host.setAttribute('aria-busy','true');host.innerHTML=loadingState('Loading preview',{detail:'Opening the saved file snapshot.'});
    try{
      blob=await load();if(closed)return;
      downloadButton.disabled=false;
      preview=await resourcePreview(blob,name);if(closed)return;
      sourceButton.hidden=!['markdown','mermaid'].includes(preview.kind);sourceButton.textContent='Source';sourceButton.setAttribute('aria-pressed','false');
      host.removeAttribute('aria-busy');await render();
    }catch(error){if(!closed){host.removeAttribute('aria-busy');host.className='work-resource-preview';host.innerHTML=loadFailure('Preview couldn’t load',{detail:error.message,retry:'data-resource-action="retry"'});}}
    finally{loading=false;}
  };
  dialog.addEventListener('click',async event=>{
    const anchor=event.target.closest('a[href^="#"]');
    if(anchor){event.preventDefault();let fragment;try{fragment=decodeURIComponent(anchor.getAttribute('href').slice(1));}catch{return;}
      const slug=value=>value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-');
      const target=[...host.querySelectorAll('[id],h1,h2,h3,h4,h5,h6')].find(el=>el.id===fragment||slug(el.textContent)===fragment);target?.scrollIntoView({block:'start'});return;}
    const button=event.target.closest('[data-resource-action]');if(!button||button.disabled)return;
    try{
      if(button.dataset.resourceAction==='retry'){await open();return;}
      if(button.dataset.resourceAction==='source'){
        source=!source;button.setAttribute('aria-pressed',String(source));button.textContent=source?(preview.kind==='mermaid'?'Diagram':'Formatted'):'Source';await render();
      }
      if(['fit','actual'].includes(button.dataset.resourceAction)){
        host.querySelector('.work-image-viewport').classList.toggle('actual-size',button.dataset.resourceAction==='actual');
        host.querySelectorAll('.work-image-controls button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      }
      if(button.dataset.resourceAction==='download'){
        const url=URL.createObjectURL(new Blob([blob],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);status.textContent='Download started.';
      }
    }catch(error){if(!closed)status.textContent=error.message;}
  });
  document.body.append(dialog);dialog.showModal();
  return {dialog,close,ready:open()};
}

export const isDocumentPreview=preview=>['pdf','docx','mermaid'].includes(preview.kind);
const check=signal=>signal?.throwIfAborted();

function convertWord(buffer,signal){
  check(signal);
  return new Promise((resolve,reject)=>{
    const worker=new Worker('/document-converter.worker.js');
    const finish=(error,result)=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);};
    const abort=()=>finish(signal.reason||new DOMException('Preview closed','AbortError'));
    const timeout=setTimeout(()=>finish(new Error('This Word document took too long to preview. Download the original to open it.')),30000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>finish(data.error?new Error(data.error):null,data);
    worker.onerror=()=>finish(new Error('The Word preview could not load. Download the original to open it.'));
    worker.postMessage(buffer,[buffer]);
  });
}

// Shared by workspace links and saved resources. The owner aborts rendering
// when its dialog closes, including workers and in-flight PDF page rendering.
export async function renderDocumentPreview(host,preview,{signal,state={}}={}){
  check(signal);host.replaceChildren();
  if(preview.kind==='mermaid'){
    host.classList.add('markdown','document-markdown');
    const pre=document.createElement('pre'),code=document.createElement('code');
    code.className='language-mermaid';code.textContent=preview.text;pre.append(code);host.append(pre);
    await enhanceMarkdown(host);return;
  }
  if(preview.kind==='docx'){
    const result=await convertWord(await preview.blob.arrayBuffer(),signal);check(signal);
    host.classList.add('markdown','document-markdown');
    host.innerHTML=documentHTML(result.html,{bookmarks:true});
    const note=document.createElement('p');note.className='document-preview-note';
    note.textContent='Reading view · Download for the original Word layout.';host.prepend(note);
    if(result.messages.length){
      const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
      details.className='document-preview-notes';summary.textContent='Document conversion notes';
      for(const message of result.messages){const item=document.createElement('li');item.textContent=message;list.append(item);}
      details.append(summary,list);host.append(details);
    }
    host.addEventListener('click',event=>{
      const link=event.target.closest('a[href^="#"]');if(!link)return;
      let id;try{id=decodeURIComponent(link.getAttribute('href').slice(1));}catch{return;}
      const target=[...host.querySelectorAll('[id]')].find(element=>element.id===id);
      if(target){event.preventDefault();target.scrollIntoView({block:'start'});}
    },{signal});
    await enhanceMarkdown(host);return;
  }
  if(preview.kind==='pdf')await renderPDF(host,preview.blob,{signal,state});
}

async function renderPDF(host,blob,{signal,state}){
  const pdfjs=await import('/vendor/pdfjs/legacy/build/pdf.mjs');check(signal);
  pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/legacy/build/pdf.worker.mjs';
  const data=new Uint8Array(await blob.arrayBuffer());check(signal);
  const loading=pdfjs.getDocument({data,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',enableXfa:false,maxImageSize:16777216,canvasMaxAreaInBytes:67108864});
  let renderTask,resize;
  const dispose=()=>{resize?.disconnect();renderTask?.cancel();loading.destroy().catch(()=>{});};
  signal?.addEventListener('abort',dispose,{once:true});
  let pdf;
  try{pdf=await loading.promise;check(signal);}catch(error){
    dispose();signal?.removeEventListener('abort',dispose);
    if(error.name==='PasswordException')throw new Error('This PDF is password protected. Download the original to open it.');
    throw error;
  }
  host.classList.add('document-pdf');
  host.innerHTML=`<div class="document-preview-controls" role="toolbar" aria-label="PDF controls"><div class="document-control-group" role="group" aria-label="Page navigation"><button type="button" data-page="-1" class="icon-button ui-action" aria-label="Previous PDF page">${libraryIcon('chevron-left',18)}</button><label>Page <input type="number" min="1" max="${pdf.numPages}" aria-label="PDF page"></label><span data-page-count>of ${pdf.numPages}</span><button type="button" data-page="1" class="icon-button ui-action" aria-label="Next PDF page">${libraryIcon('chevron-right',18)}</button></div><div class="document-control-group"><label>Zoom <select aria-label="PDF zoom"><option value="fit">Fit width</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div><div class="document-control-group document-view-switch" role="group" aria-label="PDF view"><button type="button" class="ui-action" data-pdf-view="image" aria-label="Show PDF page image" aria-pressed="true">Page</button><button type="button" class="ui-action" data-pdf-view="text" aria-label="Show PDF page text" aria-pressed="false">Text</button></div></div><p class="document-preview-status sr-only" role="status" aria-live="polite"></p><div class="document-pdf-page"></div>`;
  const controls=host.querySelector('.document-preview-controls'),input=controls.querySelector('input'),zoom=controls.querySelector('select'),views=controls.querySelectorAll('[data-pdf-view]'),pageHost=host.querySelector('.document-pdf-page'),status=host.querySelector('[role=status]');
  state.page=Math.min(pdf.numPages,Math.max(1,state.page||1));state.zoom||='fit';zoom.value=state.zoom;
  let serial=0;
  const draw=async()=>{
    const own=++serial;renderTask?.cancel();
    input.value=state.page;views.forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.pdfView==='text')===!!state.text)));
    status.classList.add('sr-only');status.textContent='Loading page '+state.page+'…';pageHost.setAttribute('aria-busy','true');
    try{
      const page=await pdf.getPage(state.page);check(signal);if(own!==serial)return;
      pageHost.replaceChildren();
      if(state.text){
        const content=await page.getTextContent();check(signal);if(own!==serial)return;
        const text=content.items.filter(item=>'str' in item).map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
        const pre=document.createElement('pre');pre.className='work-file-text document-pdf-text';pre.textContent=text.trim()||'This page has no embedded text. It may be a scanned image.';pageHost.append(pre);
      }else{
        const base=page.getViewport({scale:1}),scale=state.zoom==='fit'?Math.max(0.1,(pageHost.clientWidth-2)/base.width):Number(state.zoom);
        const viewport=page.getViewport({scale}),ratio=Math.min(window.devicePixelRatio||1,2,4096/viewport.width,4096/viewport.height);
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`PDF page ${state.page} of ${pdf.numPages}. Switch to Text view for selectable text.`);pageHost.append(canvas);
        renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});await renderTask.promise;check(signal);if(own!==serial)return;
      }
      status.textContent='Page '+state.page+' of '+pdf.numPages;
    }catch(error){
      if(signal?.aborted||own!==serial||error.name==='RenderingCancelledException')return;
      pageHost.replaceChildren();status.classList.remove('sr-only');status.textContent='This page could not be rendered. Try Text view or download the original.';
    }finally{
      if(own===serial&&!signal?.aborted){
        pageHost.removeAttribute('aria-busy');
        controls.querySelector('[data-page="-1"]').disabled=state.page===1;controls.querySelector('[data-page="1"]').disabled=state.page===pdf.numPages;
      }
    }
  };
  controls.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.page){state.page=Math.min(pdf.numPages,Math.max(1,state.page+Number(button.dataset.page)));pageHost.scrollTop=0;}
    else if(button.dataset.pdfView)state.text=button.dataset.pdfView==='text';
    draw();
  },{signal});
  input.addEventListener('change',()=>{const value=Number(input.value);state.page=Number.isInteger(value)?Math.min(pdf.numPages,Math.max(1,value)):state.page;draw();},{signal});
  zoom.addEventListener('change',()=>{state.zoom=zoom.value;draw();},{signal});
  await draw();
  let width=pageHost.clientWidth;
  resize=new ResizeObserver(()=>{const next=pageHost.clientWidth;if(next!==width){width=next;if(state.zoom==='fit'&&!state.text&&!signal?.aborted)draw();}});resize.observe(pageHost);
  if(signal?.aborted)dispose();
}
