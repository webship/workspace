/**
 * Where this plugin lives and what it reads: the workspace paths, the plugin's own settings file, and the
 * one-time move of the old `google_drive:` block out of settings.yml.
 *
 * Self-contained on purpose. The command line and the MCP server run outside the dashboard, so nothing here
 * may reach into the dashboard's own modules; the dashboard hands the plugin an `api`, and this file covers
 * everything else from the workspace files alone.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// core/workspace-app/plugins/google-drive-sync/lib -> the workspace root is five levels up.
const ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..', '..', '..', '..');
const CONFIG = process.env.WORKSPACE_CONFIG || path.join(ROOT, 'core', 'config');
const PLUGIN = 'google-drive-sync';
const SETTINGS_FILE = `plugin.${PLUGIN}.settings.yml`;
const LEGACY_KEY = 'google_drive';

const settingsPath = () => path.join(CONFIG, SETTINGS_FILE);
const globalPath = () => path.join(CONFIG, 'settings.yml');

function readYaml(file) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { return {}; }
}

/** This plugin's settings. An install that has not been moved yet still reads its old google_drive: block. */
function pluginSettings() {
  if (fs.existsSync(settingsPath())) return readYaml(settingsPath());
  return readYaml(globalPath())[LEGACY_KEY] || {};
}

const globalSettings = () => readYaml(globalPath());
const hubDomain = () => String(globalSettings().hub_domain || `${process.env.DDEV_PROJECT || 'workspace'}.ddev.site`);

function isValidWorkspace(key) {
  const list = globalSettings().workspaces;
  return typeof key === 'string' && Array.isArray(list) && list.includes(key);
}

/** The folder a workspace lives in: its own `doc.path`, else <root>/<name>. */
function workspaceDir(key) {
  if (!isValidWorkspace(key)) return null;
  const doc = readYaml(path.join(CONFIG, `workspace.${key}.settings.yml`)).doc || {};
  return doc.path || path.join(ROOT, key);
}

/**
 * Move the old `google_drive:` block of settings.yml into this plugin's own settings file, once. The values
 * are copied, not rewritten (comments and all), the file is private to the owner because it holds a client
 * secret and a refresh token, and the block (with the comment lines right above it) leaves settings.yml.
 * Returns true when it moved something.
 */
function migrate() {
  if (fs.existsSync(settingsPath())) return false;
  let text;
  try { text = fs.readFileSync(globalPath(), 'utf8'); } catch (_) { return false; }
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${LEGACY_KEY}:\\s*(#.*)?$`).test(l));
  if (start < 0) return false;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]) || /^\s*#/.test(lines[end])) && !/^#/.test(lines[end])) end += 1;
  while (end > start + 1 && lines[end - 1] === '') end -= 1;            // trailing blank lines stay with the file
  let first = start;
  while (first > 0 && /^#/.test(lines[first - 1])) first -= 1;           // the comment block that explains the key
  const body = lines.slice(start + 1, end).map((l) => l.replace(/^ {2}/, '')).join('\n');
  const header = lines.slice(first, start).join('\n');
  fs.writeFileSync(settingsPath(), `${header ? `${header}\n` : ''}${body}\n`, { mode: 0o600 });
  fs.chmodSync(settingsPath(), 0o600);
  const rest = [...lines.slice(0, first), ...lines.slice(end)];
  while (rest.length > 1 && rest[first] === '' && rest[first - 1] === '') rest.splice(first, 1);
  fs.writeFileSync(globalPath(), rest.join('\n'));
  return true;
}

module.exports = {
  ROOT, CONFIG, PLUGIN, SETTINGS_FILE, LEGACY_KEY,
  settingsPath, readYaml, pluginSettings, globalSettings, hubDomain, isValidWorkspace, workspaceDir, migrate,
};
