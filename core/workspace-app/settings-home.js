/**
 * Settings home: the base first, then every plugin by family, each with its state and one action.
 *
 * The page answers "what is on here and what does it want from me" before any file is opened. The
 * base is five entries (the styles are one of them, not a tile per theme file); a plugin is one row
 * that says its state in words and offers the one step that comes next; a filter narrows both. The
 * rules are settings-model.js's, so this file only draws. It works with no script: every row is a
 * link, the state is in the HTML, and the filter (ui.js) is shown only when it can run.
 */

const { esc } = require('./html');
const { iconHtml } = require('./icons');
const model = require('./settings-model');

const pluginHref = (name) => `/settings/plugin/${encodeURIComponent(name)}`;

/**
 * A plugin's state: one pill, in words with an icon, never colour alone. The reason for it (its note)
 * is the pill's title; the plugin's page says it in full. `withUpdate` adds the newer version as a
 * second pill, which only the plugin's own page does: on a row it is quiet text beside the name.
 */
function stateHtml(state, { withUpdate = true } = {}) {
  return `<span class="plugin-state is-${esc(state.tone)}"${state.note ? ` title="${esc(state.note)}"` : ''}>${iconHtml(state.icon, 0.8)}<span>${esc(state.label)}</span></span>${
    withUpdate && state.update ? `<span class="plugin-state is-info">${iconHtml('tabler:arrow-up-circle', 0.8)}<span>Update ${esc(state.update)}</span></span>` : ''}`;
}

const nameOf = (p) => p.label || (p.manifest && p.manifest.label) || p.name;
const commandOf = (p, a) => `bash core/scripts/plugins.sh --${a.verb} ${p.name}${a.withNeeds ? ' --with-needs' : ''}`;

/** The one action of a state, in full: a step the script runs (a button), or a place to go (a link). Used on a plugin's page. */
function actionHtml(plugin, { primary = false, target = '#webship-workspace-output' } = {}) {
  const a = plugin.state.action;
  const label = nameOf(plugin);
  const cls = `uk-button uk-button-${primary ? 'primary' : 'default'} uk-button-small plugin-action`;
  if (a.kind === 'link') return `<a class="${cls}" href="${esc(a.href)}" aria-label="${esc(`${a.label} ${label}`)}">${esc(a.label)}</a>`;
  return `<button type="button" class="${cls}" hx-post="/actions/plugins"
      hx-vals='${esc(JSON.stringify({ verb: a.verb, name: plugin.name, ...(a.withNeeds ? { withNeeds: '1' } : {}) }))}'
      hx-target="${esc(target)}" hx-swap="innerHTML" title="${esc(commandOf(plugin, a))}" aria-label="${esc(`${a.label}: ${label}`)}">${esc(a.label)}</button>`;
}

const SHORT = { activate: 'Activate', install: 'Install' };

/**
 * The action of a row. Only a row with work to do carries a button: a step the script runs (the short
 * word on the button, the full sentence in its name: "Activate with specs: Notes"), or Configure, which
 * blocks as much as Install does and is as prominent. A row that needs nothing ends in a quiet chevron:
 * the whole row is already the link to the plugin's page, and a second link to the same place on 18
 * rows was 18 extra stops for a keyboard.
 */
function rowActionHtml(p) {
  const a = p.state.action;
  const label = nameOf(p);
  if (a.kind === 'link' && p.state.id === 'ready') return `<span class="plugin-row-chevron" aria-hidden="true">${iconHtml('tabler:chevron-right', 0.9)}</span>`;
  if (a.kind === 'link') return `<a class="uk-button uk-button-${p.state.attention ? 'primary' : 'default'} uk-button-small plugin-action" href="${esc(a.href)}" aria-label="${esc(`${a.label} ${label}`)}">${esc(a.label)}</a>`;
  const short = a.label.startsWith('Add ') || a.label === 'Reinstall' ? a.label : (SHORT[a.verb] || a.label);
  return `<button type="button" class="uk-button uk-button-${p.state.attention ? 'primary' : 'default'} uk-button-small plugin-action" data-refocus-item="action" hx-post="/actions/plugins"
      hx-vals='${esc(JSON.stringify({ verb: a.verb, name: p.name, ...(a.withNeeds ? { withNeeds: '1' } : {}) }))}'
      hx-target="#webship-workspace-output" hx-swap="innerHTML" title="${esc(commandOf(p, a))}" aria-label="${esc(`${a.label}: ${label}`)}">${esc(short)}</button>`;
}

/**
 * One plugin, one row: its name (with what is beside the state in quiet text: a newer version, a need
 * that is not here), the line that says what it is, one state pill, one action. The second line is
 * always what the plugin is, so it can be read down the list; why it is in its state is on the pill's
 * title and on its page.
 */
function pluginRowHtml(p) {
  const label = nameOf(p);
  const find = [label, p.name, p.module, p.summary, p.state.label, p.state.update ? 'update' : '', model.familyById(p.family).label].join(' ').toLowerCase();
  const withNeeds = p.state.action.kind === 'post' && p.state.action.withNeeds;
  const extras = [
    p.state.update ? `<span class="plugin-row-extra">${esc(p.version || '')} → ${esc(p.state.update)}</span>` : '',
    withNeeds && p.state.note ? `<span class="plugin-row-extra">${esc(p.state.note.replace(/, which is not here yet$/, '').replace(/^Needs /, 'needs '))}</span>` : '',
  ].join('');
  return `
      <li class="plugin-row" data-refocus="row-${esc(p.name)}" data-find="${esc(find)}" data-active="${p.state.active ? '1' : '0'}" data-attention="${p.state.attention ? '1' : '0'}" data-update="${p.state.update ? '1' : '0'}" data-state="${esc(p.state.id)}">
        <a class="plugin-row-main uk-link-reset" href="${esc(pluginHref(p.name))}">
          <span class="plugin-row-title"><span class="plugin-row-name">${esc(label)}</span>${extras}</span>
          <span class="plugin-row-summary">${esc(p.summary || 'No description')}</span>
        </a>
        <span class="plugin-row-state">${stateHtml(p.state, { withUpdate: false })}</span>
        <span class="plugin-row-action">${rowActionHtml(p)}</span>
      </li>`;
}

function familyHtml(f) {
  return `
    <section class="settings-family" data-family="${esc(f.id)}">
      <h3 class="settings-family-head" id="settings-family-${esc(f.id)}">${iconHtml(f.icon, 0.9)}<span>${esc(f.label)}</span>
        <span class="settings-family-count">${f.plugins.length}</span></h3>
      <p class="settings-family-about">${esc(f.about)}</p>
      <ul class="plugin-rows">${f.plugins.map(pluginRowHtml).join('')}</ul>
    </section>`;
}

/** What npm says about newer versions, in a line: which plugins, or that it could not be asked. Nothing when there is nothing to say. */
function updatesLineHtml(outdated = [], error = '') {
  if (error) return `<p class="settings-updates-line is-unknown">${iconHtml('tabler:cloud-off', 0.9)}<span>npm could not be asked for newer versions (${esc(error)}). The versions shown are the ones installed here.</span></p>`;
  if (!outdated.length) return '';
  return `<p class="settings-updates-line">${iconHtml('tabler:arrow-up-circle', 0.9)}<span>${outdated.length === 1 ? 'A newer version is' : `${outdated.length} newer versions are`} on npm: ${
    outdated.map((u) => `<a href="${esc(pluginHref(u.name))}">${esc(u.label)} ${esc(u.version)} → ${esc(u.latest)}</a>`).join(', ')}.</span></p>`;
}

/** The plugins of this workspace by family: the part of the page that is drawn again when a step has run. */
function pluginsSectionHtml(groups, { only = '' } = {}) {
  const n = model.counts(groups);
  // The one number that says whether anything is waiting is a way to those plugins, not a grey sentence.
  const summary = n.all
    ? `<span>${n.all} added</span> · <span>${n.ready} ready</span>${n.attention ? ` · <button type="button" class="settings-summary-link" data-press-chip="attention">${n.attention} need${n.attention === 1 ? 's' : ''} attention</button>` : ''}${n.inactive ? ` · <span>${n.inactive} not active</span>` : ''}`
    : '';
  const empty = `
      <div class="settings-empty">
        <p><strong>No plugins yet.</strong> The base ships empty: folders, platforms, hosting, forges and features are added one package at a time.</p>
        <p><a class="uk-button uk-button-primary uk-button-small" href="/settings/plugins">Choose from the catalogue</a>
          <span class="uk-text-meta">or <code>webship-workspace plugin require &lt;name&gt;</code></span></p>
      </div>`;
  // `only: 'attention'` is the settings modal's overview: the plugins that want something, nothing else
  // (the modal's own list is beside it).
  const shown = only === 'attention'
    ? groups.map((g) => ({ ...g, plugins: g.plugins.filter((p) => p.state.attention) })).filter((g) => g.plugins.length)
    : groups;
  const body = !n.all ? empty
    : shown.length ? shown.map(familyHtml).join('')
      : '<p class="settings-quiet">Nothing needs attention: every plugin that is active is ready.</p>';
  return `
    <section class="settings-group settings-plugins" id="settings-plugins" aria-labelledby="settings-plugins-head"
             hx-get="/fragments/settings/plugins${only ? `?only=${esc(only)}` : ''}" hx-trigger="refresh-projects from:body" hx-swap="outerHTML"
             data-count-all="${n.all}" data-count-attention="${n.attention}" data-count-active="${n.active}" data-count-inactive="${n.inactive}" data-count-updates="${n.updates}">
      <div class="settings-group-bar">
        <h2 class="settings-group-head" id="settings-plugins-head">${only === 'attention' ? 'Plugins that need attention' : 'Plugins'}</h2>
        <span class="settings-group-summary">${summary}</span>
        <a class="uk-button uk-button-default uk-button-small settings-add" href="/settings/plugins">${iconHtml('tabler:plus', 0.8)} Add a plugin</a>
      </div>
      ${body}
    </section>`;
}

function tileHtml({ href, icon, title, hint, find = '' }) {
  return `
    <a class="settings-tile" href="${esc(href)}" data-find="${esc(`${title} ${hint} ${find}`.toLowerCase())}">
      <span class="settings-tile-icon">${iconHtml(icon, 1)}</span>
      <span class="settings-tile-name">${esc(title)}</span>
      <span class="settings-tile-meta">${esc(hint)}</span>
    </a>`;
}

/**
 * The whole home page body.
 * `files` are the settings files under core/config, `groups` the plugins by family (model.groupByFamily),
 * `folders` the workspaces' presentation by key, `styles` `{ count, wearing }`.
 */
function homeHtml({ files = [], plugins = [], groups = [], folders = {}, styles = { count: 0, wearing: '' }, compact = false } = {}) {
  const sorted = model.sortFiles(files, plugins);
  const n = model.counts(groups);
  // In the settings modal the list of everything is the modal's own sidebar, with its own filter: the
  // overview says what is waiting and nothing twice.
  if (compact) {
    return `
  <div class="settings-home is-compact">
    <div class="settings-updates" hx-get="/fragments/settings/updates" hx-trigger="load" hx-swap="innerHTML" role="status"></div>
    ${pluginsSectionHtml(groups, { only: 'attention' })}
    <p class="settings-quiet">Every setting and every plugin is in the list beside this; the filter above it narrows the list.</p>
  </div>`;
  }
  const base = [
    ...sorted.general.map((f) => ({ href: `/settings/${encodeURIComponent(f)}`, icon: 'tabler:settings', title: 'General', hint: 'Name, install account, credit, forges, AI keys', find: `${f} ${model.fileHint(f)}` })),
    { href: '/settings/navigation', icon: 'tabler:layout-sidebar-right', title: 'Navigation', hint: 'The sidebar and the top bar' },
    { href: '/settings/buttons', icon: 'tabler:layout-grid', title: 'Buttons', hint: 'What every project row offers' },
    { href: '/settings/command-order', icon: 'tabler:sort-ascending-letters', title: 'Command order', hint: 'Builders first, then tools' },
    { href: '/settings/styles', icon: 'tabler:palette', title: 'Styles',
      hint: `${styles.count} style${styles.count === 1 ? '' : 's'}${styles.wearing ? ` · wearing ${styles.wearing}` : ''}`, find: `themes theme style.yml ${sorted.styles.join(' ')}` },
  ];
  const loose = [
    ...sorted.folders.map((f) => {
      const key = f.replace(/^workspace\.|\.settings\.yml$/g, '');
      const m = folders[key] || {};
      return { href: `/settings/${encodeURIComponent(f)}`, icon: m.icon || 'tabler:folder', title: m.label || key, hint: model.fileHint(f, { folderSubtitle: m.subtitle }), find: f };
    }),
    ...sorted.other.map((f) => ({ href: `/settings/${encodeURIComponent(f)}`, icon: 'tabler:file-settings', title: f, hint: model.fileHint(f), find: f })),
  ];
  const chip = (show, label, count, { pressed = false, hidden = false } = {}) => `<button type="button" class="settings-chip" data-show="${show}" aria-pressed="${pressed ? 'true' : 'false'}"${hidden ? ' hidden' : ''}>${esc(label)} <span class="settings-chip-count" data-count="${show}">${count}</span></button>`;
  return `
  <div class="settings-home">
    <div class="settings-search" hidden>
      <label class="settings-search-label" for="settings-search-input">Find a setting or a plugin</label>
      <div class="settings-search-row">
        <input type="search" class="uk-input" id="settings-search-input" placeholder="jira, hosting, navigation, not installed" autocomplete="off" aria-describedby="settings-search-status">
        <div class="settings-chips" role="group" aria-label="Which plugins to show">
          ${chip('all', 'All', n.all, { pressed: true })}${chip('attention', 'Needs attention', n.attention)}${chip('updates', 'Updates', n.updates, { hidden: !n.updates })}${chip('active', 'Active', n.active)}${chip('inactive', 'Not active', n.inactive)}
        </div>
      </div>
      <p class="settings-search-status" id="settings-search-status" role="status" aria-live="polite"></p>
    </div>
    <section class="settings-group settings-base" aria-labelledby="settings-base-head">
      <h2 class="settings-group-head" id="settings-base-head">Workspace base</h2>
      <div class="settings-grid">${base.map(tileHtml).join('')}</div>
    </section>
    <div class="settings-updates" hx-get="/fragments/settings/updates" hx-trigger="load" hx-swap="innerHTML" role="status"></div>
    ${pluginsSectionHtml(groups)}
    ${loose.length ? `
    <section class="settings-group settings-loose" aria-labelledby="settings-loose-head">
      <h2 class="settings-group-head" id="settings-loose-head">Other settings files</h2>
      <p class="settings-family-about">Files under <code>core/config</code> that no plugin added here owns: a folder made by hand, or a file left by a plugin that is gone.</p>
      <div class="settings-grid">${loose.map(tileHtml).join('')}</div>
    </section>` : ''}
    <div class="settings-empty settings-none" hidden>
      <p><strong>Nothing matches.</strong> Clear the filter, or look in <a href="/settings/plugins">the catalogue</a> for a plugin that is not added yet.</p>
    </div>
  </div>`;
}

module.exports = { homeHtml, updatesLineHtml, pluginsSectionHtml, pluginRowHtml, rowActionHtml, stateHtml, actionHtml, pluginHref, nameOf };
