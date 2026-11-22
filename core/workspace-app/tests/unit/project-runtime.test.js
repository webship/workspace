/**
 * The runtime of a project folder (project-runtime.js, webship/workspace#694): DDEV, Docker Compose, Podman or
 * Kubernetes, with its name, its address and its state.
 *
 * Temp project folders, and stand-in docker, podman and kubectl on PATH that answer what the real ones would and
 * record each call. The module is loaded in a child process per check, so each starts with an empty cache.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');

const COMPOSE = (name, runtime, port, extra = '') => `# Written by the Webship Workspace.
name: ${name}
x-webship:
  runtime: ${runtime}
  stack: php
  type: drupal
  docroot: "web"
  php: "8.3"
  database: "10.11"
  port: ${port}
services:
  web:
    image: webship-${name}-web
${extra}`;

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-project-runtime-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  // The few tools the stand-ins use, and nothing else of the machine: a real docker, podman or kubectl on it
  // must not answer for one that is missing here.
  fs.mkdirSync(path.join(dir, 'sys'));
  for (const tool of ['bash', 'env', 'cat', 'sleep', 'touch']) {
    const found = ['/usr/bin', '/bin'].map((d) => path.join(d, tool)).find((f) => fs.existsSync(f));
    if (found) fs.symlinkSync(found, path.join(dir, 'sys', tool));
  }
  const site = (name, files) => {
    const p = path.join(dir, name);
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(p, f)), { recursive: true });
      fs.writeFileSync(path.join(p, f), text);
    }
    return p;
  };
  const cli = (name, body) => fs.writeFileSync(path.join(dir, 'bin', name), `#!/usr/bin/env bash\necho "${name} $*" >> "${dir}/calls.log"\n${body}\n`, { mode: 0o755 });
  return { dir, site, cli };
}

/** Runs `script` (an async function body using `rt`) in a child with the stand-ins first on PATH; returns what it printed as JSON. */
function child(box, script, env = {}) {
  const r = spawnSync(process.execPath, ['-e', `
    const rt = require(${JSON.stringify(path.join(APP, 'project-runtime'))});
    (async () => { ${script} })().then((v) => { process.stdout.write(JSON.stringify(v === undefined ? null : v)); process.exit(0); },
      (e) => { console.error(e); process.exit(1); });`],
  { encoding: 'utf8', env: { ...process.env, PATH: `${box.dir}/bin:${box.dir}/sys`, HOME: box.dir, WORKSPACE_KUBE_CONTEXT: '', WORKSPACE_KIND_CLUSTER: '', ...env } });
  assert.strictEqual(r.status, 0, r.stderr);
  const log = path.join(box.dir, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { value: JSON.parse(r.stdout || 'null'), calls };
}

const rt = require(path.join(APP, 'project-runtime'));

test('a folder is what it carries: DDEV, the runtime its compose.yaml names, or none', () => {
  const box = sandbox();
  const ddev = box.site('d', { '.ddev/config.yaml': 'name: my-ddev\ntype: drupal11\ndocroot: web\n' });
  const unnamed = box.site('no name here', { '.ddev/config.yaml': 'type: php\n' });
  const docker = box.site('k', { 'compose.yaml': COMPOSE('shop', 'docker', 41167) });
  const podman = box.site('p', { 'compose.yaml': COMPOSE('pod1', 'podman', 41200) });
  const kube = box.site('c', { 'compose.yaml': COMPOSE('kube1', 'kubernetes', 30081), 'k8s/kustomization.yaml': 'namespace: ws-kube1\n' });
  const plainCompose = box.site('h', { 'compose.yaml': 'name: hand\nservices:\n  web:\n    image: nginx\n' });
  const both = box.site('b', { '.ddev/config.yaml': 'name: both\n', 'compose.yaml': COMPOSE('both', 'docker', 41300) });
  const odd = box.site('o', { 'compose.yaml': COMPOSE('odd', 'lando', 41400) });

  assert.deepStrictEqual(rt.readProject(ddev), { runtime: 'ddev', name: 'my-ddev', root: ddev, port: '', type: 'drupal11', docroot: 'web', platform: '', namespace: '' });
  assert.strictEqual(rt.readProject(unnamed).name, 'no-name-here', "DDEV's own default name");
  assert.deepStrictEqual(rt.readProject(docker), { runtime: 'docker', name: 'shop', root: docker, port: '41167', type: 'drupal', docroot: 'web', platform: '', namespace: '' });
  assert.strictEqual(rt.readProject(podman).runtime, 'podman');
  assert.deepStrictEqual([rt.readProject(kube).runtime, rt.readProject(kube).namespace, rt.readProject(kube).port], ['kubernetes', 'ws-kube1', '30081']);
  assert.strictEqual(rt.readProject(plainCompose).runtime, 'none', 'a compose file the Workspace did not write');
  // A project template may ship a .ddev/ of its own: the block the Workspace wrote decides.
  assert.strictEqual(rt.readProject(both).runtime, 'docker', 'the x-webship block first, as rt_find_project decides');
  const ddevWithCompose = box.site('dc', { '.ddev/config.yaml': 'name: dc\n', 'compose.yaml': 'name: hand\nservices:\n  web:\n    image: nginx\n' });
  assert.strictEqual(rt.readProject(ddevWithCompose).runtime, 'ddev', 'a DDEV project with a compose file of its own stays DDEV');
  assert.strictEqual(rt.readProject(odd).runtime, 'none', 'a runtime the layer does not run');
  assert.strictEqual(rt.readProject(path.join(box.dir, 'missing')).runtime, 'none');
  assert.strictEqual(rt.isRuntimeProject(rt.readProject(docker)), true);
  assert.strictEqual(rt.isRuntimeProject(rt.readProject(ddev)), false);
  assert.strictEqual(rt.isRuntimeProject(rt.readProject(plainCompose)), false);
});

test('the address: ddev.site for DDEV, the port on this machine for Docker and Podman', () => {
  assert.strictEqual(rt.urlOf({ runtime: 'ddev', name: 'site' }), 'https://site.ddev.site');
  assert.strictEqual(rt.urlOf({ runtime: 'docker', name: 'a', port: '41167' }), 'http://127.0.0.1:41167');
  assert.strictEqual(rt.urlOf({ runtime: 'podman', name: 'a', port: '41200' }), 'http://127.0.0.1:41200');
  assert.strictEqual(rt.urlOf({ runtime: 'docker', name: 'a', port: '' }), '', 'no port, no link');
  assert.strictEqual(rt.urlOf({ runtime: 'none' }), '');
});

test('the menu label says the runtime: DOCKER, PODMAN, K8S', () => {
  assert.deepStrictEqual([rt.LABELS.docker, rt.LABELS.podman, rt.LABELS.kubernetes, rt.LABELS.ddev], ['DOCKER', 'PODMAN', 'K8S', 'DDEV']);
});

test('docker: one `docker compose ls` answers for every Docker project, matched by its compose file', () => {
  const box = sandbox();
  const up = box.site('up', { 'compose.yaml': COMPOSE('up', 'docker', 41001) });
  const down = box.site('down', { 'compose.yaml': COMPOSE('down', 'docker', 41002) });
  const never = box.site('never', { 'compose.yaml': COMPOSE('never', 'docker', 41003) });
  const half = box.site('half', { 'compose.yaml': COMPOSE('half', 'docker', 41004) });
  // A project of the same name that lives in another folder must not answer for this one.
  const twin = box.site('twin', { 'compose.yaml': COMPOSE('up', 'docker', 41005) });
  box.cli('docker', `cat <<JSON
[{"Name":"up","Status":"running(3)","ConfigFiles":"${up}/compose.yaml"},
 {"Name":"down","Status":"exited(3)","ConfigFiles":"${down}/compose.yaml"},
 {"Name":"half","Status":"running(2), exited(1)","ConfigFiles":"${half}/compose.yaml"},
 {"Name":"ddev-other","Status":"running(2)","ConfigFiles":"/elsewhere/.ddev/.ddev-docker-compose-full.yaml"}]
JSON`);
  const r = child(box, `const m = await rt.statesFor(${JSON.stringify([up, down, never, half, twin])}.map(rt.readProject)); return [...m.values()];`);
  assert.deepStrictEqual(r.value, ['running', 'stopped', 'stopped', 'stopped', 'stopped']);
  assert.deepStrictEqual(r.calls, ['docker compose ls --all --format json'], 'one call, whatever the number of projects');
});

test('podman: the containers of the compose project, by the label its provider sets', () => {
  const box = sandbox();
  const up = box.site('up', { 'compose.yaml': COMPOSE('pup', 'podman', 41001) });
  const down = box.site('down', { 'compose.yaml': COMPOSE('pdown', 'podman', 41002) });
  const gone = box.site('gone', { 'compose.yaml': COMPOSE('pgone', 'podman', 41003) });
  box.cli('podman', `cat <<JSON
[{"Names":["pup-web-1"],"State":"running","Labels":{"com.docker.compose.project":"pup","com.docker.compose.project.working_dir":"${up}"}},
 {"Names":["pup-db-1"],"State":"running","Labels":{"com.docker.compose.project":"pup","com.docker.compose.project.working_dir":"${up}"}},
 {"Names":["pdown_web_1"],"State":"exited","Labels":{"io.podman.compose.project":"pdown"}}]
JSON`);
  const r = child(box, `const m = await rt.statesFor(${JSON.stringify([up, down, gone])}.map(rt.readProject)); return [...m.values()];`);
  assert.deepStrictEqual(r.value, ['running', 'stopped', 'stopped']);
  assert.deepStrictEqual(r.calls, ['podman ps -a --format json']);
});

test('kubernetes: the web Deployment of the namespace ws-<name> decides, on the layer\'s context', () => {
  const box = sandbox();
  const up = box.site('up', { 'compose.yaml': COMPOSE('kup', 'kubernetes', 30081) });
  const scaled = box.site('scaled', { 'compose.yaml': COMPOSE('kscaled', 'kubernetes', 30082) });
  const gone = box.site('gone', { 'compose.yaml': COMPOSE('kgone', 'kubernetes', 30083) });
  const starting = box.site('starting', { 'compose.yaml': COMPOSE('kstarting', 'kubernetes', 30084) });
  box.cli('kubectl', `case "$*" in
  *"get nodes"*) printf '172.18.0.2' ;;
  *"-n ws-kup "*) echo '{"items":[{"metadata":{"name":"db"},"spec":{"replicas":1},"status":{"availableReplicas":1}},{"metadata":{"name":"web"},"spec":{"replicas":1},"status":{"availableReplicas":1}}]}' ;;
  *"-n ws-kscaled "*) echo '{"items":[{"metadata":{"name":"web"},"spec":{"replicas":0},"status":{}}]}' ;;
  *"-n ws-kstarting "*) echo '{"items":[{"metadata":{"name":"web"},"spec":{"replicas":1},"status":{}}]}' ;;
  *) echo '{"items":[]}' ;;
esac`);
  const r = child(box, `const ps = ${JSON.stringify([up, scaled, gone, starting])}.map(rt.readProject);
    const m = await rt.statesFor(ps); return { states: [...m.values()], url: rt.urlOf(ps[0]), context: rt.kubeContext() };`);
  assert.deepStrictEqual(r.value.states, ['running', 'stopped', 'stopped', 'unknown']);
  assert.strictEqual(r.value.url, 'http://172.18.0.2:30081', "the node's address and the NodePort");
  assert.strictEqual(r.value.context, 'kind-webship');
  assert.ok(r.calls.includes('kubectl --context kind-webship --request-timeout=5s -n ws-kup get deploy -o json'), r.calls.join('\n'));
  assert.strictEqual(r.calls.filter((c) => /get nodes/.test(c)).length, 1, "the node's address is asked once");
  const other = child(box, 'return rt.kubeContext();', { WORKSPACE_KUBE_CONTEXT: 'prod-eu' });
  assert.strictEqual(other.value, 'prod-eu', 'WORKSPACE_KUBE_CONTEXT wins, as in the layer');
});

test('an error, a missing CLI or an answer that is not JSON is unknown, never an exception', () => {
  const box = sandbox();
  const d = box.site('d', { 'compose.yaml': COMPOSE('d', 'docker', 41001) });
  const p = box.site('p', { 'compose.yaml': COMPOSE('p', 'podman', 41002) });
  const k = box.site('k', { 'compose.yaml': COMPOSE('k', 'kubernetes', 30081) });
  box.cli('docker', 'echo "Cannot connect to the Docker daemon" >&2; exit 1');
  box.cli('kubectl', 'echo "not json at all"');
  // No podman on PATH at all (as on a machine without it).
  const r = child(box, `const ps = ${JSON.stringify([d, p, k])}.map(rt.readProject);
    const m = await rt.statesFor(ps); return { states: [...m.values()], url: rt.urlOf(ps[2]) };`);
  assert.deepStrictEqual(r.value.states, ['unknown', 'unknown', 'unknown']);
  assert.strictEqual(r.value.url, '', 'no address is made up for a cluster that did not answer');
});

test('a CLI that hangs is cut off: the page gets unknown in bounded time', () => {
  const box = sandbox();
  const d = box.site('d', { 'compose.yaml': COMPOSE('d', 'docker', 41001) });
  box.cli('docker', 'sleep 30');
  const started = Date.now();
  const r = child(box, `const m = await rt.statesFor([rt.readProject(${JSON.stringify(d)})]); return [...m.values()];`, { WORKSPACE_RUNTIME_TIMEOUT_MS: '700' });
  assert.deepStrictEqual(r.value, ['unknown']);
  assert.ok(Date.now() - started < 8000, `answered in ${Date.now() - started} ms`);
});

test('states are cached: a second page within the fresh window asks nothing, and invalidate() asks again', () => {
  const box = sandbox();
  const d = box.site('d', { 'compose.yaml': COMPOSE('d', 'docker', 41001) });
  box.cli('docker', `echo '[{"Name":"d","Status":"running(3)","ConfigFiles":"${d}/compose.yaml"}]'`);
  const r = child(box, `const p = rt.readProject(${JSON.stringify(d)});
    const a = await rt.stateOf(p); const b = await rt.stateOf(p); const c = (await rt.statesFor([p])).get(p.root);
    rt.invalidate(p.root); const e = await rt.stateOf(p); return [a, b, c, e];`);
  assert.deepStrictEqual(r.value, ['running', 'running', 'running', 'running']);
  assert.strictEqual(r.calls.length, 2, `asked once, and once more after invalidate: ${r.calls.join(' | ')}`);
});

test('a stale answer is served while the refresh runs behind it: a later page never waits for a slow CLI', () => {
  const box = sandbox();
  const d = box.site('d', { 'compose.yaml': COMPOSE('d', 'docker', 41001) });
  // Fast the first time, slow ever after.
  box.cli('docker', `if [ -f "${box.dir}/asked" ]; then sleep 4; echo '[]'; else touch "${box.dir}/asked"; echo '[{"Name":"d","Status":"running(3)","ConfigFiles":"${d}/compose.yaml"}]'; fi`);
  const r = child(box, `const p = rt.readProject(${JSON.stringify(d)});
    const first = await rt.stateOf(p);
    await new Promise((r) => setTimeout(r, 5200));           // past the fresh window
    const t = Date.now(); const second = (await rt.statesFor([p], { waitMs: 300 })).get(p.root);
    return { first, second, waited: Date.now() - t };`);
  assert.strictEqual(r.value.first, 'running');
  assert.strictEqual(r.value.second, 'running', 'what was last read');
  assert.ok(r.value.waited < 2000, `waited ${r.value.waited} ms`);
});

test('the pure readers: compose ls rows, podman containers, a deployment list', () => {
  const project = { name: 'a', root: '/w/a' };
  assert.strictEqual(rt.composeState([{ Name: 'a', Status: 'running(3)', ConfigFiles: '/w/a/compose.yaml' }], project), 'running');
  assert.strictEqual(rt.composeState([{ Name: 'a', Status: 'paused(3)', ConfigFiles: '/w/a/compose.yaml' }], project), 'stopped');
  assert.strictEqual(rt.composeState([{ Name: 'a', Status: 'running(3)' }], project), 'running', 'a listing with no file: by name');
  assert.strictEqual(rt.composeState([{ Name: 'a', Status: 'running(3)', ConfigFiles: '/other/a/compose.yaml' }], project), 'stopped');
  assert.strictEqual(rt.composeState([], project), 'stopped');
  assert.strictEqual(rt.podmanState([{ State: 'running', Labels: { 'io.podman.compose.project': 'a' } }], project), 'running');
  assert.strictEqual(rt.podmanState([{ State: 'running', Labels: null }], project), 'stopped');
  assert.strictEqual(rt.deployState(null), 'unknown');
  assert.strictEqual(rt.deployState({ items: [] }), 'stopped');
});

test('a verb runs through core/scripts/runtime-verb.sh, in a line with no $ in it', () => {
  const line = rt.verbLine(['start', '-y']);
  assert.match(line, /^bash '[^'$]+\/core\/scripts\/runtime-verb\.sh' start -y$/);
  assert.doesNotMatch(line, /\$/);
  const script = fs.readFileSync(path.join(APP, '..', 'scripts', 'runtime-verb.sh'), 'utf8');
  assert.match(script, /source \$\{WORKSPACE_SCRIPTS\}\/bootstrap\.sh/, 'it loads the workspace');
  assert.match(script, /^ddev "\$@" ;$/m, 'and calls ddev <verb>: the layer does the mapping');
});

test('lando: a .lando.yml the Workspace wrote is a Lando project; one of the project\'s own keeps its plugin\'s menu', () => {
  const box = sandbox();
  const landofile = (name, port) => `# Written by the Webship Workspace.\nname: ${name}\nx-webship:\n  platform: wordpress\n  runtime: lando\n  stack: php\n  type: wordpress\n  docroot: ""\n  php: "8.3"\n  database: "10.11"\n  port: ${port}\n  mail_port: 41902\nrecipe: lamp\n`;
  const lando = box.site('l', { '.lando.yml': landofile('wp-l1', 41901) });
  const own = box.site('own', { '.lando.yml': 'name: own\nrecipe: drupal11\n' });
  // A template that ships .ddev/ after the Workspace wrote .lando.yml: the block decides, as rt_find_project does.
  const shipped = box.site('s', { '.lando.yml': landofile('s1', 41903), '.ddev/config.yaml': 'name: s1\ntype: drupal11\n' });
  // A compose.yaml block still comes first.
  const both = box.site('b', { 'compose.yaml': COMPOSE('b1', 'docker', 41904), '.lando.yml': landofile('b1', 41905) });
  // The block of a runtime in the file of another is none.
  const wrong = box.site('w', { '.lando.yml': landofile('w1', 41906).replace('runtime: lando', 'runtime: docker') });
  assert.deepStrictEqual(rt.readProject(lando), { runtime: 'lando', name: 'wp-l1', root: lando, port: '41901', type: 'wordpress', docroot: '', platform: 'wordpress', namespace: '' });
  assert.strictEqual(rt.readProject(own).runtime, 'none');
  assert.strictEqual(rt.readProject(shipped).runtime, 'lando');
  assert.strictEqual(rt.readProject(both).runtime, 'docker');
  assert.strictEqual(rt.readProject(wrong).runtime, 'none');
  assert.strictEqual(rt.urlOf(rt.readProject(lando)), 'http://127.0.0.1:41901');
  assert.deepStrictEqual([rt.LABELS.lando, rt.TITLES.lando, rt.ICONS.lando], ['LANDO', 'Lando', 'tabler:chef-hat']);
  assert.ok(rt.RUNTIMES.includes('lando'), "the core's menu replaces the plugin's on the row");
  assert.ok(rt.BUILDS_NO_IMAGE.includes('lando'), 'its remove form names no image of the Workspace');
});

test('lando: one `docker ps` answers for every Lando project, matched by the folder Lando labels its containers with', () => {
  const box = sandbox();
  const lf = (name, port) => `name: ${name}\nx-webship:\n  runtime: lando\n  port: ${port}\n`;
  const up = box.site('up', { '.lando.yml': lf('up', 41001) });
  const half = box.site('half', { '.lando.yml': lf('half', 41002) });
  const never = box.site('never', { '.lando.yml': lf('never', 41003) });
  box.cli('docker', `printf 'running\\t${up}\\nrunning\\t${up}\\nrunning\\t${half}\\nexited\\t${half}\\nrunning\\t/elsewhere/up\\n'`);
  const r = child(box, `const m = await rt.statesFor(${JSON.stringify([up, half, never])}.map(rt.readProject)); return [...m.values()];`);
  assert.deepStrictEqual(r.value, ['running', 'stopped', 'stopped']);
  assert.deepStrictEqual(r.calls, ['docker ps -a --filter label=io.lando.container=TRUE --format {{.State}}\t{{.Label "io.lando.root"}}']);
  assert.strictEqual(rt.landoState('', { root: '/w/a' }), 'stopped');
  assert.strictEqual(rt.landoState('running\t/w/a\n', { root: '/w/a' }), 'running');
  assert.strictEqual(rt.landoState('running\t/w/ab\n', { root: '/w/a' }), 'stopped', 'another folder');
});
