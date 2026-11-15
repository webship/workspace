const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureScreenDir, socketDirUnusable, ownSocketDir } = require('../../screen-dir');

test('screen refusing its socket directory is recognised, a normal answer is not', () => {
  assert.ok(socketDirUnusable("Directory '/run/screen' must have mode 777."));
  assert.ok(socketDirUnusable("Cannot make directory '/run/screen': Permission denied"));
  assert.ok(!socketDirUnusable('No Sockets found in /run/screen/S-user.'));
  assert.ok(!socketDirUnusable('There is a screen on:\n\t123.build\t(Detached)\n1 Socket in /run/screen/S-user.'));
});

test('an unusable default directory moves the sessions to a directory of the dashboard, for this user only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-dir-'));
  const env = {};
  const dir = ensureScreenDir({ env, home, probe: () => "Directory '/run/screen' must have mode 777." });
  assert.equal(dir, ownSocketDir(home));
  assert.equal(env.SCREENDIR, dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a default directory that works, no screen at all, or a SCREENDIR set from outside change nothing', () => {
  const env = {};
  assert.equal(ensureScreenDir({ env, probe: () => 'No Sockets found in /run/screen/S-user.' }), '');
  assert.equal(ensureScreenDir({ env, probe: () => null }), '');
  assert.equal(env.SCREENDIR, undefined);
  const set = { SCREENDIR: '/somewhere' };
  assert.equal(ensureScreenDir({ env: set, probe: () => 'must have mode 777' }), '');
  assert.equal(set.SCREENDIR, '/somewhere');
});
