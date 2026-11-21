/**
 * Every code box the dashboard draws is readable: its own code colours, never a UIkit background under them (webship/workspace#683).
 *
 * The home page of a fresh workspace showed its three first commands in a <pre class="uk-background-muted">. The
 * dashboard colours every pre from its tokens, --code-ink on --code-bg, and UIkit's class replaced the background but
 * not the ink: light ink on light grey, 1.14 to 1, in both themes. Measured in a browser after the fix: 12.7 to 1.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const sources = () => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'tests', 'vendor', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk(APP);
  return out;
};

test('no pre the dashboard draws carries a UIkit background class', () => {
  const found = [];
  for (const f of sources()) {
    const m = fs.readFileSync(f, 'utf8').match(/<pre\b[^>]*class="[^"]*\buk-background-[a-z]+/g);
    if (m) found.push(`${path.relative(APP, f)}: ${m.join(' | ')}`);
  }
  assert.deepStrictEqual(found, []);
});

test('the empty workspace\'s commands are in a plain code box', () => {
  assert.match(fs.readFileSync(path.join(APP, 'server.js'), 'utf8'), /<pre class="uk-padding-small">webship-workspace plugin require dev/);
});

test('in every theme, the code ink on the code background reads at 4.5 to 1 or more', () => {
  const lum = (hex) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const themes = fs.readdirSync(path.join(APP, 'public', 'themes'));
  assert.ok(themes.length >= 4, themes.join(', '));
  for (const t of themes) {
    const css = fs.readFileSync(path.join(APP, 'public', 'themes', t, 'theme.css'), 'utf8');
    const bg = (css.match(/--code-bg:\s*(#[0-9a-fA-F]{3,6})\b/) || [])[1];
    const ink = (css.match(/--code-ink:\s*(#[0-9a-fA-F]{3,6})\b/) || [])[1];
    assert.ok(bg && ink, `${t}: --code-bg and --code-ink`);
    const [a, b] = [lum(bg), lum(ink)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `${t}: ${ink} on ${bg} is ${ratio.toFixed(2)} to 1`);
  }
});
