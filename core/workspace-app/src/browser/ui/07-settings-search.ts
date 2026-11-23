// Settings home and the catalogue: one filter over the base tiles and every plugin row. Words narrow
// by text, the chips by state. The box is drawn hidden and shown here, so a page with no script
// offers no filter that does nothing. It is applied again when the plugins are drawn again.
function settingsSearchApply(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>('.settings-search');
  if (!box) return;
  box.hidden = false;
  const input = box.querySelector<HTMLInputElement>('input[type="search"]');
  const pressed = box.querySelector<HTMLElement>('.settings-chip[aria-pressed="true"]');
  const show = pressed ? pressed.dataset.show : 'all';
  const words = (input ? input.value : '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (el: HTMLElement) => words.every((w) => (el.dataset.find || el.textContent.toLowerCase()).includes(w));
  let rows = 0;
  let total = 0;
  root.querySelectorAll<HTMLElement>('.plugin-row').forEach((row) => {
    total += 1;
    const inState = show === 'all' || (show === 'attention' && row.dataset.attention === '1') || (show === 'updates' && row.dataset.update === '1')
      || (show === 'active' && row.dataset.active === '1') || (show === 'inactive' && row.dataset.active === '0');
    row.hidden = !(inState && matches(row));
    if (!row.hidden) rows += 1;
  });
  root.querySelectorAll<HTMLElement>('.settings-family').forEach((f) => {
    const shown = [...f.querySelectorAll<HTMLElement>('.plugin-row')].filter((r) => !r.hidden);
    f.hidden = !shown.length;
    f.querySelectorAll('.plugin-row.is-first-shown').forEach((r) => r.classList.remove('is-first-shown'));
    if (shown.length) shown[0].classList.add('is-first-shown');
    const count = f.querySelector<HTMLElement>('.settings-family-count');
    if (count) count.textContent = String(shown.length);
  });
  let tiles = 0;
  root.querySelectorAll<HTMLElement>('.settings-tile[data-find]').forEach((t) => {
    t.hidden = show !== 'all' || !matches(t);
    if (!t.hidden) tiles += 1;
  });
  root.querySelectorAll<HTMLElement>('.settings-base, .settings-loose').forEach((g) => { g.hidden = ![...g.querySelectorAll<HTMLElement>('.settings-tile')].some((t) => !t.hidden); });
  const plugins = root.querySelector<HTMLElement>('.settings-plugins');
  if (plugins) {
    // The chips count what is on the page now, after a step has run.
    box.querySelectorAll<HTMLElement>('[data-count]').forEach((c) => { const v = plugins.dataset[`count${c.dataset.count![0]!.toUpperCase()}${c.dataset.count!.slice(1)}`]; if (v !== undefined) c.textContent = v; });
    // Updates has a chip of its own, shown once npm has answered and there is one: it never changes another count.
    const updates = box.querySelector<HTMLElement>('.settings-chip[data-show="updates"]');
    if (updates && plugins.dataset.countUpdates !== undefined) updates.hidden = plugins.dataset.countUpdates === '0' && updates.getAttribute('aria-pressed') !== 'true';
    plugins.hidden = total > 0 && rows === 0;
  }
  root.querySelectorAll<HTMLElement>('.plugin-catalog-section').forEach((g) => { g.hidden = ![...g.querySelectorAll<HTMLElement>('.plugin-row')].some((r) => !r.hidden); });
  const filtering = words.length > 0 || show !== 'all';
  const none = root.querySelector<HTMLElement>('.settings-none');
  if (none) none.hidden = !filtering || rows + tiles > 0;
  const status = box.querySelector<HTMLElement>('.settings-search-status');
  if (status) {
    const said = !filtering ? '' : rows + tiles === 0 ? 'Nothing matches.'
      : `${rows} plugin${rows === 1 ? '' : 's'}${tiles ? ` and ${tiles} base setting${tiles === 1 ? '' : 's'}` : ''} shown.`;
    if (status.textContent !== said) status.textContent = said;
  }
}
function settingsSearchInit() { document.querySelectorAll<HTMLElement>('.settings-home').forEach(settingsSearchApply); }
document.addEventListener('input', (e) => {
  const root = (e.target as Element).closest && (e.target as Element).closest('.settings-search') && (e.target as Element).closest<HTMLElement>('.settings-home');
  if (root) settingsSearchApply(root);
});
document.addEventListener('click', (e) => {
  const chip = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.settings-chip');
  if (!chip) return;
  chip.closest('.settings-chips')!.querySelectorAll('.settings-chip').forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
  settingsSearchApply(chip.closest<HTMLElement>('.settings-home')!);
});
// "4 need attention" in the summary presses the chip of the same name: the number is the way to those plugins.
document.addEventListener('click', (e) => {
  const link = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('[data-press-chip]');
  const home = link && link.closest<HTMLElement>('.settings-home');
  const chip = home && home.querySelector<HTMLElement>(`.settings-chip[data-show="${link.dataset.pressChip}"]`);
  if (!chip) return;
  chip.click();
  chip.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !(e.target as Element).matches || !(e.target as Element).matches('.settings-search input[type="search"]') || !(e.target as HTMLInputElement).value) return;
  (e.target as HTMLInputElement).value = '';
  settingsSearchApply((e.target as Element).closest<HTMLElement>('.settings-home')!);
});
// Inside the settings modal the overview's links open the tab of the same thing, not a page behind it.
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest && (e.target as Element).closest<HTMLAnchorElement>('.tabmodal .settings-home a[href^="/settings/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  const where = a.getAttribute('href')!.split(/[?#]/)[0];
  const id = where === '/settings/plugins' ? 'plugins'
    : where.startsWith('/settings/plugin/') ? `plugin-${where.slice('/settings/plugin/'.length)}` : decodeURIComponent(where.slice('/settings/'.length));
  const tab = [...a.closest('.tabmodal')!.querySelectorAll<HTMLElement>('.tabmodal-tab')].find((t) => t.dataset.tab === id);
  if (!tab) return;
  e.preventDefault();
  tab.click();
  tab.focus();
});
// A tab's content starts at its top: the pane kept the scroll of the tab before it, so a plugin opened
// from far down the overview showed its middle.
document.body.addEventListener('htmx:after:swap', (e) => {
  const tab = e.target && (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.tabmodal-tab');
  const pane = tab && tab.closest('.tabmodal')!.querySelector<HTMLElement>('.tabmodal-pane');
  if (pane) pane.scrollTop = 0;
});
// When a step has run, the part of Settings that shows the plugin is drawn again, and the button that
// was pressed is gone with the old one. Focus goes to the same plugin in the new one (its row, or the
// steps of its page) instead of falling back to the top of the document.
let settingsFocusKey = '';
let settingsFocusItem = '';
document.addEventListener('focusin', (e) => {
  const holder = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('[data-refocus]');
  settingsFocusKey = holder ? holder.dataset.refocus || '' : '';
  // Which of the holder's buttons it was (Deactivate, not just "one of the three").
  const item = holder && (e.target as Element).closest<HTMLElement>('[data-refocus-item]');
  settingsFocusItem = item ? item.dataset.refocusItem || '' : '';
});
// Several parts of a plugin's page are drawn again by one step, one after the other: the check waits
// for the last of them, or focus would be put on a button that the next redraw takes away.
let settingsRefocusTimer = 0;
document.body.addEventListener('htmx:after:settle', () => {
  clearTimeout(settingsRefocusTimer);
  settingsRefocusTimer = setTimeout(() => {
    if (!settingsFocusKey || (document.activeElement && document.activeElement !== document.body)) return;
    const holder = [...document.querySelectorAll<HTMLElement>('[data-refocus]')].find((el) => el.dataset.refocus === settingsFocusKey);
    if (!holder) return;
    const same = settingsFocusItem && [...holder.querySelectorAll<HTMLElement>('[data-refocus-item]')].find((el) => el.dataset.refocusItem === settingsFocusItem);
    const target = same || holder.querySelector<HTMLElement>('.plugin-step-item.is-now button, .plugin-step-item.is-now a, .plugin-row-action .uk-button, .plugin-buttons .uk-button') || holder;
    if (target === holder && !holder.hasAttribute('tabindex')) holder.setAttribute('tabindex', '-1');
    target.focus();
  }, 120);
});
settingsSearchInit();
document.body.addEventListener('htmx:after:swap', settingsSearchInit);
document.body.addEventListener('htmx:after:settle', settingsSearchInit);

// A settings file: find a key, see a switch say what it is, and know when there is something unsaved.
document.addEventListener('input', (e) => {
  const box = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('.settings-find');
  if (!box) return;
  const card = box.closest('.settings-card')!;
  const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  card.querySelectorAll<HTMLElement>('.settings-form .settings-row').forEach((row) => {
    const on = words.every((w) => row.textContent.toLowerCase().includes(w));
    row.hidden = !on;
    if (on) shown += 1;
  });
  card.querySelectorAll<HTMLElement>('.settings-form .settings-group').forEach((g) => {
    g.hidden = !!words.length && ![...g.querySelectorAll<HTMLElement>('.settings-row')].some((r) => !r.hidden);
  });
  const none = card.querySelector<HTMLElement>('.settings-find-none');
  if (none) none.hidden = shown > 0 || !words.length;
});
document.addEventListener('change', (e) => {
  const sw = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('.settings-switch');
  if (sw) { const st = sw.parentElement!.querySelector('.settings-switch-state'); if (st) st.textContent = sw.checked ? 'On' : 'Off'; }
});
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => {
  const form = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.settings-form');
  // The list editor writes as it goes, so its fields are never unsaved settings.
  if (!form || (e.target as Element).closest('.settings-find, [id^="list-editor"]')) return;
  form.dataset.dirty = '1';
  const d = form.querySelector<HTMLElement>('.settings-dirty');
  if (d) d.hidden = false;
}));
document.body.addEventListener('htmx:after:request', (e) => {
  const form = e.target && (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.settings-form');
  if (!form || (e.target as Element).closest('[id^="list-editor"]')) return;
  const det = (e as CustomEvent).detail;
    const ok = det && det.ctx && det.ctx.response ? det.ctx.response.status < 400 : true;
  if (ok) { delete form.dataset.dirty; const d = form.querySelector<HTMLElement>('.settings-dirty'); if (d) d.hidden = true; }
  // On a plugin's own page a save can finish its last step: the state and the steps beside the form are
  // drawn again, so "Needs settings" does not stay on screen over a file that was just filled in.
  if (ok && form.closest('.plugin-page')) document.body.dispatchEvent(new CustomEvent('refresh-projects'));
});
window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.settings-form[data-dirty]')) { e.preventDefault(); e.returnValue = ''; }
});

