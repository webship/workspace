/* ---------------- the rail, arranged --------------------------------------- */

// Each entry in Commands → Rail posts "<group>:<id>", and dragging it moves the element without
// touching that value — so a save said every entry was still where it was rendered, and hiding
// something did nothing at all. Every form that sends the arrangement calls this first, from its own
// hx-on::before:request: the value is rewritten from the list the entry is IN at that moment.
window.navSyncGroups = function navSyncGroups() {
  const form = document.getElementById('nav-form');
  if (!form) return;
  for (const entry of form.querySelectorAll<HTMLElement>('.nav-entry')) {
    const list = entry.closest<HTMLElement>('[data-group]');
    const input = entry.querySelector<HTMLInputElement>('input[name="item"]');
    if (list && input) input.value = `${list.dataset.group}:${entry.dataset.id}`;
  }
};

// Run it on every drop rather than when the form is sent: htmx collects a form's values when the
// request is TRIGGERED, before htmx:before:request fires, so rewriting them there is already too late
// — the save kept arriving with every entry still in the group it was rendered in. UIkit's sortable
// says when something moved; that is the moment the values are stale.
for (const ev of ['moved', 'added', 'removed', 'stop']) {
  document.addEventListener(ev, (e) => {
    const t = e.target as Element | null;
    if (t && t.closest && t.closest('#nav-form')) window.navSyncGroups();
  }, true);
}

/* ---------------- grid or list -------------------------------------------- */

// Which layout the workspace cards and the project rows use. The state is on <html> and applied by the
// pre-paint script; this only changes it, marks the chosen button, and remembers the choice through the
// shared cookie so it is the same layout on every workspace.
const VIEW_PREFS: Record<string, { attr: string; allowed: string[] }> = {
  'ws-home-view': { attr: 'homeView', allowed: ['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6'] },
  'ws-rows-view': { attr: 'rowsView', allowed: ['list', 'grid-1', 'grid-2', 'grid-3'] },
  // A folder of files: a list of names, or a grid of up to six across for a folder of pictures.
  'ws-files-view': { attr: 'filesView', allowed: ['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6'] },
};

function markCurrentViews() {
  for (const btn of document.querySelectorAll<HTMLElement>('.view-pick')) {
    const spec = VIEW_PREFS[btn.dataset.pref || ''];
    if (!spec) continue;
    const current = document.documentElement.dataset[spec.attr] === btn.dataset.view;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
  for (const btn of document.querySelectorAll<HTMLElement>('.density-pick')) {
    const current = document.documentElement.dataset.density === btn.dataset.density;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
  // Words or icons: the browser's own choice, else what the style says (its --pcard-tool-label).
  const styleSays = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pcard-tool-label')) || 0) > 0 ? 'words' : 'icons';
  for (const btn of document.querySelectorAll<HTMLElement>('.tool-labels-pick')) {
    const current = (document.documentElement.dataset.toolLabels || styleSays) === btn.dataset.toolLabels;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
  // The page width sits in the same group and is marked the same way.
  for (const btn of document.querySelectorAll<HTMLElement>('.page-width-pick')) {
    const current = document.documentElement.dataset.pageWidth === btn.dataset.width;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
}

document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('.view-pick');
  if (!btn) return;
  e.preventDefault();
  const spec = VIEW_PREFS[btn.dataset.pref || ''];
  if (!spec || !spec.allowed.includes(btn.dataset.view || '')) return;
  document.documentElement.dataset[spec.attr] = btn.dataset.view;
  wsPrefSet(btn.dataset.pref!, btn.dataset.view!);
  markCurrentViews();
});

