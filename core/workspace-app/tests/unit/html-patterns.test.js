/**
 * Every `pattern` attribute has to be a regular expression the BROWSER accepts.
 *
 * HTML compiles `pattern` with the `v` flag, which is stricter inside a character class than anything
 * Node applies by default: a bare `-` or `/` there is a SyntaxError. The browser then throws, drops
 * the attribute, and the field silently has no validation at all — while every render logs
 * "Pattern attribute value … is not a valid regular expression".
 *
 * Found by opening a page with the console open, which is the only place it can be found: the server
 * renders the attribute perfectly happily, and Node's own RegExp accepts it too.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');

test('every pattern in the app compiles the way the browser compiles it', () => {
  const files = ['server.js', 'screens.js', 'commands-page.js', 'ddev-addons-page.js', 'ddev-import.js',
    'build-order-page.js', 'navigation-page.js'].filter((f) => fs.existsSync(path.join(APP, f)));
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    for (const m of src.matchAll(/pattern="([^"]+)"/g)) {
      // A template expression is checked where its values are DEFINED (below) rather than guessed at
      // here: this test reads source, and `${esc(lm.pattern || '…')}` has no value until it runs.
      if (m[1].includes('${')) continue;
      // What reaches the browser: the JS source escapes a backslash, the HTML attribute does not.
      const asServed = m[1].replace(/\\\\/g, '\\');
      try { new RegExp(asServed, 'v'); } catch (_) { bad.push(`${f}: ${m[1]}`); }
    }
  }
  assert.deepEqual(bad, [], 'a pattern the browser cannot compile is a field with no validation');
});

test('the patterns a list editor can emit compile too', () => {
  // These reach the same attribute through `${esc(lm.pattern || '…')}`, so they are the other half of
  // the check above — and the fallback is the one every list without its own pattern gets.
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8')
    + fs.readFileSync(path.join(APP, 'lists.js'), 'utf8');
  const candidates = [...src.matchAll(/pattern: '([^']+)'/g)].map((m) => m[1]);
  candidates.push("[a-zA-Z0-9_.\\-]+");                      // the fallback, spelled as the source spells it
  const bad = [];
  for (const p of candidates) {
    const asServed = p.replace(/\\\\/g, '\\');
    try { new RegExp(asServed, 'v'); } catch (_) { bad.push(p); }
  }
  assert.deepEqual(bad, []);
});
