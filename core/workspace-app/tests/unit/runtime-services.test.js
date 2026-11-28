/**
 * A project's own services beside its web server and database, on Docker Compose, Podman and Kubernetes
 * (webship/workspace#900): rt_service keeps each in .webship/runtime/services/<name>.yaml, and every `ddev config`
 * writes them into compose.yaml and into the project's Kubernetes manifests. A project without services gets what it
 * got before; removal takes the services' volumes with the project.
 *
 * Stand-in docker, podman, ddev, kind and kubectl on PATH record what is called; nothing is started.
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');

const SANDBOX_RE = /^ws-runtime-services-[A-Za-z0-9]{6}$/;
const sandboxes = [];

/** Remove a file or a folder of this test's sandboxes, never a path outside one. */
function removeInSandbox(target) {
  const parts = path.relative(os.tmpdir(), path.resolve(target)).split(path.sep);
  assert.ok(SANDBOX_RE.test(parts[0]) && !parts.includes('..'), `refused to remove ${target}: not in a sandbox of this test`);
  fs.rmSync(target, { recursive: true, force: true });
}

// Every sandbox goes when the file's tests are done: nothing of them is left in the temporary folder.
after(() => { for (const dir of sandboxes) removeInSandbox(dir); });

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-services-'));
  sandboxes.push(dir);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kind']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\ntrue\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, 'kubectl'), `#!/usr/bin/env bash\necho "kubectl $*" >> "${dir}/calls.log"\ncase "$*" in *"get nodes"*) printf 172.18.0.2 ;; esac\n`, { mode: 0o755 });
  return dir;
}

function run(dir, cwd, script, env = {}) {
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ${script}`],
    { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), ...env } });
  const log = path.join(dir, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { out: r.stdout + r.stderr, calls, status: r.status };
}

/** A generic project on a runtime, with PostgreSQL (or none), its env files beside it. */
function project(dir, runtime, name, { db = '--database=postgres:15' } = {}) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.join(p, 'app'), { recursive: true });
  fs.writeFileSync(path.join(p, 'app', 'queue.env'), 'RABBITMQ_DEFAULT_USER=app\nRABBITMQ_DEFAULT_PASS=s3cret\n');
  fs.writeFileSync(path.join(p, 'app', 'store.env'), 'MINIO_ROOT_USER=app\nMINIO_ROOT_PASSWORD=s3cret-too\n');
  const r = run(dir, p, `ddev config --project-type=generic --webserver-type=generic ${db} --project-name=${name}`, { WORKSPACE_RUNTIME: runtime });
  assert.strictEqual(r.status, 0, r.out);
  return p;
}

const read = (...f) => fs.readFileSync(path.join(...f), 'utf8');
const ONE = "rt_service cache docker.io/valkey/valkey:7.2.11-alpine --port 6379";
const THREE = `${ONE} && rt_service queue docker.io/library/rabbitmq:3.13.6-alpine --port 5672 --env-file app/queue.env --volume /var/lib/rabbitmq`
  + ` && rt_service store docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z --port 9000 --env-file app/store.env --volume /export --command 'server /export --console-address ":9090" --note $HOME'`;

/** What compose.yaml and k8s/ hold, every file, for a byte-for-byte comparison. */
function written(p) {
  const files = ['compose.yaml', ...(fs.existsSync(path.join(p, 'k8s')) ? fs.readdirSync(path.join(p, 'k8s')).filter((f) => f.endsWith('.yaml')).map((f) => `k8s/${f}`) : [])];
  return Object.fromEntries(files.sort().map((f) => [f, read(p, f)]));
}

test('no service: compose.yaml and the manifests are what they were, with no line of services; removed again, the same', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman', 'kubernetes']) {
    const p = project(dir, runtime, `none-${runtime}`);
    // Kubernetes moves the site to a NodePort the first time it is written: the files of a second write are the ones
    // every later write gives.
    assert.strictEqual(run(dir, p, 'ddev config > /dev/null').status, 0);
    const before = written(p);
    assert.doesNotMatch(JSON.stringify(before), /rt_service|svc-|services\.yaml|secretGenerator/, runtime);
    assert.ok(!fs.existsSync(path.join(p, '.webship', 'runtime', 'services')), `${runtime}: no folder of services`);
    // A service added, then taken away: the files are byte for byte the ones without.
    assert.strictEqual(run(dir, p, ONE).status, 0);
    assert.notDeepStrictEqual(written(p), before, `${runtime}: the service is written`);
    removeInSandbox(path.join(p, '.webship', 'runtime', 'services'));
    assert.strictEqual(run(dir, p, 'ddev config > /dev/null').status, 0);
    assert.deepStrictEqual(written(p), before, `${runtime}: without services, the same files as before`);
    assert.ok(!fs.existsSync(path.join(p, 'k8s', 'services')), `${runtime}: no copy of an env file left`);
  }
});

test('one service on Docker Compose and Podman: its pinned image and port, the web server waits for it, no volume of its own', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const p = project(dir, runtime, `one-${runtime}`);
    const r = run(dir, p, ONE);
    assert.strictEqual(r.status, 0, r.out);
    assert.strictEqual(read(p, '.webship', 'runtime', 'services', 'cache.yaml').split('\n').filter((l) => l && !l.startsWith('#')).join('|'), 'image: docker.io/valkey/valkey:7.2.11-alpine|port: 6379');
    const compose = yaml.load(read(p, 'compose.yaml'));
    assert.deepStrictEqual(compose.services.cache, { image: 'docker.io/valkey/valkey:7.2.11-alpine', restart: 'on-failure', expose: ['6379'] }, runtime);
    assert.deepStrictEqual(compose.services.web.depends_on, { db: { condition: 'service_healthy' }, cache: { condition: 'service_started' } }, runtime);
    assert.deepStrictEqual(compose.volumes, { db: null }, `${runtime}: a service with no volume adds none`);
    assert.strictEqual(compose.services.cache.container_name, undefined, `${runtime}: compose names its container after the project`);
  }
});

test('three services: env files of the project, volumes named after the project, a command as its words; written again they stay', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const p = project(dir, runtime, `three-${runtime}`);
    const r = run(dir, p, THREE);
    assert.strictEqual(r.status, 0, r.out);
    const text = read(p, 'compose.yaml');
    const compose = yaml.load(text);
    assert.deepStrictEqual(Object.keys(compose.services), ['web', 'db', 'mail', 'cache', 'queue', 'store'], runtime);
    assert.deepStrictEqual(compose.services.queue, { image: 'docker.io/library/rabbitmq:3.13.6-alpine', restart: 'on-failure', env_file: ['app/queue.env'], expose: ['5672'], volumes: ['svc-queue:/var/lib/rabbitmq'] });
    assert.deepStrictEqual(compose.services.store.command, ['server', '/export', '--console-address', ':9090', '--note', '$$HOME'], `${runtime}: a $ is compose's $$`);
    assert.deepStrictEqual(compose.volumes, { db: null, 'svc-queue': null, 'svc-store': null }, `${runtime}: compose prefixes them with the project's name`);
    assert.deepStrictEqual(Object.keys(compose.services.web.depends_on), ['db', 'cache', 'queue', 'store']);
    assert.match(text, /\n {2}# A service of the project's own \(rt_service, webship\/workspace#900\)\.\n {2}queue:\n/);
    // Every `ddev config` (rt_stack, rt_web_build and rt_serve call it) keeps them.
    assert.strictEqual(run(dir, p, "rt_stack python 3.13 && rt_serve 8000 'python -m http.server 8000'").status, 0);
    assert.deepStrictEqual(Object.keys(yaml.load(read(p, 'compose.yaml')).services), ['web', 'db', 'mail', 'cache', 'queue', 'store'], `${runtime}: written again`);
    const again = yaml.load(read(p, 'compose.yaml')).services;
    for (const name of ['cache', 'queue', 'store']) assert.match(again[name].image, /:[^:/]+$/, `${runtime}: ${name} is pinned`);
  }
});

test('a service whose process stops on its own comes back on Docker Compose and Podman (#959): every service has restart: on-failure, the web container, the database and the mail catcher none', () => {
  const dir = sandbox();
  assert.strictEqual(run(dir, dir, 'rt_service_restart').out.trim(), 'on-failure', 'plugins look for the function, which says the policy');
  for (const runtime of ['docker', 'podman']) {
    const p = project(dir, runtime, `restart-${runtime}`);
    assert.strictEqual(run(dir, p, THREE).status, 0);
    const services = yaml.load(read(p, 'compose.yaml')).services;
    for (const name of ['cache', 'queue', 'store']) assert.strictEqual(services[name].restart, 'on-failure', `${runtime}: ${name}`);
    for (const name of ['web', 'db', 'mail']) assert.strictEqual(services[name].restart, undefined, `${runtime}: ${name} keeps no policy (the web container ending says its application did not start)`);
    // Written again by every `ddev config`, the policy stays.
    assert.strictEqual(run(dir, p, 'ddev config').status, 0);
    const again = yaml.load(read(p, 'compose.yaml')).services;
    for (const name of ['cache', 'queue', 'store']) assert.strictEqual(again[name].restart, 'on-failure', `${runtime}: ${name} written again`);
  }
  // No service, no policy: compose.yaml is what it was.
  const bare = project(dir, 'docker', 'restart-bare');
  assert.doesNotMatch(read(bare, 'compose.yaml'), /restart:/);
});

test('no database: the services keep their volumes, and the database\'s goes', () => {
  const dir = sandbox();
  const p = project(dir, 'docker', 'nodb', { db: '--omit-containers=db' });
  assert.strictEqual(run(dir, p, THREE).status, 0);
  const compose = yaml.load(read(p, 'compose.yaml'));
  assert.deepStrictEqual(compose.volumes, { 'svc-queue': null, 'svc-store': null });
  assert.strictEqual(compose.services.db, undefined);
  assert.deepStrictEqual(Object.keys(compose.services.web.depends_on), ['cache', 'queue', 'store']);
  const bare = project(dir, 'docker', 'nodb-bare', { db: '--omit-containers=db' });
  assert.strictEqual(yaml.load(read(bare, 'compose.yaml')).volumes, undefined, 'no database and no service: no volumes at all, as before');
});

test('Kubernetes: a Deployment, a ClusterIP Service and a PVC per service in the namespace, its env file a Secret of the kustomization', () => {
  const dir = sandbox();
  const p = project(dir, 'kubernetes', 'kube');
  const r = run(dir, p, THREE);
  assert.strictEqual(r.status, 0, r.out);
  const kust = yaml.load(read(p, 'k8s', 'kustomization.yaml'));
  assert.strictEqual(kust.namespace, 'ws-kube');
  assert.deepStrictEqual(kust.resources, ['stack.yaml', 'services.yaml']);
  assert.deepStrictEqual(kust.secretGenerator, [{ name: 'queue-env', envs: ['services/queue.env'] }, { name: 'store-env', envs: ['services/store.env'] }]);
  for (const s of ['queue', 'store']) {
    const st = fs.statSync(path.join(p, 'k8s', 'services', `${s}.env`));
    assert.strictEqual(st.mode & 0o777, 0o600, `${s}: the copy of its env file is the owner's only`);
  }
  assert.strictEqual(read(p, 'k8s', 'services', 'queue.env'), read(p, 'app', 'queue.env'));
  const docs = yaml.loadAll(read(p, 'k8s', 'services.yaml')).filter(Boolean);
  const of = (kind, name) => docs.find((d) => d.kind === kind && d.metadata.name === name);
  assert.deepStrictEqual(docs.map((d) => `${d.kind}/${d.metadata.name}`), [
    'Deployment/cache', 'Service/cache',
    'PersistentVolumeClaim/svc-queue', 'Deployment/queue', 'Service/queue',
    'PersistentVolumeClaim/svc-store', 'Deployment/store', 'Service/store',
  ]);
  assert.ok(docs.every((d) => !d.metadata.namespace), 'the kustomization puts them in the project\'s namespace');
  const store = of('Deployment', 'store').spec.template.spec;
  assert.deepStrictEqual(store.containers[0].args, ['server', '/export', '--console-address', ':9090', '--note', '$HOME'], 'the command as the image\'s arguments');
  assert.deepStrictEqual(store.containers[0].envFrom, [{ secretRef: { name: 'store-env' } }]);
  assert.deepStrictEqual(store.containers[0].volumeMounts, [{ name: 'data', mountPath: '/export' }]);
  assert.deepStrictEqual(store.volumes, [{ name: 'data', persistentVolumeClaim: { claimName: 'svc-store' } }]);
  assert.strictEqual(store.enableServiceLinks, false);
  assert.strictEqual(of('Deployment', 'store').spec.strategy.type, 'Recreate', 'one pod at a time on its volume');
  assert.deepStrictEqual(of('Service', 'queue').spec, { selector: { app: 'queue' }, ports: [{ port: 5672 }] });
  assert.strictEqual(of('Service', 'queue').spec.type, undefined, 'ClusterIP: inside the project only');
  const cache = of('Deployment', 'cache').spec.template.spec.containers[0];
  assert.deepStrictEqual([cache.image, cache.imagePullPolicy, cache.args, cache.envFrom, cache.volumeMounts], ['docker.io/valkey/valkey:7.2.11-alpine', 'IfNotPresent', undefined, undefined, undefined]);
  // Written again, they stay; a service taken away takes its manifests and its copy with it.
  assert.strictEqual(run(dir, p, 'ddev config > /dev/null').status, 0);
  assert.strictEqual(yaml.loadAll(read(p, 'k8s', 'services.yaml')).filter(Boolean).length, 8);
  removeInSandbox(path.join(p, '.webship', 'runtime', 'services', 'store.yaml'));
  assert.strictEqual(run(dir, p, 'ddev config > /dev/null').status, 0);
  assert.ok(!fs.existsSync(path.join(p, 'k8s', 'services', 'store.env')));
  assert.deepStrictEqual(yaml.load(read(p, 'k8s', 'kustomization.yaml')).secretGenerator, [{ name: 'queue-env', envs: ['services/queue.env'] }]);
  // An empty root never reaches /k8s: the writer stops at its removal, with nothing removed and nothing written after.
  const empty = run(dir, p, 'rt_k8s_services "" ; echo went-on');
  assert.notStrictEqual(empty.status, 0);
  assert.match(empty.out, /root: parameter null or not set/);
  assert.doesNotMatch(empty.out, /went-on/);
  assert.ok(fs.existsSync(path.join(p, 'k8s', 'services', 'queue.env')), 'the project\'s own copy is still there');
});

test('what rt_service refuses, before anything is written; on DDEV it does nothing', () => {
  const dir = sandbox();
  const p = project(dir, 'docker', 'refused');
  const cases = [
    ['rt_service cache docker.io/valkey/valkey', /a pinned image/],
    ['rt_service cache docker.io/valkey/valkey:latest', /a pinned image/],
    ['rt_service cache', /a pinned image/],
    ['rt_service web docker.io/library/nginx:1.29.3-alpine', /a service of the stack's own/],
    ['rt_service db docker.io/library/postgres:16', /a service of the stack's own/],
    ['rt_service Cache docker.io/valkey/valkey:7.2.11-alpine', /a name, please/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --port 99999', /--port takes the port/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --env-file ../outside.env', /--env-file takes a file of the project/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --env-file /etc/passwd', /--env-file takes a file of the project/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --volume data', /--volume takes the folder/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --memory 1g', /is not an option of it/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --port', /takes a value/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --nofile', /takes a value/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --nofile 65536x', /--nofile takes the open-files limit, a number from 1024 to 1048576/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --nofile 512', /--nofile takes the open-files limit/],
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --nofile 2097152', /--nofile takes the open-files limit/],
    // YAML would read a leading zero as an octal number.
    ['rt_service cache docker.io/valkey/valkey:7.2.11-alpine --nofile 065536', /--nofile takes the open-files limit/],
  ];
  for (const [call, said] of cases) {
    const r = run(dir, p, call);
    assert.notStrictEqual(r.status, 0, call);
    assert.match(r.out, said, call);
  }
  assert.ok(!fs.existsSync(path.join(p, '.webship', 'runtime', 'services')), 'nothing was written');
  assert.doesNotMatch(read(p, 'compose.yaml'), /rt_service/);
  // A DDEV project brings its own .ddev/docker-compose.<name>.yaml: rt_service writes nothing there.
  const d = path.join(dir, 'on-ddev');
  fs.mkdirSync(path.join(d, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(d, '.ddev', 'config.yaml'), 'name: on-ddev\ntype: generic\n');
  const r = run(dir, d, ONE);
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(!fs.existsSync(path.join(d, '.webship')), 'nothing written on DDEV');
  // Lando and Docksal write no service of a project's own yet: refused, so a plugin knows, rather than left out.
  const l = path.join(dir, 'on-lando');
  fs.mkdirSync(l);
  fs.writeFileSync(path.join(l, '.lando.yml'), 'name: on-lando\nrecipe: lamp\n');
  const lando = run(dir, l, ONE);
  assert.notStrictEqual(lando.status, 0);
  assert.match(lando.out, /a service of the project's own is written on Docker Compose, Podman and Kubernetes, not on lando yet/);
  assert.ok(!fs.existsSync(path.join(l, '.webship')), 'nothing written on Lando');
});

// The open-files limit of a service of the project's own (webship/workspace#982). Erlang sizes its tables to it: on
// kind, which gives every pod the kernel's highest (1073741816), RabbitMQ 3.8 took 1.6 GB.
const NOFILE = 'rt_service queue docker.io/library/rabbitmq:3.8.34-management-alpine --port 5672 --nofile 65536';

/** A stand-in docker (or podman) that answers `image inspect` for the images it is given, as their config; the rest are not here. */
function inspectingDocker(dir, configs, { pulled = [], cli = 'docker' } = {}) {
  const lines = ['#!/usr/bin/env bash', `echo "${cli} $*" >> "${dir}/calls.log"`, 'case "$*" in'];
  for (const [image, config] of Object.entries(configs)) {
    const here = pulled.includes(image) ? `[ -f "${dir}/pulled" ] || exit 1 ; ` : '';
    lines.push(`  "image inspect --format {{json .Config}} ${image}") ${here}printf '%s\\n' '${JSON.stringify(config)}' ;;`);
    lines.push(`  "image inspect ${image}") ${here}true ;;`);
    lines.push(`  "pull -q ${image}") touch "${dir}/pulled" ;;`);
  }
  lines.push('  "image inspect "*) exit 1 ;;', '  "pull "*) exit 1 ;;', 'esac', 'true', '');
  fs.writeFileSync(path.join(dir, 'bin', cli), lines.join('\n'), { mode: 0o755 });
}

const RABBITMQ = { 'docker.io/library/rabbitmq:3.8.34-management-alpine': { Entrypoint: ['docker-entrypoint.sh'], Cmd: ['rabbitmq-server'], WorkingDir: '' } };
const lower = (n) => ['sh', '-c', `ulimit -n ${n} || echo "the open-files limit stays as the runtime gives it" >&2 ; exec "$0" "$@"`];

test('--nofile on Docker Compose: the open-files limit, soft and hard, in compose.yaml, and the image\'s own start; kept when written again (#982)', () => {
  const dir = sandbox();
  const p = project(dir, 'docker', 'nofile-docker');
  const r = run(dir, p, NOFILE);
  assert.strictEqual(r.status, 0, r.out);
  assert.match(read(p, '.webship', 'runtime', 'services', 'queue.yaml'), /\nport: 5672\nnofile: 65536\n$/);
  const queue = yaml.load(read(p, 'compose.yaml')).services.queue;
  assert.deepStrictEqual(queue.ulimits, { nofile: { soft: 65536, hard: 65536 } });
  assert.deepStrictEqual([queue.entrypoint, queue.command], [undefined, undefined], 'Docker keeps the ulimits: the image\'s own start');
  assert.deepStrictEqual(r.calls.filter((c) => /^docker (image inspect|pull)/.test(c)), [], 'no image is read');
  assert.strictEqual(run(dir, p, 'ddev config > /dev/null').status, 0);
  assert.deepStrictEqual(yaml.load(read(p, 'compose.yaml')).services.queue.ulimits, { nofile: { soft: 65536, hard: 65536 } }, 'written again');
  // A service without it has no ulimits: what it had before.
  assert.strictEqual(run(dir, p, ONE).status, 0);
  assert.strictEqual(yaml.load(read(p, 'compose.yaml')).services.cache.ulimits, undefined);
});

test('--nofile on Podman: the ulimits, and the start lowers the limit too, since Podman drops them; an image with no start stops the writing (#982)', () => {
  const dir = sandbox();
  inspectingDocker(dir, { ...RABBITMQ, 'docker.io/library/nginx:1.29.3-alpine': { Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['nginx', '-g', 'daemon off;'] }, 'docker.io/library/scratchy:1.0.0': { Entrypoint: null, Cmd: null } }, { cli: 'podman' });
  const p = project(dir, 'podman', 'nofile-podman');
  const r = run(dir, p, `${NOFILE} && rt_service proxy docker.io/library/nginx:1.29.3-alpine --port 8080 --nofile 4096 --command 'nginx -c /etc/nginx/alt.conf -g "pid $HOME/n.pid;"'`);
  assert.strictEqual(r.status, 0, r.out);
  const text = read(p, 'compose.yaml');
  const services = yaml.load(text).services;
  // compose reads a $ as one of its variables: the shell's $0 and $@ are $$0 and $$@ in compose.yaml.
  const escaped = (words) => words.map((w) => w.replace(/\$/g, '$$$$'));
  assert.deepStrictEqual([services.queue.ulimits, services.queue.entrypoint, services.queue.command],
    [{ nofile: { soft: 65536, hard: 65536 } }, escaped(lower(65536)), ['docker-entrypoint.sh', 'rabbitmq-server']]);
  assert.deepStrictEqual([services.proxy.entrypoint, services.proxy.command],
    [escaped(lower(4096)), ['/docker-entrypoint.sh', 'nginx', '-c', '/etc/nginx/alt.conf', '-g', 'pid $$HOME/n.pid;']], 'the entrypoint, then its --command');
  assert.match(text, /\n {4}# The start lowers the open-files limit, then runs the image's own \(#982\): Podman drops ulimits\.\n {4}entrypoint: /);
  assert.ok(r.calls.includes('podman image inspect --format {{json .Config}} docker.io/library/rabbitmq:3.8.34-management-alpine'), 'read with Podman');
  // Refused before anything is written; written before, `ddev config` fails and keeps compose.yaml as it was.
  const before = read(p, 'compose.yaml');
  const none = run(dir, p, 'rt_service empty docker.io/library/scratchy:1.0.0 --nofile 65536');
  assert.notStrictEqual(none.status, 0, none.out);
  assert.match(none.out, /rt_service: empty: --nofile on Podman runs the image's own start after the limit, and docker\.io\/library\/scratchy:1\.0\.0 gave none/);
  assert.ok(!fs.existsSync(path.join(p, '.webship', 'runtime', 'services', 'empty.yaml')));
  fs.writeFileSync(path.join(p, '.webship', 'runtime', 'services', 'empty.yaml'), 'image: docker.io/library/scratchy:1.0.0\nnofile: 65536\n');
  const again = run(dir, p, 'ddev config');
  assert.notStrictEqual(again.status, 0, again.out);
  assert.match(again.out, /rt_service: empty: --nofile on Podman runs the image's own start after the limit/);
  assert.doesNotMatch(again.out, /Wrote compose\.yaml/);
  assert.strictEqual(read(p, 'compose.yaml'), before, 'compose.yaml as it was');
});

test('--nofile on Kubernetes: the start lowers the limit, then runs the image\'s own entrypoint and command, or its --command (#982)', () => {
  const dir = sandbox();
  inspectingDocker(dir, {
    'docker.io/library/rabbitmq:3.8.34-management-alpine': { Entrypoint: ['docker-entrypoint.sh'], Cmd: ['rabbitmq-server'], WorkingDir: '' },
    'docker.io/library/nginx:1.29.3-alpine': { Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['nginx', '-g', 'daemon off;'] },
    'docker.io/valkey/valkey:7.2.11-alpine': { Entrypoint: null, Cmd: ['valkey-server'] },
  }, { pulled: ['docker.io/valkey/valkey:7.2.11-alpine'] });
  const p = project(dir, 'kubernetes', 'kube-nofile');
  const r = run(dir, p, `${NOFILE} && rt_service proxy docker.io/library/nginx:1.29.3-alpine --port 8080 --nofile 4096 --command 'nginx -g "daemon off;" -c /etc/nginx/alt.conf'`
    + ' && rt_service cache docker.io/valkey/valkey:7.2.11-alpine --port 6379 --nofile 10240');
  assert.strictEqual(r.status, 0, r.out);
  const docs = yaml.loadAll(read(p, 'k8s', 'services.yaml')).filter(Boolean);
  const container = (name) => docs.find((d) => d.kind === 'Deployment' && d.metadata.name === name).spec.template.spec.containers[0];
  assert.deepStrictEqual([container('queue').command, container('queue').args], [lower(65536), ['docker-entrypoint.sh', 'rabbitmq-server']], 'the image\'s entrypoint and command');
  assert.deepStrictEqual([container('proxy').command, container('proxy').args], [lower(4096), ['/docker-entrypoint.sh', 'nginx', '-g', 'daemon off;', '-c', '/etc/nginx/alt.conf']], 'the image\'s entrypoint, then its --command');
  assert.deepStrictEqual([container('cache').command, container('cache').args], [lower(10240), ['valkey-server']], 'no entrypoint: the command alone');
  // Read with the engine that builds for the cluster; an image not on this machine is fetched once, and said.
  assert.ok(r.calls.includes('docker pull -q docker.io/valkey/valkey:7.2.11-alpine'), r.calls.join('\n'));
  assert.ok(!r.calls.some((c) => c.startsWith('docker pull -q docker.io/library/rabbitmq')), 'an image that is here is not fetched');
  assert.match(r.out, /reading the start of docker\.io\/valkey\/valkey:7\.2\.11-alpine for its open-files limit: fetching the image once/);
  // Written again, it stays; a service without --nofile keeps the image's own start, with no command.
  assert.strictEqual(run(dir, p, 'ddev config > /dev/null').status, 0);
  assert.deepStrictEqual(yaml.loadAll(read(p, 'k8s', 'services.yaml')).filter(Boolean).find((d) => d.kind === 'Deployment' && d.metadata.name === 'queue').spec.template.spec.containers[0].command, lower(65536));
  assert.strictEqual(run(dir, p, "rt_service store docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z --port 9000 --command 'server /export'").status, 0);
  const store = yaml.loadAll(read(p, 'k8s', 'services.yaml')).filter(Boolean).find((d) => d.kind === 'Deployment' && d.metadata.name === 'store').spec.template.spec.containers[0];
  assert.deepStrictEqual([store.command, store.args], [undefined, ['server', '/export']]);
});

test('--nofile on Kubernetes: an image that gives no start of its own, or cannot be read, is refused before anything is written; written before, `ddev config` fails (#982)', () => {
  const dir = sandbox();
  inspectingDocker(dir, { 'docker.io/library/scratchy:1.0.0': { Entrypoint: null, Cmd: null } });
  const p = project(dir, 'kubernetes', 'kube-nostart');
  const none = run(dir, p, 'rt_service empty docker.io/library/scratchy:1.0.0 --nofile 65536');
  assert.notStrictEqual(none.status, 0, none.out);
  assert.match(none.out, /rt_service: empty: --nofile on Kubernetes runs the image's own start after the limit, and docker\.io\/library\/scratchy:1\.0\.0 gave none/);
  const unknown = run(dir, p, 'rt_service gone docker.io/library/gone:1.0.0 --nofile 65536');
  assert.notStrictEqual(unknown.status, 0, unknown.out);
  assert.match(unknown.out, /rt_service: gone: --nofile on Kubernetes runs the image's own start after the limit, and docker\.io\/library\/gone:1\.0\.0 gave none/);
  assert.ok(!fs.existsSync(path.join(p, '.webship', 'runtime', 'services')), 'refused before anything is written');
  assert.ok(!fs.existsSync(path.join(p, 'k8s', 'services.yaml')));
  // A service written before (by hand, or on another runtime) whose image gives none: `ddev config` says so and fails.
  fs.mkdirSync(path.join(p, '.webship', 'runtime', 'services'), { recursive: true });
  fs.writeFileSync(path.join(p, '.webship', 'runtime', 'services', 'empty.yaml'), 'image: docker.io/library/scratchy:1.0.0\nnofile: 65536\n');
  const again = run(dir, p, 'ddev config');
  assert.notStrictEqual(again.status, 0, again.out);
  assert.match(again.out, /rt_service: empty: --nofile on Kubernetes runs the image's own start after the limit/);
  assert.doesNotMatch(again.out, /Wrote compose\.yaml and k8s\//, 'not said to be written');
  // With a --command, an image with no entrypoint of its own runs the command alone.
  removeInSandbox(path.join(p, '.webship', 'runtime', 'services'));
  const own = run(dir, p, "rt_service empty docker.io/library/scratchy:1.0.0 --nofile 65536 --command '/bin/serve --port 80'");
  assert.strictEqual(own.status, 0, own.out);
  const c = yaml.loadAll(read(p, 'k8s', 'services.yaml')).filter(Boolean).find((d) => d.kind === 'Deployment').spec.template.spec.containers[0];
  assert.deepStrictEqual(c.args, ['/bin/serve', '--port', '80']);
});

test('the start --nofile writes on Kubernetes lowers the limit of what it runs, and runs it in its place (#982)', () => {
  const lowered = spawnSync('bash', ['-c', `source ${SCRIPTS}/functions/fun-runtime.sh ; rt_nofile_command 2048`], { encoding: 'utf8' });
  assert.strictEqual(lowered.status, 0, lowered.stderr);
  const command = JSON.parse(lowered.stdout);
  // As the container runs it: the command, then the arguments (here a shell that says its limits and its pid).
  const r = spawnSync(command[0], [...command.slice(1), 'sh', '-c', 'echo "$(ulimit -Sn) $(ulimit -Hn) $$ $PPID"'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const [soft, hard] = r.stdout.trim().split(' ');
  assert.deepStrictEqual([soft, hard], ['2048', '2048'], 'soft and hard, lowered');
  // A limit above what the process may have is said, and the start goes on with the limit it has.
  const hardNow = Number(spawnSync('sh', ['-c', 'ulimit -Hn'], { encoding: 'utf8' }).stdout.trim());
  const above = JSON.parse(spawnSync('bash', ['-c', `source ${SCRIPTS}/functions/fun-runtime.sh ; rt_nofile_command ${hardNow + 1}`], { encoding: 'utf8' }).stdout);
  const kept = spawnSync(above[0], [...above.slice(1), 'sh', '-c', 'ulimit -Hn'], { encoding: 'utf8' });
  assert.strictEqual(kept.status, 0, kept.stderr);
  assert.strictEqual(kept.stdout.trim(), String(hardNow));
  assert.match(kept.stderr, /the open-files limit stays as the runtime gives it/);
});

test('removal takes the services\' volumes: `ddev delete` is compose\'s down -v of the project, and the leftovers go by its label', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const p = project(dir, runtime, `gone-${runtime}`);
    assert.strictEqual(run(dir, p, THREE).status, 0);
    const r = run(dir, p, 'ddev delete -y -O', { WORKSPACE_RUNTIME: runtime });
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(r.calls.includes(`${runtime} compose down -v --remove-orphans`), `${runtime}: ${r.calls.join(' | ')}`);
  }
  // The core's removal of a project, when its engine still holds something: by the compose project's label, which
  // compose puts on the services' volumes too; never a volume or an image by a name of its own.
  const remove = read(SCRIPTS, 'functions', 'fun-remove-project.sh');
  assert.match(remove, /"\$\{engine\}" volume ls --filter "label=com\.docker\.compose\.project=\$\{name\}" -q 2> \/dev\/null \| xargs -r "\$\{engine\}" volume rm -f/);
  const layer = read(SCRIPTS, 'functions', 'fun-runtime.sh');
  const services = layer.slice(layer.indexOf('function rt_service()'), layer.indexOf('function rt_is_platform()'));
  assert.doesNotMatch(services, /docker (volume|image|rmi)|podman (volume|image|rmi)/, 'rt_service touches no volume and no image of the machine');
});
