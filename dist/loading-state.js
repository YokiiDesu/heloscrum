const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const line=(size='')=>`<span class="load-skeleton ${size}"></span>`;
const row=()=>`<div class="load-placeholder-row">${line('load-avatar')}<div>${line('load-title')}${line('load-copy')}${line('load-short')}</div>${line('load-badge')}</div>`;

export function loadingState(title,{detail='',variant='list'}={}){
  const shape=['board','chat','list','compact'].includes(variant)?variant:'list';
  const content=shape==='board'?`<div class="load-placeholder-toolbar">${line('load-title')}${line('load-badge')}</div><div class="load-placeholder-board"><aside>${row()}${row()}${row()}</aside><div>${line('load-heading')}${line('load-copy')}${row()}${row()}${row()}</div></div>`:shape==='chat'?`${row()}${row()}${row()}`:shape==='list'?`${row()}${row()}`:'';
  return `<section class="view-loading load-${shape}" data-loading-state role="status" aria-live="polite" aria-label="${esc(title)}"><div class="load-state-heading"><span class="load-orbit" aria-hidden="true"></span><div><strong>${esc(title)}<span aria-hidden="true">…</span></strong>${detail?`<p>${esc(detail)}</p>`:''}</div></div>${content?`<div class="load-placeholders" aria-hidden="true">${content}</div>`:''}</section>`;
}

export function loadFailure(title,{detail='',retry=''}={}){
  return `<section class="view-load-error" data-load-error role="status"><span class="load-error-mark" aria-hidden="true">!</span><div><strong>${esc(title)}</strong>${detail?`<p>${esc(detail)}</p>`:''}</div>${retry?`<button type="button" ${retry}>Try again</button>`:''}</section>`;
}
