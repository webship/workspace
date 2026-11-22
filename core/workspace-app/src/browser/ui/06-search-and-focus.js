// A list's search box sits inside the region its own results replace, so every search threw the box
// away: focus fell to the page and whatever was typed while the request ran was lost. The field being
// typed in is remembered before a swap and given back after it, with its value and caret; if more was
// typed than was searched, the search runs again.
(function keepTypingThroughSwaps() {
  let kept = null;
  document.body.addEventListener('htmx:before:swap', (e) => {
    const a = document.activeElement;
    const ctx = (e.detail && e.detail.ctx) || {};
    const target = ctx.target || (e.detail && e.detail.target) || e.target;
    const into = target && target.nodeType === 1 ? target : null;
    if (!a || !into || !into.contains(a) || !a.matches('input[name], textarea[name]')) { kept = null; return; }
    kept = { name: a.name, value: a.value, start: a.selectionStart, end: a.selectionEnd, target: into };
  });
  document.body.addEventListener('htmx:after:swap', () => {
    if (!kept) return;
    const k = kept; kept = null;
    const field = k.target.querySelector(`[name="${CSS.escape(k.name)}"]`);
    if (!field) return;
    const searched = field.value;
    if (field.value !== k.value) field.value = k.value;
    field.focus({ preventScroll: true });
    try { field.setSelectionRange(k.start, k.end); } catch (_) { /* not a text field */ }
    if (searched !== k.value) field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  });
})();

// The project list is drawn again when a modal closes (refresh-projects) and when a row changes, and the
// button that had focus goes with the old markup: a row's SCREENS button got focus back from the modal it
// opened, and lost it a moment later to <body> when the list was redrawn under it. The control is
// remembered by its row (the title the card is named by) and its place in that row — its menu's slot, or
// its order among the row's controls — and given back in the new markup.
(function keepRowFocusThroughRedraws() {
  let kept = null;
  const controls = (row) => [...row.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.closest('.uk-dropdown'));
  // A project card by its title; an item row (a doc, an agent, a skill…) by its machine name, which it has
  // instead — without it, closing a doc's editor gave focus back to Edit and the redraw took it away.
  const nameOf = (row) => {
    const t = row.querySelector('.pcard-title');
    if (t) return t.getAttribute('title') || t.textContent.trim();
    const m = row.querySelector('.item-machine');
    return m ? `item:${m.textContent.trim()}` : '';
  };
  document.body.addEventListener('htmx:before:swap', (e) => {
    kept = null;
    const a = document.activeElement;
    const ctx = (e.detail && e.detail.ctx) || {};
    const target = ctx.target || (e.detail && e.detail.target) || e.target;
    const into = target && target.nodeType === 1 ? target : null;
    if (!a || a === document.body || !into || !into.contains(a)) return;
    const row = a.closest('.project-row');
    if (!row || !nameOf(row) || a.matches('input[name], textarea[name]')) return;
    const menu = a.closest('.act-menu');
    const slot = menu ? [...menu.classList].find((c) => /^act-menu-(?!hosting$|container$|lazy$)/.test(c)) : '';
    kept = { name: nameOf(row), slot, index: controls(row).indexOf(a), target: into };
  });
  document.body.addEventListener('htmx:after:swap', () => {
    if (!kept) return;
    const k = kept; kept = null;
    if (document.activeElement && document.activeElement !== document.body && k.target.contains(document.activeElement)) return;
    const row = [...k.target.querySelectorAll('.project-row')].find((r) => nameOf(r) === k.name);
    if (!row) return;
    const inMenu = k.slot && row.querySelector(`.${CSS.escape(k.slot)} > button, .${CSS.escape(k.slot)} button`);
    const target = inMenu || (k.index >= 0 ? controls(row)[k.index] : null);
    if (target) target.focus({ preventScroll: true });
  });
})();

