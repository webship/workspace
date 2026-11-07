/**
 * A plugin's own settings file: core/config/plugin.<name>.settings.yml.
 *
 * Each plugin keeps its settings in a file of its own, the way each workspace does, instead of a block in
 * settings.yml: they are edited, backed up and (because they can hold a secret) protected separately, and
 * removing a plugin removes its configuration with it. sync-tooling copies only workspace.*.settings.yml, so
 * these files stay local like settings.yml does.
 *
 * A plugin whose settings used to be a block in settings.yml names it in LEGACY_KEYS, so an install that has
 * not been moved yet still reads (never writes) the old block.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { CONFIG_DIR, loadSettings } = require('./workspaces');

const LEGACY_KEYS = { 'google-drive-sync': 'google_drive' };
// A plugin package says in its manifest which settings.yml block its file replaces.
try {
  for (const p of require('./plugin-manifest').installedPlugins()) {
    if (p.manifest && p.manifest.legacySettingsKey) LEGACY_KEYS[p.name] = p.manifest.legacySettingsKey;
  }
} catch (_) { /* no manifests: the static map is the whole story */ }
const fileFor = (name) => `plugin.${name}.settings.yml`;

function readPluginSettings(name) {
  const full = path.join(CONFIG_DIR, fileFor(name));
  try {
    if (fs.existsSync(full)) return yaml.load(fs.readFileSync(full, 'utf8')) || {};
  } catch (_) { /* unreadable: treated as empty */ }
  const legacy = LEGACY_KEYS[name];
  return (legacy && String(legacy).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), loadSettings())) || {};
}

/** Make sure the file exists, private to the owner, before something writes into it. */
function ensurePluginSettingsFile(name) {
  const full = path.join(CONFIG_DIR, fileFor(name));
  if (!fs.existsSync(full)) fs.writeFileSync(full, '', { mode: 0o600 });
  return fileFor(name);
}

module.exports = { fileFor, readPluginSettings, ensurePluginSettingsFile, LEGACY_KEYS };
