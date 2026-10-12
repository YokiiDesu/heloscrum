// A deterministic MCP process for protocol tests; no models or external services.
import {createInterface} from 'node:readline';
const schema={type:'object',properties:{query:{type:'string'}},additionalProperties:false};
for await(const line of createInterface({input:process.stdin})){
  const {id,method,params={}}=JSON.parse(line);if(id===undefined)continue;
  let result;
  if(method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:true}},serverInfo:{name:'Fixture Knowledge MCP',version:'1.0.0'}};
  else if(method==='ping')result={};
  else if(method==='tools/list')result=params.cursor?{tools:[{name:'read_documentation',description:'Read a documentation page.',inputSchema:schema,annotations:{readOnlyHint:true}}]}:{tools:[{name:'search_documentation',description:'Search the fixture documentation.',inputSchema:schema,annotations:{readOnlyHint:true}}],nextCursor:'page-2'};
  else if(method==='tools/call')result={content:[{type:'text',text:params.arguments?.query||'Fixture documentation'}],structuredContent:{cwd:process.cwd(),tool:params.name},isError:params.arguments?.query==='failure'};
  else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32601,message:'Unknown method'}})+'\n');continue;}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
}
