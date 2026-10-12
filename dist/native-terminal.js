import {terminalTheme} from './preferences.js';
import {ApiClient} from './connection.js';
import {NativeCommandPicker} from './native-commands.js';

// The same terminal transport hosts every interactive provider. Provider escape
// sequences, keyboard shortcuts and menus pass through without reinterpretation.
export class NativeTerminal {
  constructor(host,{taskId,project,client=new ApiClient(),label='Native agent',onCompose,onState=()=>{}}={}){
    Object.assign(this,{host,taskId,project,client,onState});this.state='opening';this.disposed=false;
    host.classList.add('native-terminal');
    host.innerHTML='<div class="native-terminal-bar"><span class="native-terminal-status" role="status">Connecting native terminal…</span><div><button type="button" data-native="commands" hidden>/ Commands</button><button type="button" data-native="compose" hidden>Queue / Steer</button><button type="button" data-native="reconnect" hidden>Reconnect</button></div></div><section class="native-terminal-commands" aria-label="Provider commands" hidden></section><div class="native-terminal-screen"></div>';
    this.status=host.querySelector('.native-terminal-status');this.reconnect=host.querySelector('[data-native=reconnect]');this.screen=host.querySelector('.native-terminal-screen');
    const motion=matchMedia('(prefers-reduced-motion: reduce)');this.motion=!motion.matches;
    this.terminal=new window.Terminal({fontFamily:'Menlo, Monaco, monospace',fontSize:13,lineHeight:1.18,cursorBlink:this.motion,scrollback:1000,minimumContrastRatio:4.5,theme:terminalTheme()});
    this.onTheme=()=>{this.terminal.options.theme=terminalTheme();};document.addEventListener('heloscrum-preferences',this.onTheme);
    this.fit=new window.FitAddon.FitAddon();this.terminal.loadAddon(this.fit);this.terminal.open(this.screen);
    this.screen.querySelector('textarea')?.setAttribute('aria-label',label+' native terminal keyboard');
    this.input=this.terminal.onData(data=>{if(this.connected)this.socket.send(JSON.stringify({data}));});
    this.terminal.attachCustomKeyEventHandler(event=>!((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'&&this.terminal.hasSelection()));
    this.observer=new ResizeObserver(()=>{cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{this.resize();if(!this.attempted&&this.visible)this.connect();});});this.observer.observe(this.screen);
    this.reconnect.addEventListener('click',()=>this.connect());
    const commands=host.querySelector('[data-native=commands]');commands.hidden=!taskId;commands.addEventListener('click',()=>this.showCommands());
    const compose=host.querySelector('[data-native=compose]');compose.hidden=!onCompose;compose.addEventListener('click',()=>onCompose?.());
    this.pagehide=()=>this.disconnect();this.pageshow=event=>{if(event.persisted)this.connect();};window.addEventListener('pagehide',this.pagehide);window.addEventListener('pageshow',this.pageshow);
    document.fonts.ready.then(()=>{if(!this.disposed&&this.visible&&!this.attempted)this.connect();});
  }
  get visible(){return this.screen.clientWidth>0&&this.screen.clientHeight>0;}
  get connected(){return this.state==='ready'&&this.socket?.readyState===WebSocket.OPEN;}
  setStatus(text,state){if(this.disposed)return;this.state=state;this.status.textContent=text;this.status.title=text;this.status.dataset.state=state;this.reconnect.hidden=['opening','ready'].includes(state);this.reconnect.disabled=state==='opening';this.picker?.updateButton();this.onState(text,state);}
  resize(){if(this.disposed||!this.visible)return;this.fit.fit();if(this.socket?.readyState===WebSocket.OPEN){const size=JSON.stringify({cols:this.terminal.cols,rows:this.terminal.rows});if(size!==this.lastSize){this.socket.send(size);this.lastSize=size;}}}
  async connect(){
    if(this.disposed)return false;if(this.opening)return this.connection;if(this.connected)return true;
    this.attempted=true;this.opening=true;this.setStatus('Connecting native terminal…','opening');
    this.connection=(async()=>{
      try{
        this.resize();const ticket=await this.client.request(this.taskId?'terminals':'tui-terminal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(this.taskId?{taskId:this.taskId}:{project:this.project}),cols:this.terminal.cols,rows:this.terminal.rows,motion:this.motion})});
        if(this.disposed)return false;this.terminal.reset();this.lastSize=null;
        return await new Promise(resolve=>{
          let settled=false;const finish=ok=>{if(settled)return;settled=true;clearTimeout(this.openTimer);resolve(ok);};
          const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/terminal/'+ticket.id,['heloscrum',this.client.token]);this.socket=ws;
          this.openTimer=setTimeout(()=>{this.setStatus('Terminal did not connect. Reconnect to try again.','error');ws.close();finish(false);},12000);
          ws.addEventListener('open',()=>this.resize());
          ws.addEventListener('message',event=>{
            if(this.disposed||this.socket!==ws)return;
            try{const message=JSON.parse(event.data);
              if(message.data){this.outputAt=performance.now();this.terminal.write(message.data,()=>{if(!this.disposed&&this.state==='opening'){this.setStatus('Live native CLI · direct keyboard input','ready');finish(true);}});}
              if(message.error){this.setStatus(message.error,'error');finish(false);}
              if(message.exitCode!==undefined){this.setStatus(message.exitCode===0?'Terminal detached':'Terminal exited · '+message.exitCode,'closed');finish(false);}
            }catch{this.setStatus('Invalid terminal response','error');ws.close();finish(false);}
          });
          ws.addEventListener('error',()=>{if(this.socket===ws)this.setStatus('Terminal connection interrupted','error');finish(false);});
          ws.addEventListener('close',()=>{if(this.socket===ws){this.socket=null;if(!['error','closed'].includes(this.state))this.setStatus('Terminal disconnected','closed');}finish(false);});
        });
      }catch(error){this.setStatus(error.message,'error');return false;}
      finally{this.opening=false;}
    })();return this.connection;
  }
  async whenReady(){if(!this.attempted)await this.connect();else if(this.opening)await this.connection;const until=performance.now()+1500;while(this.connected&&performance.now()-this.outputAt<220&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,220));if(!this.connected)throw Error(this.status.textContent||'Reconnect the native terminal before running a command.');}
  focus(){this.terminal.focus();}
  latest(){this.terminal.scrollToBottom();}
  showCommands(){
    const host=this.host.querySelector('.native-terminal-commands');host.hidden=false;
    if(!this.picker)this.picker=new NativeCommandPicker(host,{client:this.client,taskId:this.taskId,connected:()=>this.connected,onSent:()=>{host.hidden=true;this.focus();}});
    else this.picker.load();
    host.querySelector('details').open=true;
  }
  disconnect(){this.socket?.close();}
  dispose(){document.removeEventListener('heloscrum-preferences',this.onTheme);this.disposed=true;this.disconnect();clearTimeout(this.openTimer);cancelAnimationFrame(this.frame);this.observer.disconnect();this.input.dispose();this.terminal.dispose();window.removeEventListener('pagehide',this.pagehide);window.removeEventListener('pageshow',this.pageshow);}
}
