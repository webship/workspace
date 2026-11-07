/**
 * The image offers `twg` on PATH through a wrapper that execs the host's binary from the mounted bin
 * directory: a single-file bind mount binds an inode, so `twg update` on the host would never reach a
 * container that mounted the file itself. The Jira plugin mounts the directory; the wrapper is the
 * image's half of that arrangement, and a machine without twg is told so.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dockerfile = fs.readFileSync(path.join(__dirname, '../../.ddev/web-build/Dockerfile.workspace-app'), 'utf8');

test('PATH finds twg through a wrapper that execs whatever the host has now', () => {
  assert.match(dockerfile, /exec \/host-local-bin\/twg "\$@"/);
  assert.match(dockerfile, /chmod 0755 \/usr\/local\/bin\/twg/);
  assert.match(dockerfile, /twg is not installed on the host/, 'a machine without twg says so');
});
