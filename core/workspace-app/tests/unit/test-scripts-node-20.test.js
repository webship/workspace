/**
 * The dashboard's own test scripts run on every Node.js the base says it supports.
 *
 * The base promises Node.js 20 or newer (`engines` in the root package.json, the README, getting-started), and the
 * unit suite passes there. `npm run test:unit` did not: it handed `node --test` quoted globs, which Node.js 21 and
 * later expand and Node.js 20 reads as file names ("Could not find …/tests/unit/*.test.js", exit 1). The shell
 * expands the list now; a pattern that may match nothing (the bundled plugins have no tests today) is passed only
 * when it does, because Node.js 20 fails on a name that matches nothing too.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const root = JSON.parse(fs.readFileSync(path.join(APP, '..', '..', 'package.json'), 'utf8'));

test('the base promises Node.js 20 or newer', () => {
  assert.strictEqual(root.engines.node, '>=20');
});

test('test:unit gives node --test no quoted glob, which Node.js 20 reads as a file name', () => {
  const script = pkg.scripts['test:unit'];
  assert.match(script, /^node --test tests\/unit\/\*\.test\.js /);
  assert.doesNotMatch(script, /"[^"]*\*[^"]*"|'[^']*\*[^']*'/, 'a quoted glob');
});

test('the files test:unit hands node --test are the unit test files, and a pattern that matches nothing adds no name', () => {
  // The script's own words, run by the shell npm uses, with `node --test` replaced by a printer of its arguments.
  const words = pkg.scripts['test:unit'].replace(/^node --test /, '');
  const r = spawnSync('sh', ['-c', `for a in ${words}; do echo "$a"; done`], { cwd: APP, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const given = r.stdout.trim().split('\n').filter(Boolean).sort();
  const expected = fs.readdirSync(path.join(APP, 'tests', 'unit')).filter((f) => f.endsWith('.test.js')).map((f) => `tests/unit/${f}`);
  for (const dir of fs.readdirSync(path.join(APP, 'plugins'))) {
    const t = path.join(APP, 'plugins', dir, 'tests');
    if (fs.existsSync(t)) for (const f of fs.readdirSync(t)) if (f.endsWith('.test.js')) expected.push(`plugins/${dir}/tests/${f}`);
  }
  assert.deepStrictEqual(given, expected.sort());
  assert.ok(!given.some((g) => g.includes('*')), 'no unexpanded pattern is passed on');
});
