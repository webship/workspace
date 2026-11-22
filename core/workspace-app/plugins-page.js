/**
 * Settings → Add a plugin: where a plugin is added, and what every Settings page knows of the plugins.
 *
 * `rows()` is every plugin package the dashboard can see with the step it is at, what it needs and
 * who needs it; the Settings home and a plugin's own page draw from it (settings-home.js,
 * settings-plugin-page.js). The page itself is the box that requires a package, the catalogue by
 * family, and the commands the core needs on this machine. The four steps are exactly
 * core/scripts/plugins.sh's verbs — every button runs that script as a job, so the button and the
 * command line cannot disagree.
 *
 *   require    npm install <spec> into core/workspace-app (a GitHub repo, a tarball, a path)
 *   activate   plugins.<name>.enabled: true in settings.yml
 *   install    place what the manifest names: bash functions, commands, compose files, a theme
 *   configure  the plugin's own core/config/plugin.<name>.settings.yml
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html.mts');
const { installedPlugins, needsInstall } = require('./plugin-manifest');
const needs = require('./plugin-needs');
const commandCheck = require('./command-check');
const { status, RECORD } = require('./plugin-install');
const { pluginConfigs, loadedPlugins } = require('./plugin-loader');
const { ROOT, CONFIG_DIR } = require('./workspaces');
const { FAMILIES, SCOPE } = require('./plugin-catalog.mts');

const STEPS = ['required', 'activated', 'installed', 'configured'];

/**
 * Whether a settings file still holds a placeholder: CHANGE_ME in the value of a key, bare, quoted or
 * inside a longer value ("https://CHANGE_ME.atlassian.net"). A comment that mentions it does not count.
 */
function hasPlaceholder(text) {
  return placeholderKeys(text).length > 0;
}

/** The keys of a settings file whose value still holds the placeholder, dotted (`git.token`), in file order (#433). */
function placeholderKeys(text) {
  const keys = [];
  const stack = [];   // [{ indent, key }]
  for (const line of String(text || '').split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const m = line.match(/^(\s*)(?:-\s+)?([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const value = m[3].replace(/\s+#.*$/, '');
    if (value.trim() === '') { stack.push({ indent, key: m[2] }); continue; }
    if (/CHANGE_ME/.test(value)) keys.push([...stack.map((x) => x.key), m[2]].join('.'));
  }
  return keys;
}

/** Where a plugin is on the way to ready. */
function stepOf(plugin, config, placed) {
  const active = config && (config.enabled === true || String(config.enabled) === 'true');
  if (!active) return 0;
  // A plugin that ships nothing to place is installed by being required.
  if (needsInstall(plugin.manifest) && !(placed && placed.installed)) return 1;
  const file = plugin.manifest && plugin.manifest.settingsFile;
  if (file && !fs.existsSync(path.join(CONFIG_DIR, file))) return 2;
  if (file) {
    try {
      const text = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8');
      if (hasPlaceholder(text)) return 2;
    } catch (_) { return 2; }
  }
  return 3;
}

function rows() {
  const configs = pluginConfigs();
  const placed = Object.fromEntries(status().map((s) => [s.name, s]));
  const loaded = new Set(loadedPlugins.map((l) => l.name));
  const st = needs.state();
  return installedPlugins().map((p) => {
    const step = stepOf(p, configs[p.name], placed[p.name]);
    const wants = needs.check(p.name, st);
    // Which keys still hold the placeholder, so "Needs settings" can say which (#433).
    let todo = [];
    const file = p.manifest && p.manifest.settingsFile;
    if (file) { try { todo = placeholderKeys(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8')); } catch (_) { /* no file yet: the note says so */ } }
    return { ...p, step, todo, loaded: loaded.has(p.name), placed: placed[p.name] || {}, config: configs[p.name] || {},
      wants, commands: commandCheck.checkOwner(p.name, p.manifest).rows, needsLine: needs.summary(wants), neededBy: [...new Set(needs.dependents(p.name, st).map((d) => d.name))] };
  });
}

/**
 * Settings → Add a plugin: where a plugin is added. The plugins that are already here live on the Settings
 * home (one row each, by family) and on their own pages; this page is the box that adds any package,
 * the catalogue by family under the same filter, and (closed, at the end) the commands the base uses.
 */
function pluginsPageHtml() {
  const model = require('./settings-model');
  const list = rows();
  const grouped = model.groupByFamily(list, { latest: require('./plugin-updates.mts').peek().latest, isNewer: require('./plugin-updates.mts').isNewer }).flatMap((g) => g.plugins);
  const added = new Map(grouped.map((p) => [p.module, p]));
  const chip = (show, label, count, pressed = false) => `<button type="button" class="settings-chip" data-show="${show}" aria-pressed="${pressed ? 'true' : 'false'}">${esc(label)} <span class="settings-chip-count">${count}</span></button>`;
  const all = FAMILIES.reduce((n, f) => n + f.plugins.length, 0);
  const here = FAMILIES.reduce((n, f) => n + f.plugins.filter(([name]) => added.has(`${SCOPE}/workspace-${name}`)).length, 0);
  return `
  <div class="settings-home plugins-add">
    <section class="settings-group plugin-require-section" aria-labelledby="plugin-require-head">
      <h2 class="settings-group-head" id="plugin-require-head">Add a plugin</h2>
      <p class="settings-family-about">A plugin is a package of its own (<code>${SCOPE}/workspace-&lt;name&gt;</code>); only Workspace notes ships with the base. Adding one here is the first of four steps
        (require); it is then activated, installed and configured on its own page, which opens from
        <a href="/settings">Settings</a>${here ? ` (${here} added from this catalogue so far)` : ''}. The same as <code>bash core/scripts/plugins.sh</code>.</p>
      <form class="plugin-require" hx-post="/actions/plugins" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="verb" value="require">
        <label class="settings-search-label" for="plugin-require-spec">Add a package by name</label>
        <div class="settings-search-row">
          <input class="uk-input" id="plugin-require-spec" name="spec" placeholder="e.g. ${SCOPE}/workspace-jira" required pattern="[A-Za-z0-9@:\\/._#+~\\-]+" aria-describedby="plugin-require-help">
          <button class="uk-button uk-button-default" type="submit">Add</button>
        </div>
        <p class="settings-search-status" id="plugin-require-help">An npm name, <code>github:owner/repo</code>, a git URL, a tarball or a path. Nothing else is installed with it.</p>
      </form>
    </section>
    <div class="settings-search" hidden>
      <label class="settings-search-label" for="settings-search-input">Find a plugin in the catalogue</label>
      <div class="settings-search-row">
        <input type="search" class="uk-input" id="settings-search-input" placeholder="e.g. hosting, wordpress, jira" autocomplete="off" aria-describedby="settings-search-status">
        <div class="settings-chips" role="group" aria-label="Which plugins to show">
          ${chip('all', 'All', all, true)}${chip('inactive', 'Not added', all - here)}${chip('active', 'Added', here)}
        </div>
      </div>
      <p class="settings-search-status" id="settings-search-status" role="status" aria-live="polite"></p>
    </div>
    ${catalogHtml(added)}
    <div class="settings-empty settings-none" hidden>
      <p><strong>Nothing in the catalogue matches.</strong> A package that is not listed can still be added by name, in the box above.</p>
    </div>
    ${commandsSectionHtml()}
  </div>`;
}

const commandLabel = (r) => `${r.anyOf.length > 1 ? `one of ${r.anyOf.join(', ')}` : r.anyOf[0]}${r.where === 'host' ? '' : ` (${r.where})`}`;

/** One command as the card and the table show it: found with its version, missing with how to install it, or not checked from here. */
function commandStateHtml(r) {
  if (r.state === 'found') return `<span class="uk-text-success" title="${esc(r.path)}">✓${r.version ? ` ${esc(r.version)}` : ''}</span>`;
  if (r.state === 'unchecked') return `<span class="uk-text-meta" title="${esc(r.why)}">not checked</span>`;
  return `<span class="${r.kind === 'needs' ? 'uk-text-danger' : 'uk-text-warning'}" title="${esc(r.hint)}">missing</span>`;
}

/**
 * The commands the base uses on this machine: what `webship-workspace doctor` prints, as a table.
 * It is not the catalogue, so it sits at the end, closed, and says in its summary whether anything
 * is missing. Nothing here installs anything.
 */
function commandsSectionHtml() {
  const core = commandCheck.checkCore();
  // DDEV is the default runtime, not the only one: a project on another runtime gets that runtime's plugin.
  const why = (r) => (r.kind !== 'needs' ? 'A part uses it' : r.anyOf.includes('ddev') ? 'Needed by the builders that use DDEV, the default runtime' : 'Needed');
  const row = (r) => `<tr class="command-row is-${r.state}"><td><code>${esc(commandLabel(r))}</code></td><td>${why(r)}</td><td>${commandStateHtml(r)}</td><td class="uk-text-meta">${r.state === 'missing' ? `Install it yourself — ${esc(r.hint)}` : esc(r.state === 'unchecked' ? r.why : r.for)}</td></tr>`;
  const missing = core.rows.filter((r) => r.state === 'missing');
  return `
    <details class="plugin-commands-section">
      <summary><span class="plugin-commands-title">Commands on this machine</span>
        <span class="plugin-commands-count">${core.rows.length} the base uses${missing.length ? ` · ${missing.length} missing` : ' · none missing'}</span></summary>
      <p class="uk-text-meta">What the base calls, and whether it is here: the same as <code>webship-workspace doctor</code> (or <code>bash core/scripts/plugins.sh --check</code>), which also covers the host when the dashboard runs in its container. A plugin's own commands are on its page. Nothing is installed for you.</p>
      ${missing.length ? `<p class="${missing.some((r) => r.kind === 'needs') ? 'uk-text-danger' : 'uk-text-warning'} uk-text-small plugin-commands-missing">Missing: ${esc(missing.map(commandLabel).join(', '))}.</p>` : ''}
      <div class="uk-overflow-auto" tabindex="0" role="region" aria-label="Commands on this machine">
      <table class="uk-table uk-table-small uk-table-divider plugin-commands-table">
        <thead><tr><th scope="col">Command</th><th scope="col">Needed</th><th scope="col">Here</th><th scope="col">Used for</th></tr></thead>
        <tbody>${core.rows.map(row).join('')}</tbody>
      </table>
      </div>
    </details>`;
}

/**
 * The catalogue: every plugin a person can add, by family, one row each: its name (the one Settings
 * uses everywhere), the line that says what it does, and its short id. What it needs is on its page,
 * not here. A plugin that is here shows the state it is in and leads to its page; the rest get an Add
 * button. `added` is the plugins that are here, by module name (a Map of grouped plugins with their
 * state, or just a Set of module names).
 */
function catalogHtml(added = new Set()) {
  const { iconHtml } = require('./icons.mts');
  const model = require('./settings-model');
  const home = require('./settings-home');
  const families = FAMILIES.map((f) => {
    const fam = model.familyById({ workspaces: 'folders', drives: 'features' }[f.id] || f.id);
    return `
      <section class="settings-family plugin-family" data-family="${esc(f.id)}">
        <h3 class="settings-family-head" id="catalog-family-${esc(f.id)}">${iconHtml(fam.icon, 0.9)}<span>${esc(f.label)}</span> <span class="settings-family-count">${f.plugins.length}</span></h3>
        <p class="settings-family-about">${esc(f.about)}</p>
        <ul class="plugin-rows plugin-catalog">
          ${f.plugins.map(([name, label, summary]) => {
    const module = `${SCOPE}/workspace-${name}`;
    const present = added.has(module);
    const p = added instanceof Map ? added.get(module) : null;
    const page = `/settings/plugin/${encodeURIComponent((p && p.name) || name)}`;
    const line = `<span class="plugin-row-title"><span class="plugin-row-name">${esc(label)}</span><span class="plugin-row-extra plugin-row-id" title="${esc(module)}">${esc(name)}</span></span>
              <span class="plugin-row-summary">${esc(summary)}</span>`;
    const state = !present ? '' : p && p.state ? home.stateHtml(p.state, { withUpdate: false })
      : `<span class="plugin-state is-ok">${iconHtml('tabler:circle-check', 0.8)}<span>Added</span></span>`;
    return `<li class="plugin-row" data-find="${esc(`${label} ${name} ${module} ${summary} ${f.label}`.toLowerCase())}" data-active="${present ? '1' : '0'}" data-attention="0">
              ${present ? `<a class="plugin-row-main uk-link-reset" href="${esc(page)}">${line}</a>` : `<span class="plugin-row-main">${line}</span>`}
              <span class="plugin-row-state">${state}</span>
              <span class="plugin-row-action">${present
    ? `<span class="plugin-row-chevron" aria-hidden="true">${iconHtml('tabler:chevron-right', 0.9)}</span>`
    : `<button type="button" class="uk-button uk-button-default uk-button-small plugin-action" hx-post="/actions/plugins" hx-vals='{"verb":"require","spec":"${esc(module)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" title="bash core/scripts/plugins.sh --require ${esc(module)}" aria-label="${esc(`Add ${label}`)}">Add</button>`}</span>
            </li>`;
  }).join('')}
        </ul>
      </section>`;
  }).join('');
  return `
    <section class="settings-group plugin-catalog-section" id="settings-catalog" aria-labelledby="settings-catalog-head"
             hx-get="/fragments/settings/catalog" hx-trigger="refresh-projects from:body" hx-swap="outerHTML">
      <h2 class="settings-group-head" id="settings-catalog-head">Catalogue</h2>
      ${families}
    </section>`;
}

module.exports = { pluginsPageHtml, catalogHtml, commandsSectionHtml, rows, stepOf, hasPlaceholder, placeholderKeys, needsInstall, STEPS };
