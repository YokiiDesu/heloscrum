// Original, scripted DOM illustrations. These do not execute product code or call a provider.
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const captions = {
  game: [
    ['The Plan', 'A Garden That Remembers', 'Plant, harvest, and pick up where you left off.'],
    ['First Build', 'The Garden Is Playable', 'Six crops are ready. Next up: try harvesting and reloading.'],
    ['Bug Reproduced', 'The Harvest Comes Back', 'Reload restores all six crops, but keeps the basket reward.'],
    ['Fix Applied', 'One Harvest. One Save.', 'The empty plot and the full basket now save together.'],
    ['Recheck Passed', 'Your Garden Stays Yours', 'Reload keeps the plot harvested and all six crops in the basket.'],
  ],
  website: [
    ['The Plan', 'From Gallery To Inquiry', 'A small portfolio with a usable contact flow.'],
    ['First Build', 'A Studio, Open For Inquiries', 'The gallery and contact form are ready to try.'],
    ['Bug Reproduced', 'Focus Gets Left Behind', 'The email is missing. Keyboard focus is still on Submit.'],
    ['Fix Applied', 'Straight To The Missing Field', 'The error names the field, and focus moves right to it.'],
    ['Recheck Passed', 'An Inquiry, Sent', 'Keyboard recovery and the phone layout both checked out.'],
  ],
  api: [
    ['The Contract', 'A Retry Is Still One Request', 'Reserve stock once for each unique request key.'],
    ['First Build', 'Sequential Retries Work', 'A later retry reuses the first reservation.'],
    ['Bug Reproduced', 'One Key. Two Reservations.', 'Two simultaneous requests each take a unit of stock.'],
    ['Fix Applied', 'One Transaction Wins', 'A unique key prevents a second write. The retry reads the result.'],
    ['Recheck Passed', 'Two Replies. One Reservation.', 'Both callers receive the same ID. Stock is reserved once.'],
  ],
  docs: [
    ['The Brief', 'A Procedure With An Owner', 'Capture the release, rollback, and next review.'],
    ['First Draft', 'A Home In The Handbook', 'Versioned, classified, and ready for a walkthrough.'],
    ['Review Finding', 'Step Four Stops The Release', 'The rollback command points to a retired script.'],
    ['Fix Applied', 'The Current Command, In Place', 'The corrected step includes its prerequisite and source.'],
    ['Walkthrough Passed', 'Ready For The Next Reader', 'The procedure works in the disposable review environment.'],
  ],
};
export function candidateStatus(kind, step) { return captions[kind][step][0]; }
const number = n => `<span class="scene-number">${n}</span>`;
const badge = text => `<span class="scene-badge">${esc(text)}</span>`;

function garden(step) {
  const planned = step === 0, harvested = step >= 3, failure = step === 2;
  return `<div class="scene-art scene-garden ${planned?'is-plan':''} ${failure?'has-regrowth':''} ${harvested?'is-harvested':''}">
    <div class="scene-sun"></div><div class="scene-hill"></div><div class="scene-trail"></div>
    <span class="scene-tree tree-a"></span><span class="scene-tree tree-b"></span><span class="scene-tree tree-c"></span>
    <div class="scene-cottage"><i></i><b></b></div>
    <div class="scene-game-title">Mosslight<span>${planned?'GARDEN PLAN':'DAY 01 · YOUR GARDEN'}</span></div>
    <div class="scene-plot">${Array.from({length:6},(_,i)=>`<span class="soil soil-${i}"><i class="crop"><b></b></i></span>`).join('')}</div>
    <span class="scene-farmer"><i></i></span>
    ${planned?'<div class="scene-plan-label">PLANT → GROW → HARVEST</div>':`<div class="scene-garden-action">${step===1?'READY TO HARVEST':failure?'↻ RELOAD · CROPS RETURNED':step===3?'↻ RELOAD · SAVE FIX APPLIED':'✓ RELOAD · HARVEST PRESERVED'}</div>`}
    <div class="scene-basket"><span class="basket-icon" aria-hidden="true"></span><span>Basket<strong>${step>=2?'6':'0'} crops</strong></span></div>
    ${failure?'<span class="scene-plot-alert">+6 crops returned</span>':harvested?'<span class="scene-plot-alert">Plot stays harvested ✓</span>':''}
    <div class="scene-reload-sweep" aria-hidden="true"></div>
  </div>
  <div class="scene-metrics"><span>In the plot<strong>${planned?'—':harvested?'0':'6'} crops</strong></span><span>In the basket<strong>${step>=2?'6':'0'} crops</strong></span><span>Save state<strong>${planned?'Planned':step===1?'Ready to test':failure?'Out of sync':'In sync ✓'}</strong></span></div>`;
}
function website(step) {
  if(step===0)return `<div class="scene-art scene-site is-plan"><div class="scene-site-brand">FORM & FIELD<span>STUDIO / OBJECTS</span></div><div class="site-wire-title"></div><div class="site-wire-line"></div><div class="site-wire-gallery"><i></i><i></i><i></i></div><div class="site-wire-form">Your email <span>Send inquiry →</span></div><span class="scene-plan-label">GALLERY → CONTACT → CONFIRMATION</span></div>`;
  if(step===4)return `<div class="scene-art scene-site is-complete"><div class="scene-site-brand">FORM & FIELD<span>MOBILE PREVIEW</span></div><div class="scene-phone"><div class="phone-speaker"></div><span>FORM & FIELD</span><div class="inquiry-success"><i>✓</i><h4>Thanks, Alex.</h4><p>Your inquiry is in.<br>We’ll be in touch.</p></div><div class="phone-home"></div></div><div class="scene-mobile-checks"><span>✓ Keyboard recovery</span><span>✓ Phone layout</span><small>Sample confirmation<br>Email service not connected</small></div></div>`;
  return `<div class="scene-art scene-site"><div class="scene-site-brand">FORM & FIELD<span>STUDIO / OBJECTS</span></div><h4>Everyday things.<br>Made with care.</h4><div class="scene-vase vase-a"></div><div class="scene-vase vase-b"></div>
    <div class="scene-form"><label>Your Email</label><div class="scene-field ${step===3?'has-focus':''}">${step===1?'alex@example.com':'Enter your email'}${step===3?'<i class="scene-caret"></i><span class="scene-focus-tag">FOCUS IS HERE</span>':''}</div>${step>=2?'<span class="scene-field-error">Please enter your email address.</span>':'<span class="scene-field-note">Tell us what you have in mind.</span>'}<div class="scene-submit ${step===2?'has-focus':''}">Send Inquiry →${step===2?'<span class="scene-focus-tag">FOCUS IS STILL HERE</span>':''}</div></div>
    ${step===2?'<div class="scene-tab-distance">↑ <strong>6 Tabs</strong> to get back to Email</div>':''}
  </div>`;
}
function api(step) {
  const failure=step===2,fixed=step>=3;
  const requests=step===0?['Request','Retry']:step===1?['Request A','Later Retry']:['Request A','Request B'];
  return `<div class="scene-art scene-api ${failure?'has-race':''} ${fixed?'has-lock':''}">
    <div class="scene-api-route"><b>POST</b> /reservations ${badge(step===0?'CONTRACT':fixed?'V2':'V1')}</div>
    <div class="scene-requests">${requests.map((name,i)=>`<div><span>${esc(name)}</span><code>key: order-42</code><small>${step===0?'same key':step===1?i?'AFTER A':'FIRST':step===4?'200 · R-041':'SAME TIME'}</small></div>`).join('')}</div>
    <div class="scene-converge"><i></i><span>${step===0?'One request key':failure?'Both lookups return “not found”':fixed?'UNIQUE(request_key)':'Read existing result'}</span><i></i></div>
    <div class="scene-ledger"><div><strong>Reservation Ledger</strong><small>${step===0?'EXPECTED':failure?'2 WRITES':'1 WRITE'}</small></div><p><code>${step===0?'request_key → reservation': 'order-42'}</code><b>${step===0?'one ID':'R-041'}</b></p>${failure?'<p class="duplicate-row"><code>order-42</code><b>R-042</b><span>DUPLICATE</span></p>':fixed?'<p class="reused-row"><span>Request B</span><span>↳ reuses R-041</span></p>':''}</div>
    <div class="scene-stock"><span>Stock Available</span><strong>${step===0?'10':failure?'8':'9'}</strong><span>${step===0?'before any request':failure?'2 units reserved':'1 unit reserved'}</span></div>
  </div>`;
}
function docs(step) {
  const plan=step===0,fixed=step>=3;
  return `<div class="scene-art scene-docs ${plan?'is-plan':''}"><div class="scene-doc-breadcrumb">HANDBOOK / OPERATIONS / RELEASE</div><h4>Release & Rollback</h4><div class="scene-doc-meta"><span>Owner <b>${plan?'To assign':'Delivery'}</b></span><span>Version <b>${plan?'Draft':fixed?'1.1':'1.0'}</b></span><span>Review <b>${plan?'To schedule':'Nov 11'}</b></span></div><div class="scene-doc-tags">${badge('INTERNAL')}${badge('SOP')}${badge('RELEASE')}</div><div class="scene-doc-steps"><p>${number('1–3')} Confirm release & recovery prerequisites</p><div class="scene-doc-command">${number('4')}<div><strong>Restore The Previous Release</strong>${plan?'<span class="doc-placeholder"></span>':`<code class="${step===2?'is-retired':''}">${fixed?'npm run release:restore':'./scripts/rollback-old.sh'}</code>`}${step===2?'<span class="scene-retired-label">RETIRED SCRIPT · WALKTHROUGH STOPPED</span>':fixed?'<small>Requires release ID · Source: runbook v3</small>':''}</div></div><p>${number('5')} Verify recovery and record the result</p></div>${step===4?'<div class="scene-doc-stamp">✓ WALKTHROUGH VERIFIED<span>Disposable environment</span></div>':step===3?'<div class="scene-doc-change"><del>rollback-old.sh</del><span>→</span><strong>release:restore</strong></div>':''}</div>`;
}
export function candidateMarkup(kind,step) {
  const [state,title,detail]=captions[kind][step],tone=step===2?'finding':step>=3?'success':'building';
  const art={game:garden,website,api,docs}[kind](step);
  return `<section class="candidate-scene ${tone}" data-scene="${kind}" data-frame="${step}" aria-label="${esc(state+': '+title)}"><div class="scene-caption"><span class="scene-status-icon" aria-hidden="true">${step===2?'!':step>=3?'✓':'↗'}</span><div><span>${esc(state)} · ${step===0?'BRIEF':step<3?'VERSION 1':'VERSION 2'}</span><h4>${esc(title)}</h4></div></div>${art}<p class="scene-outcome">${esc(detail)}</p></section>`;
}
