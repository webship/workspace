/**
 * Small truths of the settings pages: a file is described as what it is, a number with no unit prints
 * no unit, and the page heading fits a phone.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const server = read('server.js');

test('only a workspace file is "for a workspace": a plugin file and a style file say what they are', () => {
  assert.match(server, /const ws = \(file\.match\(\/\^workspace\\\.\(\.\+\)\\\.settings\\\.yml\$\/\) \|\| \[\]\)\[1\] \|\| null;/);
  assert.match(server, /fileHint\(file, \{ pluginLabel: ownerLabel \}\)/);
  assert.ok(!server.includes("file.replace(/^workspace\\.|\\.settings\\.yml$/g, '');\n\n  // A plugin may offer"), 'plugin.jira is not a workspace name');
});

test('a number field with no unit prints no unit (it printed the word undefined)', () => {
  assert.match(server, /\$\{numeric\.unit \? `<span class="uk-text-meta settings-unit">\$\{esc\(numeric\.unit\)\}<\/span>` : ''\}/);
});

test('the page heading wraps on a phone, and a wide table scrolls inside itself', () => {
  const css = read('public/css/components/top-toolbar-logo-breadcrumb.css');
  const phone = css.slice(css.lastIndexOf('@media (max-width: 40em) {'));
  assert.match(phone, /\.page-heading \{ flex-wrap: wrap; \}/);
  assert.match(phone, /\.page-heading \.width-switcher \{ display: none; \}/);
  assert.match(read('plugins-page.js'), /<div class="uk-overflow-auto" tabindex="0" role="region" aria-label="Commands on this machine">/);
});

test('a field keeps the surface and the ink of the style while it has focus (it turned white in the dark style)', () => {
  const css = read('public/css/base.css');
  const rule = css.slice(css.indexOf('.uk-input:focus, .uk-textarea:focus, .uk-select:focus {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /background-color: var\(--surface-input\);/);
  assert.match(body, /color: var\(--text-default\);/);
});
