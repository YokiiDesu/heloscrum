import {candidateMarkup,candidateStatus} from './showcase-preview.js';

// Scripted product stories. No provider, account, API, or model calls.
const stories = {
  game: {
    name: 'A small world, made playable', project: 'Mosslight / Browser game', code: 'GAME-01',
    brief: 'Build a little garden game. Plant a seed, watch it grow, and keep the garden when I come back.',
    providers: ['Codex', 'Claude Code'], files: ['src/garden.js', 'test/save.test.js'],
    checks: ['Plant → grow → harvest', 'Garden survives a reload', 'Keyboard movement'],
    note: 'Save the harvest and inventory as one change.',
    steps: [
      ['A clear first playable', 'One builder owns the game. A different agent will play and review it.', 'Brief agreed', 'builder', 'I’ll get planting, harvesting, and saving working together. Then you can try the whole loop.'],
      ['Something you can actually play', 'The builder connects the rules, interface, and save system in one candidate.', 'In progress', 'builder', 'The garden is playable. I’ve included the run command and a save to try—could you check reloading just after harvest?'],
      ['A fresh pair of eyes', 'The reviewer tries the player journey and records a reproducible defect.', 'Changes requested', 'reviewer', 'Found one: harvest, reload, and the crop comes back. The basket keeps the reward too. Steps are in the review.'],
      ['A fix with a specific handoff', 'The builder fixes the save boundary and submits a new candidate for review.', 'Ready for recheck', 'builder', 'Good catch. Harvest and inventory now save together. I added a regression test; the updated candidate is ready.'],
      ['Evidence you can inspect', 'The reviewer checks the new candidate. You decide whether to accept it.', 'Ready for your review', 'reviewer', 'Rechecked the harvest/reload case and keyboard movement. Both passed. Touch controls still need a phone check.'],
    ],
  },
  website: {
    name: 'A website that works beyond the mockup', project: 'Form & Field / Studio website', code: 'SITE-01',
    brief: 'Make a studio portfolio with a project gallery and an inquiry form. It needs to work on a phone, too.',
    providers: ['Claude Code', 'Cursor CLI'], files: ['src/contact.html', 'src/form.js'],
    checks: ['Mobile gallery layout', 'Keyboard form recovery', 'Confirmation message'],
    note: 'Link each field error and move focus to the first one.',
    steps: [
      ['Start with the visitor’s goal', 'Design and implementation stay with one owner, from gallery to inquiry.', 'Brief agreed', 'builder', 'I’ll build the gallery and inquiry flow together. Let’s make the phone layout part of the first version.'],
      ['Design becomes a working flow', 'The builder hands over a runnable site, including loading and error states.', 'In progress', 'builder', 'The first version is ready. Can you try submitting the form empty, then correcting it with just the keyboard?'],
      ['Review the awkward moments', 'The reviewer checks more than the happy path and shares the exact failure.', 'Changes requested', 'reviewer', 'The error message is clear, but focus stays on Submit. It takes six Tabs to get back to the missing field.'],
      ['Fix the interaction', 'The builder updates focus handling and hands the same visitor journey back.', 'Ready for recheck', 'builder', 'That would be frustrating. Focus now moves to the first missing field, with the error linked to it. Ready to try again.'],
      ['An independent second look', 'The recorded check names what was exercised and leaves final acceptance to you.', 'Ready for your review', 'reviewer', 'Keyboard recovery and the phone layout checked out. The demo form works; connecting your email service is still a separate step.'],
    ],
  },
  api: {
    name: 'A backend with a clear contract', project: 'Stockroom / Inventory API', code: 'API-01',
    brief: 'Create an inventory reservation API. Retrying the same request must never reserve stock twice.',
    providers: ['Codex', 'Kiro CLI'], files: ['api/reservations.ts', 'test/retries.test.ts'],
    checks: ['Duplicate request handling', 'Concurrent reservations', 'Migration rollback'],
    note: 'Enforce one reservation per request key in the database.',
    steps: [
      ['Define the important boundary', 'The brief includes the data contract, failure behavior, and review criteria.', 'Brief agreed', 'builder', 'I’ll start with the reservation contract and transaction boundary. Duplicate requests need the same result, not a second reservation.'],
      ['Build against the shared contract', 'The implementation and migration travel with a concrete candidate.', 'In progress', 'builder', 'The endpoint and migration are ready. Please send two identical requests at once—the sequential retry test already passes.'],
      ['Challenge the assumptions', 'The reviewer exercises the concurrent case against the submitted build.', 'Changes requested', 'reviewer', 'The concurrent case reserves twice. Both requests pass the lookup before either writes. I’ve attached the reproduction.'],
      ['Close the race', 'The builder enforces the invariant at the data boundary, then requests another check.', 'Ready for recheck', 'builder', 'I moved the guarantee into the transaction with a unique request key. The losing request reads the stored result. Could you rerun the pair?'],
      ['A bounded result', 'Verification records the tested conditions instead of claiming production readiness.', 'Ready for your review', 'reviewer', 'The concurrent pair now returns one reservation. Rollback passed in the test database. Production load testing hasn’t run.'],
    ],
  },
  docs: {
    name: 'Documentation people can follow', project: 'Team handbook / Release SOP', code: 'DOC-01',
    brief: 'Turn our release notes into an owned, versioned SOP, with a rollback procedure and a review date.',
    providers: ['Claude Code', 'Codex'], files: ['docs/release-sop.md', 'docs/index.md'],
    checks: ['Owner, version, review date', 'Working source references', 'Rollback walkthrough'],
    note: 'Keep the SOP, current command, and source revision together.',
    steps: [
      ['Give the document a job', 'The Knowledge Manager has a concrete output, template, and maintenance policy.', 'Brief agreed', 'builder', 'I’ll use the team template and link the source decisions. Who owns the next review is part of the document, too.'],
      ['A document with a home', 'The draft has classification, tags, ownership, and a stable place in the handbook.', 'In progress', 'builder', 'The SOP is indexed and ready. Could you follow the rollback steps from a clean checkout and flag anything I’ve assumed?'],
      ['Test the instructions', 'The reviewer follows the procedure instead of approving its wording alone.', 'Changes requested', 'reviewer', 'Step four points to a retired script. I stopped there; the rollback isn’t verified yet. The current runbook has the replacement.'],
      ['Update the source of truth', 'The owner corrects the procedure and its references, then versions the change.', 'Ready for recheck', 'builder', 'Thanks—that link was stale. The SOP now uses the current command, with its prerequisites and source revision.'],
      ['Useful now, maintainable later', 'The review captures what was followed and what still requires a real environment.', 'Ready for your review', 'reviewer', 'The disposable-environment walkthrough passed. Owner, tags, and review date are present. A production rollback drill remains unrun.'],
    ],
  },
};

const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root = document.querySelector('[data-showcase]');
if (root) {
  const $ = s => root.querySelector(s);
  const tabs = [...root.querySelectorAll('[data-story]')];
  const stages = [...root.querySelectorAll('[data-stage]')];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let key = 'game', step = 0, timer, playing = !motion.matches, visible = false;
  root.dataset.ready = '';
  for (const control of root.querySelectorAll('[data-enhanced]')) control.hidden = false;
  const status = $('[data-play-state]');
  const duration = 6500;

  function syncPlayback() {
    clearTimeout(timer);
    const running = playing && visible && !document.hidden;
    root.dataset.playing = String(running);
    $('[data-play]').textContent = playing ? 'Pause story' : step === 4 ? 'Replay story' : 'Play story';
    $('[data-play]').setAttribute('aria-label', playing ? 'Pause the sample story' : step === 4 ? 'Replay the sample story' : 'Play the sample story');
    status.textContent = running ? 'Playing sample' : playing ? 'Paused offscreen' : step === 4 ? 'Story complete' : 'Paused · explore at your pace';
    if (running) timer = setTimeout(() => { step++; if (step === 4) playing = false; render(); }, duration);
  }

  function render() {
    const s = stories[key], [title, detail, state, who, message] = s.steps[step];
    root.dataset.story = key;
    root.dataset.phase = String(step);
    $('[data-project]').textContent = s.project;
    $('[data-story-title]').textContent = s.name;
    $('[data-brief]').textContent = s.brief;
    $('[data-code]').textContent = s.code;
    $('[data-state]').textContent = state;
    $('[data-step-title]').textContent = title;
    $('[data-step-detail]').textContent = detail;
    $('[data-step-count]').textContent = `${String(step + 1).padStart(2,'0')} / 05`;
    $('[data-result-state]').textContent = candidateStatus(key,step);
    $('[data-candidate]').innerHTML = candidateMarkup(key,step);
    $('[data-files]').innerHTML = s.files.map(f=>`<span>${escape(f)}</span>`).join('');
    $('[data-notebook]').textContent = step < 3 ? 'The brief, review criteria, and source references stay with this project.' : s.note;
    $('[data-checks]').innerHTML = s.checks.map((c,i)=>`<li><span class="check-mark" aria-hidden="true">${step === 4 ? '✓' : step === 2 && i === 1 ? '!' : '·'}</span>${escape(c)}<small>${step === 4 ? 'Checked' : step === 2 && i === 1 ? 'Finding' : 'In scope'}</small></li>`).join('');
    $('[data-people]').innerHTML = s.providers.map((p,i)=>`<span class="story-person ${i ? 'reviewer' : 'builder'} ${who === (i ? 'reviewer' : 'builder') ? 'is-speaking' : ''}"><b aria-hidden="true">${p === 'Claude Code' ? '✳' : p === 'Codex' ? '>_' : p === 'Kiro CLI' ? 'K' : 'C'}</b><span>${i ? 'Reviewer' : key === 'docs' ? 'Knowledge Manager' : 'Builder'}<small>${escape(p)}</small></span></span>`).join('');
    const previous = step ? s.steps[step-1] : null;
    const bubble = (item,older=false) => {
      const role = item[3] === 'reviewer' ? 'Reviewer' : key === 'docs' ? 'Knowledge Manager' : 'Builder';
      const provider = s.providers[item[3] === 'reviewer' ? 1 : 0];
      return `<article class="story-message ${item[3]} ${older?'previous-message':''}"><div><strong>${escape(role)}</strong><span>${escape(provider)}</span></div><p>${escape(item[4])}</p></article>`;
    };
    $('[data-messages]').innerHTML = (previous ? bubble(previous,true) : `<article class="story-message sponsor previous-message"><div><strong>You</strong><span>Project brief</span></div><p>${escape(s.brief)}</p></article>`) + bubble(s.steps[step]);
    for (const tab of tabs) {
      const selected = tab.dataset.story === key;
      tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    $('[data-story-panel]').setAttribute('aria-labelledby',`story-tab-${key}`);
    for (const stage of stages) {
      const n = Number(stage.dataset.stage);
      stage.toggleAttribute('data-past',n < step);
      if (n === step) stage.setAttribute('aria-current','step'); else stage.removeAttribute('aria-current');
    }
    $('[data-back]').disabled = step === 0;
    $('[data-next]').disabled = step === 4;
    // Announce only changes requested by the visitor, never an autoplay transcript.
    if (!playing) $('[data-announcement]').textContent = `${s.name}. Step ${step+1} of 5: ${title}. ${state}.`;
    syncPlayback();
  }

  const pause = () => { playing = false; syncPlayback(); };
  for (const tab of tabs) tab.addEventListener('click', () => { pause(); key = tab.dataset.story; step = 0; render(); });
  $('[data-story-tabs]').addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    let n = tabs.indexOf(document.activeElement);
    if (n < 0) return;
    n = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (n + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[n].focus(); tabs[n].click();
  });
  for (const stage of stages) stage.addEventListener('click', () => { pause(); step = Number(stage.dataset.stage); render(); });
  $('[data-play]').addEventListener('click', () => { if (!playing && step === 4) step = 0; playing = !playing; render(); });
  $('[data-back]').addEventListener('click', () => { pause(); step = Math.max(0,step-1); render(); });
  $('[data-next]').addEventListener('click', () => { pause(); step = Math.min(4,step+1); render(); });
  root.addEventListener('focusin', event => { if (!event.target.matches('[data-play]')) pause(); });
  root.addEventListener('pointerdown', event => { if (!event.target.closest('[data-play]')) pause(); });
  document.addEventListener('visibilitychange',syncPlayback);
  motion.addEventListener('change', () => { if (motion.matches) pause(); });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; syncPlayback(); },{threshold:.12}).observe(root);
  render();
}
