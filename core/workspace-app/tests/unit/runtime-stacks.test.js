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
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\nin=""\nif [ -t 0 ] ; then : ; else in="$(cat)" ; [ -n "$in" ] && printf '%s\\n' "$in" >> "${dir}/stdin.log" ; fi\ncase "$*" in *"psql --version"*) echo "psql (PostgreSQL) 16" ;; *"SELECT 1"*) echo 1 ;; esac\n[ -f "${dir}/fail-import" ] && [[ "$*" == *db_webship_import*ON_ERROR_STOP* ]] && exit 3\n[ -f "${dir}/fail-swap" ] && [[ "$in" == *"RENAME TO db_webship_old"* ]] && exit 3\n[ -f "${dir}/fail-restore" ] && [[ "$*" == *"ALLOW_CONNECTIONS true"* ]] && exit 3\n[ -f "${dir}/fail-drop" ] && [[ "$*" == *"DROP DATABASE IF EXISTS db_webship_old"* ]] && exit 3\n[ -f "${dir}/probe-rc" ] && [[ "$*" == *"--entrypoint /bin/sh"* ]] && exit "$(cat "${dir}/probe-rc")"\ntrue\n`, { mode: 0o755 });
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
    assert.match(web, /\n {4}command: \["setpriv", "--reuid=www-data", "--regid=www-data", "--init-groups", "--", "bash", "\/var\/www\/html\/\.webship\/runtime\/start\.sh"\]\n {4}working_dir: \/var\/www\/html\n/, `${runtime}: the database wait, then the server (#850)`);
    assert.match(web, /\n {6}WEBSHIP_DB_WAIT: "300"\n/, runtime);
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
  assert.match(stack, /\n {10}ports: \[\{containerPort: 8000\}\]\n {10}command: \["setpriv", "--reuid=www-data", "--regid=www-data", "--init-groups", "--", "bash", "\/var\/www\/html\/\.webship\/runtime\/start\.sh"\]\n {10}workingDir: \/var\/www\/html\n/);
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
  const good = plain('good.sql', '--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (a int);\n--\n-- PostgreSQL database dump complete\n--\n');
  const touched = (calls) => calls.some((c) => /RENAME|DROP DATABASE db_webship_old/.test(c)) || fs.existsSync(path.join(dir, 'stdin.log')) && /ALTER DATABASE db RENAME/.test(read(dir, 'stdin.log'));
  // A whole gzip of a dump that stopped half-way: it passes gunzip -t and the header, and must still be refused.
  const cut = path.join(dumps, 'cut.sql.gz');
  fs.writeFileSync(cut, require('zlib').gzipSync('--\n-- PostgreSQL database dump\n--\nCREATE TABLE t (a int);\nCOPY t (a) FROM stdin;\n1\n'));
  for (const [f, why] of [[plain('empty.sql', ''), /missing or empty/], [plain('other.sql', 'CREATE TABLE t (a int);\n'), /not a PostgreSQL dump/], [plain('broken.sql.gz', 'not gzip'), /not a whole gzip file/], [cut, /a PostgreSQL dump cut short \(it does not end with pg_dump's 'PostgreSQL database dump complete'\)/]]) {
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
  assert.strictEqual(read(dir, 'stdin.log').match(/RENAME TO db_webship_old/g).length, 1, 'one swap');
  assert.match(read(dir, 'stdin.log'), /\nALTER DATABASE db ALLOW_CONNECTIONS false;\nSELECT pg_terminate_backend\(pid\) FROM pg_stat_activity WHERE datname = 'db' AND pid <> pg_backend_pid\(\);\nBEGIN;\nALTER DATABASE db RENAME TO db_webship_old;\nALTER DATABASE db_webship_import RENAME TO db;\nCOMMIT;/, 'in one session: db closed to new connections, its connections closed, then both renames in one transaction');
  assert.ok(ok.calls.some((c) => /DROP DATABASE IF EXISTS db_webship_old/.test(c)), 'the old database goes after');
  assert.ok(!ok.calls.some((c) => /ALLOW_CONNECTIONS true/.test(c)), 'the new db takes connections as made');
  // A swap that fails: tried three times, then db, as it was, is opened again, and the import says so.
  fs.writeFileSync(path.join(dir, 'fail-swap'), '');
  fs.unlinkSync(path.join(dir, 'stdin.log'));
  const swap = run(dir, p, `ddev import-db --file=${good}`);
  assert.strictEqual(swap.status, 1);
  assert.match(swap.out, /could not take the place of db \(three tries\): db is as it was, open again \(the dump is in db_webship_import\)/);
  assert.strictEqual(read(dir, 'stdin.log').match(/RENAME TO db_webship_old/g).length, 3, 'three tries');
  assert.ok(swap.calls.some((c) => /psql -U db -d postgres -qc ALTER DATABASE db ALLOW_CONNECTIONS true$/.test(c)), 'db is opened again');
  assert.ok(!swap.calls.some((c) => /DROP DATABASE IF EXISTS db_webship_old/.test(c)), 'nothing is dropped after a failed swap');
  // A swap that fails, and db cannot be opened again either: the import does not say it is as it was, and says how.
  fs.writeFileSync(path.join(dir, 'fail-restore'), '');
  const lost = run(dir, p, `ddev import-db --file=${good}`);
  assert.strictEqual(lost.status, 1);
  assert.match(lost.out, /and db could not be opened again by itself: ddev psql -d postgres -c 'ALTER DATABASE db ALLOW_CONNECTIONS true'/);
  assert.doesNotMatch(lost.out, /db is as it was/);
  for (const f of ['fail-swap', 'fail-restore']) fs.unlinkSync(path.join(dir, f));
  // A swap that worked is not failed by the old database's removal: the import is done, and it says what is left.
  fs.writeFileSync(path.join(dir, 'fail-drop'), '');
  const left = run(dir, p, `ddev import-db --file=${good}`);
  assert.strictEqual(left.status, 0, left.out);
  assert.match(left.out, /the dump is the project's database now; the old one, db_webship_old, could not be removed/);
});

test('rt_stack image: a pinned image that can take the stack\'s layer (a shell, apt-get or apk), refused clearly before anything is written', () => {
  const dir = sandbox();
  const p = app(dir, 'docker', 'img', { calls: false });
  const before = read(p, 'compose.yaml');
  for (const image of ['acme/app', 'acme/app:latest', 'localhost:5000/app']) {
    const r = run(dir, p, `rt_stack image ${image}`);
    assert.strictEqual(r.status, 1, image);
    assert.match(r.out, /a pinned image, please \(name:tag or name@sha256:\.\.\., never latest\)/, image);
    assert.ok(!r.calls.some((c) => /^docker run/.test(c)), `${image}: nothing is run for an image that is not pinned`);
  }
  for (const [rc, why] of [['3', /image busybox:1\.37 has neither apt-get \(Debian, Ubuntu\) nor apk \(Alpine\), which the generic stack adds its layer with \(webship\/workspace#841\)/], ['127', /image busybox:1\.37 has no shell \(a distroless image\?\)/], ['1', /image busybox:1\.37 could not be run to see what it is built on \(is the name right, and can docker pull it\?\)/], ['125', /image busybox:1\.37 could not be run to see what it is built on \(is the name right, and can docker pull it\?\)/]]) {
    fs.writeFileSync(path.join(dir, 'probe-rc'), rc);
    const r = run(dir, p, 'rt_stack image busybox:1.37');
    assert.strictEqual(r.status, 1, rc);
    assert.match(r.out, why, rc);
    assert.ok(r.calls.includes('docker run --rm --entrypoint /bin/sh busybox:1.37 -c command -v apt-get > /dev/null || command -v apk > /dev/null || exit 3'), r.calls.join('\n'));
    assert.strictEqual(read(p, 'compose.yaml'), before, `${rc}: nothing is written`);
  }
  fs.unlinkSync(path.join(dir, 'probe-rc'));
  const ok = run(dir, p, 'rt_stack image localhost:5000/acme/app:2.1.0');
  assert.strictEqual(ok.status, 0, ok.out);
  assert.match(read(p, 'compose.yaml'), /language: image\n[\s\S]*language_version: "localhost:5000\/acme\/app:2\.1\.0"/);
  assert.match(read(p, 'compose.yaml'), /BASE_IMAGE: "localhost:5000\/acme\/app:2\.1\.0"/);
  // On Podman the image is asked with podman.
  const q = app(dir, 'podman', 'pimg', { calls: false });
  const digest = `acme/app@sha256:${'a'.repeat(64)}`;
  const pod = run(dir, q, `rt_stack image ${digest}`);
  assert.strictEqual(pod.status, 0, pod.out);
  assert.ok(pod.calls.includes(`podman run --rm --entrypoint /bin/sh ${digest} -c command -v apt-get > /dev/null || command -v apk > /dev/null || exit 3`), pod.calls.join('\n'));
});

test('the generic stack takes the layer with apt-get or apk, and an image with neither stops the build with why', () => {
  const dockerfile = read(STACKS, 'generic', 'Dockerfile');
  assert.match(dockerfile, /if command -v apt-get > \/dev\/null ; then/);
  assert.match(dockerfile, /elif command -v apk > \/dev\/null ; then \\\n {6}apk add --no-cache bash git unzip curl ca-certificates less procps shadow runuser setpriv \\\n/, 'setpriv as well: BusyBox\'s has no --reuid (#983)');
  assert.match(dockerfile, /ln -sf \/usr\/bin\/msmtp \/usr\/sbin\/sendmail/, 'Alpine\'s msmtp as sendmail too');
  assert.match(dockerfile, /this image has neither \(webship\/workspace#841\)[^"]*" >&2 ; exit 1/);
});

/** start.sh and probe.sh of a generic stack, run as the web container runs them, with stand-ins on PATH (#850). */
function scripts(dir, engine) {
  const p = path.join(dir, `w${engine}`); fs.mkdirSync(p);
  const db = { postgres: 'postgres:16', mariadb: '10.11', none: 'none' }[engine];
  const conf = run(dir, p, `ddev config --project-type=generic --webserver-type=generic --docroot= --database=${db} --project-name=w${engine}`, { WORKSPACE_RUNTIME: 'docker' });
  assert.strictEqual(conf.status, 0, conf.out);
  fs.writeFileSync(path.join(p, '.webship', 'runtime', 'serve.sh'), '#!/usr/bin/env bash\necho "the server runs in $PWD"\n');
  const bin = path.join(dir, `fake-${engine}`); fs.mkdirSync(bin);
  // The database answers after ANSWER_AFTER asks (never when it is 99); the server answers CODE; the container is AGE s old.
  for (const cli of ['pg_isready', 'mariadb-admin']) fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "$0 $*" >> "${dir}/asked-${engine}.log"\nn=$(wc -l < "${dir}/asked-${engine}.log")\n[ "$n" -gt "\${ANSWER_AFTER:-0}" ]\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\nprintf "%s" "${CODE:-000}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'ps'), '#!/usr/bin/env bash\necho "   ${AGE:-10}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\ntrue\n', { mode: 0o755 });
  const sh = (script, env = {}, args = []) => {
    const r = spawnSync('bash', [path.join(p, '.webship', 'runtime', script), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir, ...env } });
    const asked = path.join(dir, `asked-${engine}.log`);
    const log = fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8').trim().split('\n') : [];
    if (fs.existsSync(asked)) fs.unlinkSync(asked);
    return { out: r.stdout + r.stderr, status: r.status, asked: log };
  };
  return { p, sh };
}

test('a generic stack\'s server starts once its database takes connections, at most WEBSHIP_DB_WAIT seconds, and says why it did not', () => {
  const dir = sandbox();
  const pg = scripts(dir, 'postgres');
  let r = pg.sh('start.sh', { ANSWER_AFTER: '2' });
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /^Waiting for the project's database \(postgres on db\) before the application's server starts\.\nthe server runs in /, 'it says it waits, once');
  assert.ok(r.out.trim().endsWith(pg.p), 'then the server, from the project\'s root');
  assert.deepStrictEqual(r.asked.map((a) => a.replace(/^\S*\//, '')), ['pg_isready -q -h db -U db', 'pg_isready -q -h db -U db', 'pg_isready -q -h db -U db'], 'asked until it answers');
  r = pg.sh('start.sh', { ANSWER_AFTER: '99', WEBSHIP_DB_WAIT: '6' });
  assert.strictEqual(r.status, 1);
  assert.match(r.out, /The project's database \(postgres on db\) did not answer in 6 s: the application's server is not started\./);
  assert.doesNotMatch(r.out, /the server runs/);
  assert.strictEqual(r.asked.length, 4, 'every 2 s for 6 s, and once more');
  const maria = scripts(dir, 'mariadb');
  r = maria.sh('start.sh', { ANSWER_AFTER: '0' });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.asked.map((a) => a.replace(/^\S*\//, '')), ['mariadb-admin ping -h db -u db -pdb --skip-ssl --silent'], 'MariaDB is asked with its own client');
  assert.doesNotMatch(r.out, /Waiting/);
  const none = scripts(dir, 'none');
  r = none.sh('start.sh', { ANSWER_AFTER: '99' });
  assert.strictEqual(r.status, 0, r.out);
  assert.deepStrictEqual(r.asked, [], 'no database, nothing to wait for');
  assert.match(r.out, /^the server runs in /);
});

test('the wait and the grace are kept in x-webship, taken from WEBSHIP_DB_WAIT and WEBSHIP_SERVE_GRACE of ddev config, and Kubernetes has them', () => {
  const dir = sandbox();
  const p = app(dir, 'docker', 'keep', { calls: false });
  assert.match(read(p, 'compose.yaml'), /\n {2}db_wait: 300\n {2}serve_grace: 1800\n/, 'the defaults');
  assert.strictEqual(run(dir, p, 'ddev config', { WEBSHIP_DB_WAIT: '600', WEBSHIP_SERVE_GRACE: '3600' }).status, 0);
  let compose = read(p, 'compose.yaml');
  assert.match(compose, /\n {2}db_wait: 600\n {2}serve_grace: 3600\n/);
  assert.match(compose, /\n {6}WEBSHIP_DB_WAIT: "600"\n/);
  assert.strictEqual(run(dir, p, 'ddev config --project-name=keep').status, 0);
  compose = read(p, 'compose.yaml');
  assert.match(compose, /\n {2}db_wait: 600\n {2}serve_grace: 3600\n/, 'written again, they stay');
  assert.strictEqual(run(dir, p, 'ddev config', { WEBSHIP_DB_WAIT: 'soon' }).status, 0);
  assert.match(read(p, 'compose.yaml'), /\n {2}db_wait: 300\n/, 'a wait that is not a number is the default');
  const k = app(dir, 'kubernetes', 'kgrace', { calls: false });
  assert.strictEqual(run(dir, k, 'ddev config', { WEBSHIP_SERVE_GRACE: '2400' }).status, 0);
  const stack = read(k, 'k8s', 'stack.yaml');
  assert.match(stack, /\n {12}- \{name: WEBSHIP_DB_WAIT, value: "300"\}\n {12}- \{name: WEBSHIP_SERVE_GRACE, value: "2400"\}\n/);
});

test('on Kubernetes a generic stack\'s server has a liveness probe on its port, and no startup probe: the pod is ready as it runs', () => {
  const dir = sandbox();
  const stack = read(app(dir, 'kubernetes', 'kprobe'), 'k8s', 'stack.yaml');
  // A slow but working server keeps its pod (#971): an answer within 10 s (probe.sh) counts, the probe has 15 s, and a
  // server that answered before is restarted after 120 s of not answering by default (12 failures, every 10 s).
  assert.match(stack, /\n {10}workingDir: \/var\/www\/html\n {10}livenessProbe:\n {12}exec: \{command: \["bash", "\/var\/www\/html\/\.webship\/runtime\/probe\.sh", "8000"\]\}\n {12}periodSeconds: 10\n {12}timeoutSeconds: 15\n {12}failureThreshold: 12\n/);
  assert.doesNotMatch(stack, /startupProbe/, '`ddev start` waits for the pod before a build has made what its server serves');
  const web = stack.slice(stack.indexOf('  name: web\n'), stack.indexOf('kind: Service', stack.indexOf('  name: web\n')));
  assert.doesNotMatch(web, /readinessProbe/);
});

test('the patience of a server on Kubernetes is WEBSHIP_SERVE_PATIENCE of ddev config, kept in x-webship; the database answers its readiness in 5 s (#971)', () => {
  const dir = sandbox();
  const k = app(dir, 'kubernetes', 'kpatience', { calls: false });
  assert.match(read(k, 'compose.yaml'), /\n {2}serve_grace: 1800\n {2}serve_patience: 120\n/, 'the default, beside the grace');
  assert.strictEqual(run(dir, k, 'ddev config', { WEBSHIP_SERVE_PATIENCE: '300' }).status, 0);
  assert.match(read(k, 'compose.yaml'), /\n {2}serve_patience: 300\n/);
  assert.match(read(k, 'k8s', 'stack.yaml'), /\n {12}timeoutSeconds: 15\n {12}failureThreshold: 30\n/, '300 s: 30 failures, every 10 s');
  assert.strictEqual(run(dir, k, 'ddev config --project-name=kpatience').status, 0);
  assert.match(read(k, 'compose.yaml'), /\n {2}serve_patience: 300\n/, 'written again, it stays');
  for (const bad of ['soon', '5']) {
    assert.strictEqual(run(dir, k, 'ddev config', { WEBSHIP_SERVE_PATIENCE: bad }).status, 0);
    assert.match(read(k, 'compose.yaml'), /\n {2}serve_patience: 120\n/, `${bad}: not a number of at least 30, the default`);
  }
  const stack = read(k, 'k8s', 'stack.yaml');
  assert.match(stack, /exec: \{command: \["pg_isready", "-U", "db", "-d", "db"\]\}\n {12}periodSeconds: 5\n {12}timeoutSeconds: 5\n/, 'PostgreSQL: 5 s to answer, not Kubernetes\' 1');
  const maria = read(app(dir, 'kubernetes', 'kmaria', { calls: false, db: 'mariadb:10.11' }), 'k8s', 'stack.yaml');
  assert.match(maria, /exec: \{command: \["healthcheck\.sh", "--connect", "--innodb_initialized"\]\}\n {12}periodSeconds: 5\n {12}timeoutSeconds: 5\n/, 'MariaDB too');
});

test('probe.sh: any answer passes (a 500 too); a server that answered and does not now fails; one that never answered has WEBSHIP_SERVE_GRACE', () => {
  const dir = sandbox();
  const { sh } = scripts(dir, 'postgres');
  const served = path.join(dir, 'webship-served');
  let r = sh('probe.sh', { CODE: '000', AGE: '100' }, ['8000']);
  assert.strictEqual(r.status, 0, 'never answered, within the grace (a build, the migrations of a first start)');
  assert.ok(!fs.existsSync(served));
  r = sh('probe.sh', { CODE: '000', AGE: '1800' }, ['8000']);
  assert.strictEqual(r.status, 1);
  assert.match(r.out, /has not answered on port 8000 in the 1800 s since its container started/);
  r = sh('probe.sh', { CODE: '000', AGE: '100', WEBSHIP_SERVE_GRACE: '60' }, ['8000']);
  assert.strictEqual(r.status, 1, 'the grace is WEBSHIP_SERVE_GRACE');
  for (const code of ['200', '404', '500']) {
    r = sh('probe.sh', { CODE: code, AGE: '5000' }, ['8000']);
    assert.strictEqual(r.status, 0, `${code}: an answer is an answer`);
  }
  assert.ok(fs.existsSync(served), 'it has served in this container');
  r = sh('probe.sh', { CODE: '000', AGE: '120' }, ['8000']);
  assert.strictEqual(r.status, 1, 'it answered before and does not now: restarted, grace or not');
  assert.match(r.out, /answered on port 8000 before, and does not now/);
});
