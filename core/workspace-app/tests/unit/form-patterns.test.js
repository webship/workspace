/**
 * Every `pattern` a form of the dashboard carries is a valid regular expression for the browser.
 *
 * Browsers compile an input's pattern with the `v` flag, where a `-` inside a character class has to be escaped. In
 * a JavaScript template literal `\-` is only `-`, so `[a-zA-Z0-9_.\-]` reached the page as `[a-zA-Z0-9_.-]`: Chrome
 * logged the pattern as invalid and checked nothing. The source must write `\\-`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const FILES = ['server.js', 'screens.js', ...fs.readdirSync(path.join(APP, 'actions')).filter((f) => f.endsWith('.js')).map((f) => `actions/${f}`)];

/** What a template-literal or quoted-string source text becomes at run time: `\\` is one backslash, `\x` is x. */
const asWritten = (src) => src.replace(/\\(.)/g, '$1');

test('every static pattern attribute is a valid regular expression with the browser\'s v flag', () => {
  const bad = [];
  let seen = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    for (const m of src.matchAll(/pattern="([^"$]*)"/g)) {
      seen += 1;
      const value = asWritten(m[1]);
      try { new RegExp(`^(?:${value})$`, 'v'); } catch (e) { bad.push(`${f}: pattern="${m[1]}" → ${value}: ${e.message}`); }
    }
    // A pattern built from an expression: its quoted default.
    for (const m of src.matchAll(/pattern="\$\{esc\([^)]*\|\|\s*'([^']*)'\)\}"/g)) {
      seen += 1;
      const value = asWritten(m[1]);
      try { new RegExp(`^(?:${value})$`, 'v'); } catch (e) { bad.push(`${f}: default '${m[1]}' → ${value}: ${e.message}`); }
    }
  }
  assert.ok(seen >= 6, `${seen} patterns found`);
  assert.deepStrictEqual(bad, []);
});

test('the New screen form\'s session name still takes a name and refuses a space', () => {
  const src = fs.readFileSync(path.join(APP, 'screens.js'), 'utf8');
  const m = /name="session" id="screen-session"[\s\S]*?pattern="([^"]*)"/.exec(src);
  const re = new RegExp(`^(?:${asWritten(m[1])})$`, 'v');
  assert.ok(re.test('dev--site--build-3f2a'));
  assert.ok(!re.test('Dev site'));
});
