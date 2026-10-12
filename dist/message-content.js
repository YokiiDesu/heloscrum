const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readingPositions=new Map();

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
