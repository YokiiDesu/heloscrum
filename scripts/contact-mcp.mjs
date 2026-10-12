#!/usr/bin/env node
// Run the same scoped MCP bridge when a host cannot reload tools in a live chat.
// File bytes stay in this process, rather than being pasted into model context.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport,getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import {MAX_ATTACHMENT_BYTES} from '../lib/image-attachments.mjs';

export async function connectContact(file){
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp-bridge.mjs',import.meta.url)),path.resolve(file)],env:{...getDefaultEnvironment(),...(process.env.CODEX_THREAD_ID?{CODEX_THREAD_ID:process.env.CODEX_THREAD_ID}:{}),...(process.env.CODEX_SESSION_ID?{CODEX_SESSION_ID:process.env.CODEX_SESSION_ID}:{})},stderr:'pipe'});
  const client=new Client({name:'HeloScrum contact client',version:'1.0.0'});
  try{await client.connect(transport);}catch(error){await client.close();throw error;}
  async function call(name,args={}){
    const result=await client.callTool({name,arguments:args});
    if(result.isError)throw Error(result.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')||'MCP call failed');
    if(result.content?.some(b=>b.type!=='text'))return result;
    const raw=result.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n');
    let value;try{value=JSON.parse(raw);}catch{return result;}
    // Follow the server's own scoped offload reference, never a preview fragment.
    if(value?.offloaded&&value.reference){
      let text='',offset=0;
      do{const page=await call('context_read',{reference:value.reference,offset,limit:8000});text+=page.text;offset=page.nextOffset;if(text.length>2*1024*1024)throw Error('Offloaded tool result exceeds 2 MiB');}while(offset!==null&&offset!==undefined);
      value=JSON.parse(text);
    }
    return value;
  }
  return {call,close:()=>client.close()};
}

export async function contactCommand(client,command,args){
  if(command==='inbox')return client.call('read_inbox',{unreadOnly:true,...(args[0]?{after:args[0]}:{})});
  if(command==='ack')return client.call('ack_inbox',{ids:args});
  if(command==='upload'){
    if(args.length!==1)throw Error('upload requires one local file path');
    const file=path.resolve(args[0]),info=await stat(file);if(!info.isFile()||info.size>MAX_ATTACHMENT_BYTES)throw Error('Choose a regular file up to 10 MiB');
    return client.call('attachment_upload',{name:path.basename(file),base64:(await readFile(file)).toString('base64')});
  }
  if(command==='receive'){
    if(args.length!==2)throw Error('receive requires an attachment ID and a new output file path');
    const [id,destination]=args,first=await client.call('attachment_read',{id});let bytes,metadata=first;
    const image=first.content?.find(b=>b.type==='image');
    if(image){bytes=Buffer.from(image.data,'base64');metadata=JSON.parse(first.content.find(b=>b.type==='text').text);}
    else if(first.kind==='text'){
      let text=first.text,offset=first.nextOffset;
      while(offset!==null){const page=await client.call('attachment_read',{id,offset,limit:40000});text+=page.text;offset=page.nextOffset;if(Buffer.byteLength(text)>MAX_ATTACHMENT_BYTES)throw Error('Attachment exceeds 10 MiB');}
      bytes=Buffer.from(text);
    }else if(first.localPath)bytes=await readFile(first.localPath);
    else throw Error('The MCP server did not return readable attachment content');
    const sha256=createHash('sha256').update(bytes).digest('hex');if(metadata.sha256&&sha256!==metadata.sha256)throw Error('Downloaded attachment checksum does not match');
    const output=path.resolve(destination);await writeFile(output,bytes,{flag:'wx',mode:0o600});return {id,path:output,size:bytes.length,sha256};
  }
  if(command==='call'){
    if(!args[0]||args.length>2)throw Error('call requires a tool name and optional JSON input file');
    return client.call(args[0],args[1]?JSON.parse(await readFile(args[1],'utf8')):{});
  }
  throw Error('Usage: node scripts/contact-mcp.mjs CONNECTION_FILE inbox [AFTER] | ack ID... | upload FILE | receive ID OUTPUT_FILE | call TOOL [JSON_FILE]');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let client;try{if(!process.argv[2])throw Error('A scoped connection file is required');client=await connectContact(process.argv[2]);const value=await contactCommand(client,process.argv[3],process.argv.slice(4));console.log(JSON.stringify(value));}
  catch(error){console.error(error.message);process.exitCode=1;}finally{await client?.close();}
}
