const header = document.querySelector('.site-header');
const toggle = document.querySelector('.nav-toggle');
const navigation = document.querySelector('#site-navigation');

if (header && toggle && navigation) {
  header.dataset.menuReady = '';
  toggle.hidden = false;
  const setOpen = open => {
    header.toggleAttribute('data-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) setOpen(false);
  });
  matchMedia('(max-width: 820px)').addEventListener('change', () => setOpen(false));
}

for (const button of document.querySelectorAll('[data-copy-target], #copy-install')) {
  button.addEventListener('click', async () => {
    const content = document.getElementById(button.dataset.copyTarget || 'install-code');
    const feedback = document.getElementById(button.dataset.copyFeedback || 'copy-feedback');
    if (!content || !feedback) return;
    try {
      await navigator.clipboard.writeText(content.textContent);
      feedback.textContent = button.dataset.copySuccess || 'Copied. Paste this into your terminal or coding agent.';
      button.textContent = 'Copied ✓';
    } catch {
      feedback.textContent = 'Clipboard access is unavailable. Select the text above and copy it manually.';
    }
  });
}
