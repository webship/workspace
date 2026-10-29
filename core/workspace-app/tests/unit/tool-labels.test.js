const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const server = read('server.js');
const ui = read('public', 'ui.js');
const css = read('public', 'css', 'components', 'project-cards.css');

test('words or icons on the tool buttons is a style option: every style states it, and icons is what ships', () => {
  const themes = fs.readdirSync(path.join(root, 'public', 'themes'));
  assert.ok(themes.length >= 4);
  for (const t of themes) assert.match(read('public', 'themes', t, 'theme.css'), /--pcard-tool-label: 0rem;/, `${t} theme.css`);
  const config = path.join(root, '..', 'config');
  const yml = fs.readdirSync(config).filter((f) => /^theme\..+\.yml$/.test(f));
  assert.ok(yml.length >= 4);
  for (const f of yml) assert.match(fs.readFileSync(path.join(config, f), 'utf8'), /^\s*pcard-tool-label: 0rem$/m, f);
});

test('the card sizes its tool buttons from that token, so a style can choose words with one value', () => {
  assert.match(css, /font-size: var\(--pcard-tool-label, 0rem\);/);
  assert.match(css, /padding: 0 calc\(var\(--pcard-tool-label, 0rem\) \* 0\.67\);/);
});

test('the browser can choose for itself, and the choice is applied before first paint', () => {
  assert.match(css, /html\[data-tool-labels="words"\] #webship-workspace-projects \{ --pcard-tool-label: 0\.75rem; \}/);
  assert.match(css, /html\[data-tool-labels="icons"\] #webship-workspace-projects \{ --pcard-tool-label: 0rem; \}/);
  assert.match(server, /wsPref\('ws-tool-labels',null\)/);
  assert.match(server, /toolLabelsSwitcherHtml\(\)/);
  assert.match(ui, /wsPrefSet\('ws-tool-labels', mode\)/);
  assert.match(ui, /--pcard-tool-label/, 'with no choice the switch shows what the style says');
});
