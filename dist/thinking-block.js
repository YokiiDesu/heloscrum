import {messageContent} from './message-content.js';
import {thinkingPresentation} from './workspace-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 15a7 7 0 1 1 8 0l-1 3H9Z"/></svg>';

export function thinkingBlock(event,{markdown,scope=''}){
  const meta=thinkingPresentation(event),{available,kind}=meta;
  const head=`<span class="tool-glyph">${icon}</span><strong>Thinking</strong>${available?`<span class="thinking-toggle"><span class="thinking-show">Show ${kind}</span><span class="thinking-hide">Hide ${kind}</span></span>`:`<span class="thinking-unavailable" title="${esc(meta.explanation)}">${esc(meta.unavailable)}</span>`}<span class="tool-status">${esc(meta.status)}</span>${meta.duration?`<time>${esc(meta.duration)}</time>`:''}`;
  return available?`<details class="chat-tool thinking-block tool-${meta.status}" data-event="${esc(event.id)}"><summary>${head}</summary><div class="thinking-content">${messageContent(markdown(event.text),`${scope}:thinking:${event.id}`)}</div></details>`:`<div class="chat-tool thinking-block tool-${meta.status}" data-event="${esc(event.id)}"><div class="thinking-heading">${head}</div></div>`;
}
