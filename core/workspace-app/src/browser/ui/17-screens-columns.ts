// The Screens page: how many sessions across.
//
// One under another by DEFAULT, and that is the point of the default rather than an accident of CSS: a
// session row carries its name, its state, its log path and five verbs, and two of those side by side
// on a 1400px screen leaves each narrower than the buttons it holds. Two and three across are for a
// machine with a dozen sessions, where the question is "which of these is waiting" rather than "what
// does this one say".
//
// Re-applied after every swap because the list refreshes itself every 20 seconds — a class set once
// would last exactly one poll. Kept per browser, like the theme and the page width.
(function screensColumns() {
  const KEY = 'ws-screens-cols';
  const read = (): string => {
    try { const v = localStorage.getItem(KEY) || ''; return ['1', '2', '3'].includes(v) ? v : '1'; }
    catch (_) { return '1'; }
  };
  function apply() {
    const list = document.querySelector<HTMLElement>('.screens-list');
    // The modal only wears the count while it is actually holding the list: it is the one modal in the
    // dashboard, and an editor opened after the screens would otherwise inherit a width chosen for
    // three columns of session cards.
    const modal = document.getElementById('editor-modal');
    if (modal) {
      if (modal.contains(list)) modal.dataset.screensCols = read();
      else delete modal.dataset.screensCols;
    }
    if (!list) return;
    const cols = read();
    list.dataset.cols = cols;
    // The buttons only: the modal itself carries data-screens-cols for its width, and as a match it was
    // being given the primary button's class, which painted the whole overlay brand blue.
    document.querySelectorAll<HTMLButtonElement>('button[data-screens-cols]').forEach((b) => {
      const on = b.dataset.screensCols === cols;
      b.classList.toggle('uk-button-primary', on);
      b.classList.toggle('uk-button-default', !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.addEventListener('click', (e) => {
    // The count buttons only. The modal wears data-screens-cols too (for its width): matched here, every
    // click inside the Screens modal was cancelled, and a link in it — "the Screens page" — went nowhere.
    const btn = (e.target as Element).closest<HTMLButtonElement>('button[data-screens-cols]');
    if (!btn) return;
    e.preventDefault();
    try { localStorage.setItem(KEY, btn.dataset.screensCols || '1'); } catch (_) { /* private window */ }
    apply();
  });
  document.addEventListener('DOMContentLoaded', apply);
  document.body.addEventListener('htmx:after:swap', apply);
  apply();
})();

