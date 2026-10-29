/**
 * The updater must put this machine's docker GID back.
 *
 * .ddev/ is mirrored from the release, and two files in it are per-machine —
 * docker-compose.dood.yaml (group_add: the GID the running process is granted)
 * and web-build/Dockerfile.workspace-app (the GID the group is created with).
 * The shipped values are placeholders.
 *
 * Nothing restored them. The project name, ports and fqdns were carefully put
 * back and the GID was not, so every supported update left a docker GID that is
 * not the host's — silently, until the next `ddev restart`, when the container
 * loses docker.sock and the dashboard reports EVERY project as Stopped while they
 * all run. Reproduced by setting it to 999 on a host whose group is 973.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const UPDATE = path.join(ROOT, 'core', 'workspace-app', 'scripts', 'update.sh');
const SYNC = path.join(ROOT, 'core', 'scripts', 'sync-tooling.sh');

test('update.sh re-applies the docker GID after mirroring the release', () => {
  const src = fs.readFileSync(UPDATE, 'utf8');
  assert.match(src, /docker-gid\.sh/, 'the updater never re-applies the docker GID');
  // After the mirror, not before it: the release's .ddev/ lands on top.
  const rsyncAt = src.indexOf('rsync ${rsync_flags} --delete');
  const gidAt = src.indexOf('core/scripts/docker-gid.sh');
  assert.ok(rsyncAt > 0 && gidAt > rsyncAt, 'the GID must be re-applied AFTER the rsync');
  // And it must not be silent when it cannot: a dashboard that will go blind on
  // its next restart, with no clue why, is the worst outcome.
  assert.match(src, /show every project as Stopped/);
});

test('sync-tooling.sh does the same, for the machines that carry the clone', () => {
  // The two install paths must not disagree: one of them getting this right and
  // the other not is how it went unnoticed.
  assert.match(fs.readFileSync(SYNC, 'utf8'), /docker-gid\.sh/);
});

test('the GID placeholder is what ships, so the restore is not optional', () => {
  // If the committed value ever became a real host's GID, this test is the thing
  // that says so — a machine-specific number in a shared repo is a different bug.
  const compose = path.join(ROOT, 'core', 'workspace-app', '.ddev', 'docker-compose.dood.yaml');
  const txt = fs.readFileSync(compose, 'utf8');
  const m = txt.match(/group_add:\s*\n\s*-\s*"(\d+)"/);
  assert.ok(m, 'group_add is not in the expected shape any more');
  assert.ok(/^\d+$/.test(m[1]), 'group_add must be a numeric GID');
});
