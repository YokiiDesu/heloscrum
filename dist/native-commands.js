const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class NativeCommandPicker {
  constructor(host,{client,taskId,onSent=()=>{},connected=()=>true}){
    Object.assign(this,{host,client,taskId,onSent,connected});this.busy=false;this.drafts=new Map();
    host.innerHTML=`<details class="native-command-picker" ${new URLSearchParams(location.search).get('commands')==='open'?'open':''}><summary>Provider commands <span data-provider-label></span></summary><div class="native-command-body"><p data-command-note>Loading command library…</p><form><div class="native-command-fields"><label>Native command<select name="command" aria-label="Native command"></select></label><label data-arguments hidden>Arguments <input name="args" aria-label="Command arguments" maxlength="4000" autocomplete="off"></label></div><p data-description></p><p data-impact></p><div class="native-command-actions"><button type="submit" disabled>Run in native terminal</button><button type="button" data-refresh>Refresh readiness</button><a data-source target="_blank" rel="noopener">Provider reference ↗</a></div></form><p data-result role="status" aria-live="polite"></p></div></details>`;
    this.form=host.querySelector('form');this.select=this.form.elements.command;this.args=this.form.elements.args;
    this.select.addEventListener('change',()=>this.selectCommand());this.args.addEventListener('input',()=>this.drafts.set(this.select.value,this.args.value));
    this.form.addEventListener('submit',event=>{event.preventDefault();this.run();});host.querySelector('[data-refresh]').addEventListener('click',()=>this.load());
    this.ready=this.load();
  }
  message(text,error=false){const result=this.host.querySelector('[data-result]');result.textContent=text;result.dataset.error=String(error);}
  async load(){
    if(this.busy)return;this.busy=true;this.updateButton();
    try{
      const report=await this.client.request('native-commands?task='+encodeURIComponent(this.taskId));this.report=report;
      const selected=this.select.value;this.select.innerHTML='<button type="button" class="select-value"><selectedcontent></selectedcontent></button>'+report.commands.map(c=>`<option value="${esc(c.name)}">${esc(c.name)} · ${esc(c.description)}</option>`).join('');
      if(report.commands.some(c=>c.name===selected))this.select.value=selected;
      this.host.querySelector('[data-provider-label]').textContent='· '+report.providerLabel;
      this.host.querySelector('[data-command-note]').textContent=report.note;
      const source=this.host.querySelector('[data-source]');source.href=report.source||'#';source.hidden=!report.source;
      this.selectCommand();this.message(report.ready?(this.connected()?'Ready. Command output appears in the terminal below.':'Connect the native terminal to run commands and view their output.'):report.reason);
    }catch(error){this.report=null;this.message(error.message,true);}
    finally{this.busy=false;this.updateButton();}
  }
  selectCommand(){
    const command=this.report?.commands.find(c=>c.name===this.select.value);if(!command)return;
    this.host.querySelector('[data-arguments]').hidden=!command.args;this.args.disabled=!command.args;this.args.placeholder=command.args;this.args.value=this.drafts.get(command.name)||'';
    this.host.querySelector('[data-description]').textContent=command.description+(command.note?' · '+command.note:'');
    this.host.querySelector('[data-impact]').textContent=command.usesModel?'May use model tokens or start continuing work.':'Opens a native panel or displays information.';
  }
  updateButton(){this.form.querySelector('[type=submit]').disabled=this.busy||!this.report?.ready||!this.connected();this.host.querySelector('[data-refresh]').disabled=this.busy;this.select.disabled=this.busy;this.args.disabled=this.busy||!this.report?.commands.find(c=>c.name===this.select.value)?.args;}
  async run(){
    if(this.busy||!this.report?.ready||!this.connected())return;this.busy=true;this.updateButton();
    try{
      const command=this.select.value;
      await this.client.request('native-commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:this.taskId,name:command,args:this.report.commands.find(c=>c.name===command)?.args?this.args.value:'',expected:this.report.expected,requestId:crypto.randomUUID()})});
      this.message(command+' sent to the native CLI. Use the terminal for its output or menu.');
      this.report.ready=false;this.onSent();
    }catch(error){this.message(error.message,true);this.report.ready=false;}
    finally{this.busy=false;this.updateButton();}
  }
}
