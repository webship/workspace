/**
 * Publishing a project on the internet, on purpose.
 *
 * `ddev share` opens a tunnel (ngrok by default) to a local project so somebody else can look at it.
 * It is the only verb on this menu whose effect reaches people who are not on this machine — the
 * whole site, including its admin, at an address anyone with it can use — and it runs until it is
 * stopped rather than finishing.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const ddev = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

test('it asks first, and for the right reason', () => {
  assert.match(ddev, /'\/actions\/ddev-share':[^\n]*destructive: true/);
  assert.match(ddev, /confirmWhy: 'puts this project on the open internet'/);
  // The gate used to say "destroys data" for everything behind it. Share destroys nothing, and a
  // gate that misstates why it is a gate teaches people to click through it.
  assert.match(actions, /\$\{esc\(act\.confirmWhy \|\| 'destroys data'\)\}/);
  assert.match(server, /hx-trigger="confirmed-remove"[\s\S]{0,400}Share on the internet/);
});

test('it runs in a screen, because it does not finish', () => {
  // The address is printed in that session, and closing a browser tab must not take somebody's demo
  // down with it.
  assert.match(ddev, /'\/actions\/ddev-share':[^\n]*inScreen: true/);
  assert.match(ddev, /'\/actions\/ddev-share':[^\n]*needsRunning: true/, 'a tunnel to a stopped project shows nothing');
  assert.match(actions, /'\/actions\/ddev-share': ddev_verb,/);
});

test('the item says what it exposes', () => {
  assert.match(server, /Anyone with the address can reach the site, including its admin/);
  assert.match(server, /until the session is stopped/);
});
