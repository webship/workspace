/**
 * core/scripts/libs/argparse.sh: what a cmd-*.sh answers to --help, -h, an unknown flag and a missing
 * argument. --help is an answer, so it ends the script with 0 and nothing after the argument block
 * runs; a wrong or missing argument ends it with a message and a non-zero code, and nothing runs either.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, '..', '..', '..', 'scripts', 'libs', 'argparse.sh');

function script() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-argparse-'));
  const file = path.join(dir, 'cmd-tools-example.sh');
  fs.writeFileSync(file, `#!/usr/bin/env bash
source "${LIB}" || exit 1
ARGPARSE_DESCRIPTION="An example command"
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME', help='The project.')
parser.add_argument('-l', '--list', action='store_true', default=False, help='List only.')
ARGEOF
touch "${path.join(dir, 'ran')}"
echo "project=\${PROJECT_NAME} list=\${LIST}"
`);
  return { dir, file, ran: () => fs.existsSync(path.join(dir, 'ran')) };
}

const run = (s, ...args) => spawnSync('bash', [s.file, ...args], { cwd: s.dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

for (const flag of ['--help', '-h']) {
  test(`${flag} prints the usage, exits 0 and runs nothing`, () => {
    const s = script();
    const r = run(s, flag);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /usage: cmd-tools-example\.sh/);
    assert.match(r.stdout, /An example command/);
    assert.strictEqual(s.ran(), false);
  });
}

test('an unknown flag says so, exits non-zero and runs nothing', () => {
  const s = script();
  const r = run(s, 'site', '--no-such-flag');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /unrecognized arguments: --no-such-flag/);
  assert.strictEqual(s.ran(), false);
});

test('a missing argument says which, exits non-zero and runs nothing', () => {
  const s = script();
  const r = run(s);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /the following arguments are required: PROJECT_NAME/);
  assert.strictEqual(s.ran(), false);
});

test('good arguments are parsed and the script goes on', () => {
  const s = script();
  const r = run(s, 'site', '--list');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /project=site list=yes/);
  assert.strictEqual(s.ran(), true);
});
