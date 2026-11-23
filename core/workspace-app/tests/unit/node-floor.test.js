/**
 * The Node.js the Workspace supports, and the floor written in each place that says it.
 *
 * The Workspace supports Node.js 24 and 26, the stable LTS releases, and nothing older: `engines` in the root
 * package.json asks for ">=24". The CLI (core/bin/workspace.js) reads it from there. Two shell scripts that start
 * Node.js check it themselves (screen-host.sh for the screen runner, ai-items.sh for the AI items engine), CI runs the
 * unit tests on the lowest line, and the docs say it: each of those writes the floor, so each is held to the same one
 * here, and none can drift from engines.
 *
 * The test scripts: `npm run test:unit` hands `node --test` the list of files the shell expanded, never a quoted glob
 * (which Node.js 20 read as a file name, before the floor moved, #709), and a pattern that may match nothing (the
 * bundled plugins have no tests today) is passed only when it does.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const REPO = path.join(APP, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const root = JSON.parse(read('package.json'));
const FLOOR = Number((String(root.engines.node).match(/^>=\s*(\d+)$/) || [])[1]);

test('the Workspace supports Node.js 24 and 26: engines asks for ">=24"', () => {
  assert.strictEqual(root.engines.node, '>=24');
  assert.strictEqual(FLOOR, 24);
});

test('every place that writes the floor says the one engines names', () => {
  // The two shell scripts that start Node.js: their check and what they say.
  for (const f of ['core/workspace-app/scripts/screen-host.sh', 'core/scripts/ai-items.sh']) {
    const src = read(f);
    assert.match(src, new RegExp(`process\\.exit\\(Number\\(process\\.versions\\.node\\.split\\("\\."\\)\\[0\\]\\) >= ${FLOOR} \\? 0 : 1\\)`), `${f}: its check`);
    assert.match(src, new RegExp(`it needs Node\\.js ${FLOOR} or later\\.`), `${f}: what it says`);
  }
  // CI: the lowest line it runs on is the floor, and the latest LTS is there too.
  const lines = [...read('.github/workflows/ci.yml').matchAll(/node-version: '(\d+)'/g)].map((m) => Number(m[1]));
  assert.strictEqual(Math.min(...lines), FLOOR, 'the lowest line CI runs on');
  assert.ok(lines.includes(26), 'and 26');
  // The docs, and the types the core is checked against.
  assert.match(read('README.md'), new RegExp(`Node\\.js ${FLOOR} or 26`));
  assert.match(read('core/docs/getting-started.md'), new RegExp(`Node\\.js ${FLOOR} or 26`));
  assert.match(read('core/workspace-app/docs/DEVELOPER-GUIDE.md'), new RegExp(`the core asks for \`>= ${FLOOR}\``));
  assert.match(String(pkg.devDependencies['@types/node']), new RegExp(`^${FLOOR}\\.`), '@types/node of the lowest line');
  // No older floor is left in what is shipped (the tests name older Node.js versions on purpose, for their stand-ins).
  const left = spawnSync('git', ['grep', '-nE', '22\\.18|Node\\.js 22\\b|a > 22', '--', '.', ':!*package-lock.json', ':!core/workspace-app/tests'], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(left.stdout.trim(), '', `an older floor is still written: ${left.stdout}`);
});

test('the CLI\'s check itself runs on an older Node.js and refuses it, saying what it needs', { skip: !olderNode() && 'no Node.js older than the floor on this machine' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-node-floor-'));
  const r = spawnSync(olderNode(), [path.join(REPO, 'core', 'bin', 'workspace.js'), 'catalog'], { cwd: tmp, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(`needs Node\\.js ${FLOOR} or later: this is Node\\.js \\d+`));
  assert.doesNotMatch(r.stderr, /SyntaxError|node:internal/, 'refused by the check, not by a parse error');
});

/** A real Node.js older than the floor on this machine (the distribution's own, often), or ''. */
function olderNode() {
  for (const n of ['/usr/bin/node', '/usr/local/bin/node']) {
    const v = spawnSync(n, ['-p', 'process.versions.node'], { encoding: 'utf8' });
    if (!v.error && v.status === 0 && Number(v.stdout.split('.')[0]) < FLOOR) return n;
  }
  return '';
}

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
  // .test.mts: a unit test converted to TypeScript, which node --test runs as it is.
  const expected = fs.readdirSync(path.join(APP, 'tests', 'unit')).filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mts')).map((f) => `tests/unit/${f}`);
  for (const dir of fs.readdirSync(path.join(APP, 'plugins'))) {
    const t = path.join(APP, 'plugins', dir, 'tests');
    if (fs.existsSync(t)) for (const f of fs.readdirSync(t)) if (f.endsWith('.test.js')) expected.push(`plugins/${dir}/tests/${f}`);
  }
  assert.deepStrictEqual(given, expected.sort());
  assert.ok(!given.some((g) => g.includes('*')), 'no unexpanded pattern is passed on');
});
