/**
 * Dashboard plugins: optional features turned on from settings.yml.
 *
 * A plugin is a node package with a `workspacePlugin` manifest in its package.json (see
 * plugin-manifest.js) and an `index.js` exporting `register(api)` — or a folder under plugins/
 * with the same shape. It is REQUIRED with npm, ACTIVATED by a `plugins.<name>` entry in
 * settings.yml, INSTALLED by core/scripts/plugins.sh (which places what the manifest names in the
 * workspace), and CONFIGURED in its own core/config/plugin.<name>.settings.yml.
 *
 * Everything a plugin adds is namespaced under its own name — actions at /actions/p/<plugin>/…,
 * fragments at /fragments/p/<plugin>/… — so it can never shadow a built-in, and turning it off
 * removes its whole surface at once. A row-menu slot or a page it registers is the one exception,
 * and both are declared, so the layout settings and the router know them by name.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { esc } = require('./html');
const { humanSize, humanTime, cliError } = require('./format');
const { ROOT, CONFIG_DIR, loadSettings, loadWorkspaces, workspaceDir, isValidWorkspace } = require('./workspaces');
const {
  run, startJob, jobFragment, runningJobKey, listProjects, screenAction, startInScreen, screenStartedHtml,
} = require('./jobs');
const { NAME_RE } = require('./validate');
const { wsUrl } = require('./urls');
const { TYPES, addTypeAction } = require('./workspace-types');
const rowLayout = require('./row-layout');
const { upsertSettingsValue, upsertSettingsList } = require('./settings-file');
const { fileFor, readPluginSettings, ensurePluginSettingsFile } = require('./plugin-settings');
const googleAuth = require('./auth-google');
const { iconHtml } = require('./icons');
const { commandBlock } = require('./command-block');
const { tabModalHtml } = require('./tab-modal');
const claudeSessions = require('./claude-sessions');
const { installedPlugins } = require('./plugin-manifest');

// What register(api) hands every plugin. Shared helpers rather than reaching into server.js: the
// same set the extracted actions/ modules already build on.
const lib = {
  esc, humanSize, humanTime, cliError,
  ROOT, CONFIG_DIR, loadSettings, loadWorkspaces, workspaceDir, isValidWorkspace,
  run, startJob, jobFragment, runningJobKey, listProjects, screenAction, startInScreen, screenStartedHtml,
  NAME_RE, wsUrl, iconHtml, commandBlock, tabModalHtml,
  // The dashboard's hostname, for links a plugin posts elsewhere; the screen sessions on this machine;
  // which of them are agents; and the Claude Code transcripts a folder holds.
  hubDomain: () => require('./workspaces').hubDomain(),
  listScreens: (...a) => require('./screens').listScreens(...a),
  agentSessions: (...a) => require('./screens').agentSessions(...a),
  screenLogFor: (...a) => require('./screens').screenLogFor(...a),
  claudeSessionsFor: (...a) => claudeSessions.sessionsFor(...a),
  // The last `screen -ls`, for a renderer that cannot wait: refreshed in the background, at most every 10s.
  screensCached: () => screensCached(),
  // The type registry, and what a workspace resolved to — so a plugin can offer itself only
  // where it makes sense ("sites only", "not on media").
  TYPES,
  // The dashboard's Google sign-in, for a plugin that wants to know who is signed in or draw the button.
  auth: { sessionOf: googleAuth.sessionOf, googleButton: googleAuth.googleButton, BUTTON_CSS: googleAuth.BUTTON_CSS },
  // What git says about a folder (its own .git, worktree role, branch, what a remove destroys), the
  // lingering-session tail every short command ends with, a path with ~ for the home, and the host
  // runner (stop a session before starting it afresh): what the GIT plugin and its kin draw from.
  projectHasGit: (dir) => require('./git-info').projectHasGit(dir),
  hasOwnGit: (dir) => require('./git-info').hasOwnGit(dir),
  gitWorktreeInfo: (dir) => require('./git-info').gitWorktreeInfo(dir),
  gitBranchOf: (dir) => require('./git-info').gitBranchOf(dir),
  lingerTail: (label) => require('./linger').lingerTail(label),
  LINGER_MARK: require('./linger').LINGER_MARK,
  tildePath: (p) => require('./format').tildePath(p),
  hostRunnerRequest: (...a) => require('./jobs').hostRunnerRequest(...a),
  // The list helpers a plugin's own list page draws with (paging, sorting, the controls), the
  // stylesheet version a standalone page links, and the script finder (cmd-tools-<x>.sh in a folder).
  lists: require('./lists'),
  cssVersionNow: () => require('./themes').cssVersion(require('./workspaces').styleSettings().theme),
  findScript: (dir, patterns) => require('./workspaces').findScript(dir, patterns),
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
const rowMenus = {};         // '<slot>' -> ({ key, project, dir, meta, allowed, vals }) -> html | { html, body, caption, classes } | null
const pages = [];            // { re, handler({ req, res, match, send }) }
const chipFns = [];          // ({ key, project, dir, meta }) -> html | null
const folderSetups = [];     // { html(ws, ctx), steps(ws, name, form, ctx), prompt(ws, name, form, ctx), problem(ws, form, ctx) }
const cssFiles = [];         // absolute paths, appended to the stylesheet after the components
let labels = {};             // settings labels, merged into settings.labels.yml's
const badgeFns = [];         // ({ key, project, dir, sessions }) -> html | null, in the card's corner, refreshed with the screens poll
const settingsOptionFns = []; // ({ file, dotted }) -> Promise<[value, label][] | null>
const screenStartFns = [];   // async ({ session, workKey, workspace, project, dir, form }) -> html | ''
const workKeyLinkFns = [];   // (key) -> url | null
const workPromptFns = [];    // ({ key, workspace, project }) -> prompt | null
const sessionLogFns = [];    // (session, dirs) -> file | ''
const assistantContextFns = []; // () -> a paragraph for the assistant's system context, or ''
const forges = {};           // '<host>' -> { name, label, env(), auth() }: who answers for a git forge host
const openWithFns = [];      // (abs, { label, caption, git }) -> html | null: the Open-with menu for a folder (the IDE plugin)
const workspaceViews = {};   // '<key>' -> { name, listHtml(state), count(), noFilesActions, noNewForm }: a plugin that owns a workspace folder's page
const folderLinkFns = [];    // (abs) -> { href, label, icon?, title? } | null: a link to open a folder elsewhere (the Web IDE)

let _screens = { at: 0, rows: [], running: false };
function screensCached() {
  if (!_screens.running && Date.now() - _screens.at > 10 * 1000) {
    _screens.running = true;
    require('./screens').listScreens().then((rows) => { _screens = { at: Date.now(), rows: rows || [], running: false }; })
      .catch(() => { _screens.running = false; });
  }
  return _screens.rows;
}
const loaded = [];           // { name, source } for the settings page and diagnostics

// Plugins that are on without a line in settings.yml. A machine's settings.yml is never
// overwritten by an update, so a plugin that needed its entry added by hand would simply not
// appear for anybody who had installed before it existed. A line in the file still wins, so
// `enabled: false` turns one off.
const SHIPPED_PLUGINS = {};

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

// What this dashboard can do that an older one could not, for a package that serves several
// dashboards: a plugin checks `api.capabilities.has(…)` before it uses a newer form of an answer.
//   row-menu-body  a row-menu function may return `{ html, body }`: the body loads when the menu opens.
const CAPABILITIES = Object.freeze(new Set(['row-menu-body']));

function makeApi(name, config) {
  return {
    name,
    config,
    lib,
    capabilities: CAPABILITIES,
    // This plugin's own settings file (core/config/plugin.<name>.settings.yml): read it, or change one
    // key or one list in place with comments kept. Secret-named keys stay out of the browser like
    // any setting.
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
    // A named menu on every project row, in the slot the layout settings arrange: `spec` is
    // `{ label, row }` like a built-in button's. The function draws it, or returns null for a row
    // the plugin has nothing to say about. It may also return `{ html, body, caption, classes }`:
    // the button, and the URL of a fragment that answers the dropdown's inner HTML when the menu
    // opens — so a page of fifty rows carries fifty buttons, not fifty menus (rowMenuHtml).
    addRowMenu(slot, spec, fn) {
      if (!/^[a-z0-9-]+$/.test(slot)) throw new Error(`${name}: invalid row menu slot '${slot}'`);
      rowLayout.registerButton({ id: slot, label: spec.label || slot, row: spec.row || 0, columns: spec.columns, menu: spec.menu });
      rowMenus[slot] = fn;
    },
    // A whole page: GET requests whose path matches `re`. The handler writes the response itself.
    addPage(re, handler) {
      pages.push({ re, handler });
    },
    // A chip in the project card's meta line, beside the folder name and the test badge.
    addProjectChip(fn) {
      chipFns.push(fn);
    },
    // A section of the New-folder form, and what it adds to the setup line, the AI prompt and the
    // validation. Each member is optional.
    addFolderSetup(setup) {
      folderSetups.push({ name, ...setup });
    },
    // A stylesheet of the plugin's own, appended after the components (it may only add rules).
    addCss(file) {
      cssFiles.push(file);
    },
    // An action name workspace types may allow ('upsun' on sites): what `typeAllows` answers.
    addTypeAction(action, types) {
      addTypeAction(action, types);
    },
    addLabels(map) {
      labels = { ...labels, ...map };
    },
    // A badge in the project card's corner, sent with every screens poll (so it clears itself): what an
    // agent here is working on, say. `sessions` is this project's live screen list.
    addProjectBadge(fn) {
      badgeFns.push(fn);
    },
    // Live options for a field of a settings file ('plugin.jira.settings.yml', 'default_project'): what a
    // CLI can see, rather than a hand-typed value. Async; null means a plain input.
    addSettingsOptions(file, dotted, fn) {
      settingsOptionFns.push({ file, dotted, fn });
    },
    // Called after a screen session started for a work item (the New screen form's `work` key): note
    // the run, say so on the item. Returns HTML to show, or ''.
    addScreenStartHook(fn) {
      screenStartFns.push(fn);
    },
    // Where a work-item key found in a project's name links to.
    addWorkKeyLink(fn) {
      workKeyLinkFns.push(fn);
    },
    // The prompt a screen started for a work item begins with, or null for the dashboard's own.
    addWorkPrompt(fn) {
      workPromptFns.push(fn);
    },
    // Where a session's log lives when the dashboard does not know ('jira-<key>' logs inside the project).
    addSessionLog(fn) {
      sessionLogFns.push(fn);
    },
    // A paragraph of the assistant's system context: what this plugin lets it reach, and the rules.
    addAssistantContext(fn) {
      assistantContextFns.push(fn);
    },
    // Who answers for a git forge host ('github.com'): `env()` is the environment a child process
    // needs to authenticate there (a token), or null; `auth()` says who, for the settings page.
    addForge(host, spec) {
      forges[String(host).toLowerCase()] = { name, ...spec };
    },
    // The "Open with" menu for a folder: the Web IDE here, an editor on the browser's machine. Drawn on
    // project rows (the IDE slot), the files pages and the images gallery. The first plugin that answers wins.
    addOpenWith(fn) {
      openWithFns.push(fn);
    },
    // A link that opens a folder elsewhere (the Web IDE on it), offered inside other menus (COMPOSER).
    addFolderLink(fn) {
      folderLinkFns.push(fn);
    },
    // A plugin that owns a workspace folder's page (the graphs workspace): its list section
    // (`listHtml(state)`), the count on the home card (`count()`), and whether the files-page
    // actions and the New-folder form stay away from it.
    addWorkspaceView(key, view) {
      if (!/^[a-z0-9_-]+$/.test(String(key))) throw new Error(`${name}: invalid workspace key '${key}'`);
      workspaceViews[key] = { name, ...view };
    },
  };
}

/** What the manifest declares, wired in before register(api) runs. */
function applyManifest(name, plugin) {
  const m = plugin.manifest || {};
  for (const [action, types] of Object.entries(m.typeActions || {})) addTypeAction(action, types);
  for (const f of m.css || []) cssFiles.push(path.join(plugin.dir, f));
  if (m.labels) {
    try {
      const data = yaml.load(fs.readFileSync(path.join(plugin.dir, m.labels), 'utf8')) || {};
      // Both the bare key, as the plugin's own settings file is edited, and the plugin-prefixed one.
      for (const [k, v] of Object.entries(data)) { labels[k] = v; labels[`plugin.${name}.${k}`] = v; }
    } catch (_) { /* no labels: the keys show as they are */ }
  }
}

function loadPlugins() {
  const known = new Map(installedPlugins().map((p) => [p.name, p]));
  for (const [name, rawConfig] of Object.entries(pluginConfigs())) {
    const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    if (String(config.enabled) !== 'true' && config.enabled !== true) continue;
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(`plugin '${name}' skipped: names are lowercase letters, digits and hyphens.`);
      continue;
    }
    // A node module first: `module:` names a package (installed from npm, or linked from this repo
    // with a `file:` dependency in package.json), which is how a plugin is shared between machines.
    // A folder under plugins/<name>/ is the fallback, and the whole mechanism for a plugin that
    // needs no package.
    const local = path.join(require('./plugin-manifest').PLUGINS_DIR, name, 'index.js');
    let source = '';
    if (config.module) {
      try { require.resolve(String(config.module)); source = String(config.module); } catch (_) { /* not installed: say so below */ }
    }
    if (!source && known.has(name) && known.get(name).module) {
      try { require.resolve(known.get(name).module); source = known.get(name).module; } catch (_) { /* fall through */ }
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
      if (known.has(name)) applyManifest(name, known.get(name));
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
  // Run it NOW, not in a microtask: a handler that answers synchronously has answered when this
  // returns, which is what the callers (and the tests) rely on. An async handler's rejection is
  // still caught, so a plugin cannot leave a request hanging.
  const fail = (err) => { try { send(`<div class="msg error">Plugin ${esc(m[1])} failed: ${esc(err.message)}</div>`, 500); } catch (_) { /* headers sent */ } };
  try {
    const r = fragments[m[1]]({ req, res, send, rest: m[2] || '', searchParams });
    if (r && typeof r.catch === 'function') r.catch(fail);
  } catch (err) {
    fail(err);
  }
  return true;
}

/** Handle a GET of a page a plugin registered. Returns true when one matched. */
async function pluginPage(pathname, req, res) {
  for (const { re, handler } of pages) {
    const match = pathname.match(re);
    if (!match) continue;
    const send = (html, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    };
    try {
      await handler({ req, res, match, send });
    } catch (err) {
      try { send(`<p>Plugin page failed: ${esc(err.message)}</p>`, 500); } catch (_) { /* headers sent */ }
    }
    return true;
  }
  return false;
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

/** The named row menus, by slot, for the row layout to place. A slot a plugin has nothing for is ''. */
function pluginRowMenus(ctx) {
  const out = {};
  for (const [slot, fn] of Object.entries(rowMenus)) {
    try { out[slot] = rowMenuHtml(slot, fn(ctx), ctx); } catch (_) { out[slot] = ''; }
  }
  return out;
}

/**
 * What a row-menu function answered, as the row's HTML.
 *
 * A string is the whole menu, drawn inline as it always was. An object `{ html, body, caption, classes }`
 * is a menu whose body loads when it opens: `html` is the button, `body` the URL of a fragment the
 * plugin serves (under /fragments/p/<plugin>/) whose response is the dropdown's inner HTML, `caption`
 * the small text beside the button and `classes` extra classes on the menu's wrapper. The page then
 * carries the button, the caption and an empty dropdown shell; UIkit's `beforeshow` on the shell is
 * relayed as `menu-opened` (public/ui.js), and htmx fetches the body into it. The fetch goes through
 * /fragments/row-menu/<slot>/<ws>/<project>, which asks the plugin's URL and arranges the items the
 * way the Buttons settings arrange an inline menu's (hidden entries, order, your own actions).
 */
function rowMenuHtml(slot, result, ctx = {}) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result !== 'object' || typeof result.html !== 'string' || !result.html
    || typeof result.body !== 'string' || !/^\/fragments\/p\/[a-z0-9-]+\//.test(result.body)) return '';
  return menuShellHtml(slot, {
    key: ctx.key, project: ctx.project, html: result.html, caption: result.caption, classes: result.classes,
    query: `?body=${encodeURIComponent(result.body)}`,
  });
}

/**
 * The shell of a row menu whose body loads when it opens — the one markup for a plugin's lazy menu and for
 * the core's own (DDEV, COMPOSER, Tests, SCREENS, NODE, More): `<span class="act-with-status">` around the
 * `.uk-inline.act-menu.act-menu-<slot>` wrapper, the button (`html`), an empty `uk-dropdown` shell and the
 * caption. The shell fetches `/fragments/row-menu/<slot>/<ws>/<project><query>` on `menu-opened` (the relay
 * of UIkit's `beforeshow` in public/ui.js) and swaps the answer in as its inner HTML; `triggers` adds more
 * (SCREENS also polls, for the badges it swaps out of band). `classes` go on the wrapper after
 * `act-menu-<slot>`, `dropdownClasses` on the shell after `act-menu-lazy` (a menu's own width class).
 */
function menuShellHtml(slot, { key, project, html, caption, classes, dropdownClasses, triggers, query = '' } = {}) {
  const url = `/fragments/row-menu/${encodeURIComponent(slot)}/${encodeURIComponent(key || '')}/${encodeURIComponent(project || '')}${query}`;
  const wrap = ['uk-inline', 'act-menu', `act-menu-${slot}`, ...String(classes || '').split(/\s+/).filter(Boolean)];
  const drop = ['act-menu-lazy', ...String(dropdownClasses || '').split(/\s+/).filter(Boolean)];
  const trigger = ['menu-opened', ...String(triggers || '').split(/\s*,\s*/).filter(Boolean)].join(', ');
  const cap = caption === undefined || caption === null || caption === '' ? ''
    : `<span class="act-status uk-text-meta">${esc(String(caption))}</span>`;
  return `<span class="act-with-status"><div class="${esc([...new Set(wrap)].join(' '))}">${html}`
    + `<div uk-dropdown="mode: click; pos: bottom-right" class="${esc([...new Set(drop)].join(' '))}" hx-get="${esc(url)}" hx-trigger="${esc(trigger)}" hx-target="this" hx-swap="innerHTML">`
    + '<ul class="uk-nav uk-dropdown-nav"><li class="uk-nav-header">…</li></ul></div></div>'
    + `${cap}</span>`;
}

/** Whether a plugin registered a row menu in this slot. */
const pluginRowMenuSlot = (slot) => Object.prototype.hasOwnProperty.call(rowMenus, slot);

/**
 * The body of a lazy row menu: the plugin's fragment at `body` (a /fragments/p/<plugin>/… URL), asked
 * the way a browser would and answered as `{ status, html }` instead of written to a response — so the
 * caller can arrange the items before sending them. A plugin that never answers is given 30 seconds.
 */
function pluginRowMenuBody(body, req = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (status, html) => { if (done) return; done = true; clearTimeout(timer); resolve({ status, html }); };
    const timer = setTimeout(() => finish(504, '<li class="uk-nav-header">The menu did not answer.</li>'), 30000);
    if (typeof timer.unref === 'function') timer.unref();
    let status = 200;
    let out = '';
    const res = {
      writeHead(code) { status = code || 200; },
      setHeader() {},
      write(chunk) { out += String(chunk || ''); },
      end(chunk) { out += String(chunk || ''); finish(status, out); },
    };
    const pathname = String(body).split('?')[0];
    const hit = pluginFragment(pathname, { url: body, method: 'GET', headers: (req && req.headers) || {} }, res);
    if (!hit) finish(404, '<li class="uk-nav-header">No such menu.</li>');
  });
}

/** The chips plugins put in a project card's meta line. */
function pluginProjectChipsHtml(ctx) {
  let html = '';
  for (const fn of chipFns) {
    try { html += fn(ctx) || ''; } catch (_) { /* a broken chip is no chip */ }
  }
  return html;
}

const pluginFolderSetups = () => folderSetups;

function pluginProjectBadgesHtml(ctx) {
  let html = '';
  for (const fn of badgeFns) { try { html += fn(ctx) || ''; } catch (_) { /* a broken badge is no badge */ } }
  return html;
}
async function pluginSettingsOptions(file, dotted) {
  for (const o of settingsOptionFns) {
    if (o.file !== file || o.dotted !== dotted) continue;
    try { const r = await o.fn({ file, dotted }); if (r && r.length) return r; } catch (_) { /* a plain input then */ }
  }
  return null;
}
async function pluginScreenStarted(ctx) {
  let html = '';
  for (const fn of screenStartFns) { try { html += (await fn(ctx)) || ''; } catch (err) { html += `<div class="msg error">${esc(err.message)}</div>`; } }
  return html;
}
function pluginWorkKeyLink(key) {
  for (const fn of workKeyLinkFns) { try { const u = fn(key); if (u) return u; } catch (_) { /* next */ } }
  return null;
}
function pluginWorkPrompt(ctx) {
  for (const fn of workPromptFns) { try { const p = fn(ctx); if (p) return p; } catch (_) { /* next */ } }
  return null;
}
/** The plugin view of a workspace folder's page, or null. */
function pluginWorkspaceView(key) {
  return workspaceViews[String(key || '')] || null;
}

/** The Open-with menu for a folder, from the first plugin that draws one; '' without an IDE plugin. */
function pluginOpenWith(abs, opts = {}) {
  for (const fn of openWithFns) {
    try { const html = fn(abs, opts); if (html) return html; } catch (e) { console.error(`plugin open-with failed: ${e.message}`); }
  }
  return '';
}
/** Links that open a folder elsewhere: [{ href, label, icon, title }]. */
function pluginFolderLinks(abs) {
  const out = [];
  for (const fn of folderLinkFns) {
    try { const l = fn(abs); if (l && l.href) out.push(l); } catch (e) { console.error(`plugin folder link failed: ${e.message}`); }
  }
  return out;
}

/** The plugin answering for a forge host, or null. */
function pluginForge(host) {
  return forges[String(host || '').toLowerCase()] || null;
}
function pluginForges() { return { ...forges }; }

function pluginAssistantContext() {
  const out = [];
  for (const fn of assistantContextFns) { try { const s = fn(); if (s) out.push(s); } catch (_) { /* next */ } }
  return out;
}
function pluginSessionLog(session, dirs) {
  for (const fn of sessionLogFns) { try { const f = fn(session, dirs); if (f) return f; } catch (_) { /* next */ } }
  return '';
}
const pluginCssFiles = () => cssFiles.filter((f) => fs.existsSync(f));
const pluginLabels = () => labels;

loadPlugins();

module.exports = {
  pluginActions: actions, pluginFragment, pluginPage, pluginPageActionGroups, pluginProjectActionsHtml,
  pluginRowMenus, rowMenuHtml, menuShellHtml, pluginRowMenuSlot, pluginRowMenuBody, pluginProjectChipsHtml, pluginFolderSetups, pluginCssFiles, pluginLabels,
  pluginProjectBadgesHtml, pluginSettingsOptions, pluginScreenStarted, pluginWorkKeyLink, pluginWorkPrompt, pluginSessionLog, pluginAssistantContext, pluginForge, pluginForges, pluginOpenWith, pluginFolderLinks, pluginWorkspaceView,
  loadedPlugins: loaded, pluginConfigs,
};
