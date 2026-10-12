import {ApiClient} from './connection.js';
import {libraryIcon} from './agent-appearance.js';
const client=new ApiClient(),sources=new Map();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=(project,id)=>JSON.stringify([project,id]);
const isImage=a=>a.kind==='image'||!a.kind;
const dataURL=a=>`data:${a.mimeType};base64,${a.base64}`;
async function source(project,id){
  const k=key(project,id);
  if(!sources.has(k)){sources.set(k,client.request('message-images/'+encodeURIComponent(id)+'?project='+encodeURIComponent(project)).catch(error=>{sources.delete(k);throw error;}));if(sources.size>16)sources.delete(sources.keys().next().value);}
  return sources.get(k);
}
export function imageGallery(items=[],project='',editable=false){return items.length?`<div class="message-images">${items.map(a=>`<div class="message-image"><button type="button" data-message-image="${esc(a.id)}" data-image-project="${esc(project)}" data-image-name="${esc(a.name)}" title="Preview ${esc(a.name)}">${isImage(a)?`<img data-attachment-image="${esc(a.id)}" data-image-project="${esc(project)}" alt="${esc(a.name)}">`:`<span class="file-attachment-icon">${libraryIcon('file',27)}<small>${Math.max(1,Math.ceil(a.size/1024))} KiB</small></span>`}<span>${esc(a.name)}</span></button>${editable?`<button type="button" class="remove-image" data-remove-image="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">×</button>`:''}</div>`).join('')}</div>`:'';}
export function hydrateImages(host){for(const img of host.querySelectorAll('img[data-attachment-image]:not([src])')){if(img.dataset.loading)continue;img.dataset.loading='true';source(img.dataset.imageProject,img.dataset.attachmentImage).then(a=>{if(img.isConnected)img.src=dataURL(a);}).catch(()=>{img.alt+=' (preview unavailable)';});}}
async function showAttachment(button){
  const {openResourcePreview}=await import('./document-preview.js');
  const task=button.closest('[data-agent-identity]')?.dataset.agentIdentity||button.closest('[data-file-task]')?.dataset.fileTask;
  return openResourcePreview({
    name:button.dataset.imageName,label:'Conversation Attachment',trigger:button,
    context:{project:button.dataset.imageProject,taskId:task},
    load:async()=>{const attachment=await source(button.dataset.imageProject,button.dataset.messageImage);return new Blob([Uint8Array.from(atob(attachment.base64),c=>c.charCodeAt(0))]);},
  });
}
if(typeof document!=='undefined')document.addEventListener('click',e=>{const b=e.target.closest('[data-message-image]');if(b)showAttachment(b);});
export class AttachmentComposer {
  constructor(host,{project,get=()=>[],set=()=>{},busy=()=>false,onError=()=>{}}){
    Object.assign(this,{host,project,get,set,busy,onError});this.pending=false;
    this.area=document.createElement('div');this.area.className='attachment-composer';this.area.innerHTML=`<div class="attachment-drafts"></div><div class="attachment-actions"><button type="button" class="attach-image" title="Choose, paste or drop up to 4 files (10 MiB each; images 3 MiB)">${libraryIcon('file-up',16)}<span>Attach files</span></button><small>Paste or drop · up to 4 files</small><input type="file" multiple hidden aria-label="Attach files"></div><p class="attachment-feedback" role="status"></p>`;host.append(this.area);
    this.area.querySelector('.attach-image').onclick=()=>{const input=this.area.querySelector('input[type=file]');try{if(typeof input.showPicker==='function')input.showPicker();else input.click();}catch{input.click();}};
    this.change=async e=>{if(e.target.type!=='file')return;const files=[...e.target.files];e.target.value='';await this.add(files);};this.area.addEventListener('change',this.change);
    this.click=e=>{const id=e.target.closest('[data-remove-image]')?.dataset.removeImage;if(id&&!this.pending&&!this.busy()){this.set(this.get().filter(a=>a.id!==id));this.render();}};this.area.addEventListener('click',this.click);
    this.paste=e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();this.add(files);}};
    this.drag=e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();host.classList.add('image-dragover');}};
    this.leave=()=>host.classList.remove('image-dragover');this.drop=e=>{const files=[...(e.dataTransfer?.files||[])];if(files.length){e.preventDefault();this.leave();this.add(files);}};
    host.addEventListener('paste',this.paste);host.addEventListener('dragover',this.drag);host.addEventListener('dragleave',this.leave);host.addEventListener('drop',this.drop);this.render();
  }
  render(){if(this.disposed)return;this.area.querySelector('.attachment-drafts').innerHTML=imageGallery(this.get(),this.project,true);hydrateImages(this.area);for(const b of this.area.querySelectorAll('button,input'))b.disabled=this.pending||this.busy();if(!this.pending&&!this.get().length)this.area.querySelector('.attachment-feedback').textContent='';}
  async add(files){if(this.pending||this.busy()||!files.length)return;const note=this.area.querySelector('.attachment-feedback');try{
    if(this.get().length+files.length>4)throw Error('Attach up to four files per message.');
    for(const f of files){const image=['image/png','image/jpeg','image/webp','image/gif'].includes(f.type),limit=(image?3:10)*1024*1024;if(f.size>limit)throw Error(f.name+` exceeds ${image?3:10} MiB. Choose a smaller file.`);}
    this.pending=true;this.render();note.textContent='Adding files…';
    for(const file of files){const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Could not read '+file.name));r.readAsDataURL(file);});const a=await client.request('message-images',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:this.project,name:file.name||'pasted-file',mimeType:file.type,base64:data.split(',')[1]})});sources.set(key(this.project,a.id),Promise.resolve({...a,base64:data.split(',')[1]}));if(sources.size>16)sources.delete(sources.keys().next().value);this.set([...this.get(),a]);}
    note.textContent=`${this.get().length} file${this.get().length===1?'':'s'} attached. Sent when you submit the message.`;
  }catch(e){note.textContent=e.message;this.onError(e);}finally{this.pending=false;this.render();}}
  dispose(){this.disposed=true;this.host.removeEventListener('paste',this.paste);this.host.removeEventListener('dragover',this.drag);this.host.removeEventListener('dragleave',this.leave);this.host.removeEventListener('drop',this.drop);this.area.remove();}
}
