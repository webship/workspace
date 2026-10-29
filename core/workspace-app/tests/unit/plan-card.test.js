/**
 * The Auto-mode confirm card, and the poll interval beside it.
 *
 * Both of these broke the same way: something the browser accepts silently. htmx parses only
 * ms/s/m, so `every 6h` was an interval of ZERO and one span re-requested itself about
 * forty-five times a second; and deep-chat draws its messages in a SHADOW ROOT, so a plain
 * `e.target.closest('.plan-run')` never saw the button and "Run it" did nothing at all.
 * Neither failed loudly, which is why they are pinned here.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '../../public/ui.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const htmx = fs.readFileSync(path.join(__dirname, '../../public/htmx.min.js'), 'utf8');

test('htmx parses only ms, s and m — so no poll may be declared in hours or days', () => {
  // Read from the vendored library rather than asserted from memory: a later htmx may add units,
  // and this test should be what notices.
  assert.match(htmx, /\(ms\|s\|m\)\?/,
    'htmx parseInterval still accepts ms/s/m only');
  const bad = [...server.matchAll(/hx-trigger="[^"]*every\s+[\d.]+\s*([a-z]+)"/g)]
    .map((m) => m[1]).filter((u) => !['ms', 's', 'm'].includes(u));
  assert.deepStrictEqual(bad, [],
    'an interval htmx cannot parse is undefined, and setTimeout treats that as zero');
});

test('the version hint polls in minutes', () => {
  assert.match(server, /hx-trigger="load, every 360m"/);
});

test('"Run it" reaches through the shadow root and sends the turn through deep-chat', () => {
  const block = ui.slice(ui.indexOf('// The Auto-mode confirm card'), ui.indexOf('// The image picker in settings'));
  assert.ok(block, 'the confirm-card handler is still there');
  assert.match(block, /composedPath\(\)/,
    'a click inside deep-chat retargets to the host element, so closest() sees nothing');
  assert.match(block, /submitUserMessage/,
    'there is no .chat-input form any more — the panel owns its own input');
  assert.doesNotMatch(block, /querySelector\('\.chat-input'\)/,
    'the old HTMX chat form is gone; looking for it is what made the button do nothing');
});
