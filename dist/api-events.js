// The stream invalidates views; normal authenticated reads still own their data.
// Polling remains a fallback during sleep, disconnects and backend upgrades.
export class WorkspaceEvents {
  constructor({client,onChange,fetch=globalThis.fetch,visible=()=>!document.hidden}){Object.assign(this,{client,onChange,fetch,visible});this.project=null;this.cursor=new Map();this.connected=false;this.generation=0;}
  select(project){if(project===this.project)return;this.stop();this.project=project;if(project&&this.visible())this.start();}
  stop(){this.generation++;this.connected=false;this.controller?.abort();clearTimeout(this.retry);clearTimeout(this.debounce);clearTimeout(this.heartbeat);}
  visibility(){this.stop();if(this.project&&this.visible())this.start();}
  start(){const gen=this.generation,project=this.project;let delay=1000;
    const connect=async()=>{
      if(gen!==this.generation||!this.visible())return;
      const controller=new AbortController();this.controller=controller;
      const touch=()=>{clearTimeout(this.heartbeat);this.heartbeat=setTimeout(()=>controller.abort(),45000);};touch();
      try{
        if(!this.client.token)await this.client.session();
        if(gen!==this.generation)return;
        const after=this.cursor.get(project),response=await this.fetch('/api/v1/projects/'+encodeURIComponent(project)+'/events'+(after?'?after='+encodeURIComponent(after):''),{headers:{'X-HeloScrum-Token':this.client.token},cache:'no-store',signal:controller.signal});
        if(response.status===401){await this.client.session();throw Error('Session renewed');}
        if(!response.ok)throw Error('Event stream unavailable');
        if(gen!==this.generation)return;this.connected=true;delay=1000;
        let buffer='';const decoder=new TextDecoder();
        for await(const bytes of response.body){
          if(gen!==this.generation)return;touch();buffer+=decoder.decode(bytes,{stream:true});if(buffer.length>1024*1024)throw Error('Invalid event frame');
          let at;while((at=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);const type=frame.split('\n').find(l=>l.startsWith('event: '))?.slice(7),id=frame.split('\n').find(l=>l.startsWith('id: '))?.slice(4);if(id)this.cursor.set(project,id);
            if(['workspace.changed','resync'].includes(type)){clearTimeout(this.debounce);this.debounce=setTimeout(()=>{if(gen===this.generation&&this.visible())this.onChange();},500);}
            if(type==='access.revoked'){await this.client.session();throw Error('Session renewed');}
          }
        }
      }catch{/* Connection status and user feedback belong to the normal refresh loop. */}
      finally{controller.abort();if(gen===this.generation){this.connected=false;clearTimeout(this.heartbeat);}}
      if(gen===this.generation&&this.visible()){this.retry=setTimeout(connect,delay);delay=Math.min(delay*2,30000);}
    };void connect();
  }
}
