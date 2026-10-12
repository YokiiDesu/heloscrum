import * as pty from 'node-pty';

export function spawn(file,args,options={}) {
  const terminal=pty.spawn(file,args,{
    ...options,...(process.platform==='win32'?{useConpty:true,useConptyDll:true}:{}),
  });
  // A websocket close, application shutdown and the child's exit can all race.
  // node-pty's Windows kill() is not idempotent: a second call can free the
  // same native ConPTY handles again, crashing the entire server.
  let closing=false;
  terminal.onExit(()=>{closing=true;});
  if(process.platform==='win32'){
    // node-pty 1.1.0 schedules ConPTY DLL worker disposal only when another
    // output chunk arrives after kill(). A quiet terminal can therefore keep
    // the socket and server alive forever. Dispose on native exit/kill too;
    // its own drain timer still allows final output to reach the frontend.
    // Keep this compatibility boundary with the pinned node-pty version.
    // https://github.com/microsoft/node-pty/issues/887
    const agent=terminal._agent;
    const drain=()=>{agent.inSocket.destroy();agent._conoutSocketWorker.dispose();};
    const nativeExit=agent._$onProcessExit.bind(agent);
    agent._$onProcessExit=code=>{closing=true;nativeExit(code);drain();};
    const nativeKill=agent.kill.bind(agent);let killed=false;
    agent.kill=()=>{if(killed)return;killed=true;try{return nativeKill();}finally{drain();}};
  }
  const kill=terminal.kill.bind(terminal);
  terminal.kill=(...args)=>{if(closing)return;closing=true;return kill(...args);};
  for(const name of ['write','resize','clear']){
    const action=terminal[name].bind(terminal);
    terminal[name]=(...args)=>{if(!closing)return action(...args);};
  }
  return terminal;
}
