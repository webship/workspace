/**
 * Writing the rail's layout: what is hidden, in what order, and the entries someone added.
 *
 * One form carries the whole arrangement (`#nav-form`), so a drag that has not been saved is posted with
 * anything else that is done meanwhile — adding an entry never loses a reorder. Every write carries the
 * file's mtime and is refused with 409 when it changed since, the way every other writer here works.
 */

const rail = require('../navigation');
const navPage = require('../navigation-page');
const cc = require('../commands');
const { startJob, jobFragment } = require('../jobs');

const ok = (msg) => `<div class="msg assistant">✅ ${msg}</div>`;
const bad = (msg) => `<div class="msg error">${msg}</div>`;

const asArray = (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]));

/** The arrangement as posted: group order, and each entry under the group it was dropped in. */
function arranged(form) {
  // Deduplicated, and the reserved lists are not sidebar groups: the group order is a set, and a stray
  // repeat would make the same group render twice.
  const groups = [...new Set(asArray(form.group).map(String).filter(rail.isId))]
    .filter((g) => !rail.RESERVED.has(g));
  const order = {};
  const hidden = [];
  const topbar = rail.emptyTopbar();
  // How much of each entry is shown: `<id>:icon`, `<id>:text`, or `<id>:both`. Both is the default and
  // is not written down, which is what keeps the file a record of what somebody changed — and posting
  // it explicitly is what makes going back to both work.
  const ships = shippedShow(scopeOf(form));
  const show = {};
  for (const raw of asArray(form.show).map(String)) {
    const at = raw.lastIndexOf(':');
    if (at < 0) continue;
    const id = raw.slice(0, at);
    const how = raw.slice(at + 1);
    if (!rail.isId(id)) continue;
    if (how === 'icon' || how === 'text') { show[id] = how; continue; }
    // Both is what an entry is unless somebody says otherwise, so it is not written down — EXCEPT when
    // it is overriding an entry the dashboard ships one way. Without that there would be no way to put
    // the assistant's label back: leaving the key out would just let its own default win again.
    if (how === 'both' && ships[id]) show[id] = 'both';
  }
  for (const raw of asArray(form.item).map(String)) {
    const at = raw.indexOf(':');
    if (at < 0) continue;
    const group = raw.slice(0, at);
    const id = raw.slice(at + 1);
    if (!rail.isId(id)) continue;
    if (group === 'hidden') { hidden.push(id); continue; }
    const region = rail.regionOf(group);
    if (region) { topbar[region].push(id); continue; }
    if (!rail.isId(group)) continue;
    (order[group] || (order[group] = [])).push(id);
  }
  return { groups, order, hidden, topbar, show };
}

/** How each entry SHIPS, from what the navigation has drawn — a default an explicit answer overrides. */
function shippedShow(scope) {
  const out = {};
  for (const g of Object.values(rail.seenFor(scope))) {
    for (const [id, was] of Object.entries((g || {}).items || {})) {
      const how = rail.seenShips(was);
      if (how) out[id] = how;
    }
  }
  return out;
}

function scopeOf(form) {
  const scope = String(form.scope || 'global');
  return scope === 'global' || rail.isId(scope) ? scope : 'global';
}

/** Save one scope, keeping the entries it already had — they are edited by their own actions. */
function write(form, change) {
  const { raw, mtime } = rail.rawLayout();
  if (String(form.mtime || '') !== String(mtime)) {
    return { conflict: true };
  }
  const scope = scopeOf(form);
  const current = rail.scopeLayout(raw, scope);
  const next = change({ ...current });
  const out = rail.withScope(raw, scope, next);
  return { mtime: rail.saveLayout(out) };
}

const editor = (send, form, message, status = 200) =>
  send(navPage.navEditorHtml(scopeOf(form), message), status);

async function nav_save({ form, send }) {
  const { groups, order, hidden, topbar, show } = arranged(form);
  const res = write(form, (current) => ({ ...current, groups, order, hidden, topbar, show }));
  if (res.conflict) {
    return editor(send, form, bad('The navigation changed somewhere else while this was open — nothing was written. This is how it is now.'), 409);
  }
  return editor(send, form, ok('Navigation saved. It applies on the next page you open.'));
}

async function nav_add({ form, send }) {
  const label = String(form.new_label || '').trim().slice(0, 40);
  if (!label) return editor(send, form, bad('An entry needs a label.'), 400);
  const href = String(form.new_href || '').trim();
  const use = String(form.new_use || '').trim();
  if (!href && !use) return editor(send, form, bad('An entry needs somewhere to go, or a command to run.'), 400);
  if (href && use) return editor(send, form, bad('An entry is a link or a command, not both.'), 400);
  if (use && !cc.loadCatalog().commands.some((c) => c.id === use)) {
    return editor(send, form, bad('No such command.'), 400);
  }
  // A link goes in an href attribute and is followed by a click: only http(s) and a path of this
  // dashboard, so nothing can put javascript: or data: into the rail.
  if (href && !/^(https?:\/\/|\/)[^\s"'<>]*$/i.test(href)) {
    return editor(send, form, bad('A link is an https:// address or a path of this dashboard.'), 400);
  }

  const base = rail.slugId(label);
  const { raw } = rail.rawLayout();
  const taken = new Set(rail.scopeLayout(raw, scopeOf(form)).items.map((i) => i.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`.slice(0, 48);

  const item = { id, label };
  const iconValue = String(form.new_icon || '').trim();
  if (iconValue) item.icon = iconValue.slice(0, 40);
  const group = String(form.new_group || '').trim();
  // A region of the top bar is a legal destination, and slugId leaves it alone (it is already a slug).
  if (group) item.group = rail.slugId(group);
  if (href) item.href = href; else item.use = use;
  if (form.new_confirm) item.confirm = true;

  const { groups, order, hidden, topbar, show } = arranged(form);
  const res = write(form, (current) => ({ ...current, groups, order, hidden, topbar, show, items: [...current.items, item] }));
  if (res.conflict) {
    return editor(send, form, bad('The navigation changed somewhere else while this was open — nothing was written.'), 409);
  }
  return editor(send, form, ok(`Added <strong>${label}</strong> to the navigation.`));
}

async function nav_remove({ form, send }) {
  const id = String(form.id || '');
  const { groups, order, hidden, topbar, show } = arranged(form);
  const res = write(form, (current) => ({
    ...current,
    groups,
    show: Object.fromEntries(Object.entries(show).filter(([x]) => x !== id)),
    order: Object.fromEntries(Object.entries(order).map(([g, ids]) => [g, ids.filter((x) => x !== id)])),
    hidden: hidden.filter((x) => x !== id),
    topbar: Object.fromEntries(Object.entries(topbar).map(([r, ids]) => [r, ids.filter((x) => x !== id)])),
    items: current.items.filter((it) => it.id !== id),
  }));
  if (res.conflict) return editor(send, form, bad('The navigation changed somewhere else while this was open.'), 409);
  return editor(send, form, ok('Removed.'));
}

async function nav_reset({ form, send }) {
  const { raw, mtime } = rail.rawLayout();
  if (String(form.mtime || '') !== String(mtime)) {
    return editor(send, form, bad('The navigation changed somewhere else while this was open.'), 409);
  }
  rail.saveLayout(rail.withScope(raw, scopeOf(form), {}));
  return editor(send, form, ok('Back to the navigation this scope ships with.'));
}

/**
 * Run a command an entry carries. The same runner a row action uses, so there is one history and one
 * screen session per run rather than a second way of doing it.
 */
async function nav_run({ form, send }) {
  const use = String(form.use || '');
  const command = cc.loadCatalog().commands.find((c) => c.id === use);
  if (!command) return send(bad('No such command.'), 400);
  let line;
  try {
    line = cc.commandLine(command, { workspace: command.workspace });
  } catch (err) {
    return send(bad(`That command cannot run from the rail: ${err.message}`), 400);
  }
  const id = startJob(`rail:${use}`, line, { cwd: command.dir });
  return send(jobFragment(id).html);
}

module.exports = {
  '/actions/nav-save': nav_save,
  '/actions/nav-add': nav_add,
  '/actions/nav-remove': nav_remove,
  '/actions/nav-reset': nav_reset,
  '/actions/nav-run': nav_run,
};
