// Settings home and the catalogue: one filter over the base tiles and every plugin row. Words narrow
// by text, the chips by state. The box is drawn hidden and shown here, so a page with no script
// offers no filter that does nothing. It is applied again when the plugins are drawn again.
function settingsSearchApply(root) {
  const box = root.querySelector('.settings-search');
  if (!box) return;
  box.hidden = false;
  const input = box.querySelector('input[type="search"]');
  const pressed = box.querySelector('.settings-chip[aria-pressed="true"]');
  const show = pressed ? pressed.dataset.show : 'all';
  const words = (input ? input.value : '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (el) => words.every((w) => (el.dataset.find || el.textContent.toLowerCase()).includes(w));
  let rows = 0;
  let total = 0;
  root.querySelectorAll('.plugin-row').forEach((row) => {
    total += 1;
    const inState = show === 'all' || (show === 'attention' && row.dataset.attention === '1') || (show === 'updates' && row.dataset.update === '1')
      || (show === 'active' && row.dataset.active === '1') || (show === 'inactive' && row.dataset.active === '0');
    row.hidden = !(inState && matches(row));
    if (!row.hidden) rows += 1;
  });
  root.querySelectorAll('.settings-family').forEach((f) => {
    const shown = [...f.querySelectorAll('.plugin-row')].filter((r) => !r.hidden);
    f.hidden = !shown.length;
    f.querySelectorAll('.plugin-row.is-first-shown').forEach((r) => r.classList.remove('is-first-shown'));
    if (shown.length) shown[0].classList.add('is-first-shown');
    const count = f.querySelector('.settings-family-count');
    if (count) count.textContent = String(shown.length);
  });
  let tiles = 0;
  root.querySelectorAll('.settings-tile[data-find]').forEach((t) => {
    t.hidden = show !== 'all' || !matches(t);
    if (!t.hidden) tiles += 1;
  });
  root.querySelectorAll('.settings-base, .settings-loose').forEach((g) => { g.hidden = ![...g.querySelectorAll('.settings-tile')].some((t) => !t.hidden); });
  const plugins = root.querySelector('.settings-plugins');
  if (plugins) {
    // The chips count what is on the page now, after a step has run.
    box.querySelectorAll('[data-count]').forEach((c) => { const v = plugins.dataset[`count${c.dataset.count[0].toUpperCase()}${c.dataset.count.slice(1)}`]; if (v !== undefined) c.textContent = v; });
    // Updates has a chip of its own, shown once npm has answered and there is one: it never changes another count.
    const updates = box.querySelector('.settings-chip[data-show="updates"]');
    if (updates && plugins.dataset.countUpdates !== undefined) updates.hidden = plugins.dataset.countUpdates === '0' && updates.getAttribute('aria-pressed') !== 'true';
    plugins.hidden = total > 0 && rows === 0;
  }
  root.querySelectorAll('.plugin-catalog-section').forEach((g) => { g.hidden = ![...g.querySelectorAll('.plugin-row')].some((r) => !r.hidden); });
  const filtering = words.length > 0 || show !== 'all';
  const none = root.querySelector('.settings-none');
  if (none) none.hidden = !filtering || rows + tiles > 0;
  const status = box.querySelector('.settings-search-status');
  if (status) {
    const said = !filtering ? '' : rows + tiles === 0 ? 'Nothing matches.'
      : `${rows} plugin${rows === 1 ? '' : 's'}${tiles ? ` and ${tiles} base setting${tiles === 1 ? '' : 's'}` : ''} shown.`;
    if (status.textContent !== said) status.textContent = said;
  }
}
function settingsSearchInit() { document.querySelectorAll('.settings-home').forEach(settingsSearchApply); }
document.addEventListener('input', (e) => {
  const root = e.target.closest && e.target.closest('.settings-search') && e.target.closest('.settings-home');
  if (root) settingsSearchApply(root);
});
document.addEventListener('click', (e) => {
  const chip = e.target.closest && e.target.closest('.settings-chip');
  if (!chip) return;
  chip.closest('.settings-chips').querySelectorAll('.settings-chip').forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
  settingsSearchApply(chip.closest('.settings-home'));
});
// "4 need attention" in the summary presses the chip of the same name: the number is the way to those plugins.
document.addEventListener('click', (e) => {
  const link = e.target.closest && e.target.closest('[data-press-chip]');
  const home = link && link.closest('.settings-home');
  const chip = home && home.querySelector(`.settings-chip[data-show="${link.dataset.pressChip}"]`);
  if (!chip) return;
  chip.click();
  chip.focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !e.target.matches || !e.target.matches('.settings-search input[type="search"]') || !e.target.value) return;
  e.target.value = '';
  settingsSearchApply(e.target.closest('.settings-home'));
});
// Inside the settings modal the overview's links open the tab of the same thing, not a page behind it.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('.tabmodal .settings-home a[href^="/settings/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  const where = a.getAttribute('href').split(/[?#]/)[0];
  const id = where === '/settings/plugins' ? 'plugins'
    : where.startsWith('/settings/plugin/') ? `plugin-${where.slice('/settings/plugin/'.length)}` : decodeURIComponent(where.slice('/settings/'.length));
  const tab = [...a.closest('.tabmodal').querySelectorAll('.tabmodal-tab')].find((t) => t.dataset.tab === id);
  if (!tab) return;
  e.preventDefault();
  tab.click();
  tab.focus();
});
// A tab's content starts at its top: the pane kept the scroll of the tab before it, so a plugin opened
// from far down the overview showed its middle.
document.body.addEventListener('htmx:after:swap', (e) => {
  const tab = e.target && e.target.closest && e.target.closest('.tabmodal-tab');
  const pane = tab && tab.closest('.tabmodal').querySelector('.tabmodal-pane');
  if (pane) pane.scrollTop = 0;
});
// When a step has run, the part of Settings that shows the plugin is drawn again, and the button that
// was pressed is gone with the old one. Focus goes to the same plugin in the new one (its row, or the
// steps of its page) instead of falling back to the top of the document.
let settingsFocusKey = '';
let settingsFocusItem = '';
document.addEventListener('focusin', (e) => {
  const holder = e.target.closest && e.target.closest('[data-refocus]');
  settingsFocusKey = holder ? holder.dataset.refocus : '';
  // Which of the holder's buttons it was (Deactivate, not just "one of the three").
  const item = holder && e.target.closest('[data-refocus-item]');
  settingsFocusItem = item ? item.dataset.refocusItem : '';
});
// Several parts of a plugin's page are drawn again by one step, one after the other: the check waits
// for the last of them, or focus would be put on a button that the next redraw takes away.
let settingsRefocusTimer = 0;
document.body.addEventListener('htmx:after:settle', () => {
  clearTimeout(settingsRefocusTimer);
  settingsRefocusTimer = setTimeout(() => {
    if (!settingsFocusKey || (document.activeElement && document.activeElement !== document.body)) return;
    const holder = [...document.querySelectorAll('[data-refocus]')].find((el) => el.dataset.refocus === settingsFocusKey);
    if (!holder) return;
    const same = settingsFocusItem && [...holder.querySelectorAll('[data-refocus-item]')].find((el) => el.dataset.refocusItem === settingsFocusItem);
    const target = same || holder.querySelector('.plugin-step-item.is-now button, .plugin-step-item.is-now a, .plugin-row-action .uk-button, .plugin-buttons .uk-button') || holder;
    if (target === holder && !holder.hasAttribute('tabindex')) holder.setAttribute('tabindex', '-1');
    target.focus();
  }, 120);
});
settingsSearchInit();
document.body.addEventListener('htmx:after:swap', settingsSearchInit);
document.body.addEventListener('htmx:after:settle', settingsSearchInit);

// A settings file: find a key, see a switch say what it is, and know when there is something unsaved.
document.addEventListener('input', (e) => {
  const box = e.target.closest && e.target.closest('.settings-find');
  if (!box) return;
  const card = box.closest('.settings-card');
  const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  card.querySelectorAll('.settings-form .settings-row').forEach((row) => {
    const on = words.every((w) => row.textContent.toLowerCase().includes(w));
    row.hidden = !on;
    if (on) shown += 1;
  });
  card.querySelectorAll('.settings-form .settings-group').forEach((g) => {
    g.hidden = !!words.length && ![...g.querySelectorAll('.settings-row')].some((r) => !r.hidden);
  });
  const none = card.querySelector('.settings-find-none');
  if (none) none.hidden = shown > 0 || !words.length;
});
document.addEventListener('change', (e) => {
  const sw = e.target.closest && e.target.closest('.settings-switch');
  if (sw) { const st = sw.parentElement.querySelector('.settings-switch-state'); if (st) st.textContent = sw.checked ? 'On' : 'Off'; }
});
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => {
  const form = e.target.closest && e.target.closest('.settings-form');
  // The list editor writes as it goes, so its fields are never unsaved settings.
  if (!form || e.target.closest('.settings-find, [id^="list-editor"]')) return;
  form.dataset.dirty = '1';
  const d = form.querySelector('.settings-dirty');
  if (d) d.hidden = false;
}));
document.body.addEventListener('htmx:after:request', (e) => {
  const form = e.target && e.target.closest && e.target.closest('.settings-form');
  if (!form || e.target.closest('[id^="list-editor"]')) return;
  const ok = e.detail && e.detail.ctx && e.detail.ctx.response ? e.detail.ctx.response.status < 400 : true;
  if (ok) { delete form.dataset.dirty; const d = form.querySelector('.settings-dirty'); if (d) d.hidden = true; }
  // On a plugin's own page a save can finish its last step: the state and the steps beside the form are
  // drawn again, so "Needs settings" does not stay on screen over a file that was just filled in.
  if (ok && form.closest('.plugin-page')) document.body.dispatchEvent(new CustomEvent('refresh-projects'));
});
window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.settings-form[data-dirty]')) { e.preventDefault(); e.returnValue = ''; }
});

