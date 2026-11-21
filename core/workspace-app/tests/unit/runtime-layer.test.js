/**
 * The runtime layer (webship/workspace#694): a project runs on DDEV, Docker Compose or Podman, and the builders,
 * tools and menus keep speaking DDEV's verbs. On a DDEV project `ddev` is DDEV itself; on another runtime the
 * `ddev` function of fun-runtime.sh gives each verb its meaning there.
 *
 * A stand-in docker/podman/ddev on PATH records what each verb becomes.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kubectl', 'kind']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\n`, { mode: 0o755 });
  }
  return dir;
}

/** Runs `script` with the layer sourced in `cwd`; returns its output and the recorded calls. */
function run(dir, cwd, script, env = {}) {
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ${script}`],
    { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), ...env } });
  const log = path.join(dir, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { out: r.stdout + r.stderr, calls, status: r.status };
}

test('a DDEV project: every verb is DDEV itself, unchanged', () => {
  const dir = sandbox();
  const p = path.join(dir, 'site'); fs.mkdirSync(path.join(p, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), 'name: site\ntype: drupal11\n');
  const r = run(dir, p, 'runtime_of; ddev composer install; ddev drush cr; ddev exec "ls -la"; rt_url');
  assert.match(r.out, /^ddev$/m);
  assert.deepStrictEqual(r.calls, ['ddev composer install', 'ddev drush cr', 'ddev exec ls -la']);
  assert.match(r.out, /https:\/\/site\.ddev\.site/);
});

test('a new build takes --runtime (WORKSPACE_RUNTIME), else settings, else DDEV', () => {
  const dir = sandbox();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-new-'));
  assert.match(run(dir, empty, 'runtime_of').out, /^ddev$/m);
  assert.match(run(dir, empty, 'container_runtime=podman; runtime_of').out, /^podman$/m);
  assert.match(run(dir, empty, 'runtime_of', { WORKSPACE_RUNTIME: 'docker' }).out, /^docker$/m);
});

test('docker: `ddev config` writes compose.yaml with the stack, and the project is then a Docker project', () => {
  const dir = sandbox();
  const p = path.join(dir, 'd1'); fs.mkdirSync(p);
  const r = run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=d1 --php-version=8.3 --database=mariadb:10.11 --auto; runtime_of; rt_url', { WORKSPACE_RUNTIME: 'docker' });
  const compose = fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8');
  assert.match(compose, /^name: d1$/m);
  assert.match(compose, /^x-webship:\n {2}runtime: docker\n {2}stack: php\n {2}type: drupal\n {2}docroot: "web"\n {2}php: "8\.3"\n {2}database: "10\.11"\n {2}port: \d+$/m);
  assert.match(compose, /APACHE_DOCUMENT_ROOT: \/var\/www\/html\/web/);
  assert.match(compose, /image: mariadb:10\.11/);
  assert.ok(fs.existsSync(path.join(p, '.webship', 'runtime', 'Dockerfile')), 'the stack image');
  assert.match(r.out, /^docker$/m);
  assert.match(r.out, /http:\/\/127\.0\.0\.1:\d+/);
  assert.deepStrictEqual(r.calls, [], 'config only writes files');
});

test('docker: each verb becomes its docker compose command, in the folder the builder is in', () => {
  const dir = sandbox();
  const p = path.join(dir, 'd2'); fs.mkdirSync(path.join(p, 'web'), { recursive: true });
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=d2', { WORKSPACE_RUNTIME: 'docker' });
  const r = run(dir, path.join(p, 'web'), [
    'ddev start', 'ddev composer require drush/drush', 'ddev drush site:install -y', 'ddev exec "php -v"',
    'ddev exec -s db "mariadb --version"', 'ddev mysql -e "select 1"', 'ddev stop', 'ddev delete -y -O',
  ].join('; '));
  assert.deepStrictEqual(r.calls, [
    'docker compose up -d --build --wait',
    'docker compose exec -T -u www-data -w /var/www/html/web web composer require drush/drush',
    'docker compose exec -T -u www-data -w /var/www/html web /var/www/html/vendor/bin/drush site:install -y',
    'docker compose exec -T -u www-data -w /var/www/html/web web bash -c php -v',
    'docker compose exec -T -u root -w /var/www/html/web db bash -c mariadb --version',
    'docker compose exec -T db mariadb -udb -pdb db -e select 1',
    'docker compose stop',
    'docker compose down -v --remove-orphans',
  ]);
});

test('docker: the database goes out and back in through the db service', () => {
  const dir = sandbox();
  const p = path.join(dir, 'd3'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=d3', { WORKSPACE_RUNTIME: 'docker' });
  fs.writeFileSync(path.join(dir, 'dump.sql'), 'select 1;\n');
  const r = run(dir, p, `ddev export-db --file=${dir}/out.sql.gz; ddev import-db --file=${dir}/dump.sql`);
  assert.deepStrictEqual(r.calls, ['docker compose exec -T db mariadb-dump -udb -pdb db', 'docker compose exec -T db mariadb -udb -pdb db']);
  assert.ok(fs.existsSync(path.join(dir, 'out.sql.gz')));
});

test('podman: the same compose file, run with podman compose', () => {
  const dir = sandbox();
  const p = path.join(dir, 'pd'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=pd', { WORKSPACE_RUNTIME: 'podman' });
  assert.match(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8'), /^ {2}runtime: podman$/m);
  const r = run(dir, p, 'ddev start; ddev composer install');
  assert.deepStrictEqual(r.calls, ['podman compose up -d --build --wait', 'podman compose exec -T -u www-data -w /var/www/html web composer install']);
});

test('drupal on a container runtime: settings.php includes the runtime\'s database file, with no $databases in settings.php', () => {
  const dir = sandbox();
  const p = path.join(dir, 'd4'); const sd = path.join(p, 'web', 'sites', 'default'); fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, 'default.settings.php'), '<?php\n$settings = [];\n');
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=d4', { WORKSPACE_RUNTIME: 'docker' });
  run(dir, p, 'ddev start; ddev restart');
  const settings = fs.readFileSync(path.join(sd, 'settings.php'), 'utf8');
  assert.strictEqual((settings.match(/settings\.webship-runtime\.php/g) || []).length, 2, 'included once, on a second start too');
  assert.doesNotMatch(settings, /\$databases/);
  assert.match(fs.readFileSync(path.join(sd, 'settings.webship-runtime.php'), 'utf8'), /'host' => 'db'/);
});

test('kubernetes: config writes compose.yaml and k8s/ manifests, and each verb becomes kubectl in the project\'s namespace', () => {
  const dir = sandbox();
  const p = path.join(dir, 'k1'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=k1 --php-version=8.3', { WORKSPACE_RUNTIME: 'kubernetes' });
  assert.match(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8'), /^ {2}runtime: kubernetes$/m);
  assert.match(fs.readFileSync(path.join(p, 'k8s', 'kustomization.yaml'), 'utf8'), /^namespace: ws-k1$/m);
  const stack = fs.readFileSync(path.join(p, 'k8s', 'stack.yaml'), 'utf8');
  for (const kind of ['Namespace', 'PersistentVolumeClaim', 'Deployment', 'Service']) assert.match(stack, new RegExp(`^kind: ${kind}$`, 'm'));
  assert.match(stack, /image: webship-k1-web\n\s+imagePullPolicy: Never/);
  assert.match(stack, new RegExp(`hostPath: \\{path: ${p}, type: Directory\\}`));
  assert.match(stack, /type: NodePort/);
  const r = run(dir, p, 'ddev drush cr; ddev mysql -e "select 1"; ddev stop; ddev logs');
  assert.deepStrictEqual(r.calls, [
    'kubectl --context kind-webship -n ws-k1 exec -i deploy/web -c web -- runuser -u www-data -- bash -c cd /var/www/html && vendor/bin/drush cr ',
    'kubectl --context kind-webship -n ws-k1 exec -i deploy/db -c db -- mariadb -udb -pdb db -e select 1',
    'kubectl --context kind-webship -n ws-k1 scale deploy --all --replicas=0',
    'kubectl --context kind-webship -n ws-k1 logs deploy/web --tail 200',
  ]);
  const own = run(dir, p, 'ddev stop', { WORKSPACE_KUBE_CONTEXT: 'my-cluster' });
  assert.deepStrictEqual(own.calls, ['kubectl --context my-cluster -n ws-k1 scale deploy --all --replicas=0'], 'a cluster of your own, by its context');
});
