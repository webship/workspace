/**
 * What a cmd-*.sh script is given as an argument is what it gets, and is never run.
 *
 * core/scripts/libs/argparse.sh prints the parsed arguments as shell assignments that the script evals. It
 * printed each value in double quotes, so a command substitution in a value ran and a double quote in it
 * ended the quotes: every script that takes an argument ran what it was given, from a dashboard form, the
 * assistant, a plugin or a person's own command line. Values are single-quoted now (shlex.quote).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ARGPARSE = path.join(__dirname, '..', '..', '..', 'scripts', 'libs', 'argparse.sh');

test('hostile argument values arrive as typed, and nothing in them runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-argparse-'));
  const ran = path.join(dir, 'ran');
  fs.mkdirSync(ran);
  fs.writeFileSync(path.join(dir, 'one.txt'), 'x');
  const script = path.join(dir, 'cmd-quote-test.sh');
  fs.writeFileSync(script, [
    '#!/usr/bin/env bash',
    `source ${JSON.stringify(ARGPARSE)} || exit 1`,
    'argparse "$@" <<EOF || exit 1',
    "parser.add_argument('PROJECT_NAME')",
    "parser.add_argument('--summary', default='')",
    "parser.add_argument('--require', nargs='+', default=['_none_'])",
    "parser.add_argument('--force', action='store_true', default=False)",
    'EOF',
    'printf \'%s\\n\' "${PROJECT_NAME}" "${SUMMARY}" "${REQUIRE[@]}" "force=${FORCE}"',
    '',
  ].join('\n'), { mode: 0o755 });
  const values = [
    `x$(touch ${ran}/dollar)`,
    `a \`touch ${ran}/tick\` "quoted" $HOME it's *.txt`,
    `y"; touch ${ran}/quote; echo "`,
    `back\\slash $(touch ${ran}/list)`,
  ];
  const r = spawnSync('bash', [script, values[0], '--summary', values[1], '--require', values[2], values[3], '--force'], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.stdout.replace(/\n$/, '').split('\n'), [values[0], values[1], values[2], values[3], 'force=yes']);
  assert.deepStrictEqual(fs.readdirSync(ran), [], 'nothing in a value ran');
  const off = spawnSync('bash', [script, 'site1'], { cwd: dir, encoding: 'utf8' });
  assert.deepStrictEqual(off.stdout.replace(/\n$/, '').split('\n'), ['site1', '', '_none_', 'force='], 'defaults and an unset flag as before');
  fs.rmSync(dir, { recursive: true, force: true });
});
