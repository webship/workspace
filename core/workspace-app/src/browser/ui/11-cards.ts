// The rows and the cards arrive in fragments, so the marking is redone after every swap.
markCurrentViews();
document.addEventListener('htmx:after:settle', markCurrentViews);

/* ---------------- how the assistant is shown ---------------------------- */

// Four views, one switch, after the pattern Drupal's own AI assistant uses: a toggle in the top
// toolbar, and a menu in the panel's header holding the rest. Sidebar is the column it has always
// been, Wide is that column doubled for a long answer, Floating is a launcher with the panel over
// the page, and Full page is /assistant.
//
// The state lives on <html> (data-assistant-view, .assistant-closed) and is applied by the
// pre-paint script in the head, not from here: the panel is 25rem of the layout, so deciding it in
// this deferred file would draw the page one way and reflow it a frame later. This file only
// CHANGES it. localStorage, like the theme and the rail — and with the same known limit, that it
// does not cross the workspace subdomains.
const ASSISTANT_VIEWS: (string | undefined)[] = ['sidebar', 'wide', 'float', 'full'];

function assistantView(): string {
  const v = document.documentElement.dataset.assistantView;
  return ASSISTANT_VIEWS.includes(v) ? v! : 'sidebar';
}

function setAssistantView(view: string | undefined) {
  if (!ASSISTANT_VIEWS.includes(view)) return;
  // Full page is a place, not a layout: switching to it goes there, and the panel on the page you
  // came from would be a second copy of the same conversation.
  if (view === 'full') {
    wsPrefSet('ws-assistant-view', view);
    window.location.href = '/assistant';
    return;
  }
  document.documentElement.dataset.assistantView = view;
  setAssistantOpen(true);
  document.dispatchEvent(new CustomEvent('assistant-view-changed'));
  wsPrefSet('ws-assistant-view', view!);
  // Leaving the full-page view has to leave the page too: /assistant has no panel to become a
  // sidebar. Back where you came from, or home when that was somewhere else.
  if (window.location.pathname === '/assistant') {
    const from = document.referrer && new URL(document.referrer, window.location.origin);
    window.location.href = from && from.origin === window.location.origin && from.pathname !== '/assistant'
      ? from.href : '/';
  }
}

// The launcher hides itself as the panel opens, so focus fell to the page: it goes to the prompt, or to
// the panel while the prompt is still being built.
function focusAssistantPrompt() {
  requestAnimationFrame(() => {
    const chat = document.getElementById('ws-deep-chat');
    const input = chat && chat.shadowRoot && chat.shadowRoot.querySelector<HTMLElement>('#text-input');
    if (input) { input.focus(); return; }
    const panel = document.querySelector<HTMLElement>('.assistant-side .assistant-panel');
    if (panel) { if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1; panel.focus(); }
  });
}

function setAssistantOpen(open: boolean) {
  document.documentElement.classList.toggle('assistant-closed', !open);
  const row = document.querySelector('.actions-assistant');
  if (row) row.setAttribute('aria-expanded', open ? 'true' : 'false');
  wsPrefSet('ws-assistant-open', open ? '1' : '0');
}

document.addEventListener('click', (e) => {
  // Show it. In the full-page view there is no panel to show — the assistant IS a page there — so this
  // is the way to it; on that page it is already in front of you and there is nothing to do.
  if ((e.target as Element).closest('.assistant-open-pick')) {
    e.preventDefault();
    if (window.location.pathname === '/assistant') return;
    if (assistantView() === 'full') { window.location.href = '/assistant'; return; }
    setAssistantOpen(true);
    return;
  }
  // Wider, and back again — one button, because it is one question: how much room does this answer
  // need? Floating has its own size, so there it is the sidebar it widens back into.
  if ((e.target as Element).closest('.assistant-wider')) {
    e.preventDefault();
    setAssistantView(assistantView() === 'wide' ? 'sidebar' : 'wide');
    return;
  }
  const pick = (e.target as Element).closest<HTMLElement>('.assistant-view-pick');
  if (pick) { e.preventDefault(); setAssistantView(pick.dataset.view); return; }
  if ((e.target as Element).closest('.assistant-hide, .assistant-close-pick')) { e.preventDefault(); setAssistantOpen(false); return; }
  // The launcher in the corner: the way back in, in every view. In the full-page view there is no
  // panel to show, so it leads to the page instead.
  if ((e.target as Element).closest('.assistant-launcher')) {
    e.preventDefault();
    if (assistantView() === 'full') { window.location.href = '/assistant'; return; }
    setAssistantOpen(true);
    focusAssistantPrompt();
  }
}, true);

document.addEventListener('click', (e) => {
  // A pick closes the menu it was made in — a dropdown left open over the panel it just changed reads
  // as a control that did not take.
  if ((e.target as Element).closest('.assistant-dropdown a') && window.UIkit) {
    const dd = (e.target as Element).closest('.uk-dropdown');
    if (dd) window.UIkit.dropdown(dd).hide(false);
  }
});

