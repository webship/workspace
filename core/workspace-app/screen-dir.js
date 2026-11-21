/*
 * Where screen keeps its sockets, when the default place cannot be used.
 *
 * screen's own directory (/run/screen) is not always usable where the dashboard runs. The dashboard's
 * container used to mount the machine's (webship/workspace#564), and on a machine that has no screen of
 * its own that directory does not exist: the mount creates it owned by root, mode 755, and screen then
 * refuses every call with "Directory '/run/screen' must have mode 777". A container made from an older
 * compose file still does, and a machine whose screen package did not make it usable is the same case
 * when the dashboard runs there. Since commands run in screen sessions only, that would leave the
 * dashboard unable to run anything. (The container has a directory of its own now: its image's.)
 *
 * So the dashboard asks once, when it starts: if screen cannot use its directory, the sessions of
 * this dashboard live in a directory of its own, and every command it starts inherits that choice
 * through SCREENDIR. A SCREENDIR set from outside is left alone.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** What screen says when its socket directory cannot be used. */
const UNUSABLE = /must have mode|Cannot make directory|Cannot access|Permission denied|must be owned/i;

/** Does this answer of `screen -ls` say the socket directory cannot be used? */
function socketDirUnusable(output) {
  return UNUSABLE.test(String(output || ''));
}

/** A Unix socket's path holds at most 107 bytes, and screen names a session's socket "<pid>.<name>" inside its
 *  directory: a pid of up to 7 digits and a session name of up to 60 (jobs.js screenSessionName). */
const SOCKET_PATH_MAX = 107;
const SOCKET_NAME_MAX = 1 + 7 + 1 + 60;

/** The dashboard's own socket directory: under the home folder, for this user only. When the home folder's path
 *  leaves no room for a session's socket (a workspace made for a test, a home on a deep mount), screen failed to
 *  start every session without a word (#485): then it is a short one of this user's under /tmp, the same on
 *  every start, so the sessions it holds are found again after a restart. */
function ownSocketDir(home = os.homedir(), tmp = '/tmp') {
  const dir = path.join(home, '.screen-workspace');
  if (dir.length + SOCKET_NAME_MAX <= SOCKET_PATH_MAX) return dir;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(tmp, `ws-screen-${uid}`);
}

/**
 * Decide and set. Returns the directory chosen, or '' when the default one is left in use
 * (it works, screen is not installed, or SCREENDIR was set from outside).
 */
function ensureScreenDir({ env = process.env, probe, home, tmp } = {}) {
  if (env.SCREENDIR) return '';
  const ask = probe || (() => {
    const out = spawnSync('screen', ['-ls'], { encoding: 'utf8', timeout: 10 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (out.error) return null;   // screen is not installed here
    return `${out.stdout || ''}${out.stderr || ''}`;
  });
  const answer = ask();
  if (answer === null || !socketDirUnusable(answer)) return '';
  const dir = ownSocketDir(home, tmp);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Under /tmp anyone can make that name first: only a real directory of this user's is used, never a link.
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) return '';
    fs.chmodSync(dir, 0o700);
  } catch (_) {
    return '';
  }
  env.SCREENDIR = dir;
  return dir;
}

module.exports = { ensureScreenDir, socketDirUnusable, ownSocketDir };
