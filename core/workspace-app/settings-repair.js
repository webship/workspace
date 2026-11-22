/**
 * Repairs an update makes to core/config/settings.yml: each for damage an earlier release did, and only that.
 *
 *   node settings-repair.js      repair, and say what was done (nothing when there is nothing to repair)
 *
 * Two plugins: blocks (1.0.2 to 1.0.6, #172, #405). The lean template shipped `plugins: {}`, and the first
 * `plugins.sh --activate` wrote a second top-level `plugins:` block below it, so the file no longer parsed
 * ("duplicated mapping key") and the dashboard read no settings at all: no folders, no plugins, none of the
 * person's values. Every activation after that also rewrote `workspaces:` to the one folder it activated,
 * because the list was read from a file that did not parse. 1.0.7 stopped writing the second block; nothing
 * repaired a file that already had it. The repair: the empty `plugins: {}` line goes (it held nothing); the
 * workspaces list is the folders of the enabled plugins again, in the order they were installed, then
 * whatever else it held; the file as it was is kept as settings.yml.before-update (mode 600: it holds tokens).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { ROOT, CONFIG_DIR } = require('./workspaces');

const EMPTY_PLUGINS = /^plugins:\s*\{\}\s*(#.*)?$/;
const PLUGINS_BLOCK = /^plugins:\s*(#.*)?$/;

/** The workspaces list the broken file lost: the folders of the enabled plugins, in install order, then the rest. */
function workspacesAgain(doc) {
  const list = (Array.isArray(doc.workspaces) ? doc.workspaces : []).map(String);
  const enabled = Object.entries(doc.plugins || {})
    .filter(([, c]) => c && (c.enabled === true || String(c.enabled) === 'true')).map(([name]) => name);
  let order = [];
  try { order = Object.keys(yaml.load(fs.readFileSync(path.join(CONFIG_DIR, 'plugins.installed.yml'), 'utf8')) || {}); } catch (_) { /* no record */ }
  const ranked = [...order.filter((n) => enabled.includes(n)), ...enabled.filter((n) => !order.includes(n))];
  const { pluginByName } = require('./plugin-manifest.mts');
  const folders = [];
  for (const name of ranked) {
    const p = pluginByName(name);
    const key = p && p.manifest && p.manifest.workspace && String(p.manifest.workspace.key || '');
    if (key && /^[a-z0-9_-]+$/.test(key) && !folders.includes(key) && fs.existsSync(path.join(ROOT, key))) folders.push(key);
  }
  return [...folders, ...list.filter((k) => !folders.includes(k))];
}

function repairTwoPluginBlocks() {
  const file = path.join(CONFIG_DIR, 'settings.yml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  try { yaml.load(text); return []; } catch (e) { if (!/duplicated mapping key/.test(String(e.message))) return []; }
  const lines = text.split('\n');
  const empty = lines.findIndex((l) => EMPTY_PLUGINS.test(l));
  const block = lines.findIndex((l, i) => i !== empty && PLUGINS_BLOCK.test(l));
  if (empty < 0 || block < 0) return [];
  const fixed = lines.filter((_, i) => i !== empty).join('\n');
  let doc;
  try { doc = yaml.load(fixed) || {}; } catch (_) {
    return ['core/config/settings.yml still does not parse without its empty plugins: {} line: it is left as it is. Read the line the dashboard names.'];
  }
  fs.writeFileSync(path.join(CONFIG_DIR, 'settings.yml.before-update'), text, { mode: 0o600 });
  fs.writeFileSync(file, fixed);
  const said = ['repaired core/config/settings.yml: it had two plugins: blocks (written by plugins.sh of 1.0.2 to 1.0.6) and could not be read; the empty one is gone. The file as it was: core/config/settings.yml.before-update'];
  const now = (Array.isArray(doc.workspaces) ? doc.workspaces : []).map(String);
  const next = workspacesAgain(doc);
  if (next.join(',') !== now.join(',')) {
    require('./settings-file').upsertSettingsList('settings.yml', 'workspaces', next);
    const back = next.filter((k) => !now.includes(k));
    said.push(`put the folders of the enabled plugins back on the workspaces list, in the order they were installed (${back.length} the broken file had lost: ${back.join(', ')})`);
  }
  return said;
}

function repair() {
  return [...repairTwoPluginBlocks()];
}

module.exports = { repair, repairTwoPluginBlocks, workspacesAgain };

if (require.main === module) {
  for (const line of repair()) console.log(line);
}
