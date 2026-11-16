/**
 * The smoke test of every cmd-*.sh (core/scripts/tests/cmd-smoke-test.sh) reports what this run saw, and fails
 * whenever a script fails.
 *
 * It kept what each script printed in two fixed files, /tmp/cmd-smoke-err and /tmp/cmd-smoke-out: two runs at
 * once on one machine read each other's output and named it as their own failure (measured with 150 scripts in
 * each: about a third of the lines). And it exited with the number of failures, which an exit status takes
 * modulo 256: 256 failing scripts exited 0.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SMOKE = path.join(__dirname, '..', '..', '..', 'scripts', 'tests', 'cmd-smoke-test.sh');

/** A workspace of one folder whose cmd-*.sh all fail: `--help` prints the script's own name, or the file does not parse. */
function workspace(tag, count, kind = 'help') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ws-smoke-${tag}-`));
  fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dev'));
  fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'workspaces:\n  - dev\n');
  for (let i = 1; i <= count; i += 1) {
    fs.writeFileSync(path.join(root, 'dev', `cmd-${tag}-${i}.sh`), kind === 'syntax'
      ? '#!/usr/bin/env bash\nif then fi (\n'
      : `#!/usr/bin/env bash\ncase "$1" in --help) echo "boom from ${tag}-${i}"; exit 3 ;; esac\n`);
  }
  return root;
}

const envFor = (root, tmp) => ({ ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: path.join(root, 'core', 'config'), TMPDIR: tmp });

function run(root, tmp) {
  return new Promise((resolve) => {
    const p = spawn('bash', [SMOKE], { env: envFor(root, tmp), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('two runs at once each name the output of their own scripts, and leave nothing in TMPDIR', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-smoke-tmp-'));
  const a = workspace('a', 40);
  const b = workspace('b', 40);
  try {
    const [ra, rb] = await Promise.all([run(a, tmp), run(b, tmp)]);
    for (const r of [ra, rb]) {
      assert.strictEqual(r.code, 40, r.out.slice(-400));
      const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL'));
      assert.strictEqual(fails.length, 40, r.out.slice(-400));
      for (const l of fails) {
        const m = /cmd-([ab])-(\d+)\.sh — --help: boom from ([ab])-(\d+)$/.exec(l);
        assert.ok(m, `not the line of a failed --help: ${l}`);
        assert.strictEqual(`${m[3]}-${m[4]}`, `${m[1]}-${m[2]}`, `${l}: another script's output`);
      }
    }
    assert.deepStrictEqual(fs.readdirSync(tmp), [], 'each run removes its own folder');
  } finally {
    for (const d of [tmp, a, b]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('256 failing scripts end with a failing exit status, not 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-smoke-tmp-'));
  const c = workspace('c', 256, 'syntax');
  try {
    const r = spawnSync('bash', [SMOKE], { env: envFor(c, tmp), encoding: 'utf8' });
    assert.match(r.stdout, /cmd- smoke test: 0 passed, 256 failed/);
    assert.strictEqual(r.status, 255);
  } finally {
    for (const d of [tmp, c]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the script keeps no file of its own at a fixed place in /tmp', () => {
  const src = fs.readFileSync(SMOKE, 'utf8');
  assert.doesNotMatch(src, /\/tmp\/cmd-smoke/);
  assert.match(src, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/cmd-smoke\.XXXXXX"/);
  assert.match(src, /trap 'rm -rf "\$\{tmp\}"' EXIT/);
});
