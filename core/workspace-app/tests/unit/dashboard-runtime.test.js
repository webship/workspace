/**
 * The dashboard itself on Docker Compose and on Kubernetes, not only in its DDEV project (webship/workspace#694).
 *
 * `webship-workspace init <dir> --runtime docker|kubernetes` writes this machine's values (core/docker/.env, or
 * core/k8s/values.local.yaml), records container.runtime in settings.yml and starts the dashboard there; update,
 * start, stop and status follow the runtime the workspace was made for; a plugin step restarts the dashboard's
 * process, never its container. Without --runtime everything is DDEV, as before.
 *
 * Stand-ins on PATH (docker, kubectl, helm, kind, ddev) record what each command becomes.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const CORE = path.join(__dirname, '..', '..', '..');
const BIN = path.join(CORE, 'bin', 'workspace.js');
const SCRIPTS = path.join(CORE, 'scripts');
const rt = require(path.join(CORE, 'bin', 'dashboard-runtime.js'));

/** A folder of stand-in commands that record their calls (and the values compose would read) in calls.log. */
function fakes(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dash-rt-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'calls.log');
  const body = {
    docker: `echo "docker $* [root=\${WORKSPACE_ROOT:-} port=\${PORT:-} project=\${COMPOSE_PROJECT_NAME:-} cwd=$(pwd)]" >> "${log}"
case "$*" in *"ps -q"*) echo "\${FAKE_DASHBOARD_CID:-}" ;; esac`,
    kubectl: `echo "kubectl $*" >> "${log}"
case "$*" in
  *"current-context"*) echo kind-unit ;;
  *"get nodes -o name"*) echo node/unit-control-plane ;;
  *"get nodes"*) printf 172.18.0.9 ;;
  *"get svc"*) printf 'NodePort 31234' ;;
  *"availableReplicas"*) printf "\${FAKE_REPLICAS:-1}" ;;
esac`,
    helm: `echo "helm $*" >> "${log}"`,
    kind: `echo "kind $*" >> "${log}"`,
    ddev: `echo "ddev $* [cwd=$(pwd)]" >> "${log}"`,
    ...extra,
  };
  for (const [name, script] of Object.entries(body)) fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${script}\n`, { mode: 0o755 });
  // A file that stands for the Docker socket: its group is what the dashboard's container is given.
  const socket = path.join(dir, 'docker.sock');
  fs.writeFileSync(socket, '');
  return { dir, socket, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
    clear: () => { if (fs.existsSync(log)) fs.unlinkSync(log); } };
}

const cli = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8',
  env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_ROOT: '', WEBSHIP_WORKSPACE_DIR: '', ...env } });
const newDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dash-')), 'workspace');
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('the words of a command line: flags with a value, with = or a space, and the folder', () => {
  assert.deepStrictEqual(rt.parseArgs(['/x/ws', '--runtime', 'docker', '--port=3100', '--no-claude']),
    { positional: ['/x/ws'], flags: { runtime: 'docker', port: '3100', 'no-claude': true } });
  assert.deepStrictEqual(rt.parseArgs(['--runtime=kubernetes', '/x/ws']).positional, ['/x/ws']);
  assert.strictEqual(rt.askedRuntime({ runtime: 'k8s' }).runtime, 'kubernetes');
  assert.strictEqual(rt.askedRuntime({}).runtime, '');
  assert.match(rt.askedRuntime({ runtime: 'podman' }).error, /ddev, docker, kubernetes/);
  assert.match(rt.askedRuntime({ runtime: true }).error, /--runtime takes one of/);
});

test('init without --runtime is DDEV, as before: no values for another runtime, no container block', () => {
  const f = fakes();
  const dir = newDir();
  const r = cli(['init', dir], { PATH: f.PATH });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, rt.DOCKER_ENV)), 'no core/docker/.env');
  assert.ok(!fs.existsSync(path.join(dir, rt.K8S_VALUES)), 'no core/k8s/values.local.yaml');
  assert.doesNotMatch(read(dir, 'core/config/settings.yml'), /^container:/m);
  assert.strictEqual(rt.runtimeOf(dir), 'ddev');
  assert.match(r.stdout, /starting the dashboard \(ddev start in core\/workspace-app\)/);
  assert.match(r.stdout, /Done\. The dashboard: https:\/\/workspace\.ddev\.site/);
  // (The doctor asks docker and ddev for their versions first; what is run is `ddev start -y` in the dashboard's project.)
  assert.deepStrictEqual(f.calls().filter((c) => / (start|compose|build|upgrade|load) /.test(c)), [`ddev start -y [cwd=${fs.realpathSync(path.join(dir, 'core', 'workspace-app'))}]`]);
  // The image and the chart ship with the core.
  for (const file of ['core/docker/Dockerfile', 'core/docker/compose.yaml', 'core/docker/dashboard.sh', 'core/docker/cloud-init.yaml', 'core/k8s/Chart.yaml', 'core/k8s/templates/deployment.yaml']) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} is there`);
  }
});

test('init --runtime docker writes this machine\'s values, records the runtime and starts docker compose with them', () => {
  const f = fakes();
  const dir = newDir();
  // A shell that carries another workspace's variables: compose must still get this workspace's.
  const r = cli(['init', dir, '--runtime', 'docker', '--port', '3111', '--no-claude'],
    { PATH: f.PATH, WEBSHIP_WORKSPACE_DOCKER_SOCKET: f.socket, PORT: '9999' });
  assert.strictEqual(r.status, 0, r.stderr);
  const env = rt.readEnv(path.join(dir, rt.DOCKER_ENV));
  assert.strictEqual(env.WORKSPACE_ROOT, dir);
  assert.strictEqual(env.PORT, '3111');
  assert.strictEqual(env.WORKSPACE_UID, String(process.getuid()));
  assert.strictEqual(env.WORKSPACE_GID, String(process.getgid()));
  assert.strictEqual(env.DOCKER_GID, String(fs.statSync(f.socket).gid), 'the group of the Docker socket');
  assert.strictEqual(env.WORKSPACE_LISTEN, '127.0.0.1', 'on this machine only');
  assert.strictEqual(env.COMPOSE_FILE, 'compose.yaml', 'no Claude Code login mounted when it is declined');
  assert.match(env.COMPOSE_PROJECT_NAME, /^webship-workspace-[0-9a-f]{6}$/);
  assert.match(read(dir, 'core/config/settings.yml'), /^container:\n {2}runtime: docker$/m);
  assert.strictEqual(rt.runtimeOf(dir), 'docker');
  const up = f.calls().find((c) => /^docker compose up /.test(c));
  assert.ok(up, f.calls().join('\n'));
  assert.match(up, /^docker compose up -d --build --wait \[/);
  assert.ok(up.includes(`root=${dir} port=3111 project=${env.COMPOSE_PROJECT_NAME} cwd=${fs.realpathSync(path.join(dir, 'core', 'docker'))}]`), up);
  assert.ok(!f.calls().some((c) => /^ddev (start|stop|config|restart)/.test(c)), 'DDEV starts nothing');
  assert.match(r.stdout, /Done\. The dashboard: http:\/\/127\.0\.0\.1:3111/);
  assert.doesNotMatch(r.stdout, /ddev\.site/);
  assert.doesNotMatch(r.stdout, /✗ core: ddev/, 'DDEV is not reported missing for a dashboard on Docker');
});

test('the values are kept: a second init and an update keep the port, the name and a line a person added', () => {
  const f = fakes();
  const dir = newDir();
  const env = { PATH: f.PATH, WEBSHIP_WORKSPACE_DOCKER_SOCKET: f.socket, WEBSHIP_WORKSPACE_SKIP_START: '1' };
  assert.strictEqual(cli(['init', dir, '--runtime', 'docker', '--port', '3222'], env).status, 0);
  const first = rt.readEnv(path.join(dir, rt.DOCKER_ENV));
  fs.appendFileSync(path.join(dir, rt.DOCKER_ENV), 'WORKSPACE_ALLOWED_HOSTS=workspace.example.org\n');
  const again = cli(['update', dir], env);
  assert.strictEqual(again.status, 0, again.stderr);
  assert.match(again.stdout, /\(the dashboard on Docker Compose\)/);
  const second = rt.readEnv(path.join(dir, rt.DOCKER_ENV));
  assert.strictEqual(second.PORT, '3222');
  assert.strictEqual(second.COMPOSE_PROJECT_NAME, first.COMPOSE_PROJECT_NAME);
  assert.strictEqual(second.WORKSPACE_ALLOWED_HOSTS, 'workspace.example.org');
  assert.match(again.stdout, /once it is restarted:\s+webship-workspace start /, 'the next step is this runtime\'s, not ddev\'s');
  assert.doesNotMatch(again.stdout, /ddev (start|restart)|docker GID/);
  // An update never moves the dashboard to another runtime.
  const moved = cli(['update', dir, '--runtime', 'ddev'], env);
  assert.strictEqual(moved.status, 1);
  assert.match(moved.stderr, /runs on Docker Compose: update keeps it there/);
  assert.match(read(dir, 'core/config/settings.yml'), /^ {2}runtime: docker$/m);
});

test('an init that names another runtime moves the dashboard: the old one is stopped and its values go', () => {
  const f = fakes();
  const dir = newDir();
  const env = { PATH: f.PATH, WEBSHIP_WORKSPACE_DOCKER_SOCKET: f.socket };
  assert.strictEqual(cli(['init', dir, '--runtime', 'docker', '--port', '3444'], env).status, 0);
  f.clear();
  const toKube = cli(['init', dir, '--runtime', 'kubernetes', '--context', 'kind-unit', '--no-sites-image'], env);
  assert.strictEqual(toKube.status, 0, toKube.stderr);
  assert.match(toKube.stdout, /the dashboard moves from Docker Compose to Kubernetes/);
  assert.ok(f.calls().some((c) => /^docker compose down \[/.test(c) && c.includes('port=3444')), f.calls().join('\n'));
  assert.ok(!fs.existsSync(path.join(dir, rt.DOCKER_ENV)), 'core/docker/.env is gone');
  assert.strictEqual(rt.runtimeOf(dir), 'kubernetes');
  assert.match(read(dir, 'core/config/settings.yml'), /^ {2}runtime: kubernetes$/m);
  // Back to DDEV: no pod, the values gone, and the release is said, not removed.
  f.clear();
  const k = rt.readKube(dir);
  const toDdev = cli(['init', dir, '--runtime', 'ddev'], env);
  assert.strictEqual(toDdev.status, 0, toDdev.stderr);
  assert.ok(f.calls().includes(`kubectl --context kind-unit -n webship-workspace scale deploy/${k.release} --replicas=0`), f.calls().join('\n'));
  assert.match(toDdev.stdout, new RegExp(`uninstall ${k.release}`));
  assert.strictEqual(rt.runtimeOf(dir), 'ddev');
  assert.match(read(dir, 'core/config/settings.yml'), /^ {2}runtime: ddev$/m);
  assert.ok(f.calls().some((c) => c.startsWith('ddev start -y')));
  // And from DDEV to Docker the DDEV project is left alone, and said.
  f.clear();
  const toDocker = cli(['init', dir, '--runtime', 'docker'], env);
  assert.match(toDocker.stdout, /Its DDEV project is left as it is/);
  assert.ok(!f.calls().some((c) => /^ddev (stop|delete|poweroff)/.test(c)), f.calls().join('\n'));
});

test('a machine without Docker is told, and nothing is called started', () => {
  const dir = newDir();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-no-docker-'));
  for (const c of ['bash', 'sh', 'env']) { try { fs.symlinkSync(spawnSync('which', [c], { encoding: 'utf8' }).stdout.trim(), path.join(empty, c)); } catch (_) { /* not there */ } }
  const r = cli(['init', dir, '--runtime', 'docker'], { PATH: empty, WEBSHIP_WORKSPACE_DOCKER_SOCKET: '/nonexistent/docker.sock' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Docker with the compose plugin is not running here/);
  assert.match(r.stdout, /The dashboard is not started: Docker is missing/);
  assert.doesNotMatch(r.stdout, /Done\. The dashboard: http/);
});

test('start, stop and status follow the runtime the workspace was made for', () => {
  const f = fakes();
  const env = { PATH: f.PATH, WEBSHIP_WORKSPACE_DOCKER_SOCKET: f.socket, WEBSHIP_WORKSPACE_SKIP_START: '1' };
  const onDocker = newDir();
  assert.strictEqual(cli(['init', onDocker, '--runtime', 'docker', '--port', '3333'], env).status, 0);
  f.clear();
  const start = cli(['start', onDocker], { PATH: f.PATH, WEBSHIP_WORKSPACE_DOCKER_SOCKET: f.socket });
  assert.strictEqual(start.status, 0, start.stderr);
  assert.match(start.stdout, /The dashboard: http:\/\/127\.0\.0\.1:3333/);
  assert.ok(f.calls().some((c) => /^docker compose up -d --build --wait/.test(c)));
  f.clear();
  assert.strictEqual(cli(['stop', onDocker], { PATH: f.PATH }).status, 0);
  assert.ok(f.calls().some((c) => /^docker compose stop \[/.test(c) && c.includes('port=3333')), f.calls().join('\n'));
  f.clear();
  const status = cli(['status', onDocker], { PATH: f.PATH, FAKE_DASHBOARD_CID: 'abc123' });
  assert.strictEqual(status.status, 0);
  assert.match(status.stdout, /runs on Docker Compose \(core\/docker\): running at http:\/\/127\.0\.0\.1:3333/);
  assert.strictEqual(cli(['status', onDocker], { PATH: f.PATH }).status, 1, 'a stopped dashboard is not a running one');

  // A DDEV workspace: DDEV's own commands, in the dashboard's project. `ddev stop` takes no -y.
  const onDdev = newDir();
  assert.strictEqual(cli(['init', onDdev], { ...env, WEBSHIP_WORKSPACE_SKIP_DDEV: '1' }).status, 0);
  f.clear();
  for (const verb of ['start', 'stop', 'status']) assert.strictEqual(cli([verb, onDdev], { PATH: f.PATH }).status, 0);
  const app = fs.realpathSync(path.join(onDdev, 'core', 'workspace-app'));
  assert.deepStrictEqual(f.calls().filter((c) => !/--version/.test(c)), [`ddev start -y [cwd=${app}]`, `ddev stop [cwd=${app}]`, `ddev describe [cwd=${app}]`]);
  // And a folder that is no workspace is said to be none.
  const none = cli(['status', fs.mkdtempSync(path.join(os.tmpdir(), 'ws-none-'))], { PATH: f.PATH });
  assert.strictEqual(none.status, 1);
  assert.match(none.stderr, /No workspace at/);
});

test('init --runtime kubernetes writes the chart\'s values, builds and loads the image on a kind cluster and installs the chart', () => {
  const f = fakes();
  const dir = newDir();
  const r = cli(['init', dir, '--runtime', 'kubernetes', '--context', 'kind-unit', '--namespace', 'ws-dashboard'], { PATH: f.PATH });
  assert.strictEqual(r.status, 0, r.stderr);
  const values = read(dir, rt.K8S_VALUES);
  assert.match(values, /^ {2}context: "kind-unit"$/m);
  assert.match(values, /^ {2}namespace: "ws-dashboard"$/m);
  assert.match(values, new RegExp(`^ {2}path: "${dir}"$`, 'm'), 'the workspace at its own path in the pod');
  assert.match(values, new RegExp(`^ {2}hostPath: "${dir}"$`, 'm'), 'and that folder of the node');
  assert.match(values, new RegExp(`^ {2}user: ${process.getuid()}$`, 'm'));
  assert.match(values, /^ {2}repository: "webship-workspace"\n {2}tag: "local"\n {2}pullPolicy: Never$/m);
  assert.match(values, /^ {2}type: NodePort$/m);
  assert.match(read(dir, 'core/config/settings.yml'), /^container:\n {2}runtime: kubernetes$/m);
  assert.strictEqual(rt.runtimeOf(dir), 'kubernetes');
  const k = rt.readKube(dir);
  const calls = f.calls();
  assert.ok(calls.some((c) => c.startsWith(`docker build -q -t webship-workspace:local ${path.join(dir, 'core', 'docker')}`)), calls.join('\n'));
  assert.ok(calls.includes('kind load docker-image webship-workspace:local --name unit'), calls.join('\n'));
  // And the web image of the sites built from the pod, which has no Docker to build one with.
  assert.ok(calls.some((c) => c.startsWith(`docker build -q -t webship-workspace-php:8.3 --build-arg PHP_VERSION=8.3 --build-arg UID=${process.getuid()} `)), calls.join('\n'));
  assert.ok(calls.includes('kind load docker-image webship-workspace-php:8.3 --name unit'), calls.join('\n'));
  assert.ok(calls.includes(`helm upgrade --install ${k.release} ${path.join(dir, 'core', 'k8s')} --kube-context kind-unit --namespace ws-dashboard --create-namespace -f ${path.join(dir, rt.K8S_VALUES)} --wait --timeout 10m`), calls.join('\n'));
  assert.match(r.stdout, /Done\. The dashboard: http:\/\/172\.18\.0\.9:31234/);
  // Stop is no pod, and the release stays.
  f.clear();
  assert.strictEqual(cli(['stop', dir], { PATH: f.PATH }).status, 0);
  assert.deepStrictEqual(f.calls(), [`kubectl --context kind-unit -n ws-dashboard scale deploy/${k.release} --replicas=0`]);
  assert.strictEqual(cli(['status', dir], { PATH: f.PATH, FAKE_REPLICAS: '0' }).status, 1);
});

test('a local image\'s id goes on the pod, and --no-sites-image leaves the sites\' web image out', () => {
  const f = fakes({ docker: `echo "docker $*" >> "$(dirname "$0")/../calls.log"
case "$*" in *"image inspect"*) echo sha256:0123abcd ;; esac` });
  const dir = newDir();
  const r = cli(['init', dir, '--runtime', 'kubernetes', '--context', 'kind-unit', '--no-sites-image'], { PATH: f.PATH });
  assert.strictEqual(r.status, 0, r.stderr);
  const calls = f.calls();
  assert.ok(calls.some((c) => /^helm upgrade --install .* --set-string podAnnotations\.webship\\\.co\/image=sha256:0123abcd --wait/.test(c)), calls.join('\n'));
  assert.ok(!calls.some((c) => /webship-workspace-php/.test(c)), calls.join('\n'));
  assert.match(r.stdout, /The sites' web image webship-workspace-php:8\.3 is left out/);
});

test('an image the cluster pulls is neither built nor loaded', () => {
  const f = fakes();
  const dir = newDir();
  const r = cli(['init', dir, '--runtime', 'kubernetes', '--context', 'my-cluster', '--image', 'registry.example.org:5000/webship/workspace:1.0.30'], { PATH: f.PATH });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(read(dir, rt.K8S_VALUES), /^ {2}repository: "registry\.example\.org:5000\/webship\/workspace"\n {2}tag: "1\.0\.30"\n {2}pullPolicy: IfNotPresent$/m);
  assert.ok(!f.calls().some((c) => /^docker build|^kind load/.test(c)), f.calls().join('\n'));
  assert.ok(f.calls().some((c) => /^helm upgrade --install .* --kube-context my-cluster /.test(c)));
});

test('container.runtime is changed where it is, or added; nothing else in settings.yml moves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-settings-'));
  const file = path.join(dir, 'core', 'config', 'settings.yml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'account:\n  name: webmaster\n# mine\nworkspaces: []\n');
  assert.ok(rt.recordRuntime(dir, 'docker'));
  assert.match(fs.readFileSync(file, 'utf8'), /^account:\n {2}name: webmaster\n# mine\nworkspaces: \[\]\n\n# The container runtime[^]*\ncontainer:\n {2}runtime: docker\n$/);
  assert.ok(!rt.recordRuntime(dir, 'docker'), 'the same value changes nothing');
  assert.ok(rt.recordRuntime(dir, 'kubernetes'));
  assert.match(fs.readFileSync(file, 'utf8'), /^container:\n {2}runtime: kubernetes\n$/m);
  assert.strictEqual((fs.readFileSync(file, 'utf8').match(/^container:/gm) || []).length, 1);
  // The builders read it as container_runtime (fun-runtime.sh runtime_of).
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-new-build-'));
  const out = spawnSync('bash', ['-c', `source ${SCRIPTS}/libs/bash-yaml.sh; eval $(parse_yaml ${file}); source ${SCRIPTS}/functions/fun-runtime.sh; runtime_of`], { cwd: empty, encoding: 'utf8', env: { ...process.env, WORKSPACE_RUNTIME: '', RUNTIME: '' } });
  assert.match(out.stdout, /^kubernetes$/m, out.stderr);
});

test('plugins.sh --restart ends the dashboard\'s process in its container, only for the workspace it serves', async () => {
  const dir = newDir();
  assert.strictEqual(cli(['init', dir], { WEBSHIP_WORKSPACE_SKIP_DDEV: '1' }).status, 0);
  const sleeper = spawn('sleep', ['600'], { stdio: 'ignore' });
  const pidfile = path.join(path.dirname(dir), 'dashboard.pid');
  fs.writeFileSync(pidfile, `${sleeper.pid}\n`);
  const restart = (served) => spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), '--restart'], { cwd: dir, encoding: 'utf8',
    env: { ...process.env, WORKSPACE_ROOT: dir, WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_PLUGINS_NO_RESTART: '', WEBSHIP_DASHBOARD_PIDFILE: pidfile, WEBSHIP_DASHBOARD_ROOT: served } });
  const other = restart('/home/someone/workspace');
  assert.match(other.stdout, /serves another workspace, so it was not restarted/);
  assert.strictEqual(sleeper.exitCode, null, 'the other workspace\'s dashboard is left alone');
  const gone = new Promise((resolve) => sleeper.on('exit', (code, signal) => resolve(signal)));
  const mine = restart(dir);
  assert.match(mine.stdout, /workspace-app: stopped\nworkspace-app: started/);
  assert.strictEqual(await gone, 'SIGTERM');
});

test('from the host, plugins.sh --restart reaches the container of this workspace\'s compose project, or the pod of its release', () => {
  const f = fakes();
  const env = { PATH: f.PATH, WEBSHIP_WORKSPACE_DOCKER_SOCKET: f.socket, WEBSHIP_WORKSPACE_SKIP_START: '1' };
  const restart = (dir, more = {}) => spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), '--restart'], { cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: f.PATH, WORKSPACE_ROOT: dir, WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_PLUGINS_NO_RESTART: '', WEBSHIP_DASHBOARD_PIDFILE: '', ...more } });
  const onDocker = newDir();
  assert.strictEqual(cli(['init', onDocker, '--runtime', 'docker'], env).status, 0);
  f.clear();
  assert.match(restart(onDocker).stdout, /The dashboard is not running; it will load the change when it starts\./);
  assert.ok(!f.calls().some((c) => c.startsWith('docker exec')));
  f.clear();
  assert.match(restart(onDocker, { FAKE_DASHBOARD_CID: 'abc123' }).stdout, /workspace-app: started/);
  assert.ok(f.calls().some((c) => c.startsWith('docker exec abc123 sh -c kill -TERM')), f.calls().join('\n'));
  assert.ok(!f.calls().some((c) => /supervisorctl|ddev-/.test(c)), 'never DDEV\'s container');

  const onKube = newDir();
  assert.strictEqual(cli(['init', onKube, '--runtime', 'kubernetes', '--context', 'kind-unit'], env).status, 0);
  f.clear();
  assert.match(restart(onKube).stdout, /workspace-app: started/);
  const k = rt.readKube(onKube);
  assert.ok(f.calls().some((c) => c.startsWith(`kubectl --context kind-unit -n webship-workspace exec deploy/${k.release} -- sh -c kill -TERM`)), f.calls().join('\n'));
});

test('the entrypoint keeps the dashboard running: ended, it is started again; told to stop, it stops', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-entry-'));
  const app = path.join(dir, 'ws', 'core', 'workspace-app');
  fs.mkdirSync(path.join(app, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(app, 'server.js'), '');
  fs.writeFileSync(path.join(app, 'package.json'), '{}');
  fs.writeFileSync(path.join(app, 'node_modules', '.package-lock.json'), '{}');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // The dashboard's stand-in: says it started, and runs until it is ended.
  fs.writeFileSync(path.join(bin, 'node'), `#!/usr/bin/env bash\necho "started $$" >> "${dir}/starts.log"\nexec sleep 600\n`, { mode: 0o755 });
  const pidfile = path.join(dir, 'dashboard.pid');
  const entry = spawn('bash', [path.join(CORE, 'docker', 'dashboard.sh')], { stdio: 'ignore',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WORKSPACE_ROOT: path.join(dir, 'ws'), HOME: dir, WEBSHIP_DASHBOARD_PIDFILE: pidfile, KUBERNETES_SERVICE_HOST: '' } });
  const starts = () => (fs.existsSync(path.join(dir, 'starts.log')) ? fs.readFileSync(path.join(dir, 'starts.log'), 'utf8').trim().split('\n').length : 0);
  const until = async (ok, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (ok()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  try {
    assert.ok(await until(() => starts() === 1 && fs.existsSync(pidfile)), 'the dashboard was started');
    const first = Number(fs.readFileSync(pidfile, 'utf8'));
    process.kill(first, 'SIGTERM');   // what plugins.sh --restart does
    assert.ok(await until(() => starts() === 2 && fs.existsSync(pidfile) && Number(fs.readFileSync(pidfile, 'utf8')) !== first), 'ended, it is started again');
    assert.strictEqual(entry.exitCode, null, 'the entrypoint is still there');
    const ended = new Promise((resolve) => entry.on('exit', (code) => resolve(code)));
    entry.kill('SIGTERM');   // the container is stopping
    assert.strictEqual(await ended, 0);
    assert.ok(await until(() => !fs.existsSync(pidfile)), 'the dashboard went with it');
    assert.strictEqual(starts(), 2, 'and was not started a third time');
  } finally {
    try { entry.kill('SIGKILL'); } catch (_) { /* gone */ }
  }
});

test('the entrypoint refuses to start without a workspace at WORKSPACE_ROOT', () => {
  const run = (env) => spawnSync('bash', [path.join(CORE, 'docker', 'dashboard.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.match(run({}).stderr, /WORKSPACE_ROOT is not set/);
  const none = run({ WORKSPACE_ROOT: '/nonexistent/workspace' });
  assert.strictEqual(none.status, 1);
  assert.match(none.stderr, /No workspace at \/nonexistent\/workspace/);
});

test('the image, the compose file and the chart say what the dashboard needs', () => {
  const dockerfile = read(CORE, 'docker/Dockerfile');
  assert.match(dockerfile, /^FROM node:\$\{NODE_VERSION\}-bookworm-slim$/m);
  assert.match(dockerfile, /^ARG NODE_VERSION=26$/m, 'Node.js 26');
  for (const pkg of ['tini', 'git', 'screen', 'python3-yaml', 'pandoc', 'docker-ce-cli', 'docker-compose-plugin']) assert.match(dockerfile, new RegExp(`\\b${pkg}\\b`), pkg);
  assert.match(dockerfile, /dl\.k8s\.io\/release\/\$\{KUBECTL_VERSION\}/, 'kubectl');
  assert.match(dockerfile, /^ENTRYPOINT \["tini", "--", "\/usr\/local\/bin\/webship-dashboard"\]$/m);
  assert.match(dockerfile, /^ARG DDEV_VERSION=$/m, 'the ddev binary only when asked for');
  assert.match(dockerfile, /at the SAME path it has on\s*\n# the host/, 'why the workspace is mounted at its own path');
  assert.doesNotMatch(dockerfile, /^\s*(COPY|ADD) .*workspace-app/m, 'the app is mounted, not in the image');
  // screen walks every file descriptor up to the limit: a pod's limit of a thousand million made each page wait seconds.
  assert.match(read(CORE, 'docker/dashboard.sh'), /ulimit -n 65536/, 'the hard limit too: Node.js raises its soft limit to it');

  const compose = read(CORE, 'docker/compose.yaml');
  assert.match(compose, /- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(compose, /- "\$\{WORKSPACE_ROOT\}:\$\{WORKSPACE_ROOT\}"/, 'the workspace at the same path');
  assert.match(compose, /user: "\$\{WORKSPACE_UID:-1000\}:\$\{WORKSPACE_GID:-1000\}"/);
  assert.match(compose, /group_add:\n\s+- "\$\{DOCKER_GID:-999\}"/);
  assert.match(compose, /WORKSPACE_LISTEN: "\$\{WORKSPACE_LISTEN:-127\.0\.0\.1\}"/, 'on 127.0.0.1 unless told otherwise');
  assert.doesNotMatch(compose, /^\s*pid:/m, 'never the host\'s process space');
  assert.doesNotMatch(compose, /privileged/);

  const k8s = (f) => read(CORE, `k8s/templates/${f}`);
  assert.match(k8s('deployment.yaml'), /serviceAccountName:/);
  assert.match(k8s('deployment.yaml'), /with \.Values\.podAnnotations/, 'a local image built again makes the pod new');
  assert.match(k8s('deployment.yaml'), /init "\$\{WORKSPACE_ROOT\}" --runtime kubernetes/, 'an empty claim is seeded for Kubernetes');
  assert.match(k8s('deployment.yaml'), /hostPath: \{path: /);
  assert.match(k8s('deployment.yaml'), /persistentVolumeClaim: \{claimName: /);
  assert.match(k8s('service.yaml'), /kind: Service/);
  const rbac = k8s('rbac.yaml');
  for (const resource of ['namespaces', 'deployments', 'services', 'persistentvolumeclaims', 'pods/exec', 'pods/log']) assert.ok(rbac.includes(`"${resource}"`), resource);
  assert.match(rbac, /kind: ValidatingAdmissionPolicy\b/);
  assert.match(rbac, /startsWith\("\{\{ \.Values\.sites\.namespacePrefix \}\}"\)/, 'only the sites\' namespaces');
  assert.match(read(CORE, 'k8s/values.yaml'), /^ {2}namespacePrefix: ws-$/m);
});

test('the cloud-init file is one a server can run: it parses, its script parses, and the dashboard is never opened without a password', () => {
  const yaml = require('js-yaml');
  const text = read(CORE, 'docker/cloud-init.yaml');
  assert.match(text, /^#cloud-config\n/);
  const doc = yaml.load(text);
  assert.deepStrictEqual(doc.runcmd, [['bash', '/usr/local/sbin/webship-workspace-install']]);
  const script = doc.write_files.find((f) => f.path === '/usr/local/sbin/webship-workspace-install').content;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cloud-')), 'install.sh');
  fs.writeFileSync(file, script);
  const parsed = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
  assert.strictEqual(parsed.status, 0, parsed.stderr);
  assert.match(script, /webship-workspace init "\$\{WORKSPACE_DIR\}" --runtime docker/);
  assert.match(script, /basicauth \{/, 'a password in front of the dashboard on a public name');
  assert.match(script, /reverse_proxy 127\.0\.0\.1:\$\{WORKSPACE_PORT\}/);
  assert.doesNotMatch(script, /WORKSPACE_LISTEN=0\.0\.0\.0/, 'the dashboard itself stays on 127.0.0.1');
  const defaults = doc.write_files.find((f) => f.path === '/etc/webship-workspace.env').content;
  assert.match(defaults, /^WORKSPACE_DOMAIN=$/m, 'no domain, nothing opened, until one is given');
});

test('a pod is a container: the dashboard listens on every interface of it, and DDEV is not what it needs', () => {
  const guard = require(path.join(CORE, 'workspace-app', 'request-guard.mts'));
  const none = () => false;
  assert.strictEqual(guard.inContainer({ env: { KUBERNETES_SERVICE_HOST: '10.96.0.1' }, exists: none }), true);
  assert.strictEqual(guard.listenHost({ env: { KUBERNETES_SERVICE_HOST: '10.96.0.1' }, exists: none }), undefined);
  assert.strictEqual(guard.listenHost({ env: {}, exists: none }), '127.0.0.1', 'on a machine it stays on 127.0.0.1');
  assert.strictEqual(guard.listenHost({ env: { WORKSPACE_LISTEN: '127.0.0.1' }, exists: () => true }), '127.0.0.1', 'compose keeps it there on the host\'s network');
  // In the Workspace's own image ddev is a part's, not a need.
  const out = spawnSync(process.execPath, ['-e', `const c = require(${JSON.stringify(path.join(CORE, 'workspace-app', 'command-check.js'))});
    console.log(JSON.stringify(c.checkCore().rows.filter((r) => r.anyOf.includes('ddev')).map((r) => r.kind)));`],
  { encoding: 'utf8', env: { ...process.env, WEBSHIP_DASHBOARD_ROOT: '/workspace' } });
  assert.deepStrictEqual([...new Set(JSON.parse(out.stdout))], ['suggests'], out.stderr);
});

test('on a plain address the page names that address, and its cookies are that address\'s own', () => {
  const urls = require(path.join(CORE, 'workspace-app', 'urls.js'));
  const { hubDomain } = require(path.join(CORE, 'workspace-app', 'workspaces.js'));
  const req = (host) => ({ headers: { host } });
  assert.strictEqual(urls.hereName(), hubDomain());
  assert.strictEqual(urls.cookieDomain(), `; Domain=.${hubDomain()}`);
  urls.withRequest(req(`dev.${hubDomain()}`), () => {
    assert.strictEqual(urls.hereName(), hubDomain());
    assert.strictEqual(urls.cookieDomain(), `; Domain=.${hubDomain()}`, 'the hub\'s subdomains share the cookie');
  });
  for (const host of ['127.0.0.1:3000', '172.18.0.2:30080', 'workspace.example.org']) {
    urls.withRequest(req(host), () => {
      assert.strictEqual(urls.hereName(), host);
      assert.strictEqual(urls.cookieDomain(), '', 'a browser refuses a cookie for a domain the page is not on');
    });
  }
  urls.withRequest(req('evil"><script>'), () => assert.doesNotMatch(urls.hereName(), /[<>"]/));
  const server = read(CORE, 'workspace-app/server.js');
  assert.match(server, /container-based tooling · <a href="\/">\$\{esc\(hereName\(\)\)\}<\/a>/);
  assert.doesNotMatch(server, />workspace\.ddev\.site<\/a>/, 'the footer no longer names the hub on every address');
  const chats = require(path.join(CORE, 'workspace-app', 'chat-threads.js'));
  urls.withRequest(req('127.0.0.1:3000'), () => assert.doesNotMatch(chats.threadCookie(chats.newId()), /Domain=/));
});

test('kubernetes sites: an image named for the cluster is used as it is, and nothing is built for it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-kube-image-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const c of ['docker', 'kubectl', 'kind']) fs.writeFileSync(path.join(bin, c), `#!/usr/bin/env bash\necho "${c} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\n`, { mode: 0o755 });
  const stacks = path.join(CORE, 'config', 'runtimes');
  const run = (cwd, script, env = {}) => spawnSync('bash', ['-c', `RT_STACKS=${stacks}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${stacks}; ${script}`],
    { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WORKSPACE_ROOT: path.join(CORE, '..'), WORKSPACE_RUNTIME: 'kubernetes', ...env } });
  const calls = () => { const f = path.join(dir, 'calls.log'); const c = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : []; if (fs.existsSync(f)) fs.unlinkSync(f); return c; };
  const config = 'ddev config --project-type=drupal --docroot=web --project-name=NAME --php-version=8.4';
  // In a pod (no Docker): the image the chart names.
  const pod = path.join(dir, 'k1'); fs.mkdirSync(pod);
  run(pod, `${config.replace('NAME', 'k1')}; ddev start`, { WORKSPACE_KUBE_WEB_IMAGE: 'webship-workspace-php:{php}' });
  const stack = fs.readFileSync(path.join(pod, 'k8s', 'stack.yaml'), 'utf8');
  assert.match(stack, /^ {10}image: webship-workspace-php:8\.4\n {10}imagePullPolicy: IfNotPresent$/m);
  const inPod = calls();
  assert.ok(!inPod.some((c) => /^docker build|^kind load/.test(c)), inPod.join('\n'));
  assert.ok(inPod.some((c) => /^kubectl .* apply -k /.test(c)), inPod.join('\n'));
  // On a machine with Docker, as before: the site's own image, built and loaded.
  const host = path.join(dir, 'k2'); fs.mkdirSync(host);
  run(host, `${config.replace('NAME', 'k2')}; ddev start`);
  assert.match(fs.readFileSync(path.join(host, 'k8s', 'stack.yaml'), 'utf8'), /^ {10}image: webship-k2-web\n {10}imagePullPolicy: Never$/m);
  const onHost = calls();
  assert.ok(onHost.some((c) => /^docker build -q -t webship-k2-web /.test(c)), onHost.join('\n'));
  assert.ok(onHost.some((c) => /^kind load docker-image webship-k2-web /.test(c)), onHost.join('\n'));
});
