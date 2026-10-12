// Keep actions readable: queue notices, coalesce repeats, and pause dismissal
// while the user is hovering or moving focus through the toast.
export function createToasts(host) {
  const queue=[];let current=null,timer,remaining=0,started=0,hovered=false,focused=false;
  const pause=()=>{clearTimeout(timer);if(started)remaining=Math.max(0,remaining-(Date.now()-started));started=0;};
  const resume=()=>{pause();if(current&&!hovered&&!focused){started=Date.now();timer=setTimeout(dismiss,remaining);}};
  function dismiss(){pause();host.classList.remove('visible');host.inert=true;current=null;showNext();}
  function showNext(){
    if(current||!queue.length)return;
    current=queue.shift();host.replaceChildren();focused=false;host.inert=false;host.dataset.tone=current.tone;
    const mark=document.createElement('span');mark.className='toast-mark';mark.setAttribute('aria-hidden','true');mark.textContent=({success:'✓',error:'!',info:'i'})[current.tone]||'i';
    const text=document.createElement('span');text.className='toast-message';text.textContent=current.message;host.append(mark,text);
    if(current.action){const action=current.action,button=document.createElement('button');button.type='button';button.className='toast-action';button.textContent=action.label;button.onclick=()=>{dismiss();Promise.resolve().then(()=>action.run()).catch(error=>push(error.message,null,{tone:'error'}));};host.append(button);}
    const close=document.createElement('button');close.type='button';close.className='toast-dismiss';close.setAttribute('aria-label','Dismiss notification');close.textContent='×';close.onclick=dismiss;host.append(close);
    host.classList.add('visible');remaining=current.action||current.tone==='error'?12000:5500;resume();
  }
  function push(message,action,{tone='info',key=message}={}) {
    if(current?.key===key||queue.some(item=>item.key===key))return;
    queue.push({message,action,tone,key});if(queue.length>5)queue.shift();showNext();
  }
  host.inert=true;
  host.addEventListener('mouseenter',()=>{hovered=true;pause();});host.addEventListener('mouseleave',()=>{hovered=false;resume();});
  host.addEventListener('focusin',()=>{focused=true;pause();});host.addEventListener('focusout',event=>{focused=host.contains(event.relatedTarget);resume();});
  return push;
}
