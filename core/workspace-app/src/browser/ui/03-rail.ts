// The actions rail. Collapsed state is remembered, like the theme, because it is
// a layout preference and having it reset on every navigation would be noise.
function applyActionsCollapsed(collapsed: boolean) {
  document.documentElement.classList.toggle('actions-collapsed', collapsed);
  const toggle = document.querySelector<HTMLElement>('.actions-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Expand the actions rail' : 'Collapse the actions rail';
  }
}

// Where the assistant beside the page leaves the content no room for the expanded rail too (a laptop), the
// rail opens OVER the content instead of squeezing it: at 1024 with the assistant open, the Dev page's
// build form was cut to a 281px card. The rail CSS keeps the content at the collapsed rail's width there,
// the head script starts the rail collapsed there, and here it opens only when asked and closes on a click
// outside it or on Escape. Opening it there is not remembered: the remembered choice is for a window with
// room. The widths are the rail CSS's (the assistant's 25rem, or the wide view's 45rem, beside 15.5rem of
// rail and 44rem of content).
function railTight() {
  const d = document.documentElement;
  if (d.classList.contains('assistant-closed') || !window.matchMedia) return false;
  const v = d.dataset.assistantView;
  const q = v === 'sidebar' ? '(min-width: 60em) and (max-width: 84.4375em)'
    : v === 'wide' ? '(min-width: 60em) and (max-width: 104.4375em)' : '';
  return !!q && window.matchMedia(q).matches;
}

// Collapsed is the default: the rail is on every page now, and the content — a
// project table, a diff, a job's output — wants the width more than the labels do.
// Only an explicit '0' (the user expanded it) keeps it open, where there is room for it.
try {
  applyActionsCollapsed(wsPref('actions-collapsed', '1') !== '0' || railTight());
} catch (_) { applyActionsCollapsed(true); }

document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.actions-toggle')) return;
  const collapsed = !document.documentElement.classList.contains('actions-collapsed');
  applyActionsCollapsed(collapsed);
  if (!railTight()) wsPrefSet('actions-collapsed', collapsed ? '1' : '0');
});
// Open over the content, the rail closes on a click outside it (a menu or a modal it opened is not
// outside), and on Escape, with focus back on its toggle when it was in the rail.
document.addEventListener('click', (e) => {
  if (!railTight() || document.documentElement.classList.contains('actions-collapsed')) return;
  if ((e.target as Element).closest && (e.target as Element).closest('.actions-side, .uk-dropdown, .uk-modal, #rail-tip')) return;
  applyActionsCollapsed(true);
});
// And when keyboard focus moves out of it: Tab past its last tile went on into the page underneath it, and
// what took focus there (Dev's Build at 1024) was hidden under the open rail (WCAG 2.4.11).
document.addEventListener('focusin', (e) => {
  if (!railTight() || document.documentElement.classList.contains('actions-collapsed')) return;
  if ((e.target as Element).closest && (e.target as Element).closest('.actions-side, .uk-dropdown, .uk-modal, #rail-tip')) return;
  applyActionsCollapsed(true);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !railTight() || document.documentElement.classList.contains('actions-collapsed')) return;
  if (document.querySelector('.uk-modal.uk-open, .uk-dropdown.uk-open')) return;
  const inRail = document.activeElement && document.activeElement.closest && document.activeElement.closest('.actions-side');
  applyActionsCollapsed(true);
  const toggle = inRail && document.querySelector<HTMLElement>('.actions-toggle');
  if (toggle) toggle.focus();
});

// The rail's names and its tooltip. Collapsed, a tile is a glyph: its name has to be there for a screen
// reader (aria-label, the visible label) and for the eye (a tooltip, at once and on keyboard focus — the
// native title waits about a second and never shows on focus). The sentence the title held moves to
// aria-description and the tooltip, so nothing is lost and nothing shows twice.
(function railTips() {
  const rail = document.getElementById('actions-rail');
  if (!rail) return;
  rail.querySelectorAll<HTMLElement>('a.action-btn, button.action-btn').forEach((el) => {
    if (el.classList.contains('actions-version')) return;
    const label = el.querySelector('.action-label')?.textContent;
    if (!label || !label.trim()) return;
    const name = label.replace(/\s+/g, ' ').trim();
    const hint = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    el.dataset.tipLabel = name;
    el.dataset.tipGroup = el.closest<HTMLElement>('.actions-group')?.dataset.group || '';
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', name);
    if (hint && hint !== name) {
      el.dataset.tipHint = hint;
      el.setAttribute('aria-description', hint);
    }
    el.removeAttribute('title');
  });

  let tip: HTMLElement | null = null;
  let shownFor: Element | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => { clearTimeout(hideTimer); if (tip) tip.hidden = true; shownFor = null; };
  // The pointer can move onto the tooltip and stay there to read it (WCAG 1.4.13, hoverable): leaving a tile
  // or the tooltip hides it after a moment, and coming onto either of them keeps it.
  const later = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 150); };
  const keep = () => clearTimeout(hideTimer);
  const onTip = (n: Element | null) => !!(n && n.closest && n.closest('#rail-tip'));
  const show = (el: HTMLElement) => {
    if (window.innerWidth < 960 || !el.dataset.tipLabel) return;
    const collapsed = document.documentElement.classList.contains('actions-collapsed');
    const head = collapsed ? el.dataset.tipLabel : '';
    const hint = el.dataset.tipHint || '';
    if (!head && !hint) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'rail-tip';
      tip.setAttribute('role', 'tooltip');
      tip.addEventListener('mouseenter', keep);
      tip.addEventListener('mouseleave', (e) => { if (!tile({ target: e.relatedTarget })) later(); });
      document.body.appendChild(tip);
    }
    tip.textContent = '';
    if (head) { const b = document.createElement('strong'); b.textContent = head; tip.appendChild(b); }
    if (hint) { const s = document.createElement('span'); s.textContent = hint; tip.appendChild(s); }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    tip.style.right = `${Math.round(window.innerWidth - r.left + 10)}px`;
    tip.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - t.height - 8, r.top + r.height / 2 - t.height / 2)))}px`;
    shownFor = el;
  };
  const tile = (e: { target: EventTarget | null }) => e.target && (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('#actions-rail a.action-btn, #actions-rail button.action-btn');
  rail.addEventListener('mouseover', (e) => { const el = tile(e); if (!el) return; keep(); if (el !== shownFor) show(el); });
  rail.addEventListener('mouseout', (e) => { if (tile(e) && !onTip(e.relatedTarget as Element | null)) later(); });
  rail.addEventListener('focusin', (e) => { const el = tile(e); if (el) show(el); });
  rail.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  rail.addEventListener('scroll', hide, { passive: true });

  // Whether there is more rail below the fold, so Go and Help are not simply cut off: a fade at the foot
  // while there is, and none once the end is in view.
  const fade = () => {
    const more = rail.scrollHeight - rail.clientHeight - rail.scrollTop > 4;
    rail.classList.toggle('can-scroll', more);
  };
  rail.addEventListener('scroll', fade, { passive: true });
  window.addEventListener('resize', fade);
  document.addEventListener('click', (e) => { if ((e.target as Element).closest('.actions-toggle')) setTimeout(fade, 250); });
  fade();
})();

