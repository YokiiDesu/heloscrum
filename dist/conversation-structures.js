import {agentLabel} from './agent-appearance.js';

// Cards for structured group conversations: proposals with live tallies,
// debates with positions and changes of mind, and decision records. Rendering
// is pure so it can be tested without a browser; ChatThreads owns events.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS_LABELS={open:'Open',accepted:'Accepted',rejected:'Rejected',expired:'Expired',withdrawn:'Withdrawn',closed:'Closed',superseded:'Superseded'};
const RULE_LABELS={majority:'Majority',unanimous:'Unanimous','proposer-decides':'Proposer decides'};
const STANCE_LABELS={support:'Supports',object:'Objects',abstain:'Abstains'};
const EVENT_LABELS={vote:'Vote','vote-changed':'Changed vote',decided:'Proposer decision','awaiting-decision':'Ready for a decision',resolved:'Outcome',position:'New position',adopt:'Changed position',superseded:'Decision withdrawn',recorded:'Decision'};

export const structureStatus=status=>`<span class="structure-status status-${esc(status)}">${esc(STATUS_LABELS[status]||status)}</span>`;
const who=(id,role)=>agentLabel(id,role);
const paragraph=(markdown,value)=>value?`<div class="structure-text">${markdown(value)}</div>`:'';
const field=(drafts,key,name)=>drafts.get(`${key}:${name}`)??'';

/** Index a conversation page's structures by ID. */
export function structureIndex(thread){return new Map((thread.structures||[]).map(s=>[s.id,s]));}

/** Which kind of rendering a message gets: a full card, or a small tag. */
export function structureRole(message){
  const ref=message.structure;if(!ref)return null;
  if(ref.event==='opened'||ref.type==='decision'&&ref.event==='recorded'||ref.event==='resolved'&&ref.decisionId)return 'card';
  return 'tag';
}

/** A short label shown above a structure event message. */
export function structureTag(message,structure){
  const ref=message.structure,name=structure?.title||structure?.question||'';
  return `<div class="structure-tag structure-tag-${esc(ref.type)}"><span>${esc(EVENT_LABELS[ref.event]||ref.event)}</span>${name?` · <span class="structure-tag-name">${esc(name)}</span>`:''}${structure&&structure.status!=='open'&&ref.event==='resolved'?' '+structureStatus(structure.status):''}</div>`;
}

/** Explain what changed someone's mind, linking the message that did it. */
function influence(id,lookup){
  if(!id)return '';const source=lookup(id);
  return source?` <button type="button" class="structure-influence" data-focus-message="${esc(id)}">Persuaded by ${esc(source.fromRole)}</button>`:' <span class="structure-influence">Persuaded by an earlier message</span>';
}

export function proposalCard(p,{markdown,drafts=new Map(),open=new Set(),busy=null,viewer='human',lookup=()=>null}={}){
  const tally=p.tally,max=Math.max(1,tally.eligible),winner=p.outcome?.option;
  const ballots=p.currentVotes||[],byOption=id=>ballots.filter(v=>v.stance==='support'&&v.option===id);
  const options=p.options.map(o=>{const votes=byOption(o.id),count=tally.support[o.id]||0;return `<li class="proposal-option${winner===o.id?' winner':''}"><div class="option-head"><b>${esc(o.id)}</b><span>${esc(o.label)}</span><span class="tally-count">${count}/${tally.eligible}</span></div><div class="tally-bar" role="img" aria-label="${count} of ${tally.eligible} voters support option ${esc(o.id)}"><span style="width:${Math.round(count/max*100)}%"></span></div>${votes.length?`<div class="option-voters">${votes.map(v=>who(v.voter,v.voterRole)).join('')}</div>`:''}</li>`;}).join('');
  const others=[tally.object&&`${tally.object} ${tally.object===1?'objects':'object'}`,tally.abstain&&`${tally.abstain} abstained`].filter(Boolean).join(' · ');
  const waiting=tally.waiting.map(id=>p.voterRoles?.[id]||id);
  const meta=[`${RULE_LABELS[p.rule]||p.rule} of ${tally.eligible}`,p.deadline&&`Deadline ${new Date(p.deadline).toLocaleString()}`,p.status==='open'&&waiting.length&&`Waiting on ${waiting.join(', ')}`,p.status==='open'&&!waiting.length&&p.rule==='proposer-decides'&&`Waiting for ${p.createdByRole} to decide`].filter(Boolean).map(esc).join(' · ');
  const history=p.votes.filter(v=>v.previous||v.deciding);
  const ballotList=ballots.length?`<details class="structure-detail"${open.has(p.id+':ballots')?' open':''} data-detail-key="${esc(p.id)}:ballots"><summary>Votes and reasons (${ballots.length})</summary><ul class="ballot-list">${ballots.map(v=>`<li>${who(v.voter,v.voterRole)} <span class="stance stance-${esc(v.stance)}">${esc(STANCE_LABELS[v.stance])}${v.option&&p.options.length>1?' '+esc(v.option):''}</span>${paragraph(markdown,v.rationale)}</li>`).join('')}</ul>${history.length?`<h5>Changes of mind</h5><ul class="mind-changes">${history.map(v=>v.deciding?`<li>${who(v.voter,v.voterRole)} decided: ${esc(v.stance==='support'?'option '+v.option:'reject')}</li>`:`<li>${who(v.voter,v.voterRole)} moved from ${esc(v.previous.stance==='support'?v.previous.option:STANCE_LABELS[v.previous.stance].toLowerCase())} to ${esc(v.stance==='support'?v.option:STANCE_LABELS[v.stance].toLowerCase())}: ${esc(v.reason)}${influence(v.influencedBy,lookup)}</li>`).join('')}</ul>`:''}</details>`:'';
  const outcome=p.outcome?`<p class="structure-outcome">${esc(p.outcome.reason)}${p.decisionId?` <button type="button" class="structure-link" data-focus-structure="${esc(p.decisionId)}">View decision</button>`:''}</p>`:'';
  return `<section class="structure-card structure-proposal" data-structure-card="${esc(p.id)}" aria-label="Proposal: ${esc(p.title)}"><header><span class="structure-kind">Proposal</span>${structureStatus(p.status)}</header><h4>${esc(p.title)}</h4>${paragraph(markdown,p.summary)}<ol class="proposal-options">${options}</ol>${others?`<p class="proposal-others">${esc(others)}</p>`:''}<p class="structure-meta">${meta}</p>${outcome}${ballotList}${p.status==='open'?proposalActions(p,{drafts,open,busy,viewer}):''}</section>`;
}

function proposalActions(p,{drafts,open,busy,viewer}){
  if(viewer!=='human')return '';const key=`${p.id}:resolve`;
  return `<div class="structure-actions"><details class="structure-action"${open.has(key)?' open':''} data-detail-key="${esc(key)}"><summary>Decide for the group</summary><form class="structure-form" data-structure-form="resolve" data-structure-id="${esc(p.id)}"><label>Outcome<select name="outcome">${p.options.map(o=>`<option value="accepted:${esc(o.id)}">Accept ${esc(o.id)}${p.options.length>1?': '+esc(o.label):''}</option>`).join('')}<option value="rejected">Reject</option><option value="withdrawn">Withdraw</option></select></label><label>Reason<textarea name="reason" rows="2" maxlength="2000" required>${esc(field(drafts,key,'reason'))}</textarea></label><button type="submit"${busy===key?' disabled':''}>${busy===key?'Saving…':'Record outcome'}</button></form></details></div>`;
}

export function debateCard(d,{markdown,drafts=new Map(),open=new Set(),busy=null,viewer='human',lookup=()=>null}={}){
  const positions=d.positions.map(p=>`<article class="debate-position" data-position="${esc(p.id)}"><header><b>${esc(p.id)}</b>${who(p.author,p.authorRole)}${p.holders.length?`<span class="position-holders" aria-label="${p.holders.length} ${p.holders.length===1?'member holds':'members hold'} this position">${p.holders.length}</span>`:''}</header><p class="position-claim">${esc(p.claim)}</p>${paragraph(markdown,p.arguments)}${p.rebuts.length?`<p class="position-rebuts">Rebuts ${p.rebuts.map(esc).join(', ')}</p>`:''}${p.holders.length?`<div class="option-voters">${p.holders.map(h=>who(h.id,h.role)).join('')}</div>`:''}</article>`).join('');
  const moves=d.stances.filter(s=>s.from);
  const moved=moves.length?`<details class="structure-detail"${open.has(d.id+':moves')?' open':''} data-detail-key="${esc(d.id)}:moves"><summary>Changes of mind (${moves.length})</summary><ul class="mind-changes">${moves.map(s=>`<li>${who(s.member,s.memberRole)} moved from ${esc(s.from)} to ${esc(s.position)}: ${esc(s.reason)}${influence(s.influencedBy,lookup)}</li>`).join('')}</ul></details>`:'';
  const closed=d.status!=='open'?`<p class="structure-outcome">${esc(d.closedReason||'Closed')}${d.decisionId?` <button type="button" class="structure-link" data-focus-structure="${esc(d.decisionId)}">View decision</button>`:''}</p>`:'';
  return `<section class="structure-card structure-debate" data-structure-card="${esc(d.id)}" aria-label="Debate: ${esc(d.question)}"><header><span class="structure-kind">Debate</span>${structureStatus(d.status)}</header><h4>${esc(d.question)}</h4>${paragraph(markdown,d.context)}${positions?`<div class="debate-positions">${positions}</div>`:'<p class="structure-meta">No positions yet.</p>'}<p class="structure-meta">Moderator: ${esc(d.moderatorRole)}</p>${moved}${closed}${d.status==='open'&&viewer==='human'?debateActions(d,{drafts,open,busy}):''}</section>`;
}

function debateActions(d,{drafts,open,busy}){
  const decideKey=`${d.id}:decide`;
  return `<div class="structure-actions"><details class="structure-action"${open.has(decideKey)?' open':''} data-detail-key="${esc(decideKey)}"><summary>Close with a decision</summary><form class="structure-form" data-structure-form="decide" data-structure-id="${esc(d.id)}"><label>Title<input name="title" maxlength="200" required value="${esc(field(drafts,decideKey,'title')||d.question.slice(0,200))}"></label>${d.positions.length?`<label>Winning position<select name="positionId"><option value="">None</option>${d.positions.map(p=>`<option value="${esc(p.id)}">${esc(p.id)}: ${esc(p.claim.slice(0,80))}</option>`).join('')}</select></label>`:''}<label>Decision<textarea name="decision" rows="2" maxlength="2000" required>${esc(field(drafts,decideKey,'decision'))}</textarea></label><label>Rationale<textarea name="rationale" rows="2" maxlength="4000" required>${esc(field(drafts,decideKey,'rationale'))}</textarea></label><button type="submit" class="primary"${busy===decideKey?' disabled':''}>${busy===decideKey?'Saving…':'Record decision'}</button></form></details></div>`;
}

export function decisionCard(d,{markdown,drafts=new Map(),open=new Set(),busy=null,viewer='human'}={}){
  const list=(title,items)=>items.length?`<h5>${title}</h5><ul>${items.join('')}</ul>`:'';
  const supersedeKey=`${d.id}:supersede`;
  const actions=d.status==='accepted'&&viewer==='human'?`<div class="structure-actions"><details class="structure-action"${open.has(supersedeKey)?' open':''} data-detail-key="${esc(supersedeKey)}"><summary>Mark superseded</summary><form class="structure-form" data-structure-form="supersede" data-structure-id="${esc(d.id)}"><label>Reason<textarea name="reason" rows="2" maxlength="2000" required>${esc(field(drafts,supersedeKey,'reason'))}</textarea></label><button type="submit"${busy===supersedeKey?' disabled':''}>${busy===supersedeKey?'Saving…':'Mark superseded'}</button></form></details></div>`:'';
  const lineage=[d.supersedes&&`<button type="button" class="structure-link" data-focus-structure="${esc(d.supersedes)}">Supersedes an earlier decision</button>`,d.supersededBy&&`<button type="button" class="structure-link" data-focus-structure="${esc(d.supersededBy)}">Superseded by a later decision</button>`,d.status==='superseded'&&!d.supersededBy&&d.supersededReason&&`<span>Superseded: ${esc(d.supersededReason)}</span>`].filter(Boolean).join(' · ');
  return `<section class="structure-card structure-decision${d.status==='superseded'?' is-superseded':''}" data-structure-card="${esc(d.id)}" aria-label="Decision: ${esc(d.title)}"><header><span class="structure-kind">Decision record</span>${structureStatus(d.status)}</header><h4>${esc(d.title)}</h4>${d.context?`<h5>Context</h5>${paragraph(markdown,d.context)}`:''}<h5>Decision</h5>${paragraph(markdown,d.decision)}<h5>Why</h5>${paragraph(markdown,d.rationale)}${list('Alternatives considered',d.alternatives.map(a=>`<li>${esc(a)}</li>`))}${d.consequences?`<h5>Consequences</h5>${paragraph(markdown,d.consequences)}`:''}${list('Dissent',d.dissent.map(x=>`<li>${who(x.member,x.memberRole)} ${esc(x.reason)}</li>`))}<p class="structure-meta">Recorded by ${esc(d.recordedByRole)} · ${esc(new Date(d.at).toLocaleString())} · Participants: ${d.participantRoles.map(esc).join(', ')} · Memory note <code>${esc(d.memoryKey)}</code></p>${lineage?`<p class="structure-meta">${lineage}</p>`:''}${actions}</section>`;
}

export function structureCard(structure,options){
  if(!structure)return '<p class="structure-meta">This structured message is no longer available.</p>';
  if(structure.type==='proposal')return proposalCard(structure,options);
  if(structure.type==='debate')return debateCard(structure,options);
  return decisionCard(structure,options);
}

/** The bar above a group's messages: open items and its decision records. */
export function structureSummary(thread,{expanded=false,markdown,drafts,open,busy}={}){
  const all=thread.structures||[];if(!all.length)return '';
  const active=all.filter(s=>s.status==='open'),decisions=all.filter(s=>s.type==='decision').sort((a,b)=>b.at.localeCompare(a.at));
  const chips=active.map(s=>`<button type="button" class="structure-chip" data-focus-structure="${esc(s.id)}">${esc(s.type==='proposal'?'Vote':'Debate')}: ${esc(s.title||s.question)}</button>`).join('');
  return `<section class="structure-summary" aria-label="Proposals, debates and decisions"><div class="structure-summary-row"><span>${active.length} open · ${decisions.filter(d=>d.status==='accepted').length} ${decisions.filter(d=>d.status==='accepted').length===1?'decision':'decisions'}</span>${decisions.length?`<button type="button" data-thread-action="decisions" aria-expanded="${expanded}">${expanded?'Hide decisions':'Show decisions'}</button>`:''}</div>${chips?`<div class="structure-chips">${chips}</div>`:''}${expanded?`<div class="decision-list">${decisions.map(d=>decisionCard(d,{markdown,drafts,open,busy})).join('')}</div>`:''}</section>`;
}

/** Turn a submitted structure form into the backend action payload. */
export function structurePayload(kind,structureId,data){
  const get=name=>String(data.get(name)??'').trim();
  if(kind==='resolve'){const [outcome,option]=get('outcome').split(':');return {action:'resolve',structureId,outcome,...(option?{option}:{}),reason:get('reason')};}
  if(kind==='supersede')return {action:'supersede',structureId,reason:get('reason')};
  if(kind==='decide')return {type:'decision',debateId:structureId,title:get('title'),decision:get('decision'),rationale:get('rationale'),...(get('positionId')?{positionId:get('positionId')}:{})};
  throw new Error('Unknown structured conversation form');
}
