// Keep authored Markdown intact. Older notes often arrive as one long paragraph;
// add reading breaks between sentences without changing the saved source.
export function formatProse(value='',{literalHtml=false}={}){
  const text=String(value??'');
  const authoredMarkup=/[\n\r`*]|\[[^\]]+\]\(|(?:^|\s)_[^\s]|^\s*(?:#{1,6}\s|[-+]\s|\d+[.)]\s|\|)/.test(text)||(!literalHtml&&/[<>]/.test(text));
  if(text.length<=360||authoredMarkup||typeof Intl.Segmenter!=='function')return text;
  const sentences=[...new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(text)].map(s=>s.segment.trim());
  return sentences.reduce((groups,s,i)=>{if(i%2===0)groups.push(s);else groups[groups.length-1]+=' '+s;return groups;},[]).join('\n\n');
}
