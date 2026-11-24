/**
 * Each application brings its own language on Lando and Docksal too (webship/workspace#841, its second part): the
 * generic stack of Docker Compose, Podman and Kubernetes (the language's own image, what the application adds, its own
 * server after the database wait of #850), with PostgreSQL, MariaDB or no database. The php stack is as before.
 *
 * Stand-in lando, fin, docker and ddev on PATH record what is called; a database's container answers psql's checks.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-stacks-ld-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // Every tool records its arguments and what it was piped; psql answers its version and SELECT 1 as a database does.
  const tool = (name) => `#!/usr/bin/env bash\necho "${name} $*" >> "${dir}/calls.log"\nin=""\nif [ -t 0 ] ; then : ; else in="$(cat)" ; [ -n "$in" ] && printf 'stdin: %s\\n' "$in" >> "${dir}/calls.log" ; fi\n`
    + 'case "$*" in *"psql --version"*) echo "psql (PostgreSQL) 16" ;; *"SELECT 1"*) echo 1 ;; esac\n';
  fs.writeFileSync(path.join(bin, 'lando'), tool('lando') + 'true\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'fin'), tool('fin') + 'true\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ddev'), tool('ddev') + 'true\n', { mode: 0o755 });
  // docker ps answers a container per service when the test says the project runs.
  fs.writeFileSync(path.join(bin, 'docker'), tool('docker')
    // (Lando's containers by its label io.lando.root: one, when the project runs.)
    + `if [ "$1" = ps ] ; then [ -f "${dir}/running" ] || exit 0 ; s="" ; for a in "$@" ; do case "$a" in label=com.docker.compose.service=*) s="\${a##*=}" ;; esac ; done ; [ -n "$s" ] && echo "id-$s" || echo c0ffee ; exit 0 ; fi\ntrue\n`, { mode: 0o755 });
  return dir;
}

function run(dir, cwd, script, env = {}) {
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ${script}`],
    { cwd, encoding: 'utf8', input: '', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, HOME: dir, WORKSPACE_ROOT: path.join(SCRIPTS, '..', '..'), ...env } });
  const log = path.join(dir, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { out: r.stdout + r.stderr, calls, status: r.status };
}

const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** A Django-like application on Lando or Docksal: a generic `ddev config`, then rt_stack, rt_web_build and rt_serve. */
function app(dir, runtime, name, { db = 'postgres:16', calls = true } = {}) {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const dbArg = db === 'none' ? '--omit-containers=db' : `--database=${db}`;
  const conf = run(dir, p, `ddev config --project-type=generic --webserver-type=generic --docroot= ${dbArg} --project-name=${name}`, { WORKSPACE_RUNTIME: runtime });
  assert.strictEqual(conf.status, 0, conf.out);
  if (calls) {
    const r = run(dir, p, "rt_stack python 3.13 && printf 'RUN pip install --no-cache-dir uv==0.13.7\\n' | rt_web_build uv && rt_serve 8000 'cd mysite && exec ../.venv/bin/python manage.py runserver 0.0.0.0:8000'");
    assert.strictEqual(r.status, 0, r.out);
  }
  return p;
}

test('Lando: a generic stack has no recipe; appserver is the stack\'s own image and runs its server; PostgreSQL is the official image on the host db', () => {
  const dir = sandbox();
  const p = app(dir, 'lando', 'glando');
  const lando = read(p, '.lando.yml');
  assert.doesNotMatch(lando, /^recipe:/m, 'no recipe: the services are the stack\'s');
  const block = lando.slice(lando.indexOf('x-webship:'), lando.indexOf('\nservices:'));
  assert.match(block, /\n {2}runtime: lando\n {2}stack: generic\n {2}language: python\n {2}language_version: "3\.13"\n {2}serve_port: 8000\n {2}db_wait: 300\n {2}serve_grace: 1800\n/);
  assert.match(block, /\n {2}database: "postgres:16"\n/, 'the PostgreSQL plugin reads the engine and the version');
  const port = block.match(/\n {2}port: (\d+)/)[1];
  const appserver = lando.slice(lando.indexOf('\n  appserver:\n'), lando.indexOf('\n  database:\n'));
  assert.match(appserver, /\n {4}type: lando\n {4}services:\n {6}build:\n {8}context: \.\/\.webship\/runtime\n {8}args:\n {10}BASE_IMAGE: "python:3\.13-slim-bookworm"\n/);
  assert.match(appserver, /\n {6}image: webship-glando-web\n {6}command: runuser -u www-data -- bash \/app\/\.webship\/runtime\/start\.sh\n/);
  assert.match(appserver, /\n {8}WEBSHIP_RUNTIME: lando\n {8}WEBSHIP_PORT: "\d+"\n {8}WEBSHIP_DB_WAIT: "300"\n/);
  assert.ok(appserver.includes(`- "127.0.0.1:${port}:8000"`), 'the address goes to the server\'s port');
  const database = lando.slice(lando.indexOf('\n  database:\n'), lando.indexOf('\n  mailpit:\n'));
  assert.match(database, /\n {4}type: compose\n {4}services:\n {6}image: postgres:16\n {6}command: docker-entrypoint\.sh postgres\n {6}environment:\n {8}POSTGRES_DB: db\n {8}POSTGRES_USER: db\n {8}POSTGRES_PASSWORD: db\n {6}volumes:\n {8}- db:\/var\/lib\/postgresql\/data\n {6}networks:\n {8}default:\n {10}aliases:\n {12}- db\n {4}volumes:\n {6}db:$/);
  assert.match(lando.slice(lando.indexOf('\n  mailpit:\n')), /\n {4}type: mailpit\n {4}overrides:\n[\s\S]*- "127\.0\.0\.1:\d+:80"[\s\S]*aliases:\n {12}- mail\n/, 'Lando\'s Mailpit on the host mail, where the stack\'s sendmail sends');
  for (const f of ['Dockerfile', 'start.sh', 'probe.sh', 'serve.sh']) assert.ok(fs.existsSync(path.join(p, '.webship', 'runtime', f)), f);
  assert.match(read(p, '.webship', 'runtime', 'start.sh'), /pg_isready -q -h db -U db/);
  assert.match(read(p, '.webship', 'runtime', 'Dockerfile'), /\n# Dockerfile\.uv \(rt_web_build\)\nRUN pip install --no-cache-dir uv==0\.13\.7\n$/);
  // Written again, the stack stays.
  assert.strictEqual(run(dir, p, 'ddev config --project-name=glando').status, 0);
  assert.match(read(p, '.lando.yml'), /\n {2}stack: generic\n {2}language: python\n {2}language_version: "3\.13"\n {2}serve_port: 8000\n/);
  // PostgreSQL 18 keeps its data in /var/lib/postgresql; MariaDB is Lando's own on the host db; no database, no service.
  assert.match(read(app(dir, 'lando', 'g18', { db: 'postgres:18', calls: false }), '.lando.yml'), /\n {8}- db:\/var\/lib\/postgresql\n/);
  const maria = read(app(dir, 'lando', 'gmaria', { db: '10.11', calls: false }), '.lando.yml');
  assert.match(maria, /\n {2}database:\n {4}type: mariadb:10\.11\n {4}creds:\n {6}user: db\n {6}password: db\n {6}database: db\n {4}overrides:\n {6}networks:\n {8}default:\n {10}aliases:\n {12}- db\n/);
  assert.match(read(p, '..', 'gmaria', '.webship', 'runtime', 'start.sh'), /mariadb-admin ping -h db -u db -pdb --skip-ssl --silent/);
  const none = read(app(dir, 'lando', 'gnone', { db: 'none', calls: false }), '.lando.yml');
  assert.doesNotMatch(none, /\n {2}database:\n/);
  assert.match(none, /\n {2}database: "none"\n/);
});

test('Lando: a generic stack\'s commands run as www-data, the database verbs follow its engine, and its own files make a rebuild', () => {
  const dir = sandbox();
  const p = app(dir, 'lando', 'vlando');
  const ex = run(dir, p, 'ddev exec "ls -la"');
  assert.ok(ex.calls.some((c) => /^lando exec appserver --user www-data -- bash -c cd '\/app' && ls -la/.test(c)), ex.calls.join('\n'));
  assert.ok(run(dir, p, 'ddev psql -c "SELECT 1"').calls.some((c) => /^lando exec database -- psql -U db -d db -c SELECT 1/.test(c)));
  assert.match(run(dir, p, 'ddev mysql -e "select 1"').out, /The database of this project is PostgreSQL: ddev psql\./);
  const dump = path.join(dir, 'out.sql.gz');
  assert.ok(run(dir, p, `ddev export-db --file=${dump}`).calls.some((c) => /^lando exec database -- pg_dump -U db --no-owner --no-privileges db/.test(c)));
  // The safe import of #846: a whole dump goes into its own database, then takes db's place in one session.
  const good = path.join(dir, 'good.sql');
  fs.writeFileSync(good, '--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (a int);\n--\n-- PostgreSQL database dump complete\n--\n');
  const imp = run(dir, p, `ddev import-db --file=${good}; echo "rc=$?"`);
  assert.match(imp.out, /rc=0/, imp.out);
  assert.ok(imp.calls.some((c) => /^lando exec database -- psql -U db -d db_webship_import -v ON_ERROR_STOP=1 -q/.test(c)), 'into a database of its own first');
  assert.ok(imp.calls.some((c) => /^stdin: ALTER DATABASE db ALLOW_CONNECTIONS false;/.test(c)), 'then the swap');
  fs.writeFileSync(path.join(dir, 'cut.sql'), '--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (a int);\n');
  assert.match(run(dir, p, `ddev import-db --file=${dir}/cut.sql`).out, /a PostgreSQL dump cut short/);
  // MariaDB as before; no database said.
  const m = app(dir, 'lando', 'vmaria', { db: '10.11', calls: false });
  assert.ok(run(dir, m, 'ddev mysql -e "select 1"').calls.some((c) => /^lando exec database -- bash -c "\$\(command -v mariadb \|\| echo mysql\)"/.test(c)));
  assert.match(run(dir, m, 'ddev psql').out, /The database of this project is MariaDB: ddev mysql\./);
  assert.match(run(dir, app(dir, 'lando', 'vnone', { db: 'none', calls: false }), 'ddev psql').out, /This project has no database\./);
  // A start after the stack's image changed (what the application adds) rebuilds the app; then a start is a start.
  fs.writeFileSync(path.join(dir, 'running'), '');
  run(dir, p, 'ddev start');
  fs.appendFileSync(path.join(p, '.webship', 'runtime', 'Dockerfile'), 'RUN true\n');
  assert.ok(run(dir, p, 'ddev start').calls.some((c) => /^lando rebuild -y/.test(c)), 'a changed image is built again');
  assert.ok(!run(dir, p, 'ddev start').calls.some((c) => /^lando rebuild/.test(c)), 'and only then');
});

test('Docksal: a generic stack is Docksal\'s node stack: cli is the stack\'s image, its server behind the proxy on its port, healthy through the probe', () => {
  const dir = sandbox();
  const p = app(dir, 'docksal', 'Gdocksal');
  const env = read(p, '.docksal', 'docksal.env');
  assert.match(env, /\nDOCKSAL_STACK=node\nCOMPOSE_PROJECT_NAME=gdocksal\nVIRTUAL_HOST=gdocksal\.docksal\.site\nDOCROOT=\.\n$/);
  assert.doesNotMatch(env, /CLI_IMAGE|DB_IMAGE/, 'cli is built, and PostgreSQL is no image of Docksal\'s');
  const yml = read(p, '.docksal', 'docksal.yml');
  const block = yml.slice(yml.indexOf('x-webship:'), yml.indexOf('\nservices:'));
  assert.match(block, /\n {2}stack: generic\n {2}language: python\n {2}language_version: "3\.13"\n {2}serve_port: 8000\n {2}db_wait: 300\n {2}serve_grace: 1800\n/);
  const cli = yml.slice(yml.indexOf('\n  cli:\n'), yml.indexOf('\n  db:\n'));
  assert.match(cli, /\n {4}image: webship-gdocksal-web\n {4}build:\n {6}context: \$\{PROJECT_ROOT\}\/\.webship\/runtime\n {6}args:\n {8}BASE_IMAGE: "python:3\.13-slim-bookworm"\n/);
  assert.match(cli, /\n {4}command: \["runuser", "-u", "www-data", "--", "bash", "\/var\/www\/\.webship\/runtime\/start\.sh"\]\n/);
  assert.match(cli, /\n {6}- WEBSHIP_RUNTIME=docksal\n {6}- WEBSHIP_DB_WAIT=300\n {6}- WEBSHIP_SERVE_GRACE=1800\n/);
  assert.match(cli, /\n {6}- io\.docksal\.user=www-data\n {6}- io\.docksal\.virtual-port=8000\n {4}expose:\n {6}- "8000"\n/);
  assert.match(cli, /\n {4}healthcheck:\n {6}test: \["CMD", "bash", "\/var\/www\/\.webship\/runtime\/probe\.sh", "8000"\]\n/, 'the proxy routes to a healthy container only');
  assert.match(yml, /\n {2}db:\n {4}hostname: db\n {4}image: postgres:16\n {4}environment:\n {6}- POSTGRES_DB=db\n {6}- POSTGRES_USER=db\n {6}- POSTGRES_PASSWORD=db\n {4}volumes:\n {6}- db:\/var\/lib\/postgresql\/data\n/);
  assert.match(yml, /\n {2}mail:\n {4}extends:\n {6}file: \$\{HOME\}\/\.docksal\/stacks\/services\.yml\n {6}service: mail\nvolumes:\n {2}db:\n$/);
  assert.strictEqual(run(dir, p, 'ddev config --project-name=Gdocksal').status, 0);
  assert.match(read(p, '.docksal', 'docksal.yml'), /\n {2}stack: generic\n {2}language: python\n/, 'written again, the stack stays');
  // MariaDB is Docksal's own, with db/db/db; no database, no db service.
  const m = app(dir, 'docksal', 'gmaria', { db: '10.11', calls: false });
  assert.match(read(m, '.docksal', 'docksal.env'), /\nDB_IMAGE=docksal\/mariadb:10\.11-1\.4\nMYSQL_ROOT_PASSWORD=root\nMYSQL_USER=db\nMYSQL_PASSWORD=db\nMYSQL_DATABASE=db\n$/);
  assert.match(read(m, '.docksal', 'docksal.yml'), /\n {2}db:\n {4}extends:\n {6}file: \$\{HOME\}\/\.docksal\/stacks\/services\.yml\n {6}service: db\n/);
  const n = app(dir, 'docksal', 'gnone', { db: 'none', calls: false });
  assert.doesNotMatch(read(n, '.docksal', 'docksal.yml'), /\n {2}db:\n/);
});

test('Docksal: a generic stack\'s commands run as www-data in cli, its database verbs follow the engine, its state and logs are cli\'s, and a start builds its image first', () => {
  const dir = sandbox();
  const p = app(dir, 'docksal', 'vdocksal');
  fs.writeFileSync(path.join(dir, 'running'), '');
  const ex = run(dir, p, 'ddev exec "ls -la"');
  assert.ok(ex.calls.some((c) => c.trimEnd() === "docker exec -i -u www-data id-cli bash -c cd '/var/www' && ls -la"), ex.calls.join('\n'));
  assert.ok(run(dir, p, 'ddev psql -c "SELECT 1"').calls.some((c) => /^docker exec -i id-db psql -U db -d db -c SELECT 1/.test(c)));
  assert.match(run(dir, p, 'ddev mysql').out, /The database of this project is PostgreSQL: ddev psql\./);
  const good = path.join(dir, 'good.sql');
  fs.writeFileSync(good, '--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (a int);\n--\n-- PostgreSQL database dump complete\n--\n');
  const imp = run(dir, p, `ddev import-db --file=${good}; echo "rc=$?"`);
  assert.match(imp.out, /rc=0/, imp.out);
  assert.ok(imp.calls.some((c) => /^stdin: ALTER DATABASE db ALLOW_CONNECTIONS false;/.test(c)), 'the swap of #846');
  assert.ok(run(dir, p, 'ddev logs').calls.some((c) => /^docker logs --tail 200 id-cli/.test(c)), 'the server runs in cli');
  assert.match(run(dir, p, 'ddev describe -j').out, /"status": ?"running"/, 'running with cli alone: a generic stack has no web');
  const start = run(dir, p, 'ddev start').calls.filter((c) => c.startsWith('fin '));
  assert.ok(start[0].startsWith('fin docker-compose build cli'), start.join('\n'));
  assert.ok(start[1].startsWith('fin project start'), 'then the start');
});

test('the php stack of Lando and Docksal has MariaDB: PostgreSQL or no database there says what has them, and writes nothing', () => {
  const dir = sandbox();
  for (const runtime of ['lando', 'docksal']) {
    for (const db of ['--database=postgres:16', '--omit-containers=db']) {
      const p = fs.mkdtempSync(path.join(dir, `php-${runtime}-`));
      const r = run(dir, p, `ddev config --project-type=drupal --docroot=web --php-version=8.3 ${db} --project-name=phpx`, { WORKSPACE_RUNTIME: runtime });
      assert.strictEqual(r.status, 1, `${runtime} ${db}`);
      assert.match(r.out, /php stack has MariaDB: .* is a generic stack's \(--webserver-type=generic\), so far \(webship\/workspace#841\)/);
      assert.deepStrictEqual(fs.readdirSync(p), [], `${runtime} ${db}: nothing written`);
    }
  }
});
