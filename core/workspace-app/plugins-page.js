/**
 * Settings → Plugins: where a plugin is added, and what every Settings page knows of the plugins.
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

const { esc } = require('./html');
const { installedPlugins, needsInstall } = require('./plugin-manifest');
const needs = require('./plugin-needs');
const commandCheck = require('./command-check');
const { status, RECORD } = require('./plugin-install');
const { pluginConfigs, loadedPlugins } = require('./plugin-loader');
const { ROOT, CONFIG_DIR } = require('./workspaces');
const { FAMILIES, SCOPE } = require('./plugin-catalog');

const STEPS = ['required', 'activated', 'installed', 'configured'];

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
      if (/:\s*CHANGE_ME\s*$/m.test(text)) return 2;
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
    return { ...p, step, loaded: loaded.has(p.name), placed: placed[p.name] || {}, config: configs[p.name] || {},
      wants, commands: commandCheck.checkOwner(p.name, p.manifest).rows, needsLine: needs.summary(wants), neededBy: [...new Set(needs.dependents(p.name, st).map((d) => d.name))] };
  });
}

/**
 * Settings → Plugins: where a plugin is added. The plugins that are already here live on the Settings
 * home (one row each, by family) and on their own pages; this page is the box that requires any
 * package, the catalogue by family under the same filter, and the commands the core needs.
 */
function pluginsPageHtml() {
  const list = rows();
  const have = new Map(list.map((p) => [p.module, p.name]));
  const chip = (show, label, count, pressed = false) => `<button type="button" class="settings-chip" data-show="${show}" aria-pressed="${pressed ? 'true' : 'false'}">${esc(label)} <span class="settings-chip-count">${count}</span></button>`;
  const all = FAMILIES.reduce((n, f) => n + f.plugins.length, 0);
  const added = FAMILIES.reduce((n, f) => n + f.plugins.filter(([name]) => have.has(`${SCOPE}/workspace-${name}`)).length, 0);
  return `
  <div class="settings-home plugins-add">
    <section class="settings-group plugin-require-section" aria-labelledby="plugin-require-head">
      <h2 class="settings-group-head" id="plugin-require-head">Add a plugin</h2>
      <p class="settings-family-about">The base ships empty. A plugin is a package of its own (<code>${SCOPE}/workspace-&lt;name&gt;</code>), turned on in four steps:
        <strong>require</strong> it here, then <strong>activate</strong>, <strong>install</strong> and <strong>configure</strong> it on its own page, which opens from
        <a href="/settings">Settings</a>${list.length ? ` (${list.length} added so far)` : ''}. The same as <code>bash core/scripts/plugins.sh</code>.</p>
      <form class="plugin-require" hx-post="/actions/plugins" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="verb" value="require">
        <label class="settings-search-label" for="plugin-require-spec">Require a package by name</label>
        <div class="settings-search-row">
          <input class="uk-input" id="plugin-require-spec" name="spec" placeholder="${SCOPE}/workspace-jira" required pattern="[A-Za-z0-9@:\\/._#+~\\-]+" aria-describedby="plugin-require-help">
          <button class="uk-button uk-button-default" type="submit">Require</button>
        </div>
        <p class="settings-search-status" id="plugin-require-help">An npm name, <code>github:owner/repo</code>, a git URL, a tarball or a path. Nothing else is installed with it.</p>
      </form>
    </section>
    <div class="settings-search" hidden>
      <label class="settings-search-label" for="settings-search-input">Find a plugin in the catalogue</label>
      <div class="settings-search-row">
        <input type="search" class="uk-input" id="settings-search-input" placeholder="hosting, wordpress, jira" autocomplete="off" aria-describedby="settings-search-status">
        <div class="settings-chips" role="group" aria-label="Which plugins to show">
          ${chip('all', 'All', all, true)}${chip('inactive', 'Not added', all - added)}${chip('active', 'Added', added)}
        </div>
      </div>
      <p class="settings-search-status" id="settings-search-status" role="status" aria-live="polite"></p>
    </div>
    ${catalogHtml(have, new Map(list.filter((p) => p.needsLine).map((p) => [p.module, p.needsLine])))}
    <div class="settings-empty settings-none" hidden>
      <p><strong>Nothing in the catalogue matches.</strong> A package that is not listed can still be required by name, in the box above.</p>
    </div>
    ${commandsSectionHtml()}
    <p class="uk-text-meta uk-margin-small-top">What each install placed is recorded in <code>${esc(path.relative(ROOT, RECORD))}</code>.</p>
  </div>`;
}

const commandLabel = (r) => `${r.anyOf.length > 1 ? `one of ${r.anyOf.join(', ')}` : r.anyOf[0]}${r.where === 'host' ? '' : ` (${r.where})`}`;

/** One command as the card and the table show it: found with its version, missing with how to install it, or not checked from here. */
function commandStateHtml(r) {
  if (r.state === 'found') return `<span class="uk-text-success" title="${esc(r.path)}">✓${r.version ? ` ${esc(r.version)}` : ''}</span>`;
  if (r.state === 'unchecked') return `<span class="uk-text-meta" title="${esc(r.why)}">not checked</span>`;
  return `<span class="${r.kind === 'needs' ? 'uk-text-danger' : 'uk-text-warning'}" title="${esc(r.hint)}">missing</span>`;
}

/** The commands the core needs on this machine: what `webship-workspace doctor` prints, as a table. Nothing here installs anything. */
function commandsSectionHtml() {
  const core = commandCheck.checkCore();
  const row = (r) => `<tr class="command-row is-${r.state}"><td><code>${esc(commandLabel(r))}</code></td><td>${r.kind === 'needs' ? 'needed' : 'a part uses it'}</td><td>${commandStateHtml(r)}</td><td class="uk-text-meta">${r.state === 'missing' ? `Install it yourself — ${esc(r.hint)}` : esc(r.state === 'unchecked' ? r.why : r.for)}</td></tr>`;
  const missing = core.rows.filter((r) => r.state === 'missing');
  return `
    <section class="settings-group plugin-commands-section">
      <h2 class="settings-group-head">Commands on this machine</h2>
      <p class="uk-text-meta">What the core calls, and whether it is here: the same as <code>webship-workspace doctor</code> (or <code>bash core/scripts/plugins.sh --check</code>), which also covers the host when the dashboard runs in its container. A plugin's own commands are on its card above. Nothing is installed for you.</p>
      ${missing.length ? `<p class="${missing.some((r) => r.kind === 'needs') ? 'uk-text-danger' : 'uk-text-warning'} uk-text-small plugin-commands-missing">Missing: ${esc(missing.map(commandLabel).join(', '))}.</p>` : ''}
      <div class="uk-overflow-auto" tabindex="0" role="region" aria-label="Commands on this machine">
      <table class="uk-table uk-table-small uk-table-divider plugin-commands-table">
        <thead><tr><th>Command</th><th></th><th>Here</th><th>Used for</th></tr></thead>
        <tbody>${core.rows.map(row).join('')}</tbody>
      </table>
      </div>
    </section>`;
}

/**
 * The catalogue: every plugin a person can add, by family, one row each. A plugin that is already
 * here says "Added" and leads to its page; the rest get a Require button with the package to install.
 * `have` is the packages here (a Set of module names, or a Map of module name to plugin name),
 * `wants` what each of them needs, said on its row.
 */
function catalogHtml(have = new Set(), wants = new Map()) {
  const { iconHtml } = require('./icons');
  const nameOf = (module) => (have instanceof Map ? have.get(module) : '');
  const families = FAMILIES.map((f) => `
      <section class="settings-family plugin-family" data-family="${esc(f.id)}" aria-labelledby="catalog-family-${esc(f.id)}">
        <h3 class="settings-family-head" id="catalog-family-${esc(f.id)}"><span>${esc(f.label)}</span> <span class="settings-family-count">${f.plugins.length}</span></h3>
        <p class="settings-family-about">${esc(f.about)}</p>
        <ul class="plugin-rows plugin-catalog">
          ${f.plugins.map(([name, label]) => {
    const module = `${SCOPE}/workspace-${name}`;
    const present = have.has(module);
    const page = `/settings/plugin/${encodeURIComponent(nameOf(module) || name)}`;
    const line = `<span class="plugin-row-name">${esc(label)}</span>
              <span class="plugin-row-summary"><code>${esc(module)}</code>${wants.get(module) ? ` <span class="plugin-catalog-needs">${esc(wants.get(module))}</span>` : ''}</span>`;
    return `<li class="plugin-row" data-find="${esc(`${label} ${name} ${module} ${f.label}`.toLowerCase())}" data-active="${present ? '1' : '0'}" data-attention="0">
              ${present ? `<a class="plugin-row-main uk-link-reset" href="${esc(page)}">${line}</a>` : `<span class="plugin-row-main">${line}</span>`}
              <span class="plugin-row-state">${present ? `<span class="plugin-state is-ok">${iconHtml('tabler:circle-check', 0.8)}<span>Added</span></span>` : ''}</span>
              <span class="plugin-row-action">${present
    ? `<a class="uk-button uk-button-default uk-button-small" href="${esc(page)}" aria-label="${esc(`Open ${label}`)}">Open</a>`
    : `<button type="button" class="uk-button uk-button-default uk-button-small" hx-post="/actions/plugins" hx-vals='{"verb":"require","spec":"${esc(module)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" title="bash core/scripts/plugins.sh --require ${esc(module)}" aria-label="${esc(`Require ${label}`)}">Require</button>`}</span>
            </li>`;
  }).join('')}
        </ul>
      </section>`).join('');
  return `
    <section class="settings-group plugin-catalog-section" id="settings-catalog" aria-labelledby="settings-catalog-head"
             hx-get="/fragments/settings/catalog" hx-trigger="refresh-projects from:body" hx-swap="outerHTML">
      <h2 class="settings-group-head" id="settings-catalog-head">Catalogue</h2>
      ${families}
    </section>`;
}

module.exports = { pluginsPageHtml, catalogHtml, commandsSectionHtml, rows, stepOf, needsInstall, STEPS };
