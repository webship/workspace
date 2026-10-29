/**
 * The navigation, as a layout: which of its entries are shown, WHERE, in what order, and what you added.
 *
 * There are two places an entry can be. The **navigation sidebar** is the rail down the right of every
 * page, grouped by concern. The **navigation topbar** is the bar across the top, in three regions —
 * start (beside the wordmark), center, end (before the theme toggle) — which is where the few things
 * someone reaches for on every page belong, and where a bare icon reads as a tool rather than a link.
 * An entry moves between them by being dragged, and an entry added can be put straight into either.
 *
 * The rail is on every page and it is built in code — a group per concern (Create, Sync, Screens, Run,
 * Archives, Go) with the page's own actions first and the navigation last. That is a good default and a
 * bad fixed set: a machine that never deploys does not want Upsun in it, a team lives in Jira and would
 * put it there, and which of nineteen workspaces you actually open differs per person.
 *
 * So it is arranged the way the project rows are (row-layout.js), with the same shape and the same
 * rules — one file for this machine, holding only what someone changed:
 *
 *   core/config/navigation.yml
 *     global:                      applies on every page
 *       hidden:  [ids…]            entries not shown
 *       groups:  [group ids…]      the order of the sidebar groups; anything unlisted keeps its place after them
 *       order:   { <group>: [ids…] }   the order inside one group
 *       topbar:  { start: [ids…], center: [ids…], end: [ids…] }   entries moved up to the top bar
 *       show:    { <id>: icon | text }  entries shown as the icon alone, or as the label alone —
 *                                  absent means both, which is what every entry is until someone says
 *       items:   [item…]           entries you added
 *     workspaces:
 *       dev: { the same four keys }    applied after global, on that workspace's pages
 *
 * An added entry is a link or a button:
 *
 *   id, label, icon, group, description
 *   href:    where it goes (a link) — external URLs open in a new tab
 *   use:     <command id> — runs that command of the catalog instead, like a row action does
 *   confirm: true → asks in the dialog first
 *
 * The defaults live in the code that builds the rail, so an entry added to the dashboard later appears
 * in its own group until someone moves it, and deleting the file is a full reset. `sync-tooling.sh`
 * copies only `workspace.*.settings.yml` into `core/config`, so a `--pull` never touches this.
 *
 * **What the editor can offer is what has been SEEN.** The rail differs per page — a files workspace has
 * Sync, a project workspace has Screens and Run — so nothing here can enumerate the entries from first
 * principles without rendering every page. Each render records what it drew into
 * `core/config/rail.seen.json`, per scope, and the editor lists that. An id that is no longer drawn stays
 * in the file and does nothing, which is what makes a hidden entry survive a dashboard that renamed it.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { esc } = require('./html');
const { CONFIG_DIR } = require('./workspaces');

// Overridable so a test can arrange a navigation without touching the machine's own, the way
// row-layout.js is. Read through the functions, never captured at require time.
const layoutFile = () => process.env.NAVIGATION_FILE || path.join(CONFIG_DIR, 'navigation.yml');
const seenFile = () => process.env.NAVIGATION_SEEN_FILE || path.join(CONFIG_DIR, 'navigation.seen.json');

// An id is a slug: it names an entry in a YAML file a person edits, and it ends up in a CSS selector
// and a query string. Anything else is refused rather than escaped into unreadability.
const ID_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const isId = (v) => ID_RE.test(String(v || ''));

// Where an entry can go besides a sidebar group. These are group ids in the editor — a list you drag
// into — so the whole arrangement stays one form and one drag, rather than a placement dropdown per
// entry. `hidden` is the fourth of them: not shown anywhere.
const REGIONS = ['start', 'center', 'end'];
const TOPBAR_GROUPS = REGIONS.map((r) => `topbar-${r}`);
const RESERVED = new Set([...TOPBAR_GROUPS, 'hidden']);
/** 'topbar-center' → 'center'; anything else → null. */
const regionOf = (group) => (TOPBAR_GROUPS.includes(String(group)) ? String(group).slice('topbar-'.length) : null);
const emptyTopbar = () => Object.fromEntries(REGIONS.map((r) => [r, []]));
const TOPBAR_LABELS = { start: 'Topbar start', center: 'Topbar center', end: 'Topbar end' };

/**
 * The id of a rail entry, derived from its label. Counts are stripped — "Backups (2)" and "Run a tool
 * (13)" change with the tree, and a layout keyed on them would forget itself the moment a backup was
 * taken. A caller with a better id passes one.
 */
function slugId(label) {
  return String(label)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

/** Which layout applies on a page: a workspace's own, or the global one. */
function scopeFor(context) {
  const m = String(context || '').match(/^(?:workspace|backups):([a-z0-9_-]+)$/);
  return m ? m[1] : 'global';
}

const EMPTY = { hidden: [], groups: [], order: {}, topbar: emptyTopbar(), show: {}, items: [] };

function readYaml() {
  try {
    return yaml.load(fs.readFileSync(layoutFile(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

/** One scope's settings, with every key present so callers never test for undefined. */
function scopeLayout(raw, scope) {
  const src = (scope === 'global' ? raw.global : ((raw.workspaces || {})[scope])) || {};
  return {
    hidden: (Array.isArray(src.hidden) ? src.hidden : []).filter(isId),
    groups: (Array.isArray(src.groups) ? src.groups : []).filter(isId),
    order: Object.fromEntries(Object.entries(src.order || {})
      .filter(([g, list]) => isId(g) && Array.isArray(list))
      .map(([g, list]) => [g, list.filter(isId)])),
    topbar: Object.fromEntries(REGIONS.map((r) => {
      const list = ((src.topbar || {})[r]);
      return [r, (Array.isArray(list) ? list : []).filter(isId)];
    })),
    show: Object.fromEntries(Object.entries(src.show || {})
      .filter(([id, how]) => isId(id) && (how === 'icon' || how === 'text' || how === 'both'))),
    items: (Array.isArray(src.items) ? src.items : []).filter((it) => it && isId(it.id) && it.label),
  };
}

let memo = { at: 0, mtime: 0, raw: null };

function loadLayout() {
  const now = Date.now();
  let mtime = 0;
  try { mtime = fs.statSync(layoutFile()).mtimeMs; } catch (_) { mtime = 0; }
  // Re-read when the file moved, and at most every 2s otherwise: this is on the critical path of every
  // page, and workspaces.js memoises its own config the same way.
  if (!memo.raw || mtime !== memo.mtime || now - memo.at > 2000) {
    memo = { at: now, mtime, raw: readYaml() };
  }
  return { raw: memo.raw, mtime: memo.mtime };
}

/** The two layouts that apply on a page, global first. A workspace's own settings are applied after it. */
function layoutsFor(scope) {
  const { raw } = loadLayout();
  const global = scopeLayout(raw, 'global');
  return scope === 'global' ? [global] : [global, scopeLayout(raw, scope)];
}

/** Every scope the editor offers: the global one, then each workspace, in the order the cards are in. */
function navScopes(workspaceKeys) {
  return ['global', ...workspaceKeys];
}

/* ------------------------------------------------------------------ *
 * What the rail has drawn, so the editor can offer it
 * ------------------------------------------------------------------ */

function readSeen() {
  try {
    const seen = JSON.parse(fs.readFileSync(seenFile(), 'utf8'));
    return seen && typeof seen === 'object' ? seen : {};
  } catch (_) {
    return {};
  }
}

let seenMemo = null;

/**
 * Record what one page's rail drew. Written only when something is new, because this runs on every page
 * render and a file written per request would be a write per page view for no gain.
 */
function recordSeen(scope, arranged) {
  const seen = seenMemo || (seenMemo = readSeen());
  const bucket = seen[scope] || (seen[scope] = {});
  let changed = false;
  // The top bar is recorded the same way, under its region: an entry moved up there is in no sidebar
  // group any more, and the editor reads its label out of this file.
  const groups = [
    ...arranged.groups,
    ...REGIONS.map((r) => ({ id: `topbar-${r}`, label: TOPBAR_LABELS[r], items: arranged.topbar[r] })),
  ];
  for (const g of groups) {
    const entry = bucket[g.id] || (bucket[g.id] = { label: g.label, items: {} });
    if (entry.label !== g.label) { entry.label = g.label; changed = true; }
    // Rebuilt in the order this page DREW them, with anything seen before appended after — so a hidden
    // entry, or one only another page draws, survives, and the editor lists them in the order they
    // actually appear. Kept as insertion order rather than a list because that is what this file has
    // always been. Only what the dashboard itself builds is recorded: an entry someone added is already
    // in the layout, and recording it too leaves a ghost behind once it is removed.
    // An entry that SHIPS one way — the assistant is its mark and nothing else — records that here, so
    // the editor knows what "both" would be overriding and can offer to put the label back. A plain
    // string is the common case and stays one; only an entry with a default of its own grows an object.
    const items = {};
    for (const it of g.items) if (!it.custom) items[it.id] = it.ships ? { label: it.label, show: it.ships } : it.label;
    for (const [id, was] of Object.entries(entry.items)) if (!(id in items)) items[id] = was;
    if (JSON.stringify(items) !== JSON.stringify(entry.items)) { entry.items = items; changed = true; }
  }
  if (!changed) return;
  try {
    fs.mkdirSync(path.dirname(seenFile()), { recursive: true });
    fs.writeFileSync(seenFile(), JSON.stringify(seen, null, 2));
  } catch (_) { /* a rail that cannot record itself still renders */ }
}

/** A seen item is a label, or a label with the way that entry ships. */
const seenLabel = (v) => (v && typeof v === 'object' ? v.label : v);
const seenShips = (v) => (v && typeof v === 'object' ? (v.show || '') : '');

/** What the editor lists for one scope: every group and entry that scope has actually drawn. */
function seenFor(scope) {
  const seen = seenMemo || (seenMemo = readSeen());
  return seen[scope] || {};
}

/* ------------------------------------------------------------------ *
 * Applying a layout to the groups the page built
 * ------------------------------------------------------------------ */

/**
 * An entry someone added, as the rail's own markup. A link goes where it points; a `use:` runs a command
 * of the catalog through the same endpoint a row action does, so there is one runner and one history.
 */
function customItemHtml(item) {
  const icon = isId(item.icon) || /^tabler:[a-z0-9-]+$/.test(String(item.icon || '')) ? item.icon : 'link';
  const label = `<span uk-icon="icon: ${esc(String(icon).replace(/^tabler:/, ''))}; ratio: .8"></span>`
    + `<span class="action-label">${esc(item.label)}</span>`;
  const title = esc(item.description || item.label);
  if (item.use) {
    // The same route, the same confirm dialog and the same history as a row action's `use:` step.
    const vals = esc(JSON.stringify({ id: `rail:${item.id}`, use: item.use }));
    return `<button class="uk-button uk-button-default action-btn${item.confirm ? ' arm-step' : ''}" type="button"`
      + ` title="${title}" hx-post="/actions/nav-run" hx-vals='${vals}'`
      + ` hx-target="#webship-workspace-output" hx-swap="innerHTML"`
      + `${item.confirm ? ' hx-trigger="confirmed-remove"' : ''}>${label}</button>`;
  }
  const href = String(item.href || '');
  // An address off this dashboard opens in a new tab: the rail is navigation within the workspace, and
  // replacing the page you are working on with an external site is not what a rail entry should do.
  const external = /^https?:\/\//i.test(href) && !href.includes('.ddev.site');
  return `<a class="uk-button uk-button-default action-btn" href="${esc(href)}" title="${title}"`
    + `${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
}

/**
 * Hide, reorder and add — global first, then the workspace's own.
 *
 * Everything here is presentation: a hidden entry's route still answers exactly as it did, and an entry
 * the dashboard no longer draws simply does not appear, rather than leaving a hole or an error.
 */
function arrange(groups, scope) {
  const layouts = layoutsFor(scope);
  const hidden = new Set(layouts.flatMap((l) => l.hidden));
  const groupOrder = layouts.map((l) => l.groups).filter((g) => g.length).pop() || [];
  const itemOrder = Object.assign({}, ...layouts.map((l) => l.order));
  const added = layouts.flatMap((l) => l.items);

  // Which entries were moved to the top bar, and to which region. A later scope wins outright: a
  // workspace that puts something in the topbar means that page, not "as well as wherever global had it".
  const region = new Map();
  for (const l of layouts) {
    for (const r of REGIONS) for (const id of l.topbar[r]) region.set(id, r);
  }
  // Every id the layout has an opinion about. An entry the dashboard SHIPS in the top bar (an entry with
  // its own `topbar:`) stays there until someone says otherwise — and naming it anywhere, even by
  // dragging it into a sidebar group, is saying otherwise.
  const named = new Set([
    ...hidden,
    ...region.keys(),
    ...layouts.flatMap((l) => Object.values(l.order).flat()),
  ]);
  const topbar = emptyTopbar();
  // The icon alone, the label alone, or both — in whichever place the entry sits, because that is about
  // how much room the entry is worth, not about which strip of the screen it is on. Both is what every
  // entry is until someone says otherwise, and an entry that ships one way (the assistant is its mark
  // and nothing else) keeps it until the layout names it.
  const show = Object.assign({}, ...layouts.map((l) => l.show));
  // `ships` is what the dashboard built the entry as; `show` is what it ends up as. An explicit `both`
  // in the layout is what turns a shipped default back off, which is why both is written down when it
  // overrides something and left out when it does not.
  const shownAs = (it) => {
    const asked = show[it.id];
    if (asked) return asked === 'both' ? '' : asked;
    return it.show || '';
  };

  let out = groups.map((g) => ({
    ...g,
    items: g.items.filter((it) => !hidden.has(it.id))
      .map((it) => ({ ...it, ships: it.show || '', show: shownAs(it) })),
  }));

  // An added entry joins the group it names, or makes one of its own at the end — a group that exists
  // only on some pages (Sync, Screens) must not swallow an entry on the pages that lack it. Naming a
  // topbar region instead puts it up there.
  for (const item of added) {
    if (hidden.has(item.id)) continue;
    const entry = { id: item.id, label: item.label, html: customItemHtml(item), custom: true };
    entry.show = shownAs(entry);
    const asked = regionOf(item.group);
    if (asked && !region.has(item.id)) region.set(item.id, asked);
    if (region.has(item.id)) { topbar[region.get(item.id)].push(entry); continue; }
    const wanted = isId(item.group) ? item.group : 'yours';
    const target = out.find((g) => g.id === wanted);
    if (target) target.items.push(entry);
    else out.push({ id: wanted, label: item.group_label || (wanted === 'yours' ? 'Yours' : item.group), items: [entry] });
  }

  // Anything else the layout moved up leaves the group it was built in. The sidebar and the topbar are
  // one arrangement, so an entry is in exactly one of them.
  const placeOf = (it) => region.get(it.id)
    || (!named.has(it.id) && REGIONS.includes(it.topbar) ? it.topbar : null);
  for (const g of out) {
    const moved = g.items.filter((it) => placeOf(it) && !it.custom);
    if (!moved.length) continue;
    g.items = g.items.filter((it) => !placeOf(it) || it.custom);
    for (const it of moved) topbar[placeOf(it)].push(it);
  }

  for (const g of out) {
    const order = itemOrder[g.id];
    if (!order || !order.length) continue;
    const rank = new Map(order.map((id, i) => [id, i]));
    // Anything unlisted keeps its place AFTER what was ordered, in the order the page built it: a new
    // entry in the dashboard must not disappear into the middle of somebody's arrangement.
    g.items = [...g.items].sort((a, b) =>
      (rank.has(a.id) ? rank.get(a.id) : order.length + 1) - (rank.has(b.id) ? rank.get(b.id) : order.length + 1));
  }

  // Each region is ordered by the list that put the entries there, newest scope last.
  const wanted = emptyTopbar();
  for (const l of layouts) for (const r of REGIONS) for (const id of l.topbar[r]) if (!wanted[r].includes(id)) wanted[r].push(id);
  for (const r of REGIONS) {
    const rank = new Map(wanted[r].map((id, i) => [id, i]));
    topbar[r].sort((a, b) =>
      (rank.has(a.id) ? rank.get(a.id) : wanted[r].length + 1) - (rank.has(b.id) ? rank.get(b.id) : wanted[r].length + 1));
  }

  if (groupOrder.length) {
    const rank = new Map(groupOrder.map((id, i) => [id, i]));
    out = [...out].sort((a, b) =>
      (rank.has(a.id) ? rank.get(a.id) : groupOrder.length + 1) - (rank.has(b.id) ? rank.get(b.id) : groupOrder.length + 1));
  }

  return { groups: out.filter((g) => g.items.length && !hidden.has(g.id)), topbar };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function saveLayout(raw) {
  const body = '# The navigation: what the sidebar and the top bar show, in what order, and what you added.\n'
    + '# Written by Commands → Navigation. Only what you changed is here; deleting this file is a full reset.\n'
    + '# Never synced: sync-tooling.sh copies only workspace.*.settings.yml into core/config.\n'
    + yaml.dump(raw, { lineWidth: 100 });
  fs.mkdirSync(path.dirname(layoutFile()), { recursive: true });
  fs.writeFileSync(layoutFile(), body);
  memo = { at: 0, mtime: 0, raw: null };
  return fs.statSync(layoutFile()).mtimeMs;
}

/** The whole file, for a writer that is about to change one scope in it. */
function rawLayout() {
  const { raw, mtime } = loadLayout();
  return { raw: JSON.parse(JSON.stringify(raw || {})), mtime };
}

/** Put one scope's settings back into the whole file, dropping what is empty so the file stays readable. */
function withScope(raw, scope, settings) {
  const clean = {};
  if (settings.hidden && settings.hidden.length) clean.hidden = settings.hidden;
  if (settings.groups && settings.groups.length) clean.groups = settings.groups;
  if (settings.order && Object.keys(settings.order).length) clean.order = settings.order;
  const topbar = Object.fromEntries(REGIONS.map((r) => [r, (settings.topbar || {})[r] || []]).filter(([, v]) => v.length));
  if (Object.keys(topbar).length) clean.topbar = topbar;
  if (settings.show && Object.keys(settings.show).length) clean.show = settings.show;
  if (settings.items && settings.items.length) clean.items = settings.items;
  const out = { ...raw };
  if (scope === 'global') {
    if (Object.keys(clean).length) out.global = clean; else delete out.global;
  } else {
    const ws = { ...(out.workspaces || {}) };
    if (Object.keys(clean).length) ws[scope] = clean; else delete ws[scope];
    if (Object.keys(ws).length) out.workspaces = ws; else delete out.workspaces;
  }
  return out;
}

module.exports = {
  layoutFile, seenFile,
  isId, slugId, scopeFor, navScopes,
  REGIONS, TOPBAR_GROUPS, TOPBAR_LABELS, RESERVED, regionOf, emptyTopbar,
  loadLayout, scopeLayout, layoutsFor, rawLayout, withScope, saveLayout,
  arrange, customItemHtml, seenLabel, seenShips,
  recordSeen, seenFor,
};
