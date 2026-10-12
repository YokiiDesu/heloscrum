import {TOUR_KEY,TOUR_VERSION,tourSteps,tourContexts,readTourProgress,tourPosition,tourHighlightBounds} from './tour-steps.js';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extraDialog={id:'other-dialog',title:'This Window',steps:[{title:'Keep Going — The Tour Is Still Here',body:["You can use this window normally. When you close it, we'll bring back the tip you were reading."],tip:"The tour won't submit a form or approve an action for you."}]};

// This guide observes real controls, selects workspace tabs, and uses normal
// close controls when the user advances from a window. It never submits forms
// or replies to an agent.
export function installGuidedTour({selectTab,currentTab,notify=()=>{}}) {
  const root=document.createElement('div');root.className='guided-tour';root.hidden=true;
  root.setAttribute('popover','manual');
  root.innerHTML='<div class="tour-highlight-clip" aria-hidden="true" hidden><div class="tour-highlight"></div></div><section class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-copy"></section>';
  document.body.append(root);
  const card=root.querySelector('.tour-card'),highlight=root.querySelector('.tour-highlight'),highlightClip=root.querySelector('.tour-highlight-clip');
  let mode=null,index=0,target=null,returnFocus=null,initialTab=null,frame=0,invitationTimer=0,generation=0,ready=false;
  let context=null,contextHost=null,contextIndex=0,compact=false,interaction=null;
  let placement=null,revealPending=false,exploredSettings=null;
  const saved=()=>{try{return readTourProgress(localStorage.getItem(TOUR_KEY));}catch{return null;}};
  const persist=status=>{try{localStorage.setItem(TOUR_KEY,JSON.stringify({version:TOUR_VERSION,status,step:tourSteps[index].id}));}catch{}};
  const viewport=()=>({width:document.documentElement.clientWidth,height:window.innerHeight});
  const visible=element=>element?.isConnected&&!element.closest('[hidden]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
  const activeModal=()=>[...document.querySelectorAll('dialog[open],[aria-modal="true"]')].filter(visible).at(-1)||null;
  const item=()=>context?context.steps[contextIndex]:tourSteps[index];
  const canAdvanceFromProjects=()=>contextHost?.matches?.('.project-library-dialog[open]')&&index<tourSteps.length-1;
  function contextReturn() {
    if(context.inline)return `<p class="tour-return">${contextIndex===context.steps.length-1?`Next moves on to step ${index+2} of ${tourSteps.length}. Your conversation and draft stay open.`:'You can read the conversation and prepare a draft while these tips are open.'}</p>`;
    if(canAdvanceFromProjects())return `<div class="tour-return"><span>Close this view and move on to step ${index+2} of ${tourSteps.length}</span><button type="button" data-tour="close-projects">Close Projects</button></div>`;
    if(contextIndex===context.steps.length-1)return `<p class="tour-return">${index===tourSteps.length-1?'Next closes this view and finishes the tour.':`Next closes this view and moves on to step ${index+2} of ${tourSteps.length}.`}</p>`;
    return `<div class="tour-return"><span>Close this view to return to tour step ${index+1} of ${tourSteps.length}.</span><button type="button" data-tour="minimize" aria-label="Minimize tour tips">Minimize</button></div>`;
  }
  function advanceFromContext() {
    if(context.inline)return void step(index+1);
    let view=contextHost,close;
    if(view===document){
      if(context.id==='new-group'){
        view=find('.group-create:not([hidden])');close=find('[data-thread-action="cancel-new"]',view||document);
      }else if(context.id==='chat-filters'){
        view=find('.chat-filter-panel:not([hidden])');close=find('[data-thread-action="filters"]');
      }else{
        view=find('#pack-drawer:not([hidden])');close=find('[data-pack="close-drawer"],[data-memory="close"],[data-history="close"]',view||document);
      }
    }else if(view){
      close=find('[data-library="close"],[data-project-setting="close"],[data-work="close"],[data-action="close"],button[aria-label^="Close"]',view);
    }
    if(!view)return;
    if(view.getAttribute('aria-busy')==='true'||close?.disabled){notify('Finish the current action before moving on.');return;}
    // Normal close handlers preserve drafts and enforce in-progress guards.
    // Never use submit, save, or other form actions to advance the guide.
    if(close)close.click();
    else if(view.matches('dialog[open]')&&view.requestClose)view.requestClose();
    const closed=!view.isConnected||!visible(view)||(view.matches('dialog')&&!view.open);
    if(!closed){notify('This view is still open. Close it when you’re ready, then choose Next.');return;}
    return index===tourSteps.length-1?stop('complete'):void step(index+1);
  }
  function find(selector,scope=document) {
    for(const part of (selector||'').split(',').filter(Boolean)){
      const found=[...scope.querySelectorAll(part)].find(element=>!root.contains(element)&&visible(element));if(found)return found;
    }
    return null;
  }
  function resolveTarget() {
    const current=item(),scope=contextHost||document;
    return find(current.target,scope)||find(current.fallback,scope);
  }
  function describe(element) {
    if(target===element)return;
    if(target){const ids=(target.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!=='tour-copy');if(ids.length)target.setAttribute('aria-describedby',ids.join(' '));else target.removeAttribute('aria-describedby');}
    target=element;
    if(target){const ids=new Set((target.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));ids.add('tour-copy');target.setAttribute('aria-describedby',[...ids].join(' '));}
  }
  function mount(modal=activeModal()) {
    // A native modal makes its siblings inert. Keep the guide inside the
    // active dialog, then use the popover top layer to escape its clipping.
    const parent=modal||document.body;
    if(root.parentElement!==parent)parent.append(root);
    if(!root.hidden&&root.showPopover&&!root.matches(':popover-open'))root.showPopover();
  }
  function detectContext(modal) {
    // The final Settings visit introduces the whole tab strip. Only move
    // into a section's tips after the user chooses a tab or uses its body.
    if(tourSteps[index].id==='settings'&&modal?.matches('.project-settings-dialog')){
      if(exploredSettings!==modal)return {definition:tourContexts.find(candidate=>candidate.id==='settings'),host:modal};
    }
    for(const candidate of tourContexts){
      if(candidate.mainStep&&candidate.mainStep!==tourSteps[index].id)continue;
      const anchor=find(candidate.when,modal||document);
      // querySelectorAll doesn't include the scope itself.
      if(anchor||(modal?.matches(candidate.when)))return {definition:candidate,host:modal||document};
    }
    return modal?{definition:extraDialog,host:modal}:null;
  }
  function syncContext(modal) {
    const next=detectContext(modal);
    let changed=context?.id!==next?.definition.id||contextHost!==(next?.host||null);
    if(changed){context=next?.definition||null;contextHost=next?.host||null;contextIndex=0;compact=false;}
    if(context&&interaction?.isConnected){
      const control=interaction.closest('button,input,select,textarea,summary,a')||interaction;
      const chosen=context.steps.findIndex(tip=>(tip.focus||tip.target)&&control.matches(tip.focus||tip.target));
      if(chosen>=0&&(chosen!==contextIndex||compact)){contextIndex=chosen;compact=false;changed=true;}
    }
    interaction=null;
    if(changed)render();
  }
  function visibleGeometry(element,view,cache) {
    const bounds=element.getBoundingClientRect();
    const clip={left:6,top:6,right:view.width-6,bottom:view.height-6};
    for(let parent=element.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      let data=cache.get(parent);
      if(!data){
        const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
        data={x:/(auto|scroll|hidden|clip)/.test(style.overflowX),y:/(auto|scroll|hidden|clip)/.test(style.overflowY),left:rect.left+parent.clientLeft,top:rect.top+parent.clientTop};
        data.right=data.left+parent.clientWidth;data.bottom=data.top+parent.clientHeight;
        data.bars=data.y?[...parent.querySelectorAll('header,footer,nav,.dialog-actions,.work-dialog-head,.drawer-heading')].filter(bar=>!root.contains(bar)&&visible(bar)).map(bar=>({element:bar,style:getComputedStyle(bar),rect:bar.getBoundingClientRect()})).filter(bar=>['sticky','fixed'].includes(bar.style.position)):[];
        cache.set(parent,data);
      }
      if(data.x){clip.left=Math.max(clip.left,data.left);clip.right=Math.min(clip.right,data.right);}
      if(data.y){clip.top=Math.max(clip.top,data.top);clip.bottom=Math.min(clip.bottom,data.bottom);}
      for(const bar of data.bars){
        if(bar.element.contains(element)||bar.rect.right<=bounds.left||bar.rect.left>=bounds.right)continue;
        if(bar.style.top!=='auto')clip.top=Math.max(clip.top,bar.rect.bottom);
        if(bar.style.bottom!=='auto')clip.bottom=Math.min(clip.bottom,bar.rect.top);
      }
    }
    const shown={left:Math.max(bounds.left,clip.left),right:Math.min(bounds.right,clip.right),top:Math.max(bounds.top,clip.top),bottom:Math.min(bounds.bottom,clip.bottom)};
    shown.width=shown.right-shown.left;shown.height=shown.bottom-shown.top;
    return {bounds,clip,shown:shown.width>0&&shown.height>0?shown:null};
  }
  function revealTarget(geometry) {
    if(!target||!geometry)return;
    const {bounds,clip,shown}=geometry;
    const requiredHeight=Math.min(bounds.height,Math.max(0,clip.bottom-clip.top-24));
    const requiredWidth=Math.min(bounds.width,Math.max(0,clip.right-clip.left-24));
    if(shown&&shown.height>=requiredHeight&&shown.width>=requiredWidth)return;
    target.scrollIntoView({block:'center',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function position() {
    frame=0;if(root.hidden)return;
    const modal=activeModal();mount(modal);
    if(mode==='tour')syncContext(modal);
    describe(mode==='tour'&&!compact?resolveTarget():null);
    const view=viewport(),cache=new Map(),geometry=target?visibleGeometry(target,view,cache):null;
    if(revealPending){revealPending=false;revealTarget(geometry);}
    const onScreen=geometry?.shown;
    const outline=onScreen?tourHighlightBounds(geometry.bounds,geometry.clip):null;
    highlightClip.hidden=!outline;
    if(outline){
      const {clip}=geometry;
      Object.assign(highlightClip.style,{left:clip.left+'px',top:clip.top+'px',width:(clip.right-clip.left)+'px',height:(clip.bottom-clip.top)+'px'});
      Object.assign(highlight.style,{left:(outline.left-clip.left)+'px',top:(outline.top-clip.top)+'px',width:outline.width+'px',height:outline.height+'px'});
    }
    const controls=context?[...contextHost.querySelectorAll('button,input,select,textarea,summary,a')].filter(element=>!root.contains(element)&&visible(element)).flatMap(element=>{const rect=visibleGeometry(element,view,cache).shown;return rect?[{...rect,weight:element.matches('[aria-label^="Close"],[data-action="close"],[data-library="close"],[data-project-setting="close"],[data-work="close"]')?1000:1}]:[];}):[];
    placement=tourPosition(onScreen,card.getBoundingClientRect(),view,controls,placement);
    Object.assign(card.style,{left:placement.left+'px',top:placement.top+'px'});card.dataset.side=placement.side;
    const note=card.querySelector('.tour-location');
    if(note){note.hidden=!!onScreen||!!context;note.textContent="This control isn't in view right now. You can keep reading or move to the next step.";}
    const closeProjects=card.querySelector('[data-tour="close-projects"]');
    if(closeProjects)closeProjects.disabled=contextHost?.getAttribute('aria-busy')==='true';
  }
  function schedule(){if(!root.hidden&&!frame)frame=requestAnimationFrame(position);}
  const resize=new ResizeObserver(schedule);resize.observe(card);
  const observer=new MutationObserver(records=>{if(records.some(record=>!root.contains(record.target)))schedule();});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','class','aria-pressed','aria-selected','aria-busy']});
  function show(){root.hidden=false;document.documentElement.dataset.guidedTour='open';mount();schedule();}
  function intro({manual=false}={}) {
    clearTimeout(invitationTimer);
    if(mode==='tour')return card.querySelector('h2')?.focus();
    returnFocus=document.activeElement;mode='intro';index=saved()?.status==='paused'?saved().index:0;context=null;contextHost=null;compact=false;describe(null);highlightClip.hidden=true;
    const resume=saved()?.status==='paused';
    root.dataset.color='mint';root.dataset.context='';root.classList.remove('tour-compact');
    card.innerHTML=`<div class="tour-kicker"><span>WELCOME TO HELOSCRUM</span><button type="button" data-tour="dismiss">Not now</button></div><div class="tour-emblem" aria-hidden="true"><img src="/brand/heloscrum-icon.svg" alt="" width="36" height="36"></div><h2 id="tour-title" tabindex="-1">${resume?'Pick Up Where You Left Off?':'Want A Look Around?'}</h2><div id="tour-copy"><p>We'll walk through projects, agents, tasks, and reviews, with a few tips to help your first team get going.</p><p>Open any highlighted menu to see its tips. You can skip the tour at any point, and we'll keep your place.</p></div><p class="tour-meta">18 main steps · Explore menus at your own pace</p><div class="tour-intro-actions">${resume?'<button type="button" data-tour="restart">Start over</button>':''}<button type="button" class="tour-primary" data-tour="begin">${resume?'Continue tour':'Show me around'} <span aria-hidden="true">→</span></button></div>`;
    show();if(manual)card.querySelector('h2').focus({preventScroll:true});
  }
  function render() {
    placement=null;revealPending=mode==='tour'&&!compact;
    const current=item();root.dataset.color=current.color||tourSteps[index].color;
    root.dataset.context=context?.id||'';root.classList.toggle('tour-compact',compact);
    const count=context?`${contextIndex+1} / ${context.steps.length}`:`${index+1} / ${tourSteps.length}`;
    const kicker=`<div class="tour-kicker"><span>${escape(context?.title||current.chapter)} <span class="tour-count">${count}</span></span><button type="button" data-tour="skip">Skip tour</button></div>`;
    if(compact){
      card.innerHTML=`${kicker}<h2 id="tour-title" tabindex="-1">The Tour’s Right Here</h2><div id="tour-copy">${canAdvanceFromProjects()?contextReturn():`<p>Close this view to return to step ${index+1}, or keep exploring.</p>`}</div><button type="button" data-tour="expand">Show tips</button>`;return;
    }
    const progress=context?(contextIndex+1)/context.steps.length:(index+1)/tourSteps.length;
    card.innerHTML=`${kicker}<div class="tour-progress" role="progressbar" aria-label="${context?'Window tips':'Tour progress'}" aria-valuemin="0" aria-valuemax="${context?context.steps.length:tourSteps.length}" aria-valuenow="${context?contextIndex+1:index+1}"><span style="width:${progress*100}%"></span></div><h2 id="tour-title" tabindex="-1">${escape(current.title)}</h2><div id="tour-copy">${current.body.map(text=>`<p>${escape(text)}</p>`).join('')}</div>${current.link?`<a class="tour-guide-link" href="${escape(current.link.href)}" target="_blank" rel="noopener">${escape(current.link.label)} <span aria-hidden="true">↗</span></a>`:''}<p class="tour-tip">${escape(current.tip)}</p><p class="tour-location" hidden></p>${context?contextReturn():`<label class="tour-topic"><span>Jump to a topic</span><select aria-label="Jump to a tour topic">${tourSteps.map((s,i)=>`<option value="${i}" ${i===index?'selected':''}>${i+1}. ${escape(s.title)}</option>`).join('')}</select></label>`}<footer class="tour-actions"><button type="button" data-tour="back" ${(context?contextIndex:index)===0?'disabled':''}>← Back</button><span class="tour-keyboard">${context?'Explore at your pace':'Esc to leave'}</span><button type="button" class="tour-primary" data-tour="next">${context?(contextIndex===context.steps.length-1?'Next':'Next tip →'):(index===tourSteps.length-1?'Finish tour':'Next →')}</button></footer>${context?'<div class="tour-pause"><button type="button" data-tour="pause" aria-describedby="tour-pause-help">Keep exploring</button><p id="tour-pause-help">This pauses the tour. Use Tour in the top right to resume.</p></div>':''}`;
  }
  async function step(next) {
    const token=++generation;index=Math.max(0,Math.min(tourSteps.length-1,next));mode='tour';persist('paused');
    context=null;contextHost=null;contextIndex=0;compact=false;interaction=null;exploredSettings=null;render();show();
    const current=tourSteps[index];
    if(current.tab&&!activeModal()){try{await selectTab(current.tab);}catch{notify("This view couldn't load right now. You can still continue the tour.");}}
    if(token!==generation||mode!=='tour')return;
    position();
    schedule();card.querySelector('h2').focus({preventScroll:true});
  }
  function contextStep(next) {
    interaction=null;contextIndex=Math.max(0,Math.min(context.steps.length-1,next));render();position();
    schedule();card.querySelector('h2').focus({preventScroll:true});
  }
  function stop(status,{restore=true}={}) {
    ++generation;clearTimeout(invitationTimer);if(status)persist(status);
    const wasTour=mode==='tour',wasContext=!!context,modal=activeModal();mode=null;root.hidePopover?.();root.hidden=true;describe(null);highlightClip.hidden=true;
    context=null;contextHost=null;interaction=null;delete document.documentElement.dataset.guidedTour;
    document.body.append(root);cancelAnimationFrame(frame);frame=0;
    if(restore){if(wasTour&&initialTab&&!modal&&!wasContext)void selectTab(initialTab);const focus=visible(returnFocus)&&(!modal||modal.contains(returnFocus))?returnFocus:modal?.querySelector('button,input,select,textarea')||document.querySelector('[data-tour-start]');focus?.focus({preventScroll:true});}
    if(status==='complete')notify("You're all set. Tour is here whenever you need it.");
  }
  card.addEventListener('click',event=>{
    // Dialogs have their own delegated click handlers. Guide controls belong
    // only to the guide, even when it is mounted inside one of those dialogs.
    event.stopPropagation();
    const action=event.target.closest('[data-tour]')?.dataset.tour;if(!action)return;
    interaction=null;
    if(action==='dismiss')return stop(saved()?.status==='paused'?'paused':'dismissed');
    if(action==='skip')return stop('paused');
    if(action==='pause'){stop('paused');notify('Tour paused. Use Tour in the top right to resume.');return;}
    if(action==='close-projects'){
      if(!canAdvanceFromProjects())return;
      const projects=contextHost,next=index+1;
      if(projects.getAttribute('aria-busy')==='true')return;
      const close=projects.querySelector('[data-library="close"]');
      if(!close||close.disabled)return;
      // Use the normal close action, including its in-progress-operation guard.
      close.click();
      if(!projects.isConnected||!projects.open)return void step(next);
      notify("Projects is still open. Finish the current action, then try Close Projects again.");
      return;
    }
    if(action==='begin'||action==='restart'){initialTab=currentTab();return void step(action==='restart'?0:index);}
    if(action==='minimize'||action==='expand'){compact=action==='minimize';render();schedule();return card.querySelector('h2').focus({preventScroll:true});}
    if(context){
      if(action==='back')return contextStep(contextIndex-1);
      if(action==='next'){if(contextIndex<context.steps.length-1)return contextStep(contextIndex+1);return advanceFromContext();}
    }
    if(action==='back')return void step(index-1);
    if(action==='next')return index===tourSteps.length-1?stop('complete'):void step(index+1);
  });
  card.addEventListener('change',event=>{event.stopPropagation();if(event.target.matches('.tour-topic select'))void step(Number(event.target.value));});
  function follow(event) {
    if(mode!=='tour'||root.contains(event.target))return;
    if(tourSteps[index].id==='settings'&&event.type==='click'&&event.target.closest('.project-settings-tabs button,.project-settings-body button,.project-settings-body input,.project-settings-body select,.project-settings-body textarea')){
      exploredSettings=event.target.closest('.project-settings-dialog');
    }
    interaction=event.target;schedule();
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-tour-start]')){event.preventDefault();intro({manual:true});return;}
    follow(event);
  },true);
  document.addEventListener('focusin',follow,true);
  document.addEventListener('change',follow,true);
  document.addEventListener('keydown',event=>{
    if(root.hidden||event.key!=='Escape')return;
    // Let Escape close a native dialog first. Its close mutation returns the
    // guide to the main step instead of abandoning the tour.
    if(activeModal())return;
    if(context){compact=true;render();schedule();return;}
    event.preventDefault();event.stopImmediatePropagation();stop(mode==='tour'?'paused':saved()?.status==='paused'?'paused':'dismissed');
  },true);
  document.addEventListener('heloscrum-tour-start',()=>intro({manual:true}));
  document.addEventListener('scroll',schedule,{capture:true,passive:true});
  window.addEventListener('resize',()=>{revealPending=mode==='tour'&&!compact;schedule();});
  return {ready(){if(ready)return;ready=true;if(!saved())invitationTimer=setTimeout(()=>{if(!document.hidden&&!activeModal())intro();},1400);},start:()=>intro({manual:true})};
}
