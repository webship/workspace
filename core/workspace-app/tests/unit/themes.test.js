/**
 * The theme system: what a theme is, what a bad name does, and the property that matters most —
 * every token a component asks for is one some theme actually defines.
 *
 * That last one is not pedantry. An undefined var() drops the whole declaration silently, which is
 * how thirty rules in the old stylesheet came to be dead without anybody noticing.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { listThemes, themeLabel, resolveTheme, assembleCss, cssVersion } = require('../../themes');

const PUBLIC = path.join(__dirname, '..', '..', 'public');

test('the themes on disk are the themes offered', () => {
  const onDisk = fs.readdirSync(path.join(PUBLIC, 'themes'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PUBLIC, 'themes', e.name, 'theme.css')))
    .map((e) => e.name).sort();
  assert.deepEqual(listThemes(), onDisk);
  assert.ok(onDisk.includes('default'), 'there is always a default');
});

test('a theme that does not exist falls back to default', () => {
  assert.equal(resolveTheme('no-such-theme'), 'default');
  assert.equal(resolveTheme(''), 'default');
  assert.equal(resolveTheme(undefined), 'default');
});

test('a theme names itself for the settings form', () => {
  for (const t of listThemes()) {
    assert.ok(themeLabel(t).length, `${t} should have a label`);
  }
});

test('the sheet is assembled base first and theme last', () => {
  const css = assembleCss('default');
  assert.ok(css.includes('/* base */'));
  assert.ok(css.includes('/* theme: default */'));
  assert.ok(css.indexOf('/* base */') < css.indexOf('/* theme: default */'),
    'the theme has to come last or it cannot overrule a component');
});

test('every component is included', () => {
  const files = fs.readdirSync(path.join(PUBLIC, 'css', 'components')).filter((f) => f.endsWith('.css'));
  const css = assembleCss('default');
  for (const f of files) {
    assert.ok(css.includes(`/* component: ${f.replace(/\.css$/, '')} */`), `${f} is missing from the sheet`);
  }
});

test('EVERY token a component uses is defined by EVERY theme', () => {
  const used = new Set();
  const read = (f) => fs.readFileSync(f, 'utf8');
  used.add('--flash-ms');                    // set on the element by ui.js at runtime, not by a theme
  for (const f of [path.join(PUBLIC, 'css', 'base.css'),
                   ...fs.readdirSync(path.join(PUBLIC, 'css', 'components')).map((n) => path.join(PUBLIC, 'css', 'components', n))]) {
    for (const m of read(f).matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  for (const theme of listThemes()) {
    const defined = new Set([...read(path.join(PUBLIC, 'themes', theme, 'theme.css')).matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    defined.add('--flash-ms');
    const missing = [...used].filter((t) => !defined.has(t));
    assert.deepEqual(missing, [], `${theme} does not define: ${missing.join(', ')}`);
  }
});

test('a component names no colour of its own', () => {
  const files = fs.readdirSync(path.join(PUBLIC, 'css', 'components')).map((n) => path.join(PUBLIC, 'css', 'components', n));
  files.push(path.join(PUBLIC, 'css', 'base.css'));
  const offenders = [];
  for (const f of files) {
    const hits = fs.readFileSync(f, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hits) offenders.push(`${path.basename(f)}: ${hits.join(' ')}`);
  }
  assert.deepEqual(offenders, [], 'a hardcoded colour cannot be themed');
});

test('the version changes when a file does, so the browser refetches', () => {
  const before = cssVersion('default');
  const f = path.join(PUBLIC, 'css', 'base.css');
  const original = fs.statSync(f).mtime;
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(cssVersion('default'), before);
  fs.utimesSync(f, original, original);
});
