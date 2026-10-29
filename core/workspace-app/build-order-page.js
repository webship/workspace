/**
 * Settings → Command order: what a workspace offers, and in what order.
 *
 * Two lists per scope, because a workspace folder holds two kinds of command and they answer different
 * questions. A **builder** (`cmd-*-project.sh`) makes a project and is what **Build a new project**
 * offers; a **tool** (`cmd-tools-backup-dev.sh`, `cmd-tools-clone.sh`, `cmd-all-*-themes.sh`) acts on
 * one, and is what Run a tool and the Commands page list. Alphabetical put them through each other —
 * `cmd-tools-backup-dev.sh` landing between two Webship builders — which reads as a mistake before it
 * reads as an order.
 *
 * One page per scope: every workspace first, then each workspace on its own tab. Drag by the handle, or
 * move with the arrows, which are not decoration — dragging is a mouse gesture, and this is the only way
 * to arrange the thing from a keyboard.
 *
 * What it lists is what the tree HAS. Unlike the navigation, which can only offer what its pages have
 * drawn, a command is a file in a folder — so the list is read straight off disk and a command added
 * this morning is arrangeable this morning.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { loadWorkspaces, findBuilderScripts, builderLabel, ROOT } = require('./workspaces');
const order = require('./build-order');

const icon = (name, ratio = 0.7) => `<span uk-icon="icon: ${name}; ratio: ${ratio}"></span>`;

const KIND_META = {
  builders: {
    title: 'Builders',
    what: 'what Build a new project offers, in this order',
    field: 'builder',
    empty: 'No builders here. A builder is a <code>cmd-*-project.sh</code> in the workspace folder.',
  },
  tools: {
    title: 'Tools',
    what: 'what Run a tool and the Commands page list, in this order',
    field: 'tool',
    empty: 'No tools here yet.',
  },
};

/** Every workspace that holds any command at all — the only ones with an order to arrange. */
function orderableWorkspaces() {
  return Object.values(loadWorkspaces())
    .map((w) => ({ ...w, dir: w.dir || path.join(ROOT, w.key) }))
    .filter((w) => commandFiles(w.dir).length);
}

/**
 * Every `cmd-*.sh` in a folder, builders included.
 *
 * Read with `fs` rather than through commands.js, which requires row-layout.js, which requires
 * commands.js back — a cycle this page has no reason to join for a directory listing.
 */
function commandFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(order.isCommand);
  } catch (_) {
    return [];
  }
}

/**
 * Every command of one kind a scope can arrange, with the label to show and where it came from.
 *
 * For a workspace that is its own folder. For `global` it is the union of every folder's, because the
 * global order applies on all of them — and a union is the only honest answer: an order that could only
 * mention what `dev` happens to hold would quietly refuse to arrange `modules`' own tools.
 */
function commandsFor(scope, kind) {
  const seen = new Map();
  const folders = scope === 'global'
    ? orderableWorkspaces()
    : orderableWorkspaces().filter((w) => w.key === scope);
  for (const w of folders) {
    const files = kind === 'builders'
      ? findBuilderScripts(w.dir)
      : commandFiles(w.dir).filter((f) => !order.isBuilder(f));
    for (const file of files) {
      if (seen.has(file)) { seen.get(file).where.push(w.label || w.key); continue; }
      seen.set(file, { file, label: builderLabel(w.dir, file), where: [w.label || w.key] });
    }
  }
  // In the order the scope itself shows them, so the page you are looking at IS the list you are
  // arranging. The same calls the Build form and the Commands page make.
  const sorted = kind === 'builders'
    ? order.sortBuilders([...seen.keys()], scope)
    : order.sortTools([...seen.keys()], scope);
  return sorted.map((f) => seen.get(f));
}

/** The scope picker: every workspace first, then one tab per workspace, dotted when it has its own order. */
function scopeTabsHtml(scope) {
  const tab = (s, label, title) => `<a class="uk-button uk-button-${scope === s ? 'primary' : 'default'} uk-button-small settings-tab"
       href="/settings/command-order?scope=${encodeURIComponent(s)}"${scope === s ? ' aria-current="page"' : ''}
       title="${esc(title)}">${esc(label)}${order.scopeHasOrder(s) ? ' •' : ''}</a>`;
  return `<p class="settings-tabs nav-scopes">
    ${tab('global', 'Every workspace', 'The order in every workspace')}
    ${orderableWorkspaces().map((w) => tab(w.key, w.label,
    `The order in ${w.label}. Applied before the global one.`)).join('')}
  </p>`;
}

function moveArrows(what) {
  return `<span class="ws-move">
      <button type="button" class="uk-button uk-button-default uk-button-small" title="Move ${esc(what)} up"
        hx-on:click="const li = this.closest('li'); if (li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling)">${icon('chevron-up')}</button>
      <button type="button" class="uk-button uk-button-default uk-button-small" title="Move ${esc(what)} down"
        hx-on:click="const li = this.closest('li'); if (li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li)">${icon('chevron-down')}</button>
    </span>`;
}

/** One command, as a row that can be dragged. */
function commandRow(c, scope, kind, named, folderCount) {
  // Where it came from, on the global tab only, and only when it is not in every folder: the same
  // builder is in five of them, and on a workspace's own tab saying so again would be noise.
  const where = scope === 'global' && c.where.length < folderCount
    ? `<span class="uk-text-meta build-order-where">${esc(c.where.join(', '))}</span>` : '';
  return `<li class="nav-entry build-order-row" data-id="${esc(c.file)}">
    <input type="hidden" name="${KIND_META[kind].field}" value="${esc(c.file)}">
    <span class="nav-handle" title="Drag to move it">${icon('table')}</span>
    <span class="nav-entry-label">${esc(c.label)}</span>
    ${where}
    <code class="uk-text-meta build-order-file">${esc(c.file)}</code>
    ${named.has(c.file) ? '<span class="uk-label nav-yours" title="This scope names it: it is placed by this list">placed</span>' : ''}
    ${moveArrows(c.label)}
  </li>`;
}

/** One kind's list, with its own heading. Dragging is confined to it: a builder cannot become a tool. */
function groupHtml(scope, kind, own, folderCount) {
  const meta = KIND_META[kind];
  const items = commandsFor(scope, kind);
  const named = new Set(own[kind]);
  return `<section class="build-order-group">
    <header class="nav-group-head"><strong>${esc(meta.title)}</strong>
      <span class="uk-text-meta">· ${esc(meta.what)}</span></header>
    ${items.length
    ? `<ol class="nav-entries build-order-list" uk-sortable="group: build-order-${kind}; handle: .nav-handle">
        ${items.map((c) => commandRow(c, scope, kind, named, folderCount)).join('')}
      </ol>`
    : `<p class="uk-text-meta">${meta.empty}</p>`}
  </section>`;
}

/**
 * The editor for one scope.
 *
 * Both lists are in ONE form and nothing is saved until Save — the same rule as the navigation, so a
 * drag is never half-applied and leaving the page changes nothing. One form and not two because they
 * are one arrangement: rearranging the tools and then the builders should be one save, not two.
 */
function editorHtml(scope, message) {
  const { raw, mtime } = order.loadOrder();
  const own = order.scopeOrder(raw, scope);
  const label = scope === 'global' ? 'every workspace' : ((loadWorkspaces()[scope] || {}).label || scope);
  const folderCount = orderableWorkspaces().length;
  const placed = order.KINDS.reduce((n, k) => n + own[k].length, 0);

  return `<div id="build-order-editor">
    ${message || ''}
    ${scopeTabsHtml(scope)}
    <p class="uk-text-meta">The order of the commands in ${esc(label)}.
      ${scope === 'global'
    ? 'A workspace can put its own first on its own tab, and what it does not mention falls back to this list.'
    : 'Applied before the global order. What this list does not mention falls back to it.'}
      Drag by the handle, or move with the arrows. Saving writes down only what sits above the commands
      you left alone — everything else keeps its shipped place, then its alphabetical one, so a command
      added later still arrives where it belongs without anyone editing this.</p>

    <form id="build-order-form" hx-post="/actions/build-order-save" hx-target="#build-order-editor" hx-swap="outerHTML">
      <input type="hidden" name="scope" value="${esc(scope)}">
      <!-- The file's mtime, so a save that would land on top of somebody else's is refused with a 409
           and the list it would have overwritten, the way every other writer here works. -->
      <input type="hidden" name="mtime" value="${mtime}">
      ${order.KINDS.map((k) => groupHtml(scope, k, own, folderCount)).join('')}
      <p class="settings-actions">
        <button class="uk-button uk-button-primary uk-button-small" type="submit">Save the order</button>
        ${placed ? `<button class="uk-button uk-button-default uk-button-small arm-step" type="button"
            title="Forget this scope's order and go back to the shipped one"
            hx-post="/actions/build-order-reset" hx-vals='${esc(JSON.stringify({ scope }))}'
            hx-target="#build-order-editor" hx-swap="outerHTML"
            hx-trigger="confirmed-remove">Reset ${esc(scope === 'global' ? 'every workspace' : label)}</button>` : ''}
      </p>
    </form>
  </div>`;
}

module.exports = { editorHtml, commandsFor, orderableWorkspaces, scopeTabsHtml, KIND_META };
