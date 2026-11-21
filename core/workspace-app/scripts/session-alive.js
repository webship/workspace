#!/usr/bin/env node
/**
 * Is a screen session still there? Exit 0 while it is, 1 once it is gone, 2 for a name that is not one.
 *
 *   node session-alive.js <session> [workspace root]
 *
 * The loop of a followed log asks this every few seconds (the Watch of a session, actions/screens.js). It was
 * `screen -ls | grep` where the dashboard runs, and the dashboard's container lists only its own sessions since it has
 * a process space of its own (webship/workspace#564): the log of a session on the machine stopped after a second, as
 * if the session had ended. So a session is there while screen here lists it, or the host runner's published list
 * does. A list the runner stopped refreshing still counts: the runner being away says nothing about the session, and a
 * followed log that stops while the session runs is worse than one that waits.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const session = String(process.argv[2] || '');
if (!/^[a-z0-9][a-zA-Z0-9._-]*$/.test(session)) process.exit(2);
const ROOT = process.argv[3] || process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..', '..');

let listed = false;
try {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, '.screens', 'host-sessions.json'), 'utf8'));
  listed = !!data && Array.isArray(data.sessions) && data.sessions.some((s) => s && s.session === session);
} catch (_) { listed = false; }

if (!listed) {
  // `screen -ls` prints:  \t<pid>.<name>\t(<date>)\t(<state>). The whole name, never one that merely starts alike.
  const out = spawnSync('screen', ['-ls'], { encoding: 'utf8', timeout: 10 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
  listed = String(out.stdout || '').split('\n').some((line) => {
    const m = line.match(/^\s+\d+\.(\S+)\s/);
    return !!m && m[1] === session;
  });
}

process.exit(listed ? 0 : 1);
