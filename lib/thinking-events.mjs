// Copy only the provider's displayable text. Signatures, redacted payloads and
// encrypted reasoning are transport data, never chat content.
export const reasoningSummary=value=>(Array.isArray(value)?value:[])
  .map(part=>typeof part==='string'?part:part?.type==='summary_text'&&typeof part.text==='string'?part.text:'')
  .filter(Boolean).join('\n');

export function thinkingEvent(base,text,{summary=false,redacted=false}={}){
  return {...base,type:'thinking',text:!redacted&&typeof text==='string'?text:'',textKind:summary?'summary':'thinking',...(redacted?{redacted:true}:{})};
}
