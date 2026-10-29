/**
 * A start that says it worked, and a dashboard that answers 502.
 *
 * DDEV starts `web_extra_daemons` itself at the end of `ddev start`, and that step races supervisord
 * coming up. When it loses, ddev prints
 *
 *   Unable to start web_extra_daemons using supervisorctl,
 *   stdout=error: <class 'http.client.RemoteDisconnected'>, Remote end closed connection …
 *
 * and then reports **Successfully started workspace** anyway. The daemons are left "Not started", so
 * nginx answers **502 Bad Gateway**: the proxy is up and the app behind it never came up.
 *
 * That is the worst shape a failure can take. The command said it worked, so nothing points at the
 * start; the browser says 502, which reads as "the dashboard is broken". Reproduced on this machine
 * by stopping the daemons and running `ddev start`: the warning appeared, the start "succeeded", and
 * the site stayed 502 until the daemons were started by hand.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const config = fs.readFileSync(path.join(__dirname, '../../.ddev/config.yaml'), 'utf8');

test('every start ends by making sure the daemons are actually up', () => {
  const post = config.slice(config.indexOf('post-start:'), config.indexOf('\ndatabase:'));
  assert.match(post, /supervisorctl status webextradaemons:\*/);
  assert.match(post, /xargs -r supervisorctl start/);
});

test('it asks which are down rather than starting everything', () => {
  // A healthy start must do nothing here: restarting a daemon that is already serving would drop
  // whatever it was doing — and this runs on every single `ddev start`.
  const post = config.slice(config.indexOf('post-start:'), config.indexOf('\ndatabase:'));
  assert.match(post, /grep -v RUNNING/);
  assert.ok(!/supervisorctl restart/.test(post), 'nothing is restarted, only started');
});

test('it covers every daemon, not just the dashboard', () => {
  // The Web IDE loses the same race, and a dashboard that comes back while the IDE stays down is
  // half a fix that nobody would think to check.
  const post = config.slice(config.indexOf('post-start:'), config.indexOf('\ndatabase:'));
  assert.match(post, /webextradaemons:\*/);
  assert.ok(!/webextradaemons:workspace-app\b(?!\*)/.test(post.replace(/#.*/g, '')),
    'not scoped to one daemon by name');
});

test('a daemon that will not start does not fail the project start', () => {
  // The 502 says the rest. A `ddev start` that exits non-zero because one daemon is unhappy would
  // stop the other projects in the autostart chain behind it.
  const post = config.slice(config.indexOf('post-start:'), config.indexOf('\ndatabase:'));
  assert.match(post, /\|\| true/);
});

test('the reason is recorded where the line is', () => {
  // Whoever removes this line as "belt and braces" should see, in the same place, that it is the
  // difference between a working dashboard and a 502 after a reboot.
  const post = config.slice(config.indexOf('post-start:'), config.indexOf('\ndatabase:'));
  assert.match(post, /RemoteDisconnected/);
  assert.match(post, /502 Bad Gateway/);
});
