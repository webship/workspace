/**
 * After webship-workspace update the dashboard that serves this workspace is restarted, so it runs the new
 * version instead of the old one it holds in memory; and the restart finds this workspace's own container,
 * ddev-<its project name>-web, not always ddev-workspace-web (#408). It still never restarts a dashboard
 * that serves another tree.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', '..', 'bin', 'workspace.js');
const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** Stand-ins on the PATH: no supervisor (the host side), and a docker that says which tree a container has mounted. */
function fakes(dir, containers) {
  const bin = path.join(dir, 'fake-bin');
  const log = path.join(dir, 'docker.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'supervisorctl'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  const cases = Object.entries(containers).map(([name, mounted]) => `      ${name}) printf '%s\\n' /var/run/docker.sock "${mounted}" ;;`).join('\n');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1" in
  inspect)
    case "$2" in
${cases}
      *) exit 1 ;;
    esac ;;
  exec) printf 'webextradaemons:workspace-app: stopped\\nwebextradaemons:workspace-app: started\\n' ;;
esac
`, { mode: 0o755 });
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}`, log: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}

function workspace(name) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-restart-')), 'workspace');
  const r = spawnSync(process.execPath, [BIN, 'init', dir], { encoding: 'utf8', env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  const config = path.join(dir, 'core', 'workspace-app', '.ddev', 'config.yaml');
  if (name) fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/^name: workspace$/m, `name: ${name}`));
  return dir;
}

const update = (dir, env) => spawnSync(process.execPath, [BIN, 'update', dir], { encoding: 'utf8',
  env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '', ...env } });

test('plugins.sh restarts the container of this workspace\'s own project name, and only when it serves this tree', () => {
  const dir = workspace('acme-workspace');
  const f = fakes(dir, { 'ddev-acme-workspace-web': dir, 'ddev-workspace-web': '/home/someone/workspace' });
  const r = spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), '--restart'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: f.PATH, WORKSPACE_ROOT: dir, WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_PLUGINS_NO_RESTART: '' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(f.log(), /^exec ddev-acme-workspace-web supervisorctl restart webextradaemons:workspace-app$/m);
  assert.doesNotMatch(f.log(), /^exec ddev-workspace-web supervisorctl/m, 'the other workspace\'s dashboard is left alone');
});

test('update restarts the dashboard that serves this workspace and says it runs the new version', () => {
  const dir = workspace('acme-workspace');
  const f = fakes(dir, { 'ddev-acme-workspace-web': dir });
  const u = update(dir, { PATH: f.PATH });
  assert.strictEqual(u.status, 0, u.stderr);
  const version = require('../../../../package.json').version;
  assert.match(u.stdout, new RegExp(`Updated the workspace at .* to ${version.replace(/\./g, '\\.')}\\.`));
  assert.match(u.stdout, /The dashboard was restarted: it runs .* now\./);
  assert.match(f.log(), /^exec ddev-acme-workspace-web supervisorctl restart/m);
  assert.doesNotMatch(u.stdout, /start it with/, 'an update does not tell a person to start what is running');
});

test('update leaves a dashboard that serves another tree alone, and says so; with WORKSPACE_PLUGINS_NO_RESTART it restarts nothing', () => {
  const dir = workspace('');
  const f = fakes(dir, { 'ddev-workspace-web': '/home/someone/workspace' });
  let u = update(dir, { PATH: f.PATH });
  assert.strictEqual(u.status, 0, u.stderr);
  assert.match(u.stdout, /serves another workspace, so it was not restarted/);
  assert.doesNotMatch(f.log(), /^exec \S+ supervisorctl restart/m);
  u = update(dir, { PATH: f.PATH, WORKSPACE_PLUGINS_NO_RESTART: '1' });
  assert.match(u.stdout, /The dashboard was not restarted \(WORKSPACE_PLUGINS_NO_RESTART is set\)/);
  assert.doesNotMatch(f.log(), /^exec \S+ supervisorctl restart/m);
});
