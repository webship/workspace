// A list's quick filter: typing narrows the cards already on screen at once (each card says what it is
// in data-find), while the debounced request asks the server for the wider answer. The input names
// the list it filters in data-list-find (a selector); the server's reply then replaces the cards, so
// nothing the page did not have is ever hidden by this. Plugins' lists (Jira's workitems) use it too.
document.addEventListener('input', (e) => {
  const box = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('input[data-list-find]');
  if (!box) return;
  const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
  let host: Element | null = null;
  try { host = document.querySelector(box.dataset.listFind || ''); } catch (_) { /* not a selector */ }
  if (!host) return;
  const cards = [...host.querySelectorAll<HTMLElement>('[data-find]')];
  let shown = 0;
  cards.forEach((c) => {
    const hay = c.dataset.find || '';
    const on = words.every((w) => hay.includes(w));
    c.hidden = !on;
    if (on) shown += 1;
  });
  let note = host.querySelector<HTMLElement>('.list-find-note');
  if (!note) {
    note = document.createElement('p');
    note.className = 'list-find-note uk-text-meta';
    host.prepend(note);
  }
  note.textContent = words.length && cards.length ? `${shown} of ${cards.length} shown here, asking for more…` : '';
  note.hidden = !note.textContent;
});

// A project's row menus (DDEV, GIT, NODE, COMPOSER, UPSUN and the rest) can hold thirty or seventy entries.
// A long one folds its groups: the first group and "This project" stay open, the rest open on their
// heading; a heading that is a sentence stays a note. Every entry is one line, its full text the tooltip.
function foldDdevMenus(root?: ParentNode | null) {
  (root && typeof root.querySelectorAll === 'function' ? root : document).querySelectorAll<HTMLElement>('.act-menu .uk-dropdown:not([data-folded])').forEach((drop) => {
    const links = drop.querySelectorAll('li > a').length;
    if (!links) return;           // filled later by its own request, folded then
    drop.dataset.folded = '1';
    drop.querySelectorAll<HTMLAnchorElement>('li > a').forEach((a) => { if (!a.title) a.title = (a.textContent || '').replace(/\s+/g, ' ').trim(); });
    const rows = drop.querySelectorAll('li:not(.uk-nav-divider)').length;
    if (links < 8 && rows < 12) return;
    const heads = [...drop.querySelectorAll<HTMLElement>('.uk-dropdown-nav > .uk-nav-header')].filter((h) => (h.textContent || '').trim().length <= 40);
    let folds = 0;
    heads.forEach((h) => {
      const rows: HTMLElement[] = [];
      // A group ends at the next heading or divider; a short one is not worth a fold.
      for (let n = h.nextElementSibling as HTMLElement | null; n && !n.classList.contains('uk-nav-header') && !n.classList.contains('uk-nav-divider'); n = n.nextElementSibling as HTMLElement | null) rows.push(n);
      if (rows.length < 3) return;
      const open = (folds === 0 && rows.length <= 6) || /this project/i.test(h.textContent || '');
      folds += 1;
      h.setAttribute('role', 'button');
      h.tabIndex = 0;
      h.classList.add('ddev-fold');
      const set = (on: boolean) => { h.setAttribute('aria-expanded', on ? 'true' : 'false'); rows.forEach((r) => { r.hidden = !on; }); };
      set(open);
      h.addEventListener('click', (e) => { e.stopPropagation(); set(h.getAttribute('aria-expanded') !== 'true'); });
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.click(); } });
    });
  });
}
document.addEventListener('DOMContentLoaded', () => foldDdevMenus());
document.body.addEventListener('htmx:after:swap', (e) => {
  const el = swappedEl(e) as HTMLElement | null;
  // A menu whose body just arrived — a row menu loading as it opens, SCREENS on its poll — is the dropdown
  // itself, which the swap left in place with its fold mark while the folded rows went with the old body.
  // Marked unfolded again; folded now if it is open, else by `shown` when it opens.
  if (el && el.matches && el.matches('.act-menu .uk-dropdown')) {
    delete el.dataset.folded;
    if (el.classList.contains('uk-open')) foldDdevMenus(el.parentElement);
    return;
  }
  foldDdevMenus(el);
});
// A menu that opens upwards near the top would sit under the top bar; the page moves down to show it.
document.addEventListener('shown', (e) => {
  const d = e.target as HTMLElement | null;
  if (!d || !d.classList || !d.classList.contains('uk-dropdown') || !d.closest('.project-row')) return;
  foldDdevMenus(d.closest('.act-menu') || d.parentElement);
  const bar = document.querySelector('.toolbar, header');
  const limit = (bar ? bar.getBoundingClientRect().bottom : 64) + 8;
  const top = d.getBoundingClientRect().top;
  if (top < limit) window.scrollBy({ top: top - limit, behavior: 'instant' });
}, true);

