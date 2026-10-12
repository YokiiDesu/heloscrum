export const PREFERENCES_KEY='heloscrum.preferences';
export function readPreferences(storage=globalThis.localStorage){try{const value=JSON.parse(storage.getItem(PREFERENCES_KEY)||'{}');return {theme:['dark','light','system'].includes(value.theme)?value.theme:'dark',sounds:value.sounds===true};}catch{return {theme:'dark',sounds:false};}}
const media=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;
export const resolvedTheme=()=>{const p=readPreferences();return p.theme==='system'?(media?.matches?'dark':'light'):p.theme;};
export function applyPreferences(){if(typeof document==='undefined')return;const theme=resolvedTheme();document.documentElement.dataset.colorTheme=theme;document.documentElement.style.colorScheme=theme;document.querySelector('meta[name=theme-color]')?.setAttribute('content',theme==='light'?'#f4f6f7':'#111315');document.dispatchEvent(new CustomEvent('heloscrum-preferences',{detail:readPreferences()}));}
export function setPreferences(patch){const next={...readPreferences(),...patch};try{localStorage.setItem(PREFERENCES_KEY,JSON.stringify(next));}catch{throw Error('Browser storage is unavailable; appearance settings could not be saved.');}applyPreferences();return next;}
// User-supplied clips are bundled locally. Task completion keeps its original chord.
export const SOUND_FILES=Object.freeze({
  'plan-complete':'/sounds/project-complete-sound-effect.mp3',
  request:'/sounds/notification-sound-effect.mp3',
  notification:'/sounds/notification-sound-effect.mp3',
  error:'/sounds/error-sound-effect.wav',
});
export class SoundEffects {
  constructor({enabled=()=>readPreferences().sounds,createContext=()=>new (window.AudioContext||window.webkitAudioContext)(),fetchAudio=url=>fetch(url),now=()=>Date.now()}={}){
    Object.assign(this,{enabled,createContext,fetchAudio,now});
    this.buffers=new Map();this.last=new Map();this.pending=new Map();this.voices=new Set();this.generation=0;
  }
  async unlock(){
    if(!this.enabled())return false;
    try{
      this.context ||= this.createContext();
      if(this.context.state==='suspended')await this.context.resume();
      if(!this.enabled()||this.context.state!=='running')return false;
      await Promise.all([...new Set(Object.values(SOUND_FILES))].map(url=>this.load(url)));
      return this.enabled()&&this.context.state==='running';
    }catch{return false;}
  }
  load(url){
    if(!this.buffers.has(url)){
      const buffer=Promise.resolve().then(async()=>{
        try{
          const response=await this.fetchAudio(url);
          if(!response.ok)throw Error('Sound unavailable');
          return await this.context.decodeAudioData(await response.arrayBuffer());
        }catch{this.buffers.delete(url);return null;}
      });
      this.buffers.set(url,buffer);
    }
    return this.buffers.get(url);
  }
  track(source,gain,key){
    const voice={source,gain,key};this.voices.add(voice);
    source.onended=()=>{source.disconnect();gain.disconnect();this.voices.delete(voice);};
  }
  stop(){
    this.generation++;this.pending.clear();
    for(const voice of this.voices){try{voice.source.stop();}catch{}}
  }
  tone(hz,at,duration,level,{type='sine',end=hz,attack=.008}={}){
    const ctx=this.context,osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type=type;osc.frequency.setValueAtTime(hz,at);osc.frequency.exponentialRampToValueAtTime(end,at+duration);
    gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(level,at+attack);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    osc.connect(gain);gain.connect(ctx.destination);this.track(osc,gain,'complete');osc.start(at);osc.stop(at+duration+.01);
  }
  async play(kind,{preview=false}={}){
    const url=SOUND_FILES[kind],key=url||kind,now=this.now();
    if((!url&&kind!=='complete')||!this.enabled()||this.context?.state!=='running'||(!preview&&now-(this.last.get(key)??-Infinity)<180))return false;
    if(preview)this.stop();
    this.last.set(key,now);
    const generation=this.generation,request=Symbol();this.pending.set(key,request);
    try{
      if(kind==='complete'){
        const at=this.context.currentTime;
        this.tone(392,at,.34,.038,{type:'triangle',attack:.012});
        this.tone(587.33,at+.065,.38,.025,{attack:.015});
        this.tone(783.99,at+.12,.44,.014,{attack:.018});
        return true;
      }
      const buffer=await this.load(url);
      // Discard superseded or muted requests instead of playing a backlog.
      if(!buffer||!this.enabled()||this.context.state!=='running'||generation!==this.generation||this.pending.get(key)!==request)return false;
      for(const voice of this.voices)if(voice.key===key){try{voice.source.stop();}catch{}}
      const source=this.context.createBufferSource(),gain=this.context.createGain();
      source.buffer=buffer;gain.gain.setValueAtTime(.5,this.context.currentTime);
      source.connect(gain);gain.connect(this.context.destination);this.track(source,gain,key);source.start();
      return true;
    }catch{return false;}
  }
}
export const sounds=new SoundEffects();
export class WorkspaceSoundObserver {
  constructor(play=kind=>sounds.play(kind)){this.play=play;this.observations=new Map();this.work=new Map();}
  workCue(project,plans=[]){
    const previous=this.work.get(project)||new Map();this.work.set(project,previous);
    let completedPlan=false,completedTask=false;
    for(const plan of plans){
      const old=previous.get(plan.id);
      if(old&&plan.revision<old.revision)continue;
      const next={status:plan.status,revision:plan.revision,items:new Map((plan.items||[]).map(t=>[t.id,t.status]))};
      previous.set(plan.id,next);
      if(!old)continue;
      if(plan.status==='completed'&&old.status!==plan.status){
        if(plan.kind==='task')completedTask=true;else completedPlan=true;
      }
      if([...next.items].some(([id,status])=>status==='done'&&old.items.has(id)&&old.items.get(id)!==status))completedTask=true;
    }
    return completedPlan?'plan-complete':completedTask?'complete':null;
  }
  observeWork(project,plans){const cue=this.workCue(project,plans);if(cue)this.play(cue);}
  observe(snapshot){
    const key=snapshot.project.path,old=this.observations.get(key),
      tasks=new Map((snapshot.tasks||[]).map(t=>[t.id,t.status])),
      questions=new Set((snapshot.collaboration?.userRequests||[]).filter(q=>q.status==='pending').map(q=>q.id)),
      notices=snapshot.collaboration?.notifications||[],reminders=snapshot.scheduler?.notices||[],
      notifications=new Set(notices.map(n=>n.id)),schedule=new Map(reminders.map(n=>[n.id,n.toastEligible!==false])),
      workCue=this.workCue(key,snapshot.work?.plans);
    this.observations.set(key,{tasks,questions,notifications,schedule});
    if(!old)return;
    const attention=[...questions].some(id=>!old.questions.has(id))||[...tasks].some(([id,s])=>s==='blocked'&&old.tasks.has(id)&&old.tasks.get(id)!==s),
      completed=[...tasks].some(([id,s])=>s==='done'&&old.tasks.get(id)==='working'),
      notification=notices.some(n=>n.type!=='human-request'&&!old.notifications.has(n.id))||reminders.some(n=>!n.readAt&&!n.obsolete&&n.toastEligible!==false&&!old.schedule.get(n.id));
    const cue=attention?'request':workCue||(completed?'complete':notification?'notification':null);
    if(cue)this.play(cue);
  }
}
const workspaceSounds=new WorkspaceSoundObserver();
export const observeWorkspaceSounds=snapshot=>workspaceSounds.observe(snapshot);
export const observeWorkSounds=(project,plans)=>workspaceSounds.observeWork(project,plans);
export function preferencesPanel(){const p=readPreferences();return `<section class="app-preferences"><h3>Make yourself comfortable</h3><p>These preferences apply across HeloScrum on this browser.</p><fieldset><legend>Color theme</legend><div class="appearance-choices">${[['dark','Dark','A familiar, low-light workspace'],['light','Light','Bright surfaces and clear contrast'],['system','Use system','Follow your device’s appearance']].map(([value,title,detail])=>`<label><input type="radio" name="app-theme" value="${value}" ${p.theme===value?'checked':''}><span><strong>${title}</strong><small>${detail}</small></span></label>`).join('')}</div></fieldset><fieldset><legend>Sound effects</legend><label class="settings-check"><input type="checkbox" name="app-sounds" ${p.sounds?'checked':''}>Play completion, notification, and error sounds</label><p>The familiar chord for completed tasks, a separate celebration for completed plans, and distinct cues for errors and notifications. Needs attention uses the notification sound. Sounds are off by default.</p><div class="sound-previews">${[['complete','Task completed'],['plan-complete','Plan completed'],['request','Needs attention / notification'],['error','Error']].map(([sound,label])=>`<button type="button" data-project-setting="preview-sound" data-sound="${sound}" ${p.sounds?'':'disabled'}>Preview ${label.toLowerCase()}</button>`).join('')}</div></fieldset><p class="appearance-saved" role="status">Changes save automatically.</p></section>`;}
export const terminalTheme=()=>resolvedTheme()==='light'?{background:'#f5f7f8',foreground:'#182831',cursor:'#126b60',selectionBackground:'#b7d9ec80',black:'#263842',red:'#a52b3c',green:'#176344',yellow:'#87520d',blue:'#195c9c',magenta:'#76439f',cyan:'#0e697e',white:'#465a64',brightBlack:'#586f7c',brightRed:'#b42336',brightGreen:'#127343',brightYellow:'#966000',brightBlue:'#1569b0',brightMagenta:'#8b3bb0',brightCyan:'#08758a',brightWhite:'#182831'}:{background:'#10171b',foreground:'#dce5e8',cursor:'#85d8c6',selectionBackground:'#85d8c62b',black:'#10171b',red:'#e99e9e',green:'#85d8c6',yellow:'#ffab76',blue:'#91b7eb',magenta:'#baa0dc',cyan:'#8dcbd8',white:'#dce5e8'};
if(typeof document!=='undefined'){document.addEventListener('heloscrum-preferences',()=>{if(!readPreferences().sounds)sounds.stop();});applyPreferences();media?.addEventListener('change',()=>{if(readPreferences().theme==='system')applyPreferences();});window.addEventListener('storage',e=>{if(e.key===PREFERENCES_KEY)applyPreferences();});document.addEventListener('pointerdown',()=>sounds.unlock(),{passive:true});document.addEventListener('keydown',()=>sounds.unlock(),{passive:true});}
