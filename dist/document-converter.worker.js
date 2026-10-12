// DOCX is converted in a disposable worker. It cannot read local files and the
// result still passes through the same HTML sanitizer as document Markdown.
importScripts('/vendor/mammoth.js','/vendor/fflate.js');
self.onmessage=async({data})=>{
  try{
    let total=0,count=0;const names=new Set();
    fflate.unzipSync(new Uint8Array(data),{filter:file=>{
      total+=file.originalSize;count++;names.add(file.name);
      if(total>64*1024*1024||count>10000)throw new Error('This Word document is too large to preview. Download the original to open it.');
      return false;
    }});
    if(!names.has('[Content_Types].xml')||!names.has('word/document.xml'))throw new Error('This file is not a supported Word document. Download the original to inspect it.');
    const result=await mammoth.convertToHtml({arrayBuffer:data},{externalFileAccess:false,includeEmbeddedStyleMap:false,idPrefix:'docx-',ignoreEmptyParagraphs:false});
    self.postMessage({html:result.value,messages:result.messages.map(message=>message.message)});
  }catch(error){self.postMessage({error:error.message||'This Word document could not be previewed.'});}
};
