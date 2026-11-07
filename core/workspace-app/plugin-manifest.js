/**
 * Which plugins this dashboard has, and what each one ships.
 *
 * A plugin is a node package whose package.json carries a `workspacePlugin` block — the manifest —
 * named as a dependency of this app (`npm install github:webship/workspace-upsun` is the whole
 * "require" step), or a folder under plugins/ with the same shape. The manifest says what the
 * installer has to place in the workspace (bash functions, per-workspace commands, DDEV compose
 * files, themes, a settings template) and what the loader wires in at startup (type actions, CSS,
 * labels). Nothing here loads a plugin's code: that is plugin-loader.js, and only for the ones that
 * are activated.
 *
 * Also a command: `node plugin-manifest.js [--json] [name]` lists them, for plugins.sh.
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
// Overridable for tests, like WORKSPACE_ROOT: a temporary folder of fake plugins.
const PLUGINS_DIR = process.env.WORKSPACE_PLUGINS_DIR || path.join(APP_DIR, 'plugins');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** The directory a package resolves to, through this app's node_modules, or null. */
function packageDir(moduleName) {
  try {
    return path.dirname(require.resolve(`${moduleName}/package.json`, { paths: [APP_DIR] }));
  } catch (_) {
    // A package whose package.json is not exported still has a directory under node_modules.
    const guess = path.join(APP_DIR, 'node_modules', ...moduleName.split('/'));
    return fs.existsSync(path.join(guess, 'package.json')) ? guess : null;
  }
}

/**
 * Every plugin package the app can see: `{ name, module, dir, manifest, version, description }`,
 * by manifest name. Dependencies first; a folder under plugins/ with the same name is the
 * fallback, the way the loader treats it.
 */
function installedPlugins() {
  const out = new Map();
  const own = readJson(path.join(APP_DIR, 'package.json')) || {};
  const deps = { ...(own.dependencies || {}), ...(own.devDependencies || {}) };
  for (const moduleName of Object.keys(deps)) {
    const dir = packageDir(moduleName);
    if (!dir) continue;
    const pkg = readJson(path.join(dir, 'package.json'));
    const m = pkg && pkg.workspacePlugin;
    if (!m || !m.name) continue;
    out.set(m.name, { name: m.name, module: moduleName, dir: fs.realpathSync(dir), manifest: m, version: pkg.version || '', description: pkg.description || '', spec: deps[moduleName] });
  }
  let folders = [];
  try { folders = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (_) { /* no plugins/ */ }
  for (const folder of folders) {
    const dir = path.join(PLUGINS_DIR, folder);
    const pkg = readJson(path.join(dir, 'package.json'));
    const m = (pkg && pkg.workspacePlugin) || (fs.existsSync(path.join(dir, 'index.js')) ? { name: folder } : null);
    if (!m || !m.name || out.has(m.name)) continue;
    out.set(m.name, { name: m.name, module: pkg ? pkg.name : '', dir, manifest: m, version: (pkg && pkg.version) || '', description: (pkg && pkg.description) || '', spec: `plugins/${folder}` });
  }
  return [...out.values()];
}

function pluginByName(name) {
  return installedPlugins().find((p) => p.name === name) || null;
}

module.exports = { installedPlugins, pluginByName, packageDir, APP_DIR, PLUGINS_DIR };

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const name = args.find((a) => !a.startsWith('--'));
  const list = name ? [pluginByName(name)].filter(Boolean) : installedPlugins();
  if (json) {
    process.stdout.write(`${JSON.stringify(name ? list[0] || null : list, null, 2)}\n`);
  } else {
    for (const p of list) process.stdout.write(`${p.name}\t${p.module || '-'}\t${p.version || '-'}\t${p.dir}\n`);
  }
  if (name && !list.length) process.exit(1);
}
