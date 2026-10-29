const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SOURCE = path.join(APP, '..', 'scripts', 'ddev-shim', 'ddev');
const IN_CONTEXT = path.join(APP, '.ddev', 'web-build', 'ddev-shim-ddev');

test('the build-context copy is byte-identical to the source', () => {
  // Docker cannot COPY from outside its build context, so the shim exists twice. This is
  // the only thing stopping them drifting: edit core/scripts/ddev-shim/ddev, then
  //   cp core/scripts/ddev-shim/ddev core/workspace-app/.ddev/web-build/ddev-shim-ddev
  assert.equal(fs.readFileSync(IN_CONTEXT, 'utf8'), fs.readFileSync(SOURCE, 'utf8'),
    'the shim in .ddev/web-build differs from core/scripts/ddev-shim/ddev — copy it across');
});

test('the shim is valid bash', () => {
  // A broken shim breaks EVERY ddev call in the container, the dashboard's own status
  // reads included, and it is not exercised by any other test.
  execFileSync('bash', ['-n', SOURCE]);
});

test('it never resolves the real ddev through PATH', () => {
  // Resolving by PATH would find the shim again and fork until the machine gives up.
  const src = fs.readFileSync(SOURCE, 'utf8');
  assert.ok(!/command -v ddev|which ddev/.test(src), 'resolves ddev through PATH — that recurses');
  assert.match(src, /for candidate in \/usr\/local\/bin\/ddev/, 'no absolute-path candidate list');
  assert.match(src, /== "\$\{SELF\}" \]\] |== "\$\{SELF\}" \] && continue/, 'does not exclude itself from the candidates');
});

test('exactly the router-mutating verbs are locked', () => {
  const src = fs.readFileSync(SOURCE, 'utf8');
  assert.match(src, /^\s*start\|stop\|restart\|poweroff\|delete\)/m,
    'the locked verb list changed — every one of these recreates the shared router');
  // Everything else must exec straight through: `ddev list --json-output` runs every 20s.
  assert.match(src, /\*\)\s+exec "\$\{REAL_DDEV\}" "\$@" ;;/);
});

test('a lock already held is not taken again', () => {
  // The dashboard wraps its own calls in flock; re-locking from inside deadlocks for the
  // full timeout. Verified by experiment before this interlock existed.
  const src = fs.readFileSync(SOURCE, 'utf8');
  assert.match(src, /DDEV_ROUTER_LOCK_HELD/);
  const ddevjs = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');
  assert.ok(ddevjs.includes('env DDEV_ROUTER_LOCK_HELD=1'),
    'the dashboard no longer announces that it holds the lock — its flock will deadlock the shim');
});

test('nothing about a missing flock or lock file is fatal', () => {
  // Refusing to run ddev because a lock could not be taken is a worse failure than the
  // one being prevented.
  const src = fs.readFileSync(SOURCE, 'utf8');
  const fallbacks = (src.match(/exec "\$\{REAL_DDEV\}" "\$@"/g) || []).length;
  assert.ok(fallbacks >= 4, `expected pass-through fallbacks, found ${fallbacks}`);
});
