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

test('a home folder whose path leaves no room for a session\'s socket gets a short directory of this user\'s under /tmp (#485)', () => {
  const uid = process.getuid();
  // Room for "/<pid>.<a 60-character session name>" in the 107 bytes of a socket's path.
  assert.equal(ownSocketDir('/home/rajab'), '/home/rajab/.screen-workspace');
  // A 20-character home: 38 characters of directory, 69 of socket name, 107 in all.
  assert.equal(ownSocketDir('/home/r2345678901234', '/tmp'), '/home/r2345678901234/.screen-workspace', 'exactly enough room');
  assert.equal(ownSocketDir('/home/r23456789012345', '/tmp'), `/tmp/ws-screen-${uid}`, 'one character over');
  const deep = `/tmp/${'a-test-workspace/'.repeat(5)}home`;
  assert.equal(ownSocketDir(deep), `/tmp/ws-screen-${uid}`);
  // Chosen, made for this user only, and the same on the next start.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-tmp-'));
  const env = {};
  const dir = ensureScreenDir({ env, home: deep, tmp, probe: () => "Cannot make directory '/run/screen': Permission denied" });
  assert.equal(dir, path.join(tmp, `ws-screen-${uid}`));
  assert.equal(env.SCREENDIR, dir);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(ensureScreenDir({ env: {}, home: deep, tmp, probe: () => "Cannot make directory '/run/screen': Permission denied" }), dir);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a link made in its place is not used: the default directory is left as it is', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-tmp-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-elsewhere-'));
  fs.chmodSync(elsewhere, 0o755);
  fs.symlinkSync(elsewhere, path.join(tmp, `ws-screen-${process.getuid()}`));
  const env = {};
  const deep = `/tmp/${'a-test-workspace/'.repeat(5)}home`;
  assert.equal(ensureScreenDir({ env, home: deep, tmp, probe: () => "Directory '/run/screen' must have mode 777." }), '');
  assert.equal(env.SCREENDIR, undefined);
  assert.equal(fs.statSync(elsewhere).mode & 0o777, 0o755, 'what the link points to is not touched');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});
