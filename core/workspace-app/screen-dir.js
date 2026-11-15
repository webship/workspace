/*
 * Where screen keeps its sockets, when the default place cannot be used.
 *
 * The dashboard's container shares /run/screen with the machine, so that `screen -r` in a real
 * terminal reaches the dashboard's sessions. On a machine that has no screen of its own that
 * directory does not exist; the mount creates it owned by root, mode 755, and screen then refuses
 * every call with "Directory '/run/screen' must have mode 777". Since commands run in screen
 * sessions only, that would leave the dashboard unable to run anything.
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

/** The dashboard's own socket directory: under the home folder, for this user only. */
function ownSocketDir(home = os.homedir()) {
  return path.join(home, '.screen-workspace');
}

/**
 * Decide and set. Returns the directory chosen, or '' when the default one is left in use
 * (it works, screen is not installed, or SCREENDIR was set from outside).
 */
function ensureScreenDir({ env = process.env, probe, home } = {}) {
  if (env.SCREENDIR) return '';
  const ask = probe || (() => {
    const out = spawnSync('screen', ['-ls'], { encoding: 'utf8', timeout: 10 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (out.error) return null;   // screen is not installed here
    return `${out.stdout || ''}${out.stderr || ''}`;
  });
  const answer = ask();
  if (answer === null || !socketDirUnusable(answer)) return '';
  const dir = ownSocketDir(home);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  } catch (_) {
    return '';
  }
  env.SCREENDIR = dir;
  return dir;
}

module.exports = { ensureScreenDir, socketDirUnusable, ownSocketDir };
