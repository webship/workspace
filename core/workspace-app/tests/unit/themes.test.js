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

const { listThemes, themeLabel, resolveTheme, assembleCss, cssVersion,
  readThemeOverrides, themeOverridesCss, themeOverridesFile,
  createTheme, isYamlOnlyTheme, themePreview, isMadeHere} = require('../../themes');

const PUBLIC = path.join(__dirname, '..', '..', 'public');

/**
 * The tokens a style actually renders with, from whichever source it has.
 *
 * A style can ship as a directory with a `theme.css`, or exist only as `core/config/theme.<n>.yml`
 * — which is what a style created from the interface is. A test that reads only the stylesheet
 * would pass for the shipped four and say nothing about the ones people make.
 */
const styleTokens = (name) => {
  const file = path.join(PUBLIC, 'themes', name, 'theme.css');
  if (fs.existsSync(file)) {
    const clean = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const grab = (selector) => {
      const out = new Map();
      const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g');
      let m;
      while ((m = re.exec(clean))) {
        for (const d of m[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim());
      }
      return out;
    };
    return { root: grab(':root'), dark: grab('html\\.dark'), fromCss: true };
  }
  const { tokens, dark } = readThemeOverrides(name);
  return { root: new Map(Object.entries(tokens)), dark: new Map(Object.entries(dark)), fromCss: false };
};


test('the themes on disk are the themes offered', () => {
  // Both kinds: a directory with a stylesheet, and a style that is only YAML.
  const onDisk = fs.readdirSync(path.join(PUBLIC, 'themes'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PUBLIC, 'themes', e.name, 'theme.css')))
    .map((e) => e.name).sort();
  for (const t of onDisk) assert.ok(listThemes().includes(t), `${t} is on disk but not offered`);
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

// Set on an element by a script at runtime, never by a theme: the terminal's own palette, which xterm needs
// as values too, and the swatches in its menu.
// Layout variables a component declares for itself (the project card's sizes, set on its own list), not colours a theme owns.
const CARD_VARS = ['--pcard-min', '--pcard-gap', '--pcard-pad', '--pcard-radius', '--pcard-tool', '--pcard-chip',
  '--pcard-title-lines', '--pcard-cols', '--pcard-stripe'];
// sortable.js sets where a dragged card's open slot starts, past its column's gutter.
const RUNTIME_TOKENS = ['--flash-ms', '--term-bg', '--term-fg', '--term-bar', '--term-bar-ink', '--sw-bg', '--sw-fg', '--sw-ink',
  '--sort-inset-left', ...CARD_VARS];

test('EVERY token a component uses is defined by EVERY theme', () => {
  const used = new Set();
  const read = (f) => fs.readFileSync(f, 'utf8');
  for (const f of [path.join(PUBLIC, 'css', 'base.css'),
                   ...fs.readdirSync(path.join(PUBLIC, 'css', 'components')).map((n) => path.join(PUBLIC, 'css', 'components', n))]) {
    for (const m of read(f).matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  for (const theme of listThemes()) {
    const defined = new Set(styleTokens(theme).root.keys());
    RUNTIME_TOKENS.forEach((t) => defined.add(t));
    const missing = [...used].filter((t) => !defined.has(t));
    assert.deepEqual(missing, [], `${theme} does not define: ${missing.join(', ')}`);
  }
});

// The debt this split inherited — now paid, and held at zero.
//
// A colour written into a component cannot be themed: it looks right in exactly one palette and
// silently wrong in every other. The single stylesheet carried 117 of them when it was split,
// almost all in `html.dark` overrides that existed only because the light rule underneath named a
// colour instead of a token. Every one is now a token, so the map is empty and the test is a
// simple rule rather than a ratchet: a component may not name a colour at all.
//
// A file may still be listed here if a genuine exception ever appears. Nothing qualifies today:
// the surfaces that legitimately ignore the theme (a terminal, a video's letterbox, rendered
// paper) are tokens too — --code-bg, --media-bg, --paper — so a theme can still overrule them.
const COLOUR_LITERAL_BASELINE = {};

test('no component gains a new hardcoded colour', () => {
  const files = fs.readdirSync(path.join(PUBLIC, 'css', 'components')).map((n) => path.join(PUBLIC, 'css', 'components', n));
  files.push(path.join(PUBLIC, 'css', 'base.css'));
  const worse = [];
  for (const f of files) {
    const name = path.basename(f);
    const hits = (fs.readFileSync(f, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    const allowed = COLOUR_LITERAL_BASELINE[name] || 0;
    if (hits > allowed) worse.push(`${name}: ${hits} colours, baseline ${allowed}`);
  }
  assert.deepEqual(worse, [], 'use a token — a hardcoded colour cannot be themed');
});

test('the baseline is honest: it lists no file that is already clean', () => {
  for (const name of Object.keys(COLOUR_LITERAL_BASELINE)) {
    const f = name === 'base.css'
      ? path.join(PUBLIC, 'css', 'base.css')
      : path.join(PUBLIC, 'css', 'components', name);
    const hits = (fs.readFileSync(f, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    assert.ok(hits > 0, `${name} is clean now — take it out of the baseline`);
  }
});

// A theme is a palette. It says what --surface IS; it never says what has one.
//
// The default theme used to end with sixty `html.dark .something { … }` rules, which is how a
// palette file quietly becomes a second stylesheet: those rules existed only under ONE theme, so
// switching to Ember or Slate lost the toggle's styling, the modal's dark surface and the editor's
// code face. Selecting an element from inside a palette is the mistake — this catches it.
// The assistant's input lives in deep-chat's shadow root, where the sheet does not reach, so ui.js carries its CSS
// as strings. A custom property does cross into a shadow root, so a token there follows the theme; a literal does
// not — which is how the send button came to be UIKit blue, resting on a pale grey that stayed light after dark.
test('the chat panel\'s own CSS paints with tokens, not colours', () => {
  const ui = fs.readFileSync(path.join(PUBLIC, 'ui.js'), 'utf8');
  for (const name of ['auxiliaryStyle', 'shadowCss']) {
    const at = ui.indexOf(name === 'auxiliaryStyle' ? 'el.auxiliaryStyle = `' : 'const shadowCss = `');
    assert.ok(at > 0, `no ${name} in ui.js`);
    const css = ui.slice(at, ui.indexOf('`;', at)).replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g) || [];
    assert.deepEqual(literals, [], `${name} paints with colour literals`);
  }
});

test('a theme declares values and selects nothing', () => {
  for (const theme of listThemes()) {
    // A style with no stylesheet cannot select anything, which is the point of it.
    if (!fs.existsSync(path.join(PUBLIC, 'themes', theme, 'theme.css'))) continue;
    const css = fs.readFileSync(path.join(PUBLIC, 'themes', theme, 'theme.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');                       // comments are prose, not rules
    const selectors = [...css.matchAll(/(^|})\s*([^{}]+)\{/g)].map((m) => m[2].trim());
    const offenders = selectors.filter((s) => !/^(:root|html\.dark)$/.test(s));
    assert.deepEqual(offenders, [], `${theme} styles elements: ${offenders.join(' | ')}`);
  }
});

// Every theme has to answer every question, or a component asking one of them gets nothing back
// and drops the declaration in silence. Same names everywhere; only the values differ.
test('every theme defines exactly the same tokens', () => {
  // Names, not the Map itself — a Map spreads into [key, value] pairs and every `has` would miss.
  const tokensOf = (t) => new Set(styleTokens(t).root.keys());
  const themes = listThemes();
  const reference = tokensOf('default');
  for (const theme of themes.filter((t) => t !== 'default')) {
    const mine = tokensOf(theme);
    assert.deepEqual([...reference].filter((t) => !mine.has(t)), [], `${theme} is missing tokens`);
    assert.deepEqual([...mine].filter((t) => !reference.has(t)), [], `${theme} invents tokens the default does not have`);
  }
});

// Both halves, not one. A token that only the light half sets keeps its light value after dark,
// which is the failure that leaves navy text on a navy surface.
test('the dark half restates every token that has to change', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'themes', 'default', 'theme.css'), 'utf8');
  const dark = css.slice(css.indexOf('html.dark'));
  for (const token of ['--surface', '--surface-card', '--text-default', '--line', '--link', '--chip-bg']) {
    assert.ok(new RegExp(`^\\s*${token}:`, 'm').test(dark), `the dark half never sets ${token}`);
  }
});

test('the version changes when a file does, so the browser refetches', () => {
  const before = cssVersion('default');
  const f = path.join(PUBLIC, 'css', 'base.css');
  const original = fs.statSync(f).mtime;
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(cssVersion('default'), before);
  fs.utimesSync(f, original, original);
});

/* ---------- type roles ---------- */

// The role tokens are the point of the type layer: one token per role holding the weight, the
// size, the line-height and the family together, so a component cannot set three of the four.
// A role that is only a size would let the drift back in.
test('every theme states each heading as a complete role, not a bare size', () => {
  const roles = ['--type-h1', '--type-h2', '--type-h3', '--type-h4', '--type-h5', '--type-h6', '--type-body'];
  for (const t of listThemes()) {
    const tokens = styleTokens(t).root;
    for (const role of roles) {
      const value = tokens.get(role);
      assert.ok(value, `${t} does not define ${role}`);
      assert.match(value, /var\(--weight-/, `${t} ${role} has no weight`);
      assert.match(value, /var\(--size-[a-z0-9-]+\)\//, `${t} ${role} has no size followed by a line-height`);
      assert.match(value, /var\(--font-/, `${t} ${role} has no family`);
    }
  }
});

// A heading must not have to remember to bring its own tracking, so the token exists in every
// theme even where it is `normal`.
test('every theme states tracking for every heading role', () => {
  for (const t of listThemes()) {
    const tokens = styleTokens(t).root;
    for (const n of [1, 2, 3, 4, 5, 6]) {
      assert.ok(tokens.has(`--tracking-h${n}`), `${t} does not define --tracking-h${n}`);
    }
  }
});

// Press is the Vardot palette on a different type scale. Its own file says the colours are
// identical to default's, and a claim in a comment is worth what a test makes it worth: a colour
// that drifts apart here is a second palette nobody decided to have.
test('press is default’s palette — only the type differs', () => {
  const read = (t) => {
    const css = fs.readFileSync(path.join(PUBLIC, 'themes', t, 'theme.css'), 'utf8');
    const out = new Map();
    for (const m of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
    return out;
  };
  const a = read('default');
  const b = read('press');
  const TYPE = /^--(size|leading|tracking|type|weight|font)-/;
  const differ = [];
  for (const [k, v] of a) {
    if (TYPE.test(k)) continue;
    if (b.has(k) && b.get(k) !== v) differ.push(k);
  }
  assert.deepEqual(differ, [], 'these colour tokens differ between default and press');
});

/* ---------- tokens as YAML ---------- */

// A theme file declares custom properties and selects nothing. That is what makes every value in
// it configuration — and configuration belongs beside settings.yml, not inside a stylesheet.
test('a theme file only ever declares tokens', () => {
  for (const t of listThemes()) {
    const file = path.join(PUBLIC, 'themes', t, 'theme.css');
    if (!fs.existsSync(file)) continue;          // a YAML-only style has nothing to paint with
    const css = fs.readFileSync(file, 'utf8');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const declarations = stripped.match(/^\s+[a-zA-Z-]+\s*:/gm) || [];
    const painting = declarations.filter((d) => !d.trim().startsWith('--'));
    assert.deepEqual(painting, [], `${t} paints something; a theme is a palette`);
  }
});

// The override layer: names without the leading dashes, and anything that could close the block
// and start a rule of its own is dropped rather than written into the sheet.
test('YAML tokens are normalised, and nothing that is not a token gets through', () => {
  const css = themeOverridesCss('press');
  if (css) {
    assert.match(css, /^:root \{/m, 'the tokens are emitted as a :root block');
    assert.doesNotMatch(css.replace(/^:root \{|^html\.dark \{|^\}/gm, ''), /[{}]/,
      'a value must not be able to close the block');
  }
  // The reader itself, on values it should refuse.
  const { tokens } = readThemeOverrides('press');
  for (const k of Object.keys(tokens)) {
    assert.match(k, /^--[a-zA-Z][a-zA-Z0-9-]*$/, `${k} is not a token name`);
    assert.doesNotMatch(tokens[k], /[{};]/, `${k} carries something that is not a value`);
  }
});

// The YAML wins, or it is not an override.
test('the override block is emitted after the theme', () => {
  const css = assembleCss('press');
  if (css.includes('/* theme overrides:')) {
    assert.ok(css.indexOf('/* theme: press */') < css.indexOf('/* theme overrides:'),
      'a token set in YAML has to come after the same token in the theme file');
  }
});

// Editing the YAML has to reach the browser: /style.css is cached by this key.
test('the cache key follows the YAML, not just the CSS', () => {
  const f = themeOverridesFile('press');
  if (!fs.existsSync(f)) return;
  const before = cssVersion('press');
  const original = fs.statSync(f).mtime;
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.notEqual(cssVersion('press'), before, 'editing the tokens would serve yesterday’s sheet');
  fs.utimesSync(f, original, original);
});

// Two sources for one value is a drift waiting to happen. The theme file is what you get with no
// YAML at all, so the two have to agree on anything the YAML sets.
test('every theme’s YAML agrees with its CSS, so deleting the YAML changes nothing', () => {
  // Read the two halves SEPARATELY. A flat map of the whole file would let html.dark's values
  // overwrite :root's, and the comparison would then hold the light tokens against the dark ones —
  // which is how this test failed the first time it was run.
  const halves = (css) => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const grab = (selector) => {
      const out = new Map();
      const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g');
      let m;
      while ((m = re.exec(clean))) {
        for (const d of m[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim());
      }
      return out;
    };
    return { root: grab(':root'), dark: grab('html\\.dark') };
  };

  for (const t of listThemes()) {
    const { tokens, dark } = readThemeOverrides(t);
    if (!Object.keys(tokens).length && !Object.keys(dark).length) continue;
    const file = path.join(PUBLIC, 'themes', t, 'theme.css');
    if (!fs.existsSync(file)) continue;          // nothing to disagree with
    const css = halves(fs.readFileSync(file, 'utf8'));
    const differ = [];
    const compare = (yamlBlock, cssBlock, half) => {
      for (const [k, v] of Object.entries(yamlBlock)) {
        if (cssBlock.has(k) && cssBlock.get(k) !== v) differ.push(`${half} ${k}: ${cssBlock.get(k)} vs ${v}`);
      }
    };
    compare(tokens, css.root, 'light');
    compare(dark, css.dark, 'dark');
    assert.deepEqual(differ, [], `${t}: the theme file and its YAML disagree`);
  }
});

/* ---------- styles made from the interface ---------- */

// A style used to be something only a release could add: a directory and a stylesheet inside the
// app. With every token in YAML there is nothing left for a stylesheet to say, so one can be made
// from the Styles page — and it has to be a complete style, not a fragment that leans on another.
test('a style created from an existing one is complete on its own', () => {
  const name = `test-made-${process.pid}`;
  const file = themeOverridesFile(name);
  try {
    const made = createTheme({ name, label: 'Test Made', from: 'default' });
    assert.ok(made.ok, made.error);
    assert.equal(made.from, 'default');

    // Every token the source renders with, copied — not referenced.
    const source = new Set(styleTokens('default').root.keys());
    const mine = new Set(Object.keys(readThemeOverrides(name).tokens));
    assert.deepEqual([...source].filter((t) => !mine.has(t)), [], 'the copy is missing tokens');

    assert.ok(listThemes().includes(name), 'it is not offered');
    assert.ok(isYamlOnlyTheme(name), 'it should have no stylesheet');
    assert.equal(themeLabel(name), 'Test Made', 'it names itself in its own file');

    // And it renders: no theme.css block, but every token present.
    const css = assembleCss(name);
    assert.ok(!css.includes(`/* theme: ${name} */`), 'there is no stylesheet to include');
    assert.match(css, /--brand-primary:/, 'its tokens are in the sheet');

    // Editing the style it came from must not change it later.
    assert.notStrictEqual(readThemeOverrides(name).tokens['--brand-primary'], undefined);
  } finally {
    try { fs.unlinkSync(file); } catch (_) { /* already gone */ }
  }
});

test('a style will not be created with a name that is not a name, or one already taken', () => {
  for (const bad of ['', 'Has Caps', '9leading', 'has space', '../escape', 'dot.dot']) {
    assert.equal(createTheme({ name: bad, from: 'default' }).ok, false, `${bad} should be refused`);
  }
  assert.equal(createTheme({ name: 'default', from: 'default' }).ok, false, 'default is taken');
});

// The page shows a style before you wear it, which only works if the preview reads real values.
test('a style previews with its own colours and its own type', () => {
  for (const t of listThemes()) {
    const p = themePreview(t);
    assert.ok(p, `${t} has no preview`);
    assert.match(p.brand, /^(#|rgb|oklch|hsl)/, `${t} brand is not a colour: ${p.brand}`);
    assert.ok(p.sizeBody, `${t} has no body size to show`);
    assert.ok(p.fontPrimary, `${t} has no family to set the card in`);
    // An alias has to be resolved or the swatch paints nothing.
    assert.doesNotMatch(p.brand, /^var\(/, `${t} brand is an unresolved alias`);
  }
});

// A colour that is not a colour paints nothing and says nothing: the browser drops the declaration
// and the element keeps whatever it inherited, so the page looks almost right. `#2b3cf` — five hex
// digits — got into a style this way and no test noticed until the value was read by eye.
test('every colour token in every style is a colour a browser will accept', () => {
  const COLOUR = /^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(|hsla?\(|oklch\(|oklab\(|color\(|var\(|transparent$|currentColor$|inherit$|none$)/;
  const LOOKS_LIKE_COLOUR = /^(#|rgb|hsl|oklch|oklab)/;
  const bad = [];
  for (const t of listThemes()) {
    const { root, dark } = styleTokens(t);
    for (const [half, map] of [['light', root], ['dark', dark]]) {
      for (const [k, v] of map) {
        if (!LOOKS_LIKE_COLOUR.test(v)) continue;          // a size, a shadow, a font stack
        if (!COLOUR.test(v)) bad.push(`${t} ${half} ${k}: ${v}`);
        // A hex has to be 3, 4, 6 or 8 digits. Five is the one that slips through by eye.
        const hex = /^#([0-9a-fA-F]+)$/.exec(v);
        if (hex && ![3, 4, 6, 8].includes(hex[1].length)) bad.push(`${t} ${half} ${k}: ${v} is ${hex[1].length} hex digits`);
      }
    }
  }
  assert.deepEqual(bad, [], 'these are not colours');
});

test('a style that ships with the workspace is not credited to whoever opened the page', () => {
  // The card used to read `isYamlOnlyTheme` and label the answer "made here". Five styles that ship
  // in the repository — Dispatch, UPSUN, GitHub, GitLab and Drupal — are YAML and nothing else,
  // because a style is a set of tokens and a stylesheet would be a second place to keep them. All
  // nine were therefore split between two labels on a machine that had created none of them.
  for (const name of listThemes()) {
    assert.equal(isMadeHere(name), false,
      `${name} ships with the workspace but claims to have been made here`);
  }
});

test('a style made here says so, and the marker is on the file', () => {
  const fs = require('fs');
  const name = `unittest${process.pid}`;
  const made = createTheme({ name, label: 'Unit Test', from: 'slate' });
  try {
    assert.ok(made.ok, made.error);
    assert.equal(isMadeHere(name), true);
    assert.equal(themePreview(name).madeHere, true);
    // On the file, not inferred from its shape — which is the whole point.
    assert.match(fs.readFileSync(made.file, 'utf8'), /^made_here: true$/m);
    // And the marker must not have cost it any tokens.
    assert.equal(themePreview(name).tokens, themePreview('slate').tokens);
  } finally {
    try { fs.unlinkSync(made.file); } catch (_) { /* nothing to clean */ }
  }
});
