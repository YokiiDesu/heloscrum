// Inspect saved bytes, not the server's generic download Content-Type.
export async function resourcePreview(blob,name){
  const bytes=new Uint8Array(await blob.arrayBuffer()),ext=name.split('.').pop().toLowerCase();
  const prefix=(...signature)=>signature.every((v,i)=>bytes[i]===v);
  const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
  const mime=prefix(137,80,78,71,13,10,26,10)?'image/png':prefix(255,216,255)?'image/jpeg':
    ['GIF87a','GIF89a'].includes(ascii(0,6))?'image/gif':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':
    ascii(4,8)==='ftyp'&&['avif','avis'].includes(ascii(8,12))?'image/avif':null;
  if(mime)return {kind:'image',blob:new Blob([bytes],{type:mime})};
  if(ascii(0,5)==='%PDF-')return {kind:'pdf',blob:new Blob([bytes],{type:'application/pdf'})};
  if(ext==='docx'&&prefix(80,75,3,4))return {kind:'docx',blob:new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})};
  if(bytes.length>2*1024*1024)return {kind:'unavailable',reason:'This file is too large for an inline text preview. Download it to read the complete file.'};
  try{
    const encoding=prefix(255,254)?'utf-16le':prefix(254,255)?'utf-16be':'utf-8';
    const text=new TextDecoder(encoding,{fatal:true}).decode(bytes);
    if(/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text))throw Error('Binary content');
    return {kind:['md','markdown','mdown','mkd'].includes(ext)?'markdown':['mmd','mermaid'].includes(ext)?'mermaid':'text',text};
  }catch{return {kind:'unavailable',reason:'This file format does not have an inline preview yet. Download the original to open it in a compatible app.'};}
}

// A Markdown link is a local file reference only when it has no web/app scheme.
// Return decoded paths for the API; never use browser-resolved anchor.href.
export function fileReference(href){
  if(typeof href!=='string'||!href.trim()||/[\u0000-\u001f\u007f]/.test(href))return null;
  let value=href.trim();
  const drivePath=/^[a-z]:[\\/]/i.test(value);
  if(drivePath)value=value.replaceAll('\\','/');
  else if(value.includes('\\'))return null;
  if(value.startsWith('#')||value.startsWith('?')||value.startsWith('//'))return null;
  if(/^file:/i.test(value)){
    try{const url=new URL(value);if(url.hostname&&url.hostname!=='localhost'||url.search)return null;value=url.pathname.replace(/^\/([a-z]:\/)/i,'$1')+url.hash;}catch{return null;}
  }else if(!drivePath&&/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^([^:]+\.[^:/]+|[^:]*\/[^:]+):\d+(?::\d+)?(?:#.*)?$/.test(value))return null;
  const hash=value.indexOf('#'),rawPath=hash<0?value:value.slice(0,hash);
  if(rawPath.includes('?'))return null;
  let pathname,fragment;
  try{pathname=decodeURIComponent(rawPath);fragment=hash<0?'':decodeURIComponent(value.slice(hash+1));}catch{return null;}
  if(!pathname||/[\u0000-\u001f\u007f\\]/.test(pathname)||pathname.startsWith('//')||pathname.startsWith('~'))return null;
  if(!/^[a-z]:\//i.test(pathname)&&/^[a-z][a-z\d+.-]*:/i.test(pathname)&&!/^([^:]+\.[^:/]+|[^:]*\/[^:]+):\d+(?::\d+)?$/.test(pathname))return null;
  let line=null,column=null;
  const suffix=pathname.match(/:(\d+)(?::(\d+))?$/),anchor=fragment.match(/^L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i);
  if(suffix){pathname=pathname.slice(0,-suffix[0].length);line=Number(suffix[1]);column=suffix[2]?Number(suffix[2]):null;}
  if(anchor){line=Number(anchor[1]);column=anchor[2]?Number(anchor[2]):null;}
  if(line!==null&&(!Number.isSafeInteger(line)||line<1)||column!==null&&(!Number.isSafeInteger(column)||column<1))return null;
  // A scheme-looking remainder must never become a local link (javascript:123).
  if(!pathname||/^[a-z][a-z\d+.-]*:/i.test(pathname)&&!/^[a-z]:\//i.test(pathname))return null;
  return {path:pathname,line,column,fragment:anchor?'':fragment};
}

// Each viewer visit retains its own display state. Opening a new link after
// going back discards the forward branch, like browser navigation.
export class FilePreviewHistory {
  constructor(){this.entries=[];this.index=-1;}
  get current(){return this.entries[this.index];}
  get canBack(){return this.index>0;}
  get canForward(){return this.index<this.entries.length-1;}
  open(entry){this.entries.splice(this.index+1);this.entries.push(entry);this.index=this.entries.length-1;return entry;}
  move(direction){
    if(direction!==-1&&direction!==1)return null;
    if(direction===-1&&!this.canBack||direction===1&&!this.canForward)return null;
    this.index+=direction;return this.current;
  }
}
