import {resolvedTheme} from './preferences.js';
import {agentIdentities} from './agent-appearance.js';
import { screenFrame, transcriptRows, activeEvents, framePatch, scrollStep, TUI_COLORS, TUI_LIGHT_COLORS, tuiForeground } from './tui-model.js';

export class TranscriptTUI {
  constructor(host,{task,transcript,state,expanded,onCompose,onInterrupt}){
    Object.assign(this,{host,task,transcript,state,expanded,onCompose,onInterrupt});
    this.rowHeight=19;this.targetTop=state.top;this.inViewport=true;
    this.motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.viewport=document.createElement('div');this.viewport.className='tui-scroll-viewport';
    this.surface=document.createElement('div');this.surface.className='tui-scroll-surface';this.viewport.append(this.surface);
    this.status=document.createElement('div');this.status.className='tui-live-status';
    host.append(this.viewport,this.status);
    this.colors=resolvedTheme()==='light'?TUI_LIGHT_COLORS:TUI_COLORS;
    this.term=new window.Terminal({fontSize:14,fontFamily:'Menlo, Monaco, monospace',lineHeight:1.35,scrollback:0,disableStdin:false,cursorBlink:false,theme:this.theme()});
    this.fit=new window.FitAddon.FitAddon();this.term.loadAddon(this.fit);this.term.open(this.surface);this.term.write('\x1b[?1049h\x1b[?7l');
    const input=host.querySelector('textarea');if(input)input.setAttribute('aria-label',(task.role||task.title)+' TUI keyboard');
    this.input=this.term.onData(data=>this.key(data));
    this.rendered=this.term.onRender(()=>{const commit=this.afterRender;if(commit){this.afterRender=null;commit();}});
    this.term.attachCustomKeyEventHandler(event=>{if(event.type==='keydown'&&event.key==='Tab'){event.preventDefault();this.nextTool(event.shiftKey?-1:1);return false;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'&&this.term.hasSelection())return false;return true;});
    this.wheel=event=>{
      if(event.ctrlKey||!event.deltaY)return;
      event.preventDefault();
      const pixels=event.deltaY*(event.deltaMode===1?this.rowHeight:event.deltaMode===2?this.viewport.clientHeight:1);
      this.scroll(pixels/this.rowHeight);
    };
    host.addEventListener('wheel',this.wheel,{passive:false});
    this.visibility=()=>{
      if(!this.canAnimate()){cancelAnimationFrame(this.animationFrame);this.animationFrame=null;}
      if(this.motionQuery.matches)this.state.top=this.targetTop;
      this.draw();this.schedule();
    };
    document.addEventListener('visibilitychange',this.visibility);this.motionQuery.addEventListener('change',this.visibility);
    this.intersection=new IntersectionObserver(entries=>{this.inViewport=entries[0].isIntersecting;this.visibility();});this.intersection.observe(host);
    this.resize=new ResizeObserver(()=>{cancelAnimationFrame(this.resizeFrame);this.resizeFrame=requestAnimationFrame(()=>this.measure());});this.resize.observe(this.viewport);
    this.onTheme=()=>{const colors=resolvedTheme()==='light'?TUI_LIGHT_COLORS:TUI_COLORS;if(colors===this.colors)return;this.colors=colors;this.term.options.theme=this.theme();this.lastWritten=null;this.draw();};document.addEventListener('heloscrum-preferences',this.onTheme);
    this.update(task,transcript);this.measure();
  }
  theme(){return {background:this.colors.background,foreground:this.colors.text,selectionBackground:this.colors.selection};}
  canAnimate(){return !this.disposed&&!document.hidden&&this.inViewport&&!this.motionQuery.matches&&this.viewport.clientHeight>0;}
  measure(){
    if(this.disposed||!this.viewport.clientWidth||!this.viewport.clientHeight)return;
    // Two overscan rows keep fractional-pixel movement filled at both edges.
    this.surface.style.height=(this.viewport.clientHeight+this.rowHeight*2)+'px';this.fit.fit();
    this.rowHeight=(this.surface.querySelector('.xterm-screen')?.clientHeight/this.term.rows)||this.rowHeight;
    this.visibleRows=Math.max(1,Math.floor(this.viewport.clientHeight/this.rowHeight));
    this.prepared=null;this.lastWritten=null;this.draw();this.schedule();
  }
  update(task,transcript,error=''){
    if(!this.transcript&&transcript)this.initialized=false;
    const events=transcript?.events||[],signatures=new Map(events.map(event=>[event.id,JSON.stringify(event)]));
    const changed=!this.signatures||signatures.size!==this.signatures.size||[...signatures].some(([id,value])=>this.signatures.get(id)!==value);
    this.signatures=signatures;this.task=task;this.transcript=transcript;this.error=error;this.activity=activeEvents(events,task);
    if(changed||this.identityRevision!==agentIdentities.revision)this.prepared=null;this.identityRevision=agentIdentities.revision;
    this.draw();this.schedule();
  }
  prepare(){
    if(!this.prepared||this.preparedCols!==this.term.cols){
      this.prepared=transcriptRows(this.transcript?.events,this.term.cols,this.expanded,{task:this.task});this.preparedCols=this.term.cols;
    }
    const max=Math.max(0,this.prepared.length-(this.visibleRows||this.term.rows));
    this.targetTop=this.state.follow?max:Math.max(0,Math.min(max,this.targetTop));
    if(!this.initialized||!this.canAnimate()){this.state.top=this.targetTop;this.initialized=true;}
    this.state.top=Math.max(0,Math.min(max,this.state.top));
  }
  draw(now=performance.now()){
    if(this.disposed)return;
    this.prepare();
    const motion={tick:Math.floor(now/80),enabled:this.canAnimate()};
    const frame=screenFrame({colors:this.colors,cols:this.term.cols,rows:this.term.rows,visibleRows:this.visibleRows,footer:false,position:this.state.top,task:this.task,events:this.transcript?.events,preparedHistory:this.prepared,activity:this.activity,motion,expanded:this.expanded,top:this.state.top,follow:this.state.follow,selected:this.state.selected,error:this.error,loaded:!!this.transcript});
    this.frame=frame;this.lastMotionTick=motion.tick;
    const status=frame.status;
    if(this.status.textContent!==status.text)this.status.textContent=status.text;
    this.status.style.color=tuiForeground(status.spans[0],this.colors);
    this.host.classList.toggle('is-working',['working','starting'].includes(this.task.status)&&!this.error);
    this.paint(frame);
  }
  paint(frame=this.frame){
    const pixels=(this.state.top-frame.top)*this.rowHeight;
    // Coalesce frames while xterm parses a write. Translation and its row content
    // are committed together, so a slow write cannot flash the wrong history row.
    this.pendingPaint={frame,pixels};if(this.writing)return;
    this.flushPaint();
  }
  flushPaint(){
    if(this.disposed||!this.pendingPaint)return;
    const {frame,pixels}=this.pendingPaint;this.pendingPaint=null;
    const patch=framePatch(frame,this.lastWritten);
    const commit=()=>{
      if(this.disposed)return;
      this.lastWritten=frame;this.surface.style.transform=`translate3d(0,${-pixels}px,0)`;this.writing=false;this.flushPaint();
    };
    if(patch){this.writing=true;this.term.write(patch,()=>{if(!this.disposed)this.afterRender=commit;});}else commit();
  }
  schedule(){
    if(this.animationFrame||!this.canAnimate())return;
    if(this.state.top===this.targetTop&&!['working','starting'].includes(this.task.status))return;
    this.lastTick=performance.now();this.animationFrame=requestAnimationFrame(now=>this.tick(now));
  }
  tick(now){
    this.animationFrame=null;if(!this.canAnimate())return;
    const before=this.state.top;this.state.top=scrollStep(before,this.targetTop,Math.min(64,now-this.lastTick));this.lastTick=now;
    if(Math.floor(before)!==Math.floor(this.state.top)||Math.floor(now/80)!==this.lastMotionTick)this.draw(now);
    else if(before!==this.state.top)this.paint();
    this.schedule();
  }
  scroll(delta){
    this.state.follow=false;this.targetTop=Math.max(0,Math.min(this.frame.maxTop,this.targetTop+delta));
    this.draw();this.schedule();
  }
  latest(){this.state.follow=true;this.state.selected=null;this.draw();this.schedule();}
  nextTool(direction=1){
    const ids=[...new Set(this.frame.history.filter(row=>row.toolHeader).map(row=>row.eventId))];if(!ids.length)return;
    let index=ids.indexOf(this.state.selected);index=index<0?(direction>0?0:ids.length-1):(index+direction+ids.length)%ids.length;this.state.selected=ids[index];
    const row=this.frame.history.findIndex(r=>r.eventId===this.state.selected&&r.toolHeader);this.state.follow=false;
    if(row<this.targetTop||row>=this.targetTop+this.frame.bodyRows)this.targetTop=Math.max(0,row-1);
    this.draw();this.schedule();
  }
  toggleTool(){if(!this.state.selected)return this.onCompose();if(this.expanded.has(this.state.selected))this.expanded.delete(this.state.selected);else this.expanded.add(this.state.selected);this.prepared=null;this.draw();this.schedule();}
  key(data){
    if(['\x1b[A','k'].includes(data))this.scroll(-1);else if(['\x1b[B','j'].includes(data))this.scroll(1);
    else if(['\x1b[5~','\x15'].includes(data))this.scroll(-this.frame.bodyRows);else if(['\x1b[6~','\x04'].includes(data))this.scroll(this.frame.bodyRows);
    else if(['\x1b[F','\x1b[4~','G'].includes(data))this.latest();else if(['\x1b[H','\x1b[1~','g'].includes(data)){this.state.follow=false;this.targetTop=0;this.draw();this.schedule();}
    else if(data==='\r')this.toggleTool();else if(data==='i'||data==='/')this.onCompose();else if((data==='\x03'&&!this.term.hasSelection())||(data==='\x1b'&&this.task.status==='working'))this.onInterrupt();
  }
  dispose(){
    this.disposed=true;cancelAnimationFrame(this.resizeFrame);cancelAnimationFrame(this.animationFrame);this.resize.disconnect();this.intersection.disconnect();this.input.dispose();this.rendered.dispose();this.afterRender=null;this.pendingPaint=null;
    document.removeEventListener('heloscrum-preferences',this.onTheme);document.removeEventListener('visibilitychange',this.visibility);this.motionQuery.removeEventListener('change',this.visibility);this.host.removeEventListener('wheel',this.wheel);this.term.dispose();this.viewport.remove();this.status.remove();
  }
}
