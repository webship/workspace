/**
 * core/scripts/install.sh reads its options before it does anything. A mistyped one (--chek for
 * --check) was ignored, which made the run a full install with sudo; it stops the run now.
 * Only the option handling runs here: --help and an unknown option both end before the platform is read.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'install.sh');
const run = (...args) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

test('an unknown option is named, exits non-zero and installs nothing', () => {
  for (const flag of ['--chek', '--no-such-option', 'check']) {
    const r = run(flag);
    assert.equal(r.status, 1, flag);
    assert.match(r.stdout, new RegExp(`Unknown option: ${flag} \\(see --help\\)`));
    assert.match(r.stdout, /Usage: install\.sh \[--check\] \[-y\]/);
    assert.doesNotMatch(r.stdout + r.stderr, /apt-get|sudo|Installing|Checking/i, 'the run ended at the option');
  }
});

test('an unknown option beside a known one still stops the run', () => {
  const r = run('--check', '--verbos');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Unknown option: --verbos/);
});

test('--help and -h print the usage as text and exit 0', () => {
  for (const flag of ['--help', '-h']) {
    const r = run(flag);
    assert.equal(r.status, 0, flag);
    assert.match(r.stdout, /Webship Workspace — tool installer/);
    assert.match(r.stdout, /--check +report what is present and what is missing, install nothing/);
    assert.doesNotMatch(r.stdout, /^##/m, 'the comment marks are not part of the help');
  }
});
