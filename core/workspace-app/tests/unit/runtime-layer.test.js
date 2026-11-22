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

test('a template that ships .ddev/: the project stays on the runtime the Workspace built it on', () => {
  const dir = sandbox();
  const p = path.join(dir, 'site'); fs.mkdirSync(path.join(p, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(p, 'compose.yaml'), 'name: site\nx-webship:\n  runtime: docker\n  type: drupal\n  port: 41555\nservices:\n  web:\n    image: x\n');
  // What `composer create-project drupal/webship_project` copies in after `ddev config` wrote compose.yaml.
  fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), 'type: drupal11\ndocroot: web\n');
  const r = run(dir, p, 'runtime_of; ddev drush status; rt_url');
  assert.match(r.out, /^docker$/m);
  assert.ok(r.calls.length > 0 && r.calls.every((c) => c.startsWith('docker ')), r.calls.join(' | '));
  assert.match(r.out, /http:\/\/127\.0\.0\.1:41555/);
  // A DDEV project that has a compose file of its own, without the block, is still DDEV.
  const d = path.join(dir, 'plain'); fs.mkdirSync(path.join(d, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(d, '.ddev', 'config.yaml'), 'name: plain\n');
  fs.writeFileSync(path.join(d, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n');
  assert.match(run(dir, d, 'runtime_of').out, /^ddev$/m);
});

test('drush runs from the bin-dir of Composer: bin/ when the project says so, else vendor/bin', () => {
  const dir = sandbox();
  const p = path.join(dir, 'site'); fs.mkdirSync(p);
  fs.writeFileSync(path.join(p, 'compose.yaml'), 'name: site\nx-webship:\n  runtime: docker\n  type: drupal\n  port: 41556\nservices:\n  web:\n    image: x\n');
  assert.match(run(dir, p, 'ddev drush status').calls.join('\n'), /web \/var\/www\/html\/vendor\/bin\/drush status$/);
  fs.writeFileSync(path.join(p, 'composer.json'), JSON.stringify({ config: { 'bin-dir': 'bin/' } }));
  assert.match(run(dir, p, 'ddev drush status').calls.join('\n'), /web \/var\/www\/html\/bin\/drush status$/);
  // A bin-dir that is not a plain path inside the project is not used.
  for (const bad of ['../x', '$(id)', 'a b']) {
    fs.writeFileSync(path.join(p, 'composer.json'), JSON.stringify({ config: { 'bin-dir': bad } }));
    assert.match(run(dir, p, 'rt_bin_dir "$PWD"').out, /^vendor\/bin$/m, bad);
  }
});

test('the php stack: the database clients skip SSL even when a tool gives them its own defaults file', () => {
  // Drush runs `mysql --defaults-file=<its own>`, which leaves /etc/mysql out; the stack's database has no TLS.
  const dockerfile = fs.readFileSync(path.join(STACKS, 'php', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /for b in mysql mariadb mysqldump mariadb-dump ; do printf '#!\/bin\/sh\\nexec \/usr\/bin\/%s "\$@" --skip-ssl\\n' "\$b" > \/usr\/local\/bin\/\$b/);
  assert.match(dockerfile, /PATH=\/var\/www\/html\/vendor\/bin:\/var\/www\/html\/bin:\$PATH/);
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
  assert.doesNotMatch(compose, /userns_mode|user: "0:0"/, 'Docker keeps its own user mapping');
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
  // Rootless Podman: the web service keeps the host user (so it can write the project folder), and starts as root
  // inside so Apache can bind port 80. Found on a real Podman 4.9.3 build; Docker's file has neither line.
  assert.match(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8'), /image: webship-pd-web\n {4}userns_mode: keep-id\n {4}user: "0:0"\n {4}environment:/);
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

/* ---- What the dashboard's tools need of the layer (the row, the Tests menu, backup, restore, remove) ---- */

test('describe -j answers in DDEV\'s shape, so the tools read the state and the address as they do from DDEV', () => {
  const dir = sandbox();
  const p = path.join(dir, 'dj'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=dj', { WORKSPACE_RUNTIME: 'docker' });
  const port = fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8').match(/^ {2}port: (\d+)$/m)[1];
  // The stand-in prints nothing: no running web container.
  const stopped = run(dir, p, 'ddev describe -j');
  assert.match(stopped.out, new RegExp(`^\\{"raw":\\{"name":"dj","status":"stopped","primary_url":"http://127\\.0\\.0\\.1:${port}","runtime":"docker"\\}\\}$`, 'm'));
  assert.deepStrictEqual(stopped.calls, ['docker compose ps --status running -q web']);
  // One that answers with a container id: running.
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${dir}/calls.log"\ncase "$*" in *"ps --status running -q web"*) echo abc123 ;; esac\n`, { mode: 0o755 });
  const running = run(dir, p, 'ddev describe --json-output | grep -c \'"status":"running"\'');
  assert.match(running.out, /^1$/m, 'the exact text fun-testing.sh looks for');

  const k = path.join(dir, 'kj'); fs.mkdirSync(k);
  fs.writeFileSync(path.join(dir, 'bin', 'kubectl'), `#!/usr/bin/env bash\necho "kubectl $*" >> "${dir}/calls.log"\ncase "$*" in *"get deploy web"*) printf 1 ;; *"get nodes"*) printf 172.18.0.2 ;; *"get svc"*) printf '' ;; esac\n`, { mode: 0o755 });
  run(dir, k, 'ddev config --project-type=drupal --docroot=web --project-name=kj', { WORKSPACE_RUNTIME: 'kubernetes' });
  const kube = run(dir, k, 'ddev describe -j');
  assert.match(kube.out, /^\{"raw":\{"name":"kj","status":"running","primary_url":"http:\/\/172\.18\.0\.2:\d+","runtime":"kubernetes"\}\}$/m);
});

test('the JS side runs in the tests container: npm, npx, node, yarn and `exec -s tests`, on Docker, Podman and Kubernetes', () => {
  const dir = sandbox();
  const uid = `${process.getuid()}:${process.getgid()}`;
  const d = path.join(dir, 'dn'); fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
  run(dir, d, 'ddev config --project-type=drupal --docroot=web --project-name=dn', { WORKSPACE_RUNTIME: 'docker' });
  const port = fs.readFileSync(path.join(d, 'compose.yaml'), 'utf8').match(/^ {2}port: (\d+)$/m)[1];
  const tail = `--user ${uid} -v ${d}:${d} -v webship-workspace-tests:/cache`;
  const r = run(dir, d, 'ddev npm install; ddev exec -s tests "BROWSER=chromium node ./x.js"; cd tests && ddev npx playwright install chromium; ddev php -v');
  assert.deepStrictEqual(r.calls, [
    'docker image inspect webship-workspace-tests',
    `docker run --rm --network host ${tail} -w ${d} -e LAUNCH_URL=http://127.0.0.1:${port} webship-workspace-tests bash -c npm install `,
    'docker image inspect webship-workspace-tests',
    `docker run --rm --network host ${tail} -w ${d} -e LAUNCH_URL=http://127.0.0.1:${port} webship-workspace-tests bash -c BROWSER=chromium node ./x.js`,
    'docker image inspect webship-workspace-tests',
    `docker run --rm --network host ${tail} -w ${d}/tests -e LAUNCH_URL=http://127.0.0.1:${port} webship-workspace-tests bash -c npx playwright install chromium `,
    // PHP stays in the web container.
    'docker compose exec -T -u www-data -w /var/www/html/tests web php -v',
  ]);

  const p = path.join(dir, 'pn'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=pn', { WORKSPACE_RUNTIME: 'podman' });
  const pod = run(dir, p, 'ddev yarn install');
  assert.strictEqual(pod.calls[0], 'podman image inspect webship-workspace-tests');
  assert.match(pod.calls[1], /^podman run --rm --network host --userns=keep-id --user \d+:\d+ -v .* webship-workspace-tests bash -c yarn install ?$/, 'podman runs it, as the host user');

  const k = path.join(dir, 'kn'); fs.mkdirSync(k);
  fs.writeFileSync(path.join(dir, 'bin', 'kubectl'), `#!/usr/bin/env bash\necho "kubectl $*" >> "${dir}/calls.log"\ncase "$*" in *"get nodes"*) printf 172.18.0.2 ;; esac\n`, { mode: 0o755 });
  run(dir, k, 'ddev config --project-type=drupal --docroot=web --project-name=kn', { WORKSPACE_RUNTIME: 'kubernetes' });
  const kube = run(dir, k, 'ddev node -v').calls.filter((c) => /^docker/.test(c));
  assert.strictEqual(kube[0], 'docker image inspect webship-workspace-tests');
  assert.match(kube[1], /^docker run --rm --network host .* -e LAUNCH_URL=http:\/\/172\.18\.0\.2:\d+ webship-workspace-tests bash -c node -v ?$/, "on the host's network, against the node's address");
});

test('the tests image is built once, from core/config/runtimes/tests: Node.js 24 and the browsers\' libraries', () => {
  const dir = sandbox();
  const d = path.join(dir, 'ti'); fs.mkdirSync(d);
  run(dir, d, 'ddev config --project-type=drupal --docroot=web --project-name=ti', { WORKSPACE_RUNTIME: 'docker' });
  // No image yet: `image inspect` fails.
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${dir}/calls.log"\ncase "$*" in "image inspect"*) exit 1 ;; esac\n`, { mode: 0o755 });
  const r = run(dir, d, 'ddev npm -v');
  assert.strictEqual(r.calls[1], `docker build -t webship-workspace-tests ${STACKS}/tests`);
  assert.match(r.out, /Building the tests image webship-workspace-tests \(once\)/);
  const dockerfile = fs.readFileSync(path.join(STACKS, 'tests', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:24-/m, 'every build runs Node.js 24');
  assert.match(dockerfile, /playwright@[\d.]+ install-deps chromium/);
  assert.match(dockerfile, /PLAYWRIGHT_BROWSERS_PATH=\/cache\/ms-playwright/);
  assert.match(dockerfile, /PLAYWRIGHT_SKIP_BROWSER_GC=1/, "one project's Playwright never removes another's browser");
  assert.match(dockerfile, /chmod 1777 \/cache/, 'the shared volume is writable by the host user');
});

test('export-db and import-db take --file=<path> and --file <path>, and an empty dump is a failure', () => {
  const dir = sandbox();
  const p = path.join(dir, 'db'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=db', { WORKSPACE_RUNTIME: 'docker' });
  fs.writeFileSync(path.join(dir, 'in.sql'), 'select 1;\n');
  // A db service that dumps something.
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), `#!/usr/bin/env bash\ncase "$*" in *mariadb-dump*) echo "-- MariaDB dump" ;; *) [ -t 0 ] || cat > /dev/null ;; esac\n`, { mode: 0o755 });
  const r = run(dir, p, `ddev export-db --gzip --file ${dir}/a.sql.gz; echo "export $?"; ddev import-db --file ${dir}/in.sql; echo "import $?"; ddev import-db --file=${dir}/missing.sql; echo "missing $?"`);
  assert.ok(fs.existsSync(path.join(dir, 'a.sql.gz')), 'the file after a separate --file');
  assert.match(r.out, /^export 0$/m);
  assert.match(r.out, /^import 0$/m);
  assert.match(r.out, /No such file: .*missing\.sql/);
  assert.match(r.out, /^missing 1$/m);
  // A dump command that fails leaves a failure, not a file that looks like a backup.
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), `#!/usr/bin/env bash\ncase "$*" in *mariadb-dump*) exit 2 ;; esac\n`, { mode: 0o755 });
  const failed = run(dir, p, `ddev export-db --file=${dir}/b.sql.gz; echo "export $?"`);
  assert.match(failed.out, /^export 1$/m);
  // And one that wrote nothing: a few bytes of gzip are not a dump.
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  assert.match(run(dir, p, `ddev export-db --file=${dir}/c.sql.gz; echo "export $?"`).out, /^export 1$/m);
});

test('restart stops what runs first on Docker and Podman: `up` alone leaves running containers as they are', () => {
  const dir = sandbox();
  const p = path.join(dir, 'rs'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=php --project-name=rs', { WORKSPACE_RUNTIME: 'docker' });
  assert.deepStrictEqual(run(dir, p, 'ddev restart').calls, ['docker compose stop', 'docker compose up -d --build --wait']);
  assert.deepStrictEqual(run(dir, p, 'ddev start -y').calls, ['docker compose up -d --build --wait']);
});

test('drupal on a container runtime keeps sites/default writable, as DDEV\'s own settings do', () => {
  const dir = sandbox();
  const p = path.join(dir, 'd5'); const sd = path.join(p, 'web', 'sites', 'default'); fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, 'default.settings.php'), '<?php\n$settings = [];\n');
  run(dir, p, 'ddev config --project-type=drupal --docroot=web --project-name=d5', { WORKSPACE_RUNTIME: 'docker' });
  run(dir, p, 'ddev start');
  assert.match(fs.readFileSync(path.join(sd, 'settings.webship-runtime.php'), 'utf8'), /\$settings\['skip_permissions_hardening'\] = TRUE;/);
});

test('the npm package ships the stacks the runtimes build from: a workspace made from npm has them', () => {
  const { files } = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', '..', 'package.json'), 'utf8'));
  assert.ok(files.includes('core/config/runtimes'), 'core/config/runtimes is in package.json files');
  for (const stack of ['php', 'tests']) assert.ok(fs.existsSync(path.join(STACKS, stack, 'Dockerfile')), `the ${stack} stack`);
});
