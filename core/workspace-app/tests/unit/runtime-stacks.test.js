/**
 * Each application brings its own language on every runtime (webship/workspace#841): a generic stack from the
 * language's own image at the version the application chooses (rt_stack), the application's additions (rt_web_build)
 * and its own server (rt_serve), and PostgreSQL as a database beside MariaDB, or none. The php stack is as before.
 *
 * Stand-in docker, podman, ddev, kubectl and kind on PATH record what is called; nothing is started.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-stacks-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kind']) {
    // A database's container answers `psql --version` and `SELECT 1`; a dump that says STOP fails as psql would.
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\nif [ -t 0 ] ; then : ; else in="$(cat)" ; [ -n "$in" ] && printf '%s\\n' "$in" >> "${dir}/stdin.log" ; fi\ncase "$*" in *"psql --version"*) echo "psql (PostgreSQL) 16" ;; *"SELECT 1"*) echo 1 ;; esac\n[ -f "${dir}/fail-import" ] && [[ "$*" == *db_webship_import*ON_ERROR_STOP* ]] && exit 3\ntrue\n`, { mode: 0o755 });
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

/** A Django-like application on a runtime: `ddev config` for a generic web server and PostgreSQL, then the three calls. */
function app(dir, runtime, name, { db = 'postgres:16', calls = true } = {}) {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const conf = run(dir, p, `ddev config --project-type=django --webserver-type=generic --docroot= --database=${db} --project-name=${name}`, { WORKSPACE_RUNTIME: runtime });
  assert.strictEqual(conf.status, 0, conf.out);
  if (calls) {
    const r = run(dir, p, "rt_stack python 3.13 && printf 'RUN pip install --no-cache-dir uv==0.13.7\\n' | rt_web_build uv && rt_serve 8000 '.venv/bin/python mysite/manage.py runserver 0.0.0.0:8000'");
    assert.strictEqual(r.status, 0, r.out);
  }
  return p;
}

const read = (...f) => fs.readFileSync(path.join(...f), 'utf8');

test('a generic stack on Docker Compose and Podman: the language\'s pinned image, the additions, the server and its port, kept when written again', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const p = app(dir, runtime, `dj${runtime}`);
    const compose = read(p, 'compose.yaml');
    const block = compose.slice(compose.indexOf('x-webship:'), compose.indexOf('\nservices:'));
    assert.match(block, /\n {2}stack: generic\n {2}language: python\n {2}language_version: "3\.13"\n {2}serve_port: 8000\n/, runtime);
    assert.match(block, /\n {2}database: "postgres:16"\n/, `${runtime}: the PostgreSQL plugin reads the engine and the version`);
    const port = block.match(/\n {2}port: (\d+)/)[1];
    const web = compose.slice(compose.indexOf('\n  web:\n'), compose.indexOf('\n  db:\n'));
    assert.match(web, /\n {8}BASE_IMAGE: "python:3\.13-slim-bookworm"\n/, `${runtime}: pinned to the version`);
    assert.match(web, /\n {4}command: \["runuser", "-u", "www-data", "--", "bash", "\/var\/www\/html\/\.webship\/runtime\/serve\.sh"\]\n {4}working_dir: \/var\/www\/html\n/, runtime);
    assert.ok(web.includes(`- "127.0.0.1:${port}:8000"`), `${runtime}: the address goes to the server's port`);
    assert.doesNotMatch(web, /APACHE_DOCUMENT_ROOT|PHP_VERSION/, `${runtime}: no Apache, no PHP`);
    if (runtime === 'podman') assert.match(web, /\n {4}userns_mode: keep-id\n/);
    const dockerfile = read(p, '.webship', 'runtime', 'Dockerfile');
    assert.ok(dockerfile.startsWith(read(STACKS, 'generic', 'Dockerfile')), 'the stack\'s own first');
    assert.match(dockerfile, /\n# Dockerfile\.uv \(rt_web_build\)\nRUN pip install --no-cache-dir uv==0\.13\.7\n$/, 'then the application\'s additions');
    assert.match(read(p, '.webship', 'runtime', 'serve.sh'), /^cd "\$\(dirname "\$0"\)\/\.\.\/\.\." \|\| exit 1\n\.venv\/bin\/python mysite\/manage\.py runserver 0\.0\.0\.0:8000\n$/m);
    run(dir, p, 'ddev config --project-name=other-name-kept-not');
    const again = read(p, 'compose.yaml');
    assert.match(again, /\n {2}language_version: "3\.13"\n {2}serve_port: 8000\n/, `${runtime}: written again, the stack stays`);
    assert.match(again, new RegExp(`- "127\\.0\\.0\\.1:${port}:8000"`));
  }
});

test('the generic stack is the language\'s own image with what every stack has: git, curl, the database clients, sendmail to Mailpit, www-data as the host user', () => {
  const dockerfile = read(STACKS, 'generic', 'Dockerfile');
  assert.match(dockerfile, /^ARG BASE_IMAGE=debian:bookworm-slim\nFROM \$\{BASE_IMAGE\}$/m);
  for (const pkg of ['git', 'curl', 'mariadb-client', 'postgresql-client', 'msmtp-mta']) assert.ok(dockerfile.includes(pkg), pkg);
  assert.match(dockerfile, /host mail\\nport 1025/);
  assert.match(dockerfile, /usermod -o -u "\$\{UID\}" -g "\$\{GID\}"/);
  const images = run(sandbox(), os.tmpdir(), 'for l in "python 3.13" "node 24" "java 25" "dotnet 10.0" "ruby 3.4" "go 1.25" "image ghcr.io/acme/app:2.1.0" ; do rt_stack_image $l ; done').out.trim().split('\n');
  assert.deepStrictEqual(images, ['python:3.13-slim-bookworm', 'node:24-bookworm-slim', 'eclipse-temurin:25-jdk', 'mcr.microsoft.com/dotnet/sdk:10.0', 'ruby:3.4-slim-bookworm', 'golang:1.25-bookworm', 'ghcr.io/acme/app:2.1.0']);
});

test('rt_stack takes a language and the version the application chooses, never latest; on DDEV the three calls change nothing', () => {
  const dir = sandbox();
  const p = app(dir, 'docker', 'refuse', { calls: false });
  assert.match(run(dir, p, 'rt_stack cobol 1').out, /rt_stack: a language/);
  assert.match(run(dir, p, 'rt_stack python latest').out, /never latest/);
  assert.match(run(dir, p, 'rt_stack python').out, /the version python runs at/);
  const d = path.join(dir, 'dd'); fs.mkdirSync(path.join(d, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(d, '.ddev', 'config.yaml'), 'name: dd\ntype: generic\n');
  const r = run(dir, d, "rt_stack python 3.13 && echo 'RUN true' | rt_web_build x && rt_serve 8000 'python -m http.server'");
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(fs.readdirSync(d), ['.ddev'], 'the plugin\'s own .ddev files are DDEV\'s way');
});

test('PostgreSQL on Docker Compose: the db service of its image, the data where its version keeps it; none leaves no db service', () => {
  const dir = sandbox();
  let compose = read(app(dir, 'docker', 'pg16', { calls: false }), 'compose.yaml');
  let db = compose.slice(compose.indexOf('\n  db:\n'), compose.indexOf('\n  mail:\n'));
  assert.match(db, /\n {4}image: postgres:16\n {4}environment:\n {6}POSTGRES_DB: db\n {6}POSTGRES_USER: db\n {6}POSTGRES_PASSWORD: db\n {4}volumes:\n {6}- db:\/var\/lib\/postgresql\/data\n/);
  assert.match(db, /test: \["CMD-SHELL", "pg_isready -U db -d db"\]/);
  compose = read(app(dir, 'docker', 'pg18', { db: 'postgres:18', calls: false }), 'compose.yaml');
  assert.match(compose, /\n {6}- db:\/var\/lib\/postgresql\n/, 'PostgreSQL 18 keeps its data in /var/lib/postgresql');
  const p = path.join(dir, 'nodb'); fs.mkdirSync(p);
  run(dir, p, 'ddev config --project-type=generic --webserver-type=generic --omit-containers=db --project-name=nodb', { WORKSPACE_RUNTIME: 'docker' });
  compose = read(p, 'compose.yaml');
  assert.match(compose, /\n {2}database: "none"\n/);
  assert.doesNotMatch(compose, /\n {2}db:\n|depends_on/);
  assert.doesNotMatch(compose.slice(compose.indexOf('services:')), /\n\n/, 'no empty line left where the db service was');
});

test('PostgreSQL on Kubernetes: a db deployment of its image, its data in a folder of the volume, and the web container\'s own port', () => {
  const dir = sandbox();
  const stack = read(app(dir, 'kubernetes', 'kpg'), 'k8s', 'stack.yaml');
  assert.match(stack, /\n {10}image: postgres:16\n/);
  assert.match(stack, /\n {12}- \{name: PGDATA, value: \/var\/lib\/postgresql\/data\/pgdata\}\n/);
  assert.match(stack, /readinessProbe:\n {12}exec: \{command: \["pg_isready", "-U", "db", "-d", "db"\]\}/);
  assert.match(stack, /\n {2}ports: \[\{port: 5432\}\]\n/);
  assert.match(stack, /\n {10}ports: \[\{containerPort: 8000\}\]\n {10}command: \["runuser", "-u", "www-data", "--", "bash", "\/var\/www\/html\/\.webship\/runtime\/serve\.sh"\]\n {10}workingDir: \/var\/www\/html\n/);
  assert.match(stack, /\n {2}ports: \[\{port: 80, nodePort: \d+, targetPort: 8000\}\]\n/);
  assert.doesNotMatch(stack, /mariadb/);
});

test('the database verbs follow the project\'s engine: psql and pg_dump for PostgreSQL, MariaDB\'s as before, and each says so of the other', () => {
  const dir = sandbox();
  const p = app(dir, 'docker', 'verbs', { calls: false });
  assert.match(run(dir, p, 'ddev mysql -e "select 1"').out, /The database of this project is PostgreSQL: ddev psql\./);
  assert.ok(run(dir, p, 'ddev psql -c "select 1"').calls.some((c) => / exec -T db psql -U db -d db -c select 1$/.test(c)));
  const out = path.join(dir, 'dump.sql.gz');
  const ex = run(dir, p, `ddev export-db --file=${out}`);
  assert.ok(ex.calls.some((c) => / exec -T db pg_dump -U db --no-owner --no-privileges db$/.test(c)), ex.calls.join('\n'));
  const m = path.join(dir, 'm'); fs.mkdirSync(m);
  run(dir, m, 'ddev config --project-type=php --database=mariadb:10.11 --project-name=m', { WORKSPACE_RUNTIME: 'docker' });
  assert.match(run(dir, m, 'ddev psql').out, /The database of this project is MariaDB: ddev mysql\./);
  assert.ok(run(dir, m, 'ddev mysql -e "select 1"').calls.some((c) => / exec -T db mariadb -udb -pdb db -e select 1$/.test(c)));
});

test('a PostgreSQL import checks the dump, the client and the database first, goes into a database of its own, and leaves db untouched on any failure', () => {
  const dir = sandbox();
  const p = app(dir, 'docker', 'imp', { calls: false });
  const dumps = path.join(dir, 'dumps'); fs.mkdirSync(dumps);
  const plain = (name, body) => { const f = path.join(dumps, name); fs.writeFileSync(f, body); return f; };
  const good = plain('good.sql', '--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (a int);\n');
  const touched = (calls) => calls.some((c) => /RENAME|DROP DATABASE db_webship_old/.test(c)) || fs.existsSync(path.join(dir, 'stdin.log')) && /ALTER DATABASE db RENAME/.test(read(dir, 'stdin.log'));
  for (const [f, why] of [[plain('empty.sql', ''), /missing or empty/], [plain('other.sql', 'CREATE TABLE t (a int);\n'), /not a PostgreSQL dump/], [plain('broken.sql.gz', 'not gzip'), /not a whole gzip file/]]) {
    if (fs.existsSync(path.join(dir, 'stdin.log'))) fs.unlinkSync(path.join(dir, 'stdin.log'));
    const r = run(dir, p, `ddev import-db --file=${f}`);
    assert.strictEqual(r.status, 1, f);
    assert.match(r.out, why);
    assert.match(r.out, /untouched/);
    assert.ok(!r.calls.some((c) => / exec -T db /.test(c)), `${f}: the database is not even asked`);
  }
  fs.writeFileSync(path.join(dir, 'fail-import'), '');
  if (fs.existsSync(path.join(dir, 'stdin.log'))) fs.unlinkSync(path.join(dir, 'stdin.log'));
  const failed = run(dir, p, `ddev import-db --file=${good}`);
  assert.strictEqual(failed.status, 1);
  assert.match(failed.out, /the dump stopped on an error: the project's database is untouched/);
  assert.ok(!touched(failed.calls), 'db is never renamed when the import failed');
  assert.ok(failed.calls.some((c) => /DROP DATABASE IF EXISTS db_webship_import/.test(c)), 'and the half import goes');
  fs.unlinkSync(path.join(dir, 'fail-import'));
  if (fs.existsSync(path.join(dir, 'stdin.log'))) fs.unlinkSync(path.join(dir, 'stdin.log'));
  const ok = run(dir, p, `ddev import-db --file=${good}`);
  assert.strictEqual(ok.status, 0, ok.out);
  const order = ok.calls.map((c) => c.replace(/^docker compose .* exec -T db /, ''));
  assert.ok(order.indexOf('psql --version') < order.findIndex((c) => /CREATE DATABASE db_webship_import/.test(c)), 'the client asked before anything is made');
  assert.match(read(dir, 'stdin.log'), /ALTER DATABASE db RENAME TO db_webship_old;\nALTER DATABASE db_webship_import RENAME TO db;\nDROP DATABASE db_webship_old;/, 'a whole import takes db\'s place');
});
