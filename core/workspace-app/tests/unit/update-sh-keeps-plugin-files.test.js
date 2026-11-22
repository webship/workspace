/**
 * The top bar's update hint names the update of a workspace made with npm, and the older updater of the
 * dashboard folder (scripts/update.sh, rsync --delete from a release tarball) leaves what plugins placed
 * there: their compose files in .ddev/ and their features under tests/features/plugins/ (#411).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const UPDATER = path.join(APP, 'scripts', 'update.sh');

test('the update hint names npx -y @webship.co/workspace@latest update', () => {
  const src = fs.readFileSync(path.join(APP, 'version-check.mts'), 'utf8');
  assert.match(src, /Update with: npx -y @webship\.co\/workspace@latest update/);
  assert.doesNotMatch(src, /Update with: bash core\/workspace-app\/scripts\/update\.sh/);
});

test('update.sh leaves the compose files and features plugins placed, and says a workspace made with npm has its own update', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-update-sh-'));
  // The workspace: made with npm (core/bin/workspace.js, no .git), one plugin's files in the dashboard folder.
  const root = path.join(tmp, 'workspace');
  const app = path.join(root, 'core', 'workspace-app');
  const put = (file, text, mode = 0o644) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { mode }); };
  put(path.join(root, 'core', 'bin', 'workspace.js'), '// the npm package\n');
  put(path.join(app, 'scripts', 'update.sh'), fs.readFileSync(UPDATER, 'utf8'), 0o755);
  put(path.join(app, '.app-version'), '1.0.0\n');
  put(path.join(app, 'server.js'), '// 1.0.0\n');
  put(path.join(app, '.ddev', 'config.yaml'), 'name: workspace\n');
  put(path.join(app, '.ddev', 'docker-compose.plugin-x-y-cli.yaml'), 'services: {}\n');
  put(path.join(app, 'tests', 'features', 'plugins', 'x-y', 'x-y.feature'), 'Feature: x\n');
  put(path.join(app, 'public', 'css', 'components', 'gone.css'), '.gone {}\n');
  // The release: the dashboard folder of a tag, as GitHub's tarball has it.
  const rel = path.join(tmp, 'release', 'webship-workspace-abc1234', 'core', 'workspace-app');
  put(path.join(rel, 'scripts', 'update.sh'), fs.readFileSync(UPDATER, 'utf8'), 0o755);
  put(path.join(rel, 'server.js'), '// 9.9.9, the release\n');
  put(path.join(rel, '.ddev', 'config.yaml'), 'name: workspace\n');
  fs.mkdirSync(path.join(rel, 'public', 'css', 'components'), { recursive: true });
  const tarball = path.join(tmp, 'release.tar.gz');
  assert.strictEqual(spawnSync('tar', ['-czf', tarball, '-C', path.join(tmp, 'release'), 'webship-workspace-abc1234']).status, 0);
  // Stand-ins: gh is not signed in; curl hands over the tarball.
  const bin = path.join(tmp, 'bin');
  put(path.join(bin, 'gh'), '#!/usr/bin/env bash\nexit 1\n', 0o755);
  put(path.join(bin, 'curl'), `#!/usr/bin/env bash\nout=""\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\n[ -n "$out" ] && cp "${tarball}" "$out"\nexit 0\n`, 0o755);
  const r = spawnSync('bash', [path.join(app, 'scripts', 'update.sh'), '--tag', 'v9.9.9', '--no-prompts'], { encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /This workspace was made with npm\. Update it with:  npx -y @webship\.co\/workspace@latest update/);
  assert.strictEqual(fs.readFileSync(path.join(app, 'server.js'), 'utf8'), '// 9.9.9, the release\n', 'the dashboard is updated');
  assert.ok(!fs.existsSync(path.join(app, 'public', 'css', 'components', 'gone.css')), 'what the release dropped goes');
  assert.ok(fs.existsSync(path.join(app, '.ddev', 'docker-compose.plugin-x-y-cli.yaml')), 'a plugin\'s compose file stays');
  assert.ok(fs.existsSync(path.join(app, 'tests', 'features', 'plugins', 'x-y', 'x-y.feature')), 'a plugin\'s feature stays');
});
