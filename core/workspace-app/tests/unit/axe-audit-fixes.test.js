/**
 * What the axe-core audit of every page and every Settings tab found (tests/features/accessibility.feature),
 * and what must not come back. Each was a real violation on a fresh workspace, light and dark.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');
const server = read('server.js');

test('heading-order: under a page\'s h1 the next level is an h2, its look kept by a size class', () => {
  const commands = read('commands-page.js');
  assert.match(commands, /<h2 class="uk-h3 uk-margin-small-bottom">Commands <span class="uk-badge">/, 'Commands: h1 then h3');
  assert.match(commands, /<h3 class="uk-h4 uk-margin-small-top">\$\{esc\(group\)\}/, 'its groups: h3 then h4');
  assert.doesNotMatch(commands, /<h4 class="uk-margin-small-top">\$\{esc\(group\)\}/);
  assert.match(server, /<h2 class="uk-h3 uk-margin-small-bottom uk-margin-top">Backups <span class="uk-badge">/, 'a workspace\'s backups');
});

test('heading-order: a settings file and the styles are h2 on their page and h3 in a pane of the modal', () => {
  assert.match(server, /await settingsFormHtml\(current, '', \{ heading: options\.fragment \? 'h3' : 'h2' \}\)/);
  assert.match(server, /<\$\{heading\} class="\$\{heading === 'h2' \? 'uk-h3 ' : ''\}uk-margin-small-bottom settings-card-file">/, 'the file name looks as it did');
  assert.match(server, /settingsFormHtml\(chosen\.file, '', \{ heading: 'h4' \}\)/, 'under a plugin page\'s h3 "Settings" it stays an h4');
  assert.match(server, /function stylesPageHtml\(\{ heading = 'h3' \} = \{\}\)/);
  assert.match(server, /stylesPageHtml\(\{ heading: options\.fragment \? 'h3' : 'h2' \}\)/);
  assert.match(server, /<\$\{heading\} class="uk-card-title uk-margin-remove" style="\$\{headStyle\}">/);
});

test('page-has-heading-one: Help has one h1, the guide\'s title, with pandoc or without it', () => {
  assert.match(server, /const titleLine = md\.match\(\/\^#\[ \\t\]\+\(\.\+\?\)\[ \\t#\]\*\$\/m\);/);
  assert.match(server, /const guideBody = titleLine \? md\.replace\(titleLine\[0\], ''\) : md;\n\s+const html = await renderMarkdown\(guideBody\);/, 'the title is not drawn twice');
  assert.match(server, /plainGuideHtml\(guideBody\)/, 'nor twice in the plain guide without pandoc');
  assert.match(server, /<h1 class="help-title">\$\{esc\(helpTitle\)\}<\/h1>/);
  assert.match(read('docs', 'USER-GUIDE.md'), /^# /m, 'the guide still starts with its title');
});

test('aria-allowed-role: the panes of a UIkit switcher are divs, never list items', () => {
  // UIkit gives each pane role="tabpanel", which a list item may not carry.
  const rows = read('row-layout.js');
  assert.match(rows, /<div id="row-actions-panes" class="uk-switcher">\s*<div>\$\{rowsPane\}<\/div>/);
  assert.doesNotMatch(rows, /<ul id="row-actions-panes"/);
  assert.match(server, /<div class="uk-switcher">\$\{MANAGERS\.map\(panel\)\.join\(''\)\}<\/div>/, 'the NODE menu');
  assert.match(server, /return `<div><div class="node-columns">/);
  for (const [file, src] of [['server.js', server], ['row-layout.js', rows]]) {
    assert.doesNotMatch(src, /<ul[^>]*class="[^"]*\buk-switcher\b/, `${file} has a switcher whose panes are list items`);
  }
});

test('scrollable-region-focusable: a list too long to show whole scrolls in a box a keyboard can reach, with a name', () => {
  assert.match(server, /<div class="set-list-scroll" tabindex="0" role="region" aria-label="\$\{esc\(listLabel\)\}, \$\{block\.items\.length\} entries"><ul class="set-list">/);
  assert.doesNotMatch(server, /<ul class="set-list\$\{/, 'the scroll is on the named box, not on the list');
});

test('the audit is a feature the browser suite runs, over every page, every workspace page and every Settings tab, light and dark', () => {
  const feature = read('tests', 'features', 'accessibility.feature');
  for (const p of ['/', '/screens', '/help', '/commands', '/settings', '/settings/plugins', '/settings/styles', '/settings/buttons']) {
    assert.ok(feature.includes(`| ${p} `), `${p} is audited`);
  }
  assert.match(feature, /Then the page should have no accessibility violations\n\s+Given the local storage "ws-theme" is set to "dark"/);
  assert.match(feature, /every workspace page should have no accessibility violations, in the light style and the dark one/);
  assert.match(feature, /every tab of the Settings modal should have no accessibility violations, in the light style and the dark one/);
  const steps = read('tests', 'step-definitions', 'accessibility-audit.steps.js');
  assert.match(steps, /require\('@axe-core\/playwright'\)/);
  assert.match(steps, /for \(const style of \['light', 'dark'\]\)/);
});

test('color-contrast: a Settings tab whose content is on its way is not faded with everything else that makes a request', () => {
  const tabCss = read('public', 'css', 'components', 'tab-modal.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(read('public', 'css', 'components', 'project-rows.css'), /\.htmx-request \{ opacity: \.6; pointer-events: none; \}/, 'the rule it is an exception to');
  assert.match(tabCss, /\.tabmodal-tab\.htmx-request \{ opacity: 1; pointer-events: auto; \}/);
});
