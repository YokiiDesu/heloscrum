export class ConnectionError extends Error {
  constructor({timeout=false,uncertain=false}={}) {
    super(uncertain?'Connection interrupted. This action may have completed. Reconnect and check its result before trying again.':timeout?'HeloScrum took too long to respond. Reconnecting…':'Cannot reach HeloScrum. Reconnecting…');
    this.name='ConnectionError';this.uncertain=uncertain;
  }
}

// A failed write is never replayed. A 401 is safe to retry once: the server
// checks the session token before reading or applying an API operation.
export class ApiClient {
  constructor({fetch=(...args)=>globalThis.fetch(...args),timeout=20000,writeTimeout=120000,onUnavailable=()=>{}}={}) {
    Object.assign(this,{fetch,timeout,writeTimeout,onUnavailable});this.token='';this.renewing=null;
  }
  async read(route,options={},format='json') {
    const write=options.method&&options.method!=='GET',controller=new AbortController();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},write?this.writeTimeout:this.timeout);
    try {
      const response=await this.fetch('/api/'+route,{...options,cache:'no-store',signal:controller.signal});
      const gateway=[502,503,504].includes(response.status);
      let data;
      try{data=await response[response.ok?format:'json']();}
      catch(error){if(gateway)throw new ConnectionError({uncertain:!!write});throw error;}
      // A structured rejection from the running app (for example Git refusing
      // a folder) is an action error. Only an unavailable gateway is an outage.
      if(gateway&&typeof data?.error!=='string')throw new ConnectionError({uncertain:!!write});
      return {response,data};
    } catch(error) {
      if(error instanceof ConnectionError||timedOut||error.name==='TypeError'||error.name==='AbortError') {
        const failure=error instanceof ConnectionError?error:new ConnectionError({timeout:timedOut,uncertain:!!write});
        this.onUnavailable(failure);throw failure;
      }
      throw error;
    } finally {clearTimeout(timer);}
  }
  async session() {
    if(!this.renewing)this.renewing=(async()=>{
      const {response,data}=await this.read('session');
      if(!response.ok||typeof data.token!=='string'||!data.token)throw Error(data.error||'Could not renew the HeloScrum session');
      this.token=data.token;return this.token;
    })().finally(()=>{this.renewing=null;});
    return this.renewing;
  }
  async request(route,options={},format='json') {
    if(!this.token)await this.session();
    const sentToken=this.token;
    const send=()=>this.read(route,{...options,headers:{...options.headers,'X-HeloScrum-Token':this.token}},format);
    let result=await send();
    if(result.response.status===401&&(result.data.code==='SESSION_EXPIRED'||result.data.error==='Refresh HeloScrum to reconnect')) {
      if(sentToken===this.token)await this.session();
      result=await send();
    }
    if(!result.response.ok)throw Object.assign(Error(result.data.error||'Request failed'),{status:result.response.status,code:result.data.code});
    return result.data;
  }
}

// One state refresh at a time, with bounded backoff. Child views pause their
// polling while disconnected; visibility/focus/online events can wake this loop.
export class RefreshLoop {
  constructor({refresh,paused=()=>false,onChange=()=>{},onRecovered=()=>{},interval=15000,now=Date.now,setTimer=(...args)=>setTimeout(...args),clearTimer=id=>clearTimeout(id)}) {
    Object.assign(this,{refresh,paused,onChange,onRecovered,interval,now,setTimer,clearTimer});
    this.state={phase:'connecting',lastSync:null,failures:0,error:null,refreshing:false,manual:false,retryAt:null};this.stopped=false;this.failureRevision=0;
  }
  update(patch){Object.assign(this.state,patch);this.onChange(this.state);}
  unavailable(error){
    this.failureRevision++;this.lastFailure=error;
    this.update({phase:'disconnected',error});
    if(!this.pending)this.schedule(2000);
  }
  pollInterval(){return typeof this.interval==='function'?this.interval():this.interval;}
  schedule(delay=this.pollInterval()){
    this.clearTimer(this.timer);if(this.stopped)return;
    this.update({retryAt:this.now()+delay});this.timer=this.setTimer(()=>this.run(),delay);
  }
  run({manual=false}={}) {
    if(this.pending){if(manual&&!this.state.manual)this.update({manual:true});return this.pending;}
    this.clearTimer(this.timer);if(this.stopped)return Promise.resolve(false);
    if(!manual&&this.paused()){this.schedule();return Promise.resolve(false);}
    const recovering=['disconnected','reconnecting','error'].includes(this.state.phase),failureRevision=this.failureRevision;
    this.update({refreshing:true,manual,retryAt:null,...(recovering?{phase:'reconnecting'}:{})});
    this.pending=Promise.resolve().then(()=>this.refresh({manual})).then(()=>{
      if(this.failureRevision!==failureRevision)throw this.lastFailure;
      this.update({phase:'connected',failures:0,error:null,lastSync:this.now()});
      if(recovering)this.onRecovered();return true;
    }).catch(error=>{
      this.update({phase:error instanceof ConnectionError?'disconnected':'error',error,failures:this.state.failures+1});return false;
    }).finally(()=>{
      this.pending=null;this.update({refreshing:false,manual:false});
      this.schedule(this.state.failures?Math.min(30000,2000*2**Math.min(this.state.failures-1,4)):this.pollInterval());
    });
    return this.pending;
  }
  wake({force=false}={}){if(!this.paused()&&(force||this.state.phase!=='connected'||this.state.lastSync===null||this.now()-this.state.lastSync>=this.pollInterval()))return this.run();}
  stop(){this.stopped=true;this.clearTimer(this.timer);}
}

// Feedback has its own clock: data and recovery never wait for the spinner.
// Healthy background polls leave the control untouched; manual refreshes can
// join an in-flight poll and still get a full, non-flickering busy indication.
export class RefreshFeedback {
  constructor({onChange=()=>{},minimumBusy=3000,pulseDuration=10000,now=Date.now,setTimer=(...args)=>setTimeout(...args),clearTimer=id=>clearTimeout(id)}={}) {
    Object.assign(this,{onChange,minimumBusy,pulseDuration,now,setTimer,clearTimer});
    this.state={busy:false,tone:'pending',pulsing:false};this.refreshing=false;this.manual=false;
  }
  update({phase,refreshing=false,manual=false}) {
    const tone=phase==='connected'?'connected':phase==='error'?'error':'pending';
    if(tone!==this.state.tone){this.state.tone=tone;this.pulse();}
    this.refreshing=refreshing;
    if(refreshing){
      this.clearTimer(this.holdTimer);this.holdTimer=null;
      if((manual||phase!=='connected')&&!this.state.busy){this.state.busy=true;this.holdUntil=this.now()+this.minimumBusy;}
      if(manual)this.manual=true;
    }else if(this.state.busy){
      const remaining=this.holdUntil-this.now();
      if(remaining<=0)this.finish();
      else if(this.holdTimer==null)this.holdTimer=this.setTimer(()=>{this.finish();this.onChange(this.state);},remaining);
    }
    this.onChange(this.state);
  }
  finish(){
    this.clearTimer(this.holdTimer);this.holdTimer=null;if(this.refreshing)return;
    this.state.busy=false;if(this.manual)this.pulse();this.manual=false;
  }
  pulse(){
    this.clearTimer(this.pulseTimer);this.state.pulsing=true;
    this.pulseTimer=this.setTimer(()=>{this.state.pulsing=false;this.onChange(this.state);},this.pulseDuration);
  }
  stop(){this.clearTimer(this.holdTimer);this.clearTimer(this.pulseTimer);}
}
