/**
 * The settings a plugin's current version no longer has (#424).
 *
 * A plugin's settings file is written once from its template and then kept as the person's, so a key that a newer
 * version of the plugin dropped stays in it. The settings form showed it as a live setting, with the description its
 * old comment gave it (`runs.default_mode: page` of the screens plugin, which no release reads since 1.0.10). This
 * compares the file with the template the installed version ships, so the form can say so. The file is never changed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The keys a template has, as dotted paths, and the ones it leaves to the person: a map or a list written empty on
 * one line (`api_tokens: {}`), a key with nothing under it, or a list. Whatever sits under those is the person's.
 */
function templateShape(text) {
  const keys = new Set();
  const open = new Set();
  const parents = new Set();
  const withChildren = new Set();
  const stack = [];   // [{ indent, key }]
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(#|$)/.test(line)) return;
    const m = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) return;   // a list item, or a line that is not a key
    const [, indentStr, key, rawValue] = m;
    const indent = indentStr.length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.map((x) => x.key).join('.');
    const dotted = parent ? `${parent}.${key}` : key;
    keys.add(dotted);
    if (parent) withChildren.add(parent);
    const value = rawValue.replace(/\s+#.*$/, '').trim();
    if (value === '') {
      stack.push({ indent, key });
      parents.add(dotted);
      if (/^\s*-(\s|$)/.test(lines[i + 1] || '')) open.add(dotted);
    } else if (/^(\{\s*\}|\[\s*\])$/.test(value)) {
      open.add(dotted);
    }
  });
  for (const p of parents) if (!withChildren.has(p)) open.add(p);
  return { keys, open };
}

/** The dotted keys of a settings file's rows (settings-file.js readSettingsRows) that the template has no place for. */
function droppedKeys(rows, templateText) {
  const { keys, open } = templateShape(templateText);
  const dropped = new Set();
  for (const r of rows || []) {
    if (!r || !r.dotted || keys.has(r.dotted)) continue;
    const parts = String(r.dotted).split('.');
    const underOpen = parts.slice(0, -1).some((_, i) => open.has(parts.slice(0, i + 1).join('.')));
    if (!underOpen) dropped.add(r.dotted);
  }
  return dropped;
}

/** For a plugin's own settings file: the keys its installed template no longer has, or none when there is no template. */
function droppedSettingsOf(pluginName, rows, lookup = require('./plugin-manifest.mts').pluginByName) {
  const plugin = pluginName ? lookup(pluginName) : null;
  const rel = plugin && plugin.manifest && plugin.manifest.settingsTemplate;
  if (!rel) return new Set();
  let text;
  try { text = fs.readFileSync(path.join(plugin.dir, rel), 'utf8'); } catch (_) { return new Set(); }
  return droppedKeys(rows, text);
}

module.exports = { templateShape, droppedKeys, droppedSettingsOf };
