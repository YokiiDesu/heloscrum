// Browser-local sent text, isolated by project and stable agent identity.
export class InputHistory {
  constructor(project,agent,storage=globalThis.localStorage){this.key='heloscrum.input-history:'+JSON.stringify([project,agent]);this.storage=storage;this.reset();}
  entries(){try{const a=JSON.parse(this.storage.getItem(this.key)||'[]');return Array.isArray(a)?a.filter(t=>typeof t==='string'&&t.length<=16000).slice(-50):[];}catch{return [];}}
  remember(text){if(!text.trim())return;let a=this.entries();if(a.at(-1)!==text)a.push(text);a=a.slice(-50);while(a.join('').length>128000)a.shift();try{this.storage.setItem(this.key,JSON.stringify(a));}catch{}this.reset();}
  reset(){this.index=null;this.draft=null;this.last=null;}
  navigate(direction,value){const a=this.entries();if(!a.length)return null;if(this.index===null||value!==this.last){if(direction>0)return null;this.draft=value;this.index=a.length;}this.index=Math.max(0,Math.min(a.length,this.index+direction));this.last=this.index===a.length?this.draft:a[this.index];return this.last;}
  handle(event,input){
    if(!['ArrowUp','ArrowDown'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing||input.selectionStart!==input.selectionEnd)return false;
    const value=input.value,pos=input.selectionStart,up=event.key==='ArrowUp',active=this.index!==null&&value===this.last;
    if(!active&&(up?value.slice(0,pos).includes('\n'):value.slice(pos).includes('\n')))return false;
    const next=this.navigate(up?-1:1,value);if(next===null)return false;event.preventDefault();input.value=next;input.setSelectionRange(next.length,next.length);return true;
  }
}
