const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readingPositions=new Map();

const parseJSON=text=>{try{return JSON.parse(text);}catch{return null;}};
const parseResult=text=>{const json=parseJSON(text);if(json!==null)return json;const split=String(text).indexOf('\n\n');if(split<0)return null;const meta=parseJSON(text.slice(0,split));return meta?.format==='heloscrum-source-page'?{...meta,text:text.slice(split+2)}:null;};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

// Context pages can start/end inside a JSON string. Show only the text actually
// present; never fetch more context, reconstruct records, or rewrite saved output.
function inboxExcerpts(text){
  const excerpts=[];
  const decode=(value,continued=false)=>{
    const decoded=parseJSON('"'+value+'"');
    if(typeof decoded==='string'&&decoded.trim())excerpts.push({text:decoded,continued});
  };
  const leading=text.match(/^((?:\\.|[^"\\])*)"\s*,\s*"[a-zA-Z]/);
  if(leading)decode(leading[1],true);
  const fields=/(?:^|[,{])\s*"text"\s*:\s*"((?:\\.|[^"\\])*)("|$)/g;
  for(const match of text.matchAll(fields))decode(match[1],match[2]!== '"');
  return excerpts;
}

export function toolOutputHTML(event,{markdown}={}){
  const raw=String(event.output??''),prose=text=>markdown?markdown(text,{literalHtml:true}):esc(text).replaceAll('\n','<br>');
  let value=parseResult(raw);
  // MCP text envelopes and JSON-encoded strings occur in both live and saved
  // provider transcripts. Only unwrap a single text block so none are dropped.
  for(let i=0;i<3;i++){
    if(typeof value==='string'){const parsed=parseJSON(value);if(parsed===null)break;value=parsed;continue;}
    if(object(value)&&Array.isArray(value.content)&&value.content.length===1&&value.content[0]?.type==='text'){
      const parsed=parseResult(value.content[0].text);if(parsed===null)break;value=parsed;continue;
    }
    break;
  }
  const isPage=object(value)&&typeof value.reference==='string'&&typeof value.source==='string'&&typeof value.text==='string';
  const payload=isPage?parseJSON(value.text):value;
  const messages=object(payload)&&Array.isArray(payload.messages)&&payload.messages.every(m=>object(m)&&typeof m.text==='string')?payload.messages:null;
  const rawDetails=()=>`<details class="tool-output-raw" data-event="${esc(event.id)}:raw"><summary>Raw output</summary><pre>${esc(raw)}</pre></details>`;
  if(value?.format==='heloscrum-source-page'&&!isPage){
    return `<div class="tool-output-readable"><div class="tool-output-meta"><strong>${esc(value.name||value.key||'Source excerpt')}</strong><span>Characters ${esc(value.offset)}–${esc(value.endOffset)} of ${esc(value.totalCharacters)}</span></div>${value.sha256?`<p class="tool-output-note">SHA-256 · ${esc(value.sha256)}</p>`:''}${value.nextOffset!==null?'<p class="tool-output-note">Partial source · more content is available.</p>':''}<pre>${esc(value.text)}</pre>${rawDetails()}</div>`;
  }
  const message=m=>`<article class="tool-output-message"><header><strong>${esc(m.fromRole||'Message')}${m.toRole?' → '+esc(m.toRole):''}</strong>${typeof m.at==='string'?`<time>${esc(m.at)}</time>`:''}</header><div class="markdown tool-output-prose">${prose(m.text)}</div></article>`;
  if(isPage){
    const offset=Number.isInteger(value.offset)&&value.offset>=0?value.offset:0,total=Number.isInteger(value.totalCharacters)&&value.totalCharacters>=0?value.totalCharacters:null;
    const partial=offset>0||value.nextOffset!=null||(total!==null&&offset+value.text.length<total);
    const range=`Characters ${offset.toLocaleString('en-US')}–${(offset+value.text.length).toLocaleString('en-US')}${total!==null?' of '+total.toLocaleString('en-US'):''}`;
    let body;
    if(messages)body=messages.map(message).join('')||'<p class="tool-output-note">No messages in this result.</p>';
    else if(/(?:^|__)read_inbox$/.test(value.source)){
      const excerpts=inboxExcerpts(value.text);
      body=excerpts.length?excerpts.map(m=>`<article class="tool-output-message"><header><strong>${m.continued?'Partial message':'Message excerpt'}</strong></header><div class="markdown tool-output-prose">${prose(m.text)}</div></article>`).join(''):`<pre>${esc(payload!==null?JSON.stringify(payload,null,2):value.text)}</pre>`;
    }else body=payload!==null?`<pre>${esc(JSON.stringify(payload,null,2))}</pre>`:`<div class="markdown tool-output-prose">${prose(value.text)}</div>`;
    return `<div class="tool-output-readable"><div class="tool-output-meta"><strong>Saved context · ${esc(value.source)}</strong><span>${range}</span></div>${partial?'<p class="tool-output-note">Partial saved result · only this page is shown; records may continue outside it.</p>':''}${body}${rawDetails()}</div>`;
  }
  if(messages)return `<div class="tool-output-readable">${messages.map(message).join('')||'<p class="tool-output-note">No messages in this result.</p>'}${rawDetails()}</div>`;
  return `<pre>${esc(value!==null?JSON.stringify(value,null,2):raw)}</pre>`;
}

// The body is already sanitized Markdown. Never shorten the source itself.
export function messageContent(html,key,instance=key){
  const id='message-body-'+encodeURIComponent(instance);
  return `<message-content class="message-content" data-message-key="${esc(key)}"><div class="message-scroll" id="${esc(id)}"><div class="markdown">${html}</div></div><button type="button" class="message-expand" aria-expanded="false" aria-controls="${esc(id)}" hidden><span>See more</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></message-content>`;
}

// Custom-element cleanup follows each message through polling and view changes.
// Registration is lazy so the HTML helper also works in server-side tests.
export function enhanceMessageContent(){
  if(customElements.get('message-content'))return;
  customElements.define('message-content',class extends HTMLElement{
    connectedCallback(){
      this.viewport=this.querySelector('.message-scroll');
      this.body=this.viewport?.querySelector('.markdown');
      this.button=this.querySelector('.message-expand');
      if(!this.body||!this.button)return;
      this.saved=readingPositions.get(this.dataset.messageKey)||{expanded:false,top:0};
      this.expanded=this.saved.expanded;
      this.restoreTop=this.saved.top;
      this.button.onclick=()=>this.toggle(!this.expanded);
      this.viewport.onscroll=()=>{if(this.restoreTop===null)this.remember();};
      this.viewport.onwheel=this.viewport.onpointerdown=this.viewport.onkeydown=()=>{this.restoreTop=null;};
      // Keyboard users can still reach links and code controls beyond the preview.
      this.viewport.onfocusin=event=>{
        if(event.target===this.viewport||!this.long)return;
        if(!this.expanded)this.toggle(true);
        const target=event.target.getBoundingClientRect(),box=this.viewport.getBoundingClientRect();
        if(target.top<box.top||target.bottom>box.bottom)this.viewport.scrollTop+=target.top-box.top;
      };
      this.measure();
      this.observer=new ResizeObserver(()=>this.measure());
      this.observer.observe(this.body);
    }
    disconnectedCallback(){
      this.observer?.disconnect();
      // Disconnected elements have no layout; keep the last actual scroll position.
      if(this.viewport)this.viewport.onscroll=null;
    }
    remember(){
      if(!this.isConnected)return;
      const key=this.dataset.messageKey;
      readingPositions.delete(key);
      readingPositions.set(key,{expanded:this.expanded,top:this.viewport.scrollTop});
      if(readingPositions.size>500)readingPositions.delete(readingPositions.keys().next().value);
    }
    measure(){
      if(!this.body.getClientRects().length)return;
      const line=parseFloat(getComputedStyle(this.body).lineHeight)||24;
      this.style.setProperty('--message-line-height',line+'px');
      this.long=this.body.scrollHeight>line*7+1;
      this.classList.toggle('is-collapsed',this.long&&!this.expanded);
      this.classList.toggle('is-expanded',this.long&&this.expanded);
      this.button.hidden=!this.long;
      this.button.setAttribute('aria-expanded',String(this.long&&this.expanded));
      this.button.querySelector('span').textContent=this.expanded?'See less':'See more';
      if(this.long&&this.expanded){
        this.viewport.tabIndex=0;
        this.viewport.setAttribute('role','region');
        this.viewport.setAttribute('aria-label','Full message');
      }else{
        this.viewport.removeAttribute('tabindex');
        this.viewport.removeAttribute('role');
        this.viewport.removeAttribute('aria-label');
      }
      // Rich content can grow after mounting (code headers, fonts, diagrams).
      if(this.restoreTop!==null){
        this.viewport.scrollTop=this.restoreTop;
        if(Math.abs(this.viewport.scrollTop-this.restoreTop)<1)this.restoreTop=null;
      }
    }
    toggle(expanded){
      this.restoreTop=null;
      this.expanded=expanded;
      this.measure();
      if(!expanded)this.viewport.scrollTop=0;
      this.remember();
      this.dispatchEvent(new CustomEvent('message-content-resize',{bubbles:true}));
    }
  });
}
