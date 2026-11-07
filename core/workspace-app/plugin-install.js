/**
 * Installing a plugin into the workspace: placing what its manifest names.
 *
 *   node plugin-install.js install <name>     place everything, idempotently
 *   node plugin-install.js uninstall <name>   remove exactly what install placed
 *   node plugin-install.js status [<name>]    what is placed, what is not, as JSON
 *
 * A package in node_modules is code the dashboard can require; the workspace is a tree of bash
 * scripts, DDEV config and settings files that know nothing about node_modules. This is the
 * bridge: it copies (never links — a link breaks the moment a package is updated or removed)
 * each piece to where the workspace expects it, records every path it wrote in
 * core/config/plugins.installed.yml, and keeps a managed block in .gitignore so a dev clone
 * never commits what an install placed.
 *
 *   scripts.functions   -> core/scripts/plugins/<name>/functions/   (bootstrap sources them)
 *   scripts.args        -> core/scripts/plugins/<name>/args/
 *   scripts.machine     -> core/scripts/plugins/<name>/
 *   scripts.hostInstall -> core/scripts/plugins/<name>/host-install.sh
 *   ddev.hostMounts     -> core/scripts/plugins/<name>/host-mounts.txt (host-mounts.sh reads it)
 *   commands.files      -> <workspace>/ for every workspace of commands.types (__WORKSPACE__ filled in)
 *   ddev.compose        -> core/workspace-app/.ddev/docker-compose.plugin-<name>-<file>
 *   themes              -> core/config/
 *   settingsTemplate    -> core/config/plugin.<name>.settings.yml, only when absent, carrying the
 *                          values of the settings.yml block it replaces (legacySettingsKey)
 *   features            -> core/workspace-app/tests/features/plugins/<name>/  (webship-js runs them)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { pluginByName, installedPlugins } = require('./plugin-manifest');
// The workspace root as the dashboard knows it — NOT __dirname's parents: inside the container the
// app runs at /var/www/html while the tree is bind-mounted at its own absolute path, and the record
// written from one side must be the one read from the other.
const { ROOT, CONFIG_DIR } = require('./workspaces');

const SCRIPTS_DIR = path.join(ROOT, 'core', 'scripts');
const DDEV_DIR = path.join(ROOT, 'core', 'workspace-app', '.ddev');
const RECORD = path.join(CONFIG_DIR, 'plugins.installed.yml');
const GITIGNORE = path.join(ROOT, '.gitignore');
const BLOCK_START = '# plugins — managed by core/scripts/plugins.sh; do not edit between the markers';
const BLOCK_END = '# end plugins';

const rel = (p) => path.relative(ROOT, p);

function readRecord() {
  try { return yaml.load(fs.readFileSync(RECORD, 'utf8')) || {}; } catch (_) { return {}; }
}
function writeRecord(data) {
  fs.writeFileSync(RECORD, `# Written by core/scripts/plugins.sh: what each installed plugin placed in this tree.\n${yaml.dump(data)}`);
}

/** Workspaces of the given types, from settings.yml and each workspace.<key>.settings.yml. */
function workspacesOfTypes(types) {
  const { loadWorkspaces } = require('./workspaces');
  const all = loadWorkspaces();
  return Object.entries(all).filter(([, m]) => types.includes(m.type)).map(([key]) => key);
}

function copyFile(src, dest, { fill } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let data = fs.readFileSync(src);
  if (fill) data = Buffer.from(Object.entries(fill).reduce((t, [k, v]) => t.split(k).join(v), data.toString('utf8')));
  fs.writeFileSync(dest, data, { mode: fs.statSync(src).mode & 0o777 });
}

/** The managed .gitignore block: one line per placed path, so a dev clone stays clean. */
function updateGitignore(record) {
  let text = '';
  try { text = fs.readFileSync(GITIGNORE, 'utf8'); } catch (_) { /* a tree with no .gitignore */ }
  const lines = new Set();
  for (const entry of Object.values(record)) for (const p of entry.placed || []) lines.add(`/${p}`);
  lines.add('/core/config/plugins.installed.yml');
  lines.add('/core/scripts/plugins/');
  const block = `${BLOCK_START}\n${[...lines].sort().join('\n')}\n${BLOCK_END}\n`;
  const re = new RegExp(`${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${BLOCK_END}\\n?`);
  text = re.test(text) ? text.replace(re, block) : `${text.replace(/\n*$/, '\n\n')}${block}`;
  fs.writeFileSync(GITIGNORE, text);
}

/** The settings template, carrying over the block it replaces in settings.yml when there is one. */
function placeSettings(plugin, placed) {
  const m = plugin.manifest;
  if (!m.settingsTemplate) return { restart: false };
  const dest = path.join(CONFIG_DIR, m.settingsFile || `plugin.${plugin.name}.settings.yml`);
  if (fs.existsSync(dest)) return { restart: false };
  let text = fs.readFileSync(path.join(plugin.dir, m.settingsTemplate), 'utf8');
  if (m.legacySettingsKey) {
    try {
      const settings = yaml.load(fs.readFileSync(path.join(CONFIG_DIR, 'settings.yml'), 'utf8')) || {};
      // Dotted keys name a nested block: git.github is settings.git.github.
      const legacy = String(m.legacySettingsKey).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), settings);
      if (legacy && typeof legacy === 'object') {
        for (const [k, v] of Object.entries(legacy)) {
          if (v == null || v === '' || v === 'CHANGE_ME') continue;
          const line = new RegExp(`^${k}:.*$`, 'm');
          const rendered = yaml.dump({ [k]: v }).trim();
          text = line.test(text) ? text.replace(line, rendered) : `${text.replace(/\n*$/, '\n')}${rendered}\n`;
        }
      }
    } catch (_) { /* settings.yml unreadable: the template ships as is */ }
  }
  fs.writeFileSync(dest, text, { mode: 0o600 });
  placed.push(rel(dest));
  return { restart: false };
}

function install(name) {
  const plugin = pluginByName(name);
  if (!plugin) throw new Error(`no plugin named '${name}' is installed in core/workspace-app (npm install it first)`);
  const m = plugin.manifest;
  const record = readRecord();
  const before = new Set((record[name] && record[name].placed) || []);
  const placed = [];
  let restart = false;
  const scripts = m.scripts || {};
  const into = path.join(SCRIPTS_DIR, 'plugins', name);
  for (const f of scripts.functions || []) { const d = path.join(into, 'functions', path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  for (const f of scripts.args || []) { const d = path.join(into, 'args', path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  for (const f of scripts.machine || []) { const d = path.join(into, path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  if (scripts.hostInstall) { const d = path.join(into, 'host-install.sh'); copyFile(path.join(plugin.dir, scripts.hostInstall), d); placed.push(rel(d)); }
  const ddev = m.ddev || {};
  if ((ddev.hostMounts || []).length) {
    const d = path.join(into, 'host-mounts.txt');
    fs.mkdirSync(into, { recursive: true });
    fs.writeFileSync(d, `${ddev.hostMounts.join('\n')}\n`);
    placed.push(rel(d));
  }
  for (const f of ddev.compose || []) {
    const d = path.join(DDEV_DIR, `docker-compose.plugin-${name}-${path.basename(f).replace(/^docker-compose\./, '')}`);
    const fresh = !fs.existsSync(d) || !fs.readFileSync(d).equals(fs.readFileSync(path.join(plugin.dir, f)));
    copyFile(path.join(plugin.dir, f), d);
    placed.push(rel(d));
    if (fresh) restart = true;
  }
  const commands = m.commands || {};
  if ((commands.files || []).length) {
    // Named workspaces when the manifest lists them (only those that exist), else every one of the types.
    const named = (commands.workspaces || []).filter((ws) => /^[a-z0-9_-]+$/.test(ws) && fs.existsSync(path.join(ROOT, ws)));
    for (const ws of named.length ? named : workspacesOfTypes(commands.types || ['sites'])) {
      for (const f of commands.files) {
        const d = path.join(ROOT, ws, path.basename(f));
        copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws } });
        placed.push(rel(d));
      }
    }
  }
  for (const f of m.themes || []) { const d = path.join(CONFIG_DIR, path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  // A workspace folder the plugin IS (modules, themes, dev…): the folder, its settings file (placed once,
  // never overwritten — it holds this machine's lists — and kept on uninstall) and its commands.
  // --activate puts the key on settings.yml's workspaces list; --deactivate takes it off.
  const ws = m.workspace || null;
  if (ws && /^[a-z0-9_-]+$/.test(String(ws.key || ''))) {
    const folder = path.join(ROOT, ws.key);
    fs.mkdirSync(folder, { recursive: true });
    if (ws.settingsTemplate) {
      const d = path.join(CONFIG_DIR, `workspace.${ws.key}.settings.yml`);
      // Recorded every time, placed only once: a path an earlier install recorded and this one does not is removed as stale.
      if (!fs.existsSync(d)) copyFile(path.join(plugin.dir, ws.settingsTemplate), d);
      placed.push(rel(d));
    }
    for (const f of ws.files || []) {
      const d = path.join(folder, path.basename(f));
      copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws.key } });
      placed.push(rel(d));
    }
    // Written once, for a person to edit: what the folder is for.
    for (const f of ws.docs || []) {
      const d = path.join(folder, path.basename(f));
      if (!fs.existsSync(d)) copyFile(path.join(plugin.dir, f), d, { fill: { __WORKSPACE__: ws.key } });
      placed.push(rel(d));
    }
  }
  // webship-js features, under tests/features/plugins/<name>/: the dashboard's cucumber paths cover every
  // folder below tests/features, so an installed plugin's scenarios run with `ddev test-dashboard browser`.
  for (const f of m.features || []) { const d = path.join(ROOT, 'core', 'workspace-app', 'tests', 'features', 'plugins', name, path.basename(f)); copyFile(path.join(plugin.dir, f), d); placed.push(rel(d)); }
  placeSettings(plugin, placed);
  // What an earlier install placed and this one did not (a workspace that changed type, a file the
  // manifest dropped) goes away, so the tree never holds a stale copy.
  for (const old of before) if (!placed.includes(old)) { try { fs.rmSync(path.join(ROOT, old)); } catch (_) { /* already gone */ } }
  record[name] = { module: plugin.module, version: plugin.version, installed: new Date().toISOString(), placed };
  writeRecord(record);
  updateGitignore(record);
  return { name, placed, restart: restart || (ddev.hostMounts || []).length > 0 && !before.size };
}

function uninstall(name) {
  const record = readRecord();
  const entry = record[name];
  if (!entry) return { name, removed: [] };
  const removed = [];
  for (const p of entry.placed || []) {
    // A workspace's own settings file and its docs stay: they hold what a person put there.
    if (/^core\/config\/workspace\.[a-z0-9_-]+\.settings\.yml$/.test(p) || /\/(AGENTS|CLAUDE|README)\.md$/.test(p)) continue;
    try { fs.rmSync(path.join(ROOT, p)); removed.push(p); } catch (_) { /* already gone */ }
  }
  try { fs.rmSync(path.join(SCRIPTS_DIR, 'plugins', name), { recursive: true, force: true }); } catch (_) { /* nothing there */ }
  delete record[name];
  writeRecord(record);
  updateGitignore(record);
  return { name, removed, restart: removed.some((p) => p.includes('/.ddev/')) };
}

function status(name) {
  const record = readRecord();
  const list = (name ? [pluginByName(name)].filter(Boolean) : installedPlugins());
  return list.map((p) => {
    const entry = record[p.name];
    const missing = entry ? (entry.placed || []).filter((f) => !fs.existsSync(path.join(ROOT, f))) : [];
    return { name: p.name, module: p.module, version: p.version, dir: p.dir, installed: !!entry, placed: entry ? entry.placed.length : 0, missing,
      settingsFile: p.manifest.settingsFile ? fs.existsSync(path.join(CONFIG_DIR, p.manifest.settingsFile)) : null };
  });
}

module.exports = { install, uninstall, status, RECORD };

if (require.main === module) {
  const [verb, name] = process.argv.slice(2);
  try {
    if (verb === 'install' && name) {
      const r = install(name);
      for (const p of r.placed) console.log(`  placed ${p}`);
      console.log(r.restart ? 'RESTART_NEEDED' : 'RESTART_NOT_NEEDED');
    } else if (verb === 'uninstall' && name) {
      const r = uninstall(name);
      for (const p of r.removed) console.log(`  removed ${p}`);
      console.log(r.restart ? 'RESTART_NEEDED' : 'RESTART_NOT_NEEDED');
    } else if (verb === 'status') {
      console.log(JSON.stringify(status(name), null, 2));
    } else {
      console.error('usage: node plugin-install.js install|uninstall|status [<name>]');
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
