import {createHash} from 'node:crypto';
import {assert} from './adapters.mjs';

const trustedPages=new WeakSet();
export const sourceHash=value=>createHash('sha256').update(value).digest('hex');
export const sourceBudget=plane=>Math.max(2000,Math.min(24000,plane?.data?.contextSettings?.toolResultChars||12000));
export const isSourcePage=value=>value&&trustedPages.has(value);
export function sourcePage(full,{offset=0,limit=8000,budget=12000,...metadata}={}){
  assert(typeof full==='string'&&Number.isInteger(offset)&&offset>=0&&offset<=full.length,'Choose an offset within this source');
  assert(Number.isInteger(limit)&&limit>0&&limit<=40000,'Choose a page of at most 40,000 characters');
  assert(offset===0||!/[\uDC00-\uDFFF]/.test(full[offset])||!/[\uD800-\uDBFF]/.test(full[offset-1]),'Offset splits a Unicode character; use the returned continuation');
  const make=end=>({format:'heloscrum-source-page',...metadata,text:full.slice(offset,end),offset,endOffset:end,totalCharacters:full.length,nextOffset:end<full.length?end:null});
  // Include JSON escaping, MCP content metadata, and room for the RPC envelope.
  const fits=page=>JSON.stringify(mcpToolResult(page,{explicitSuccess:true})).length+128<=budget;
  let low=offset,high=Math.min(full.length,offset+limit);
  assert(fits(make(low)),'Source metadata exceeds the response budget');
  while(low<high){const mid=Math.ceil((low+high)/2);if(fits(make(mid)))low=mid;else high=mid-1;}
  if(low<full.length&&low>offset&&/[\uD800-\uDBFF]/.test(full[low-1]))low--;
  const page=make(low);
  assert(low>offset||offset===full.length,'Response budget cannot fit source content');
  trustedPages.add(page);return page;
}
export function sourceText(value){const {text,...meta}=value;return JSON.stringify(meta)+'\n\n'+text;}
export function toolText(value){return value?.format==='heloscrum-source-page'&&typeof value.text==='string'?sourceText(value):typeof value==='string'?value:JSON.stringify(value);}
export function parseToolText(text){
  try{return JSON.parse(text);}catch(error){const split=text.indexOf('\n\n');if(split<0)throw error;const meta=JSON.parse(text.slice(0,split));if(meta.format!=='heloscrum-source-page')throw error;return {...meta,text:text.slice(split+2)};}
}
export function mcpToolResult(value,{explicitSuccess=false}={}){
  if(Array.isArray(value?.mcpResult?.content))return value.mcpResult;
  const isError=typeof value?.exitCode==='number'&&value.exitCode!==0;
  return {content:[{type:'text',text:toolText(value)}],...(isError||explicitSuccess?{isError}:{})};
}
