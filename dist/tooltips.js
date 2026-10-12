const MARGIN=12,GAP=8;

export function tooltipPosition(anchor,size,viewport){
  const below=viewport.height-anchor.bottom-GAP-MARGIN;
  const above=anchor.top-GAP-MARGIN;
  const side=below>=size.height||below>=above?'bottom':'top';
  const clamp=(value,min,max)=>Math.max(min,Math.min(value,Math.max(min,max)));
  return {
    left:clamp(anchor.left+(anchor.width-size.width)/2,MARGIN,viewport.width-size.width-MARGIN),
    top:clamp(side==='bottom'?anchor.bottom+GAP:anchor.top-size.height-GAP,MARGIN,viewport.height-size.height-MARGIN),
    side,
  };
}

// One shared, theme-aware tooltip works for existing and dynamically rendered titles.
// Titles become plain text, never HTML, and retain their accessible names/descriptions.
export function installTooltips(doc=document){
  const win=doc.defaultView,labels=new WeakMap(),listeners=[];
  const tip=doc.createElement('div');
  tip.id='heloscrum-tooltip';tip.className='app-tooltip';tip.hidden=true;
  tip.setAttribute('role','tooltip');tip.setAttribute('popover','manual');
  doc.body.append(tip);
  let active=null,hovered=null,focused=null,showTimer=null,hideTimer=null,visibleText='';

  function adopt(element){
    const text=element.getAttribute('title');if(text===null)return;
    const previous=labels.get(element);
    if(previous&&element.getAttribute(previous.attribute)===previous.text){
      if(text)element.setAttribute(previous.attribute,text);else element.removeAttribute(previous.attribute);
      labels.set(element,{attribute:previous.attribute,text});
    }else if(text){
      const unnamed=element.matches('button,a[href],input,select,textarea,[role=button]')
        &&!element.hasAttribute('aria-label')&&!element.hasAttribute('aria-labelledby')
        &&!element.textContent.trim()&&!element.labels?.length&&!element.querySelector('img[alt]');
      const attribute=unnamed?'aria-label':'aria-description';
      if(!element.hasAttribute(attribute)&&!element.hasAttribute('aria-describedby')){
        element.setAttribute(attribute,text);labels.set(element,{attribute,text});
      }
    }
    element.dataset.tooltip=text;element.removeAttribute('title');
  }
  function scan(root){
    if(root.nodeType!==1)return;
    if(root.hasAttribute('title'))adopt(root);
    root.querySelectorAll('[title]').forEach(adopt);
  }
  function target(node){
    const element=node?.closest?.('[data-tooltip],[title]');
    if(!element||tip.contains(element))return null;
    if(element.hasAttribute('title'))adopt(element);
    return element.dataset.tooltip?.trim()?element:null;
  }
  function removeDescription(){
    if(!active)return;
    const ids=(active.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);
    if(ids.length)active.setAttribute('aria-describedby',ids.join(' '));else active.removeAttribute('aria-describedby');
  }
  function hide(){
    win.clearTimeout(showTimer);win.clearTimeout(hideTimer);showTimer=hideTimer=null;
    removeDescription();active=null;
    if(typeof tip.hidePopover==='function'&&tip.matches(':popover-open'))tip.hidePopover();
    tip.hidden=true;
  }
  function position(){
    if(!active?.isConnected)return hide();
    const anchor=active.getBoundingClientRect(),size=tip.getBoundingClientRect();
    const place=tooltipPosition(anchor,size,{width:doc.documentElement.clientWidth,height:win.innerHeight});
    tip.style.left=place.left+'px';tip.style.top=place.top+'px';tip.dataset.side=place.side;
  }
  function render(element){
    visibleText=element.dataset.tooltip;tip.replaceChildren();
    const shortcuts=element.dataset.tooltipKind==='shortcuts';
    tip.classList.toggle('app-tooltip-shortcuts',shortcuts);
    if(shortcuts){
      for(const part of visibleText.split(' · ')){
        const split=part.indexOf(':');
        if(split<0){const line=doc.createElement('div');line.textContent=part;tip.append(line);continue;}
        const row=doc.createElement('div'),key=doc.createElement('kbd'),detail=doc.createElement('span');
        row.className='app-tooltip-shortcut';key.textContent=part.slice(0,split);detail.textContent=' '+part.slice(split+1).trim();
        row.append(key,detail);tip.append(row,doc.createTextNode('\n'));
      }
    }else tip.textContent=visibleText;
  }
  function show(element){
    hide();if(!element.isConnected||!element.dataset.tooltip?.trim())return;
    active=element;render(element);
    const ids=new Set((element.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
    ids.add(tip.id);element.setAttribute('aria-describedby',[...ids].join(' '));
    // Popovers escape card clipping and stay above modal dialogs without moving focus.
    (element.closest('dialog[open]')||doc.body).append(tip);
    tip.style.visibility='hidden';tip.hidden=false;
    if(typeof tip.showPopover==='function')tip.showPopover();
    position();tip.style.visibility='visible';
  }
  function request(element,delay=400){
    win.clearTimeout(hideTimer);
    if(element===active)return;
    hide();
    if(!delay)return show(element);
    showTimer=win.setTimeout(()=>{showTimer=null;if(element===hovered||element===focused)show(element);},delay);
  }
  function leave(){win.clearTimeout(showTimer);win.clearTimeout(hideTimer);hideTimer=win.setTimeout(hide,140);}
  function listen(host,name,handler,options){host.addEventListener(name,handler,options);listeners.push(()=>host.removeEventListener(name,handler,options));}

  listen(doc,'pointerover',event=>{
    if(event.pointerType==='touch')return;
    if(tip.contains(event.target)){win.clearTimeout(hideTimer);return;}
    const next=target(event.target);if(next===hovered)return;
    hovered=next;if(next)request(next);else if(active!==focused)leave();
  },true);
  listen(doc,'pointerout',event=>{
    if(event.pointerType==='touch')return;
    if(hovered?.contains(event.target)&&!hovered.contains(event.relatedTarget))hovered=null;
    if(!tip.contains(event.relatedTarget)&&!hovered&&active!==focused)leave();
  },true);
  listen(doc,'focusin',event=>{
    focused=event.target.matches?.(':focus-visible')?target(event.target):null;
    if(focused)request(focused,0);
  });
  listen(doc,'focusout',event=>{if(focused&&!focused.contains(event.relatedTarget)){focused=null;if(active!==hovered)leave();}});
  listen(doc,'keydown',event=>{
    if(event.key==='Escape'&&active){event.preventDefault();event.stopPropagation();}
    hide();
  },true);
  listen(doc,'pointerdown',hide,true);
  listen(doc,'input',hide,true);
  listen(doc,'scroll',event=>{if(!tip.contains(event.target))hide();},{capture:true,passive:true});
  listen(win,'resize',hide);listen(win,'blur',hide);
  scan(doc.body);
  const observer=new win.MutationObserver(records=>{
    for(const record of records){if(record.type==='attributes')adopt(record.target);else record.addedNodes.forEach(scan);}
    if(active){if(!active.isConnected||!active.dataset.tooltip?.trim())hide();else if(active.dataset.tooltip!==visibleText){render(active);position();}}
  });
  observer.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['title']});
  return ()=>{hide();observer.disconnect();listeners.forEach(remove=>remove());tip.remove();};
}
