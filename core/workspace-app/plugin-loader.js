/**
 * Dashboard plugins: optional features a workspace can turn on from settings.yml.
 *
 * A plugin is a folder under core/workspace-app/plugins/<name>/ with an index.js
 * exporting `register(api)` — or any require()-able node module named by a
 * `module:` key, so a plugin can also be installed with npm and listed in
 * package.json. Which plugins load, and which workspaces they apply to, is
 * configuration, not code:
 *
 *   plugins:
 *     workspace-notes:
 *       enabled: true
 *       workspaces: "dev,test"     # empty or absent = every workspace
 *
 * Everything a plugin adds is namespaced under its own name — actions at
 * /actions/p/<plugin>/<action>, fragments at /fragments/p/<plugin>/<rest> — so
 * a plugin can never shadow a built-in route, and removing one removes all of
 * its surface at once. See PLUGINS.md for the contract.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('./html');
const { humanSize, humanTime } = require('./format');
const { ROOT, loadWorkspaces, workspaceDir, isValidWorkspace, loadSettings } = require('./workspaces');
const { startJob, jobFragment, listProjects, screenAction } = require('./jobs');
const { NAME_RE } = require('./validate');
const { wsUrl } = require('./urls');
const { TYPES } = require('./workspace-types');
const { upsertSettingsValue, upsertSettingsList } = require('./settings-file');
const { fileFor, readPluginSettings, ensurePluginSettingsFile } = require('./plugin-settings');
const googleAuth = require('./auth-google');

const PLUGINS_DIR = path.join(__dirname, 'plugins');

// What register(api) hands every plugin. Shared helpers rather than reaching into
// server.js: the same set the extracted actions/ modules already build on.
const lib = {
  esc, humanSize, humanTime,
  ROOT, loadWorkspaces, workspaceDir, isValidWorkspace,
  startJob, jobFragment, listProjects, screenAction,
  NAME_RE, wsUrl,
  // The type registry, and what a workspace resolved to — so a plugin can offer
  // itself only where it makes sense ("sites only", "not on media").
  TYPES,
  // The dashboard's Google sign-in, for a plugin that wants to know who is signed in or draw the Google button.
  auth: { sessionOf: googleAuth.sessionOf, googleButton: googleAuth.googleButton, BUTTON_CSS: googleAuth.BUTTON_CSS },
  workspaceType: (key) => (loadWorkspaces()[key] || {}).type || null,
  typeAllows: (key, action) => {
    const meta = loadWorkspaces()[key];
    return !!(meta && meta.typeActions && meta.typeActions.has(action));
  },
};

const actions = {};          // '/actions/p/<plugin>/<action>' -> handler(ctx)
const fragments = {};        // '<plugin>' -> handler({ req, res, send, rest, searchParams })
const pageActionFns = [];    // ({ view, key, meta }) -> { label, items: [html] } | null
const projectActionFns = []; // ({ key, project, dir, meta }) -> html | null
const loaded = [];           // { name, source } for the settings page and diagnostics

// Plugins that are on without a line in settings.yml. A machine's settings.yml is never overwritten by an
// update, so a plugin that needed its entry added by hand would simply not appear for anybody who had
// installed before it existed. A line in the file still wins, so `enabled: false` turns one off.
const SHIPPED_PLUGINS = {
  'google-drive-sync': { enabled: true, module: '@webship/workspace-google-drive', workspaces: 'videos,audio,docs,specs,test' },
};

function pluginConfigs() {
  const block = loadSettings().plugins;
  const own = (block && typeof block === 'object') ? block : {};
  const merged = {};
  for (const [name, config] of Object.entries(SHIPPED_PLUGINS)) merged[name] = { ...config };
  for (const [name, config] of Object.entries(own)) merged[name] = { ...(merged[name] || {}), ...(config && typeof config === 'object' ? config : {}) };
  return merged;
}

function appliesTo(config, workspaceKey) {
  const list = String(config.workspaces || '').split(',').map((w) => w.trim()).filter(Boolean);
  return list.length === 0 || list.includes(workspaceKey);
}

function makeApi(name, config) {
  return {
    name,
    config,
    lib,
    // This plugin's own settings file (core/config/plugin.<name>.settings.yml): read it, or change one key or
    // one list in place with comments kept. Secret-named keys stay out of the browser like any setting.
    settings: {
      file: fileFor(name),
      read: () => readPluginSettings(name),
      set: (dotted, value) => { upsertSettingsValue(ensurePluginSettingsFile(name), dotted, value); },
      setList: (dotted, items) => { upsertSettingsList(ensurePluginSettingsFile(name), dotted, items); },
    },
    appliesTo: (workspaceKey) => appliesTo(config, workspaceKey),
    addAction(action, handler) {
      if (!/^[a-z0-9-]+$/.test(action)) throw new Error(`${name}: invalid action name '${action}'`);
      actions[`/actions/p/${name}/${action}`] = handler;
    },
    addFragment(handler) {
      fragments[name] = handler;
    },
    addPageActions(fn) {
      pageActionFns.push((ctx) => fn(ctx));
    },
    addProjectActions(fn) {
      projectActionFns.push((ctx) => fn(ctx));
    },
  };
}

function loadPlugins() {
  for (const [name, rawConfig] of Object.entries(pluginConfigs())) {
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    if (String(config.enabled) !== 'true' && config.enabled !== true) continue;
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(`plugin '${name}' skipped: names are lowercase letters, digits and hyphens.`);
      continue;
    }
    // A node module first: `module:` names a package (installed from npm, or linked from this repo with a
    // `file:` dependency in package.json), which is how a plugin is shared between machines. A folder under
    // plugins/<name>/ is the fallback, and the whole mechanism for a plugin that needs no package.
    const local = path.join(PLUGINS_DIR, name, 'index.js');
    let source = '';
    if (config.module) {
      try { require.resolve(String(config.module)); source = String(config.module); } catch (_) { /* not installed: say so below */ }
    }
    if (!source && fs.existsSync(local)) {
      source = local;
      if (config.module) console.warn(`plugin '${name}': module ${config.module} is not installed, using plugins/${name}. Run npm install in core/workspace-app.`);
    }
    if (!source) {
      console.error(`plugin '${name}' skipped: ${config.module ? `module ${config.module} is not installed (npm install) and` : ''} there is no plugins/${name}/index.js.`);
      continue;
    }
    try {
      const mod = require(source);
      if (typeof mod.register !== 'function') throw new Error('no register(api) export');
      mod.register(makeApi(name, config));
      loaded.push({ name, source: source === local ? `plugins/${name}` : `module:${source}` });
    } catch (err) {
      // One broken plugin must not take the dashboard down.
      console.error(`plugin '${name}' failed to load: ${err.message}`);
    }
  }
}

/** Handle a GET /fragments/p/<plugin>/<rest> request. Returns true when handled. */
function pluginFragment(pathname, req, res) {
  const m = pathname.match(/^\/fragments\/p\/([a-z0-9-]+)(?:\/(.*))?$/);
  if (!m || !fragments[m[1]]) return false;
  const send = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };
  const searchParams = new URL(req.url, 'http://localhost').searchParams;
  try {
    fragments[m[1]]({ req, res, send, rest: m[2] || '', searchParams });
  } catch (err) {
    send(`<div class="msg error">Plugin ${esc(m[1])} failed: ${esc(err.message)}</div>`, 500);
  }
  return true;
}

/** Rail groups every loaded plugin wants on this page. */
function pluginPageActionGroups(view, key, meta) {
  const groups = [];
  for (const fn of pageActionFns) {
    try {
      const group = fn({ view, key, meta });
      if (group && group.items && group.items.length) groups.push(group);
    } catch (_) {
      // A plugin that cannot draw its buttons should not blank the rail.
    }
  }
  return groups;
}

/** Extra buttons plugins put on one project row. Concatenated after the built-in menus. */
function pluginProjectActionsHtml(ctx) {
  let html = '';
  for (const fn of projectActionFns) {
    try {
      html += fn(ctx) || '';
    } catch (_) {
      // A plugin that cannot draw its button should not blank the row.
    }
  }
  return html;
}

loadPlugins();

module.exports = {
  pluginActions: actions, pluginFragment, pluginPageActionGroups, pluginProjectActionsHtml,
  loadedPlugins: loaded,
};
