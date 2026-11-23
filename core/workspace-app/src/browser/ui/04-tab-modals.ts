// Tabbed modals (tab-modal.mts renders the markup). A tab is a button that loads its fragment into the
// pane; this keeps the one you are on marked, moves between tabs with the arrow keys, filters a long
// list, keeps #<modal>/<tab> in the address for a modal that asks for it, and sends the links inside a
// pane back into the pane rather than away from the page.
/** A tab modal: the element, and the timer of its "Loading…" status. */
type TabModal = HTMLElement & { _statusTimer?: ReturnType<typeof setTimeout> };
/** What htmx 4 tells of a tab's request in an event's detail (detail.ctx), as far as the tab modals read it. */
interface TabRequestCtx { target?: Element; sourceElement?: Element; status?: string }

(function tabModals() {
  const hashOf = (tm: HTMLElement) => tm.hasAttribute('data-hash') ? tm.dataset.tabmodal : '';
  const select = (tm: HTMLElement, tab: HTMLElement) => {
    tm.querySelectorAll<HTMLElement>('.tabmodal-tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-selected', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    const head = tm.querySelector('.tabmodal-heading');
    const sub = tm.querySelector('.tabmodal-sub');
    if (head) head.textContent = tab.dataset.label || '';
    if (sub) sub.textContent = tab.dataset.hint || '';
    // The phone's fold button says the tab you are on, with its icon (#669).
    const toggle = tm.querySelector('.tabmodal-toggle');
    if (toggle) {
      const label = toggle.querySelector('.tabmodal-toggle-label');
      if (label) label.textContent = tab.dataset.label || '';
      const icon = tab.querySelector('svg, .tabler-icon');
      const was = toggle.firstElementChild;
      if (icon && was && was !== label) was.replaceWith(icon.cloneNode(true));
    }
    const pane = tm.querySelector('.tabmodal-pane');
    if (pane) pane.setAttribute('aria-labelledby', tab.id);
    const h = hashOf(tm);
    if (h) { try { history.replaceState(null, '', `#${h}/${encodeURIComponent(tab.dataset.tab!)}`); } catch (_) { /* a sandboxed frame */ } }
  };

  // While a tab loads, its pane says so and shows nothing of the tab before it. The heading changes the
  // moment a tab is chosen, and a slow tab (a plugin page that looks for a command takes two seconds) left
  // the last tab's content under the new name until its own arrived. Busy is said at once, to a screen
  // reader; the words show after a moment (tab-modal.css), so a tab that answers at once does not flash.
  const busy = (tm: TabModal, label?: string) => {
    const pane = tm && tm.querySelector('.tabmodal-pane');
    if (!pane) return;
    pane.setAttribute('aria-busy', 'true');
    let note = pane.querySelector(':scope > .tabmodal-wait');
    if (!note) {
      note = document.createElement('p');
      note.className = 'tabmodal-wait';
      // Last, though it is drawn at the top (tab-modal.css): first, it made the old first child a second one,
      // and UIkit's "* + …" margins moved the old content 20px down before it hid.
      pane.append(note);
    }
    note.textContent = `Loading ${label || 'this tab'}…`;
    // Said to a screen reader too, after the same moment the line waits for (aria-busy alone says nothing).
    tm.dataset.chosen = '1';
    const status = tm.querySelector('.tabmodal-status');
    clearTimeout(tm._statusTimer);
    if (status) {
      status.textContent = '';
      tm._statusTimer = setTimeout(() => { if (pane.getAttribute('aria-busy') === 'true') status.textContent = note.textContent; }, 180);
    }
  };
  // The answer of a tab that is no longer the chosen one never lands under the chosen one's name. The tabs
  // share one queue (hx-sync on the tablist, tab-modal.mts), so a new choice replaces the request in flight;
  // and an answer that still arrives for a tab left behind is refused here. A command a plugin page looks
  // for can take three seconds while the next tab answers in a fraction of one: that slow answer replaced
  // the tab chosen after it. The modal's first load gives way to a tab chosen before it answered.
  // On document, not body: htmx dispatches on document when the element that asked has left the page (the
  // first load's placeholder, once another tab's content replaced it), and reads it from ctx.sourceElement.
  document.addEventListener('htmx:before:swap', (e) => {
    const ctx: TabRequestCtx = ((e as CustomEvent<{ ctx?: TabRequestCtx } | null>).detail || {}).ctx || {};
    const pane = ctx.target;
    if (!pane || !pane.classList || !pane.classList.contains('tabmodal-pane')) return;
    const src = ctx.sourceElement || (e.target as Element);
    const tab = src && src.closest && src.closest('.tabmodal-tab');
    const first = src && src.classList && src.classList.contains('tabmodal-loading');
    const tm = pane.closest<HTMLElement>('.tabmodal');
    if ((tab && tab.getAttribute('aria-selected') !== 'true') || (first && tm && tm.dataset.chosen === '1')) e.preventDefault();
  });
  document.body.addEventListener('htmx:after:swap', (e) => {
    const t = swappedEl(e);
    if (t && t.classList && t.classList.contains('tabmodal-pane')) {
      t.removeAttribute('aria-busy');
      const tm = t.closest<TabModal>('.tabmodal');
      const status = tm && tm.querySelector('.tabmodal-status');
      if (tm) clearTimeout(tm._statusTimer);
      if (status) status.textContent = '';
    }
  });
  // No answer at all (the dashboard is down, the connection dropped): say so in the pane, rather than
  // leave the last tab under this one's name. A request given up because another tab was chosen is not
  // this tab's failure, so only the selected tab's own request speaks.
  document.addEventListener('htmx:error', (e) => {
    const pane = swappedEl(e);
    if (!pane || !pane.classList || !pane.classList.contains('tabmodal-pane') || pane.getAttribute('aria-busy') !== 'true') return;
    const from = e.target && (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.tabmodal-tab');
    if (from && from.getAttribute('aria-selected') !== 'true') return;
    pane.removeAttribute('aria-busy');
    const head = pane.closest('.tabmodal') && pane.closest('.tabmodal')!.querySelector('.tabmodal-heading');
    const msg = document.createElement('div');
    msg.className = 'msg error';
    msg.setAttribute('role', 'alert');
    const words = document.createElement('p');
    words.textContent = `${(head && head.textContent) || 'This tab'} could not be loaded: the dashboard did not answer.`;
    // A way out on the spot: the same tab, asked again.
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'uk-button uk-button-default uk-button-small tabmodal-retry';
    again.textContent = 'Try again';
    const asked = from || (pane.closest('.tabmodal') && pane.closest('.tabmodal')!.querySelector<HTMLElement>('.tabmodal-tab.is-selected'));
    again.addEventListener('click', () => { if (asked) asked.click(); });
    msg.append(words, again);
    pane.replaceChildren(msg);
    again.focus();
  });

  // An answer with nothing to swap in (a 204) leaves the pane as it was: it is not left busy, and blank.
  document.addEventListener('htmx:finally:request', (e) => {
    const ctx: TabRequestCtx = ((e as CustomEvent<{ ctx?: TabRequestCtx } | null>).detail || {}).ctx || {};
    const pane = ctx.target;
    if (!pane || !pane.classList || !pane.classList.contains('tabmodal-pane') || pane.getAttribute('aria-busy') !== 'true') return;
    if (ctx.status === 'swapped' || String(ctx.status || '').startsWith('error')) return;
    const from = e.target && (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.tabmodal-tab');
    if (from && from.getAttribute('aria-selected') !== 'true') return;
    pane.removeAttribute('aria-busy');
    const note = pane.querySelector(':scope > .tabmodal-wait');
    if (note) note.remove();
  });

  // On a phone the list folds behind a button that says the tab you are on (#669). It is shown only below
  // 640px; where it is hidden, the list is always there and none of this does anything.
  const folds = (tm: HTMLElement | null) => { const t = tm && tm.querySelector<HTMLElement>('.tabmodal-toggle'); return t && t.offsetParent ? t : null; };
  const fold = (tm: HTMLElement, open: boolean, focus: HTMLElement | null) => {
    const t = tm.querySelector('.tabmodal-toggle');
    tm.classList.toggle('is-open', open);
    if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (focus) focus.focus();
  };

  document.addEventListener('click', (e) => {
    const toggle = (e.target as Element).closest && (e.target as Element).closest('.tabmodal-toggle');
    if (toggle) {
      const tm = toggle.closest<HTMLElement>('.tabmodal')!;
      const open = !tm.classList.contains('is-open');
      fold(tm, open, open ? (tm.querySelector<HTMLElement>('.tabmodal-tab[aria-selected="true"]') || tm.querySelector<HTMLElement>('.tabmodal-filter')) : null);
      return;
    }
    const tab = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.tabmodal-tab');
    if (tab) {
      const tm = tab.closest<TabModal>('.tabmodal')!;
      select(tm, tab);
      busy(tm, tab.dataset.label);
      // Chosen on a phone: the list folds again and focus goes back to the button, which now says the tab.
      const t = folds(tm);
      if (t) fold(tm, false, t);
      return;
    }

    // A link in a pane that points at another page of the same section loads into the pane.
    const a = (e.target as Element).closest && (e.target as Element).closest<HTMLAnchorElement>('.tabmodal-pane a[href^="/settings"]');
    if (a && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0
        && a.target !== '_blank' && window.htmx) {
      const tm = a.closest<TabModal>('.tabmodal')!;
      e.preventDefault();
      const u = new URL(a.getAttribute('href')!, location.origin);
      u.searchParams.set('fragment', '1');
      window.htmx.ajax('GET', u.pathname + u.search, { target: a.closest('.tabmodal-pane')!, swap: 'innerHTML' });
      const seg = decodeURIComponent(u.pathname.replace(/^\/settings\/?/, ''));
      const want = seg === '' ? 'overview' : seg;
      const tab2 = [...tm.querySelectorAll<HTMLElement>('.tabmodal-tab')].find((t) => t.dataset.tab === want);
      if (tab2) select(tm, tab2);
      busy(tm, tab2 ? tab2.dataset.label : a.textContent.trim());
      return;
    }

    // The rail's tile for a place that also exists as a modal: open it over the page you are on.
    const opener = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('[data-tabmodal-open]');
    if (opener && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && window.htmx) {
      e.preventDefault();
      window.htmx.ajax('GET', opener.dataset.tabmodalOpen!, { target: '#editor-modal-body', swap: 'innerHTML' });
    }
  });

  document.addEventListener('keydown', (e) => {
    const tab = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.tabmodal-tab');
    if (!tab || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tab.closest('.tabmodal')!.querySelectorAll<HTMLElement>('.tabmodal-tab')].filter((t) => !t.hidden && t.offsetParent);
    const i = tabs.indexOf(tab);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1]
      : tabs[Math.min(tabs.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus(); }
  });

  // Escape in the open fold, on a phone, folds the list and goes back to its button before it would close the
  // modal (the capture phase, ahead of the modal's own Escape). A filter with text in it is emptied first (below).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const tm = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.tabmodal.is-open');
    const t = tm && folds(tm);
    if (!t || !(e.target as Element).closest('.tabmodal-list')) return;
    const box = (e.target as Element).closest<HTMLInputElement>('.tabmodal-filter');
    if (box && box.value) return;
    e.preventDefault();
    e.stopPropagation();
    fold(tm!, false, t);
  }, true);

  // In the filter box: Down goes to the first tab shown, and Escape empties the box before it closes the modal
  // (in the capture phase, ahead of the modal's own Escape), as the other filters do.
  document.addEventListener('keydown', (e) => {
    const box = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('.tabmodal-filter');
    if (!box) return;
    if (e.key === 'ArrowDown') {
      const first = [...box.closest('.tabmodal')!.querySelectorAll<HTMLElement>('.tabmodal-tab')].find((t) => !t.hidden);
      if (first) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Escape' && box.value) {
      e.preventDefault();
      e.stopPropagation();
      box.value = '';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  document.addEventListener('input', (e) => {
    const box = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('.tabmodal-filter');
    if (!box) return;
    const q = box.value.trim().toLowerCase();
    const tm = box.closest('.tabmodal')!;
    tm.querySelectorAll<HTMLElement>('.tabmodal-tab').forEach((t) => {
      t.hidden = !!q && !(t.dataset.label || '').toLowerCase().includes(q);
    });
    tm.querySelectorAll<HTMLElement>('.tabmodal-group').forEach((g) => {
      g.hidden = ![...g.querySelectorAll<HTMLElement>('.tabmodal-tab')].some((t) => !t.hidden);
    });
    // The one tab in the Tab order (the list's roving tabindex) is one that is shown: the chosen tab, or the
    // first match while the filter hides it. It was left on a hidden tab, and what matched could not be
    // reached from the keyboard at all.
    const tabs = [...tm.querySelectorAll<HTMLElement>('.tabmodal-tab')];
    const chosen = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    const stop = chosen && !chosen.hidden ? chosen : tabs.find((t) => !t.hidden);
    tabs.forEach((t) => { t.tabIndex = t === stop ? 0 : -1; });
    // Said in words, and to a screen reader: how many are left, or that nothing matches (a blank column reads as a fault).
    const status = tm.querySelector<HTMLElement>('.tabmodal-filter-status');
    if (status) {
      const shown = [...tm.querySelectorAll<HTMLElement>('.tabmodal-tab')].filter((t) => !t.hidden).length;
      status.textContent = !q ? '' : shown ? `${shown} of ${status.dataset.total} shown.` : 'Nothing matches.';
    }
  });

  // A link to a place: #settings/<tab> opens the modal on that tab, from any page.
  // The tab you are on may be far down a long list: bring it into view when the modal opens.
  document.body.addEventListener('htmx:after:swap', (e) => {
    const t = e.target && (e.target as Element).id === 'editor-modal-body' && (e.target as Element).querySelector('.tabmodal-tab.is-selected');
    if (t) t.scrollIntoView({ block: 'nearest' });
  });

  const openFromHash = () => {
    const m = location.hash.match(/^#(settings)\/([^/]+)$/);
    if (m && window.htmx) {
      window.htmx.ajax('GET', `/fragments/settings/modal?tab=${m[2]}`, { target: '#editor-modal-body', swap: 'innerHTML' });
    }
  };
  window.addEventListener('hashchange', openFromHash);
  window.addEventListener('load', openFromHash);
  document.addEventListener('hidden', (e) => {
    if (e.target && (e.target as Element).id === 'editor-modal' && /^#settings\//.test(location.hash)) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* nothing to clear */ }
    }
  }, true);
})();

