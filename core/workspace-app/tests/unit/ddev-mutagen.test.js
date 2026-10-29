/**
 * Mutagen beyond `sync`.
 *
 * The menu could ask for a sync and nothing else — so a project that felt slow or stale left you with
 * no way to ask whether the sync was BEHIND or BROKEN, and no way to repair it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const ddev = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

test('status reads, and is not gated', () => {
  assert.match(ddev, /'\/actions\/ddev-mutagen-status':[^\n]*args: \['mutagen', 'status'\]/);
  const line = ddev.match(/'\/actions\/ddev-mutagen-status':[^\n]*/)[0];
  assert.ok(!line.includes('destructive'));
  // It answers "Mutagen is not enabled on project X" too, which is worth knowing before anybody
  // blames the sync for something else.
  assert.match(actions, /'\/actions\/ddev-mutagen-status': ddev_verb,/);
});

test('reset asks first, and says what it really does', () => {
  // It STOPS THE PROJECT and removes the volume. That is not a thing to click while somebody is
  // working, and "destroys data" would have been the wrong reason to give: the files on disk are the
  // source, and the volume is rebuilt on the next start.
  assert.match(ddev, /'\/actions\/ddev-mutagen-reset':[^\n]*destructive: true/);
  assert.match(ddev, /confirmWhy: 'stops the project and removes its sync volume'/);
  assert.match(server, /Reset the sync…/);
  assert.match(server, /the volume is rebuilt on the next start/);
  const item = server.slice(server.indexOf('/actions/ddev-mutagen-reset'));
  assert.match(item.slice(0, 300), /hx-trigger="confirmed-remove"/);
});
