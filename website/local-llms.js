const example = document.querySelector('[data-local-example]');
if (example) {
  // The contents are real; the progressive reveal is an illustration, not a
  // recording of internal reasoning or incremental writes. No model is contacted.
  const panels = [...example.querySelectorAll('[data-run-panel]')];
  const steps = [...example.querySelectorAll('[data-run-step]')];
  function selectStep(next) {
    panels.forEach((panel, i) => { panel.hidden = i !== next; });
    steps.forEach((step, i) => step.setAttribute('aria-pressed', String(i === next)));
  }
  steps.forEach(button => button.addEventListener('click', () => {
    finishIllustration(false);
    selectStep(Number(button.dataset.runStep));
  }));

  const viewport = example.querySelector('[data-demo-viewport]');
  const overlay = example.querySelector('[data-demo-overlay]');
  const play = example.querySelector('[data-demo-play]');
  const stop = example.querySelector('[data-demo-stop]');
  const reset = example.querySelector('[data-demo-reset]');
  const status = example.querySelector('[data-demo-status]');
  const title = example.querySelector('[data-result-title]');
  const label = example.querySelector('[data-result-label]');
  const watch = example.querySelector('[data-tool-watch]');
  const skip = example.querySelector('[data-tool-skip]');
  const toolStatus = example.querySelector('[data-tool-status]');
  const visualization = example.querySelector('[data-tool-visualization]');
  const fileView = example.querySelector('[data-file-visualization]');
  const noteView = example.querySelector('[data-note-visualization]');
  const code = example.querySelector('[data-file-code]');
  const scroller = example.querySelector('[data-file-scroll]');
  const lineCount = example.querySelector('[data-file-lines]');
  const note = example.querySelector('[data-note-reveal]');
  const fileCard = example.querySelector('[data-tool-file]');
  const noteCard = example.querySelector('[data-tool-note]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const notebookText = example.querySelector('[data-original-note]').textContent.trim();
  let source = null, sourceRequest = null, timer = null, elapsed = 0, phase = '', playbackRequest = 0;
  let frame = null, inView = true;

  function pauseIllustration() {
    if (!timer) return;
    clearInterval(timer); timer = null;
    watch.textContent = 'Continue Playback';
    toolStatus.textContent = 'Playback paused · real completion times are shown on the left';
  }
  function finishIllustration(completed) {
    playbackRequest++;
    clearInterval(timer); timer = null; elapsed = 0; phase = '';
    visualization.hidden = true; viewport.hidden = false; skip.hidden = true;
    fileCard.removeAttribute('data-active'); noteCard.removeAttribute('data-active');
    title.textContent = 'Red Ball Physics'; label.textContent = 'ACTUAL OUTPUT';
    if (!frame) status.textContent = 'Play the original demo in its sandbox, or download the HTML to open locally.';
    watch.disabled = false;
    watch.textContent = completed ? 'Watch Again' : 'Watch the Tool Actions';
    toolStatus.textContent = completed ? 'File and notebook saved. Play the actual result on the right or below.' : 'Illustrative playback · no LLM request';
  }
  function renderIllustration() {
    const nextPhase = elapsed < 6000 ? 'file' : 'note';
    if (phase !== nextPhase) {
      phase = nextPhase;
      title.textContent = phase === 'file' ? 'Writing index.html' : 'Saving the Notebook Entry';
      label.textContent = 'SIMULATED PLAYBACK';
      fileCard.toggleAttribute('data-active', phase === 'file');
      noteCard.toggleAttribute('data-active', phase === 'note');
      fileView.hidden = phase !== 'file'; noteView.hidden = phase !== 'note';
      toolStatus.textContent = phase === 'file' ? 'Revealing Muse’s actual HTML · illustrative write animation' : 'Revealing the exact notebook entry Muse saved';
    }
    if (phase === 'file') {
      const lines = source.trimEnd().split('\n');
      const count = Math.max(1, Math.ceil(lines.length * Math.min(1, elapsed / 5800)));
      code.textContent = lines.slice(0, count).join('\n');
      lineCount.textContent = `${count} / ${lines.length} Lines`;
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      const count = Math.ceil(notebookText.length * Math.min(1, (elapsed - 6000) / 1700));
      note.textContent = notebookText.slice(0, count);
    }
  }
  watch.addEventListener('click', async () => {
    if (timer) { pauseIllustration(); return; }
    const request = ++playbackRequest;
    if (!source) {
      watch.disabled = true; watch.textContent = 'Loading the Original File…';
      try {
        sourceRequest ||= fetch(new URL('./demos/red-ball-original.html', import.meta.url), {credentials: 'omit'})
          .then(response => { if (!response.ok) throw Error('File unavailable'); return response.text(); });
        source = await sourceRequest;
      } catch {
        sourceRequest = null;
        if (request !== playbackRequest) return;
        watch.disabled = false; watch.textContent = 'Try Playback Again';
        toolStatus.textContent = 'The example file couldn’t load. Try again, or use Download Original HTML.';
        return;
      }
      if (request !== playbackRequest) return;
    }
    watch.disabled = false;
    if (document.hidden || !inView) {
      watch.textContent = 'Watch the Tool Actions';
      return;
    }
    stopDemo(); selectStep(2);
    visualization.hidden = false; viewport.hidden = true; skip.hidden = false;
    status.textContent = 'Illustration using the original file and notebook text. Each actual tool action saved a complete result at once.';
    if (motion.matches) {
      // Honor reduced motion with complete, manually advanced stages.
      if (phase === 'note') { finishIllustration(true); return; }
      elapsed = phase === 'file' ? 8000 : 5900;
      renderIllustration();
      watch.textContent = phase === 'file' ? 'Show the Notebook Entry' : 'Show the Result';
      return;
    }
    const start = performance.now() - elapsed;
    watch.textContent = 'Pause Playback';
    renderIllustration();
    timer = setInterval(() => {
      elapsed = performance.now() - start;
      if (elapsed >= 8500) { finishIllustration(true); return; }
      renderIllustration();
    }, 90);
  });
  skip.addEventListener('click', () => { finishIllustration(true); watch.focus({preventScroll: true}); });
  motion.addEventListener('change', pauseIllustration);
  function stopDemo(message = 'Demo stopped. Play again to start a fresh throw.') {
    if (!frame) return;
    frame.remove(); frame = null;
    overlay.hidden = false;
    stop.disabled = reset.disabled = true;
    play.textContent = 'Play Again';
    status.textContent = message;
  }
  function startDemo() {
    finishIllustration(false);
    frame?.remove();
    frame = document.createElement('iframe');
    frame.title = 'Red Ball Physics — drag and throw the ball';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.src = new URL('./demos/red-ball.html', import.meta.url).href;
    viewport.prepend(frame);
    overlay.hidden = true;
    stop.disabled = reset.disabled = false;
    status.textContent = 'Grab the red ball and drag or flick it. Stop Demo ends the animation; Reset Demo starts it over.';
    // Move keyboard focus outside the now-hidden play overlay.
    stop.focus({preventScroll: true});
  }
  play.addEventListener('click', startDemo);
  reset.addEventListener('click', startDemo);
  stop.addEventListener('click', () => { stopDemo(); play.focus({preventScroll: true}); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseIllustration(); stopDemo('Demo stopped while this tab was hidden. Play again when you’re ready.'); }
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      if (!inView) {
        pauseIllustration();
        stopDemo('Demo stopped while you read. Play again when you’re ready.');
      }
    }).observe(example.querySelector('.run-window'));
  }
}
