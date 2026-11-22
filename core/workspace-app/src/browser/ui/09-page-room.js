// Starting a new conversation redraws the panel: deep-chat holds the transcript it was given, and
// emptying it is not something the component exposes — the page it is on is what carries it.
document.body.addEventListener('chat-cleared', () => { window.location.reload(); });

/* ---------------- how much room a page's content gets ------------------- */

// The pages were capped at UIKit's small container whatever room they had, which was right when the
// assistant was a fixed column and the rail was another: 900px was what was left. Neither is fixed any
// more, so the cap is a choice — and it is the content that most wants the width (a command catalog, a
// settings file, a terminal) that was capped hardest.
//
// Applied by the pre-paint script, like the assistant's view: this is the width of the main column, and
// changing it after the page is drawn moves everything on it.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.page-width-pick');
  if (!pick) return;
  e.preventDefault();
  const width = pick.dataset.width;
  if (!['comfortable', 'wide', 'full'].includes(width)) return;
  document.documentElement.dataset.pageWidth = width;
  wsPrefSet('ws-page-width', width);
  markCurrentViews();
});

// Comfortable or compact project rows. The same buttons; compact folds the caption under each one away, and
// shows it on hover instead. Applied before first paint, like the width.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.density-pick');
  if (!pick) return;
  e.preventDefault();
  const density = pick.dataset.density === 'compact' ? 'compact' : 'comfortable';
  document.documentElement.dataset.density = density;
  wsPrefSet('ws-density', density);
  markCurrentViews();
});

document.addEventListener('click', (e) => {
  const pick = e.target.closest('.tool-labels-pick');
  if (!pick) return;
  e.preventDefault();
  const mode = pick.dataset.toolLabels === 'words' ? 'words' : 'icons';
  document.documentElement.dataset.toolLabels = mode;
  wsPrefSet('ws-tool-labels', mode);
  markCurrentViews();
});

// The caption of a button is also its tooltip, so folding it away loses nothing for a pointer.
function syncRowCaptions(root) {
  for (const wrap of (root && typeof root.querySelectorAll === 'function' ? root : document).querySelectorAll('.act-with-status')) {
    const cap = wrap.querySelector('.act-status');
    const btn = wrap.querySelector('button');
    if (!cap || !btn) continue;
    const text = cap.textContent.trim();
    if (text && !(btn.title || '').includes(text)) btn.title = btn.title ? `${btn.title} · ${text}` : text;
  }
}
document.addEventListener('DOMContentLoaded', () => syncRowCaptions());
document.body.addEventListener('htmx:after:swap', (e) => syncRowCaptions(swappedEl(e)));

// The tab says when a session has stopped to ask something, so it is visible from any other tab (Vercel does
// the same for a build). Only "waiting" goes in the title: a count of detached sessions would be noise, and the
// page's own title is kept as it was.
const BASE_TITLE = document.title;
function syncTitleState() {
  const w = document.querySelector('.screens-count .screens-waiting');
  if (!w) { document.title = BASE_TITLE; return; }
  const n = parseInt(w.textContent.replace(/[^0-9]/g, ''), 10) || 1;
  document.title = `✋ ${n} waiting · ${BASE_TITLE}`;
}
document.body.addEventListener('htmx:after:swap', (e) => {
  const t = swappedEl(e);
  if (t && t.classList && (t.classList.contains('screens-count') || (t.closest && t.closest('.screens-count')))) syncTitleState();
});
// Watching the badge itself is sturdier than waiting for htmx's own event: it does not matter who rewrote it.
const screensCountEl = document.querySelector('.screens-count');
if (screensCountEl) new MutationObserver(syncTitleState).observe(screensCountEl, { childList: true, subtree: true, characterData: true });
// The first count usually arrives before this script has run, so look once now.
syncTitleState();

