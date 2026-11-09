/**
 * Settings → Plugins: every plugin package the dashboard can see, the step each is at, and the
 * buttons that take it to the next one. The four steps are exactly core/scripts/plugins.sh's
 * verbs — the page runs that script as a job, so the button and the command line cannot disagree.
 *
 *   require    npm install <spec> into core/workspace-app (a GitHub repo, a tarball, a path)
 *   activate   plugins.<name>.enabled: true in settings.yml
 *   install    place what the manifest names: bash functions, commands, compose files, a theme
 *   configure  the plugin's own core/config/plugin.<name>.settings.yml
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { installedPlugins } = require('./plugin-manifest');
const { status, RECORD } = require('./plugin-install');
const { pluginConfigs, loadedPlugins } = require('./plugin-loader');
const { ROOT, CONFIG_DIR } = require('./workspaces');
const { FAMILIES, SCOPE } = require('./plugin-catalog');

const STEPS = ['required', 'activated', 'installed', 'configured'];

/** Where a plugin is on the way to ready. */
/** Whether the manifest names anything an install has to place. */
function needsInstall(m = {}) {
  const s = m.scripts || {};
  return !!((s.functions || []).length || (s.args || []).length || (s.machine || []).length || s.hostInstall
    || ((m.ddev || {}).compose || []).length || ((m.ddev || {}).hostMounts || []).length
    || ((m.commands || {}).files || []).length || (m.themes || []).length || (m.features || []).length || m.settingsTemplate);
}

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
  return installedPlugins().map((p) => {
    const step = stepOf(p, configs[p.name], placed[p.name]);
    return { ...p, step, loaded: loaded.has(p.name), placed: placed[p.name] || {}, config: configs[p.name] || {} };
  });
}

function pluginsPageHtml() {
  const list = rows();
  const btn = (verb, name, label, primary, title = '') => `<button class="uk-button uk-button-${primary ? 'primary' : 'default'} uk-button-small"
      hx-post="/actions/plugins" hx-vals='{"verb":"${esc(verb)}","name":"${esc(name)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML"
      title="${esc(title || `bash core/scripts/plugins.sh --${verb} ${name}`)}">${esc(label)}</button>`;
  const cards = list.map((p) => {
    const next = p.step === 0 ? btn('activate', p.name, 'Activate', true)
      : p.step === 1 ? btn('install', p.name, 'Install', true)
        : p.step === 2 ? `<a class="uk-button uk-button-primary uk-button-small" href="/settings/${esc(p.manifest.settingsFile)}">Configure</a>`
          : '';
    const steps = STEPS.map((s, i) => `<span class="plugin-step${i <= p.step ? ' is-done' : ''}">${esc(s)}</span>`).join('<span class="plugin-step-sep">›</span>');
    const more = [
      p.step >= 1 && needsInstall(p.manifest) ? btn('install', p.name, p.step >= 2 ? 'Reinstall' : 'Install', false, 'Place the plugin\'s files again; safe to repeat') : '',
      p.step >= 1 ? btn('deactivate', p.name, 'Deactivate', false) : '',
      p.placed.installed ? btn('uninstall', p.name, 'Uninstall', false, 'Remove what Install placed, and deactivate') : '',
      p.manifest.settingsFile && p.step >= 2 ? `<a class="uk-button uk-button-default uk-button-small" href="/settings/${esc(p.manifest.settingsFile)}">Settings</a>` : '',
    ].filter(Boolean).join(' ');
    return `
      <div class="uk-card uk-card-default uk-card-body uk-card-small plugin-card">
        <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
          <h3 class="uk-card-title uk-margin-remove">${esc(p.manifest.label || p.name)} <span class="uk-text-meta">${esc(p.module || p.spec || '')}${p.version ? ` ${esc(p.version)}` : ''}</span></h3>
          <span class="plugin-steps">${steps}</span>
        </div>
        <p class="uk-text-meta uk-margin-small">${esc(p.description || '')}</p>
        ${p.step === 1 && !p.loaded ? '<p class="uk-text-warning uk-text-small">Activated, but not loaded yet: the dashboard loads plugins when it starts. Install restarts it.</p>' : ''}
        ${p.placed.missing && p.placed.missing.length ? `<p class="uk-text-warning uk-text-small">${p.placed.missing.length} placed file(s) are missing — Reinstall puts them back.</p>` : ''}
        <div class="uk-margin-small-top plugin-buttons">${next} ${more}</div>
      </div>`;
  }).join('');
  return `
    <section class="settings-group">
      <h2 class="settings-group-head">Plugins</h2>
      <p class="uk-text-meta">Optional features, each a package of its own (github.com/webship/workspace-&lt;name&gt;). Four steps turn one on:
        <strong>require</strong> it with npm, <strong>activate</strong> it in settings.yml, <strong>install</strong> what it ships into the workspace,
        <strong>configure</strong> its own settings file. The same as <code>bash core/scripts/plugins.sh</code>.</p>
      <form class="uk-flex uk-flex-middle uk-margin-small-bottom plugin-require" hx-post="/actions/plugins" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="verb" value="require">
        <input class="uk-input uk-form-small uk-form-width-large" name="spec" placeholder="github:webship/workspace-jira" aria-label="Package to require" required pattern="[A-Za-z0-9@:/._#+~-]+">
        <button class="uk-button uk-button-default uk-button-small uk-margin-small-left" type="submit">Require</button>
      </form>
      <div class="plugin-cards">${cards || '<p class="uk-text-meta">No plugin packages yet. Pick one from the catalogue below, or require one above.</p>'}</div>
      <p class="uk-text-meta uk-margin-small-top">What each install placed is recorded in <code>${esc(path.relative(ROOT, RECORD))}</code>.</p>
    </section>
    ${catalogHtml(new Set(list.map((p) => p.module)))}`;
}

/** The catalogue: every plugin a person can add, by family; what is already required is marked. */
function catalogHtml(have = new Set()) {
  const families = FAMILIES.map((f) => `
      <div class="plugin-family">
        <h3 class="uk-margin-small-bottom">${esc(f.label)} <span class="uk-text-meta">${esc(f.about)}</span></h3>
        <ul class="uk-list uk-list-divider plugin-catalog">
          ${f.plugins.map(([name, label]) => {
    const module = `${SCOPE}/workspace-${name}`;
    const present = have.has(module);
    return `<li class="uk-flex uk-flex-between uk-flex-middle">
              <span><strong>${esc(label)}</strong> <code class="uk-text-meta">${esc(module)}</code></span>
              ${present ? '<span class="uk-label">required</span>' : `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/plugins" hx-vals='{"verb":"require","spec":"${esc(module)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" title="npm install ${esc(module)} into core/workspace-app">Require</button>`}
            </li>`;
  }).join('')}
        </ul>
      </div>`).join('');
  return `
    <section class="settings-group plugin-catalog-section">
      <h2 class="settings-group-head">Catalogue</h2>
      <p class="uk-text-meta">The core ships empty. Add what you need, one package at a time: <strong>Require</strong> installs it with npm into <code>core/workspace-app/package.json</code>, then Activate, Install and Configure above. Nothing is added until you ask for it.</p>
      ${families}
    </section>`;
}

module.exports = { pluginsPageHtml, catalogHtml, rows, stepOf, needsInstall, STEPS };
