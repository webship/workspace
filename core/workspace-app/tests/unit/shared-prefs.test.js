/**
 * One dashboard, one set of preferences.
 *
 * The theme, the rail, the assistant's view and whether it is open are per PERSON, not per workspace —
 * but they lived in localStorage, which is per-origin, and this dashboard spans <workspace>.<hub>
 * subdomains. So the theme was a different theme on /dev than on modules.workspace…, with no way to
 * set it once. The lists' page-size cookie already had to be scoped to the hub for the same reason.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(app, 'public', 'ui.js'), 'utf8');
const head = server.slice(server.indexOf('window.wsPref='), server.indexOf('</script>'));

test('the preference helpers are in the head, so the first paint can read them', () => {
  assert.match(head, /window\.wsPref\s*=\s*function\(name,fallback\)/);
  assert.match(head, /window\.wsPrefSet\s*=\s*function\(name,value\)/);
  // The pre-paint script is what applies the theme and the rail; reading a preference there is the
  // whole point, since doing it later shows the wrong one for a frame.
  assert.ok(server.indexOf('window.wsPref=') < server.indexOf("wsPref('ws-theme'"), 'defined before it is used');
});

test('a preference is written to a cookie on the HUB domain', () => {
  assert.match(head, /document\.cookie=name\+'='\+encodeURIComponent\(value\)\+'; Path=\/; Domain=\.\$\{hubDomain\(\)\}/,
    'not the page host: a cookie on dev.workspace… would be the same bug in another form');
  assert.match(head, /Max-Age=31536000/, 'a preference outlives the tab');
  assert.match(head, /SameSite=Lax/);
});

test('localStorage stays as the fallback, so a browser that set one before is not reset', () => {
  assert.match(head, /var ls=localStorage\.getItem\(name\);/);
  assert.match(head, /if\(ls!==null\)return ls;/);
  // The cookie is read FIRST, or a stale per-origin value would keep winning on that subdomain.
  assert.ok(head.indexOf('document.cookie.match') < head.indexOf('localStorage.getItem'), 'cookie first');
  assert.match(head, /try\{localStorage\.setItem\(name,value\);\}catch\(e\)\{\}/, 'and both are written');
});

test('nothing writes these preferences straight to localStorage any more', () => {
  for (const key of ['ws-theme', 'actions-collapsed', 'ws-assistant-view', 'ws-assistant-open', 'ws-page-width']) {
    assert.ok(!new RegExp(`localStorage\\.setItem\\('${key}'`).test(ui), `${key} must go through wsPrefSet`);
    assert.ok(!new RegExp(`localStorage\\.getItem\\('${key}'`).test(ui), `${key} must be read with wsPref`);
    assert.ok(!new RegExp(`localStorage\\.getItem\\('${key}'`).test(server), `${key} must be read with wsPref`);
  }
});
