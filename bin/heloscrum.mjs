#!/usr/bin/env node
import {spawn} from 'node:child_process';
import path from 'node:path';
import {HeloClient,CliError,exitCode,codeRoot} from '../cli/client.mjs';
import {parseArgs,command,help} from '../cli/commands.mjs';
import {plainText} from '../dist/tui-model.js';
import metadata from '../package.json' with {type:'json'};

let options={};
try{
  const parsed=parseArgs(process.argv.slice(2));options=parsed.options;const [area]=parsed.words;
  if(options.version){console.log(options.json?JSON.stringify({ok:true,data:{name:'HeloScrum',version:metadata.version,apiVersion:'1'}}):`HeloScrum ${metadata.version} · API v1`);}
  else if(options.help||!area){process.stdout.write(options.json?JSON.stringify({ok:true,data:{help}})+'\n':help);}
  else if(area==='doctor'){
    const {diagnose,formatDiagnosis}=await import('../scripts/doctor.mjs');
    const result=await diagnose({root:options.root||process.env.HELOSCRUM_ROOT||codeRoot,provider:options.provider});
    console.log(options.json?JSON.stringify(result):formatDiagnosis(result));process.exitCode=result.ok?0:1;
  }else if(area==='serve'){
    const root=path.resolve(options.root||process.env.HELOSCRUM_ROOT||codeRoot);
    const child=spawn(process.execPath,[path.join(codeRoot,'server.mjs')],{cwd:codeRoot,env:{...process.env,HELOSCRUM_ROOT:root,...(options.port?{PORT:String(options.port)}:{})},stdio:'inherit'});
    process.once('SIGINT',()=>child.kill('SIGINT'));process.once('SIGTERM',()=>child.kill('SIGTERM'));
    child.on('error',error=>{console.error(error.message);process.exitCode=6;});child.on('exit',code=>{process.exitCode=code||0;});
  }else{
    const client=await HeloClient.load(options);
    if(area==='tui'){
      if(!process.stdin.isTTY||!process.stdout.isTTY)throw new CliError('The TUI needs an interactive terminal. Use commands with --json for headless control.');
      const {runTui}=await import('../cli/tui.mjs');await runTui(client,options);
    }else if(area==='events'){
      if(!options.follow)throw new CliError('Use events --follow to stream changes');
      const project=await client.project(options.project),controller=new AbortController();
      process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
      await client.watch(project.id,{after:options.after,signal:controller.signal,onEvent:event=>process.stdout.write(JSON.stringify(event)+'\n')});
    }else{
      const result=await command(client,parsed.words,options);
      if(options.json||options.format==='json')process.stdout.write(JSON.stringify({ok:true,data:result})+'\n');
      else if(result?.format==='md')process.stdout.write(plainText(result.text)+'\n');
      else if(result?.items){for(const item of result.items)console.log(plainText([item.id,item.role||item.title||item.name||item.path,item.status||item.state].filter(Boolean).join('  ·  ')));if(!result.items.length)console.log('No results.');if(result.nextCursor)console.log('More results: cursor '+result.nextCursor);}
      else process.stdout.write(JSON.stringify(result,null,2)+'\n');
    }
  }
}catch(error){
  if(options.json||options.format==='json')process.stderr.write(JSON.stringify({ok:false,error:{code:error.code||'INVALID_INPUT',message:plainText(error.message),...(error.operationId?{operationId:error.operationId}:{})}})+'\n');
  else process.stderr.write('HeloScrum: '+plainText(error.message)+(error.operationId?'\nOperation: '+error.operationId:'')+'\n');
  process.exitCode=exitCode(error);
}
