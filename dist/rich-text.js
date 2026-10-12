import {fileReference} from './resource-preview.js';
import {marked} from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import {enhanceMessageContent} from './message-content.js';
import {formatProse} from './prose-format.js';

export const proseMarkdown=(text,options={})=>markdown(formatProse(text,{literalHtml:true}),{...options,literalHtml:true});

export function markdown(text,options={}){
  const renderer=new marked.Renderer(),link=renderer.link;
  renderer.link=function(token){
    const reference=fileReference(token.href);
    // file: links would otherwise be removed by the sanitizer. Convert only
    // validated local references; keep all other links under its normal policy.
    if(reference&&/^file:/i.test(token.href))token={...token,href:encodeURI(reference.path).replace(/#/g,'%23').replace(/\?/g,'%3F')+(reference.line?'#L'+reference.line:reference.fragment?'#'+encodeURIComponent(reference.fragment):'')};
    return link.call(this,token);
  };
  const parseOptions={gfm:true,breaks:false,renderer};
  if(options.literalHtml){
    // Reports use angle brackets for command placeholders; render them as text.
    parseOptions.renderer.html=({text})=>text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  }
  if(options.document)return documentHTML(marked.parse(text||'',parseOptions));
  const html=DOMPurify.sanitize(marked.parse(text||'',parseOptions),{USE_PROFILES:{html:true},ALLOW_DATA_ATTR:false,FORBID_TAGS:['img','input','button','style','form','iframe','video','audio'],FORBID_ATTR:['style','id','srcset']});
  return html;
}

// Word and Markdown use the same inert document policy and application styles.
export function documentHTML(html,{bookmarks=false}={}){
  const safe=DOMPurify.sanitize(html,{USE_PROFILES:{html:true},ALLOW_DATA_ATTR:false,SANITIZE_NAMED_PROPS:bookmarks,FORBID_TAGS:['button','style','form','iframe','video','audio'],FORBID_ATTR:['style','srcset',...(bookmarks?[]:['id'])]});
  const template=document.createElement('template');template.innerHTML=safe;
  if(bookmarks)template.content.querySelectorAll('a[href^="#"]').forEach(a=>{a.setAttribute('href','#user-content-'+a.getAttribute('href').slice(1));});
  // GFM task lists are read-only. Never turn attached HTML into an editable form.
  template.content.querySelectorAll('input').forEach(input=>{if(input.type!=='checkbox')input.remove();else input.disabled=true;});
  template.content.querySelectorAll('img').forEach(img=>{
    const src=img.getAttribute('src')||'';
    if(!/^(https:\/\/|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(src)){img.replaceWith(document.createTextNode(img.alt||'Image'));return;}
    img.loading='lazy';img.referrerPolicy='no-referrer';
  });
  return template.innerHTML;
}
let renderer,diagramId=0;
async function mermaid(){
  if(!renderer)renderer=import('/vendor/mermaid/mermaid.esm.min.mjs').then(({default:library})=>{
    library.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark',look:'classic',layout:'dagre',htmlLabels:false,fontFamily:'DM Sans, system-ui, sans-serif',suppressErrorRendering:true,maxTextSize:30000,maxEdges:300,flowchart:{htmlLabels:false},secure:['securityLevel','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering','htmlLabels','flowchart','themeCSS']});
    return library;
  }).catch(error=>{renderer=null;throw error;});
  return renderer;
}

export async function enhanceMarkdown(root,onResize=()=>{},context={}){
  if(context.project)root.dataset.fileProject=context.project;
  if(context.taskId)root.dataset.fileTask=context.taskId;
  enhanceMessageContent();
  root.querySelectorAll('a').forEach(a=>{
    if(a.getAttribute('href')?.startsWith('#')){a.removeAttribute('target');return;}
    const reference=fileReference(a.getAttribute('href'));
    if(reference){a.dataset.fileLink='true';a.removeAttribute('target');a.title='Preview '+reference.path;}
    else{a.target='_blank';a.rel='noopener noreferrer';}
  });
  for(const code of root.querySelectorAll('pre>code')){
    const pre=code.parentElement;if(pre.dataset.enhanced)continue;pre.dataset.enhanced='true';
    const figure=document.createElement('figure');figure.className='code-block';
    const header=document.createElement('figcaption'),label=document.createElement('span'),copy=document.createElement('button');
    const language=[...code.classList].find(c=>c.startsWith('language-'))?.slice(9)||'code';
    label.textContent=language;copy.type='button';copy.textContent='Copy';copy.setAttribute('aria-label','Copy '+language+' source');
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);copy.textContent='Copied';}catch{copy.textContent='Select code to copy';}setTimeout(()=>{if(copy.isConnected)copy.textContent='Copy';},2000);};
    header.append(label,copy);pre.replaceWith(figure);figure.append(header,pre);
    if(language!=='mermaid')continue;
    const source=document.createElement('details'),summary=document.createElement('summary'),diagram=document.createElement('div');
    summary.textContent='Diagram source';source.append(summary,pre);diagram.className='mermaid-diagram';diagram.setAttribute('role','img');diagram.setAttribute('aria-label','Mermaid diagram');diagram.textContent='Rendering diagram…';figure.append(diagram,source);
    try{
      const lib=await mermaid();if(!figure.isConnected)continue;
      const {svg}=await lib.render('heloscrum-diagram-'+(++diagramId),code.textContent);
      if(!figure.isConnected)continue;
      diagram.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','a','image','script'],FORBID_ATTR:['href','xlink:href']});
    }catch{diagram.textContent='Diagram preview unavailable. The source is available below.';source.open=true;}
    onResize();
  }
  onResize();
}
