const checks=new Map();

// A saved address is not proof that its model server is reachable. Check the
// catalog without generating text or sending any conversation to the model.
export async function connectionStatus(api,connection,{retry=false}={}){
  if(!connection?.id)return null;
  if(!connection.baseUrl)return {state:'saved',label:'Connection Saved'};
  const key=connection.id+':'+connection.revision;
  let entry=checks.get(key);
  if(!entry||(!entry.pending&&(retry||Date.now()-entry.at>30000))){
    entry={at:Date.now(),pending:true};
    entry.promise=(async()=>{
      try{
        const {models}=await api('ai-connections/models',{id:connection.id});
        const model=models.find(m=>m.id===connection.model);
        if(connection.model&&(!model||model.loaded===false))return {state:'unavailable',label:model?'Model Not Loaded':'Model Unavailable'};
        return {state:'connected',label:'Connected'};
      }catch{return {state:'unavailable',label:'Not Connected'};}
      finally{entry.pending=false;entry.at=Date.now();}
    })();
    checks.set(key,entry);
  }
  return entry.promise;
}

export function mountConnectionIndicator(host,{api,connection}){
  if(!host)return;
  const request={};host.connectionCheck=request;host.hidden=!connection;
  if(!connection){host.replaceChildren();return;}
  async function check(retry=false){
    host.innerHTML='<span class="connection-indicator" data-state="checking" role="status"><span class="connection-indicator-dot" aria-hidden="true"></span><span>Checking Connection…</span></span>';
    const result=await connectionStatus(api,connection,{retry});
    if(!host.isConnected||host.connectionCheck!==request)return;
    const indicator=host.firstElementChild;indicator.dataset.state=result.state;
    indicator.lastElementChild.textContent=result.label;
    indicator.title=result.state==='connected'?'Your model server is reachable. Manage this connection in Settings → AI & Context.':result.state==='saved'?'Manage this connection in Settings → AI & Context.':'Start your model server and load this model, then check again.';
    if(result.state==='unavailable'){
      const button=document.createElement('button');button.type='button';button.className='connection-retry';button.textContent='Check Again';
      button.addEventListener('click',()=>check(true));host.append(button);
    }
  }
  void check();
}
