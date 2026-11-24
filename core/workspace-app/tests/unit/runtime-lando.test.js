/**
 * Lando through the runtime layer (webship/workspace#729): a project with a .lando.yml is a Lando project, and the
 * builders, tools and menus keep speaking DDEV's verbs, which fun-runtime.sh gives their meaning through `lando …`.
 *
 * A stand-in lando, docker and ddev on PATH record what each verb becomes, with the environment Lando is called with.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-lando-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'ddev']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\n`
      // `docker ps -q --filter label=io.lando.root=…`: the app's containers when the test says they run.
      + `[ "$1" = ps ] && [ -f "${dir}/running" ] && [[ "$*" != *status=exited* ]] && echo c0ffee\ntrue\n`, { mode: 0o755 });
  }
  // Lando records its arguments, the two settings the layer gives it, and what was piped in.
  fs.writeFileSync(path.join(bin, 'lando'), `#!/usr/bin/env bash\necho "lando $* [proxy=$LANDO_PROXY channel=$LANDO_CHANNEL]" >> "${dir}/calls.log"\n`
    + `[ -t 0 ] || { s="$(cat)" ; [ -n "$s" ] && echo "stdin: $s" >> "${dir}/calls.log" ; }\n[ "$1" = exec ] && [ -f "${dir}/dump" ] && cat "${dir}/dump"\n`
    // A start whose healthcheck gave up: Lando answers 1.
    + `case "$1" in start|restart|rebuild) [ -f "${dir}/fail-start" ] && exit 1 ;; esac\n[ "$1" = exec ] && [ -f "${dir}/db-down" ] && exit 1\ntrue\n`, { mode: 0o755 });
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

/** A project the Workspace built on Lando: `ddev config` in an empty folder, with --runtime lando. */
function built(dir, name = 'l1', args = '--project-type=drupal --docroot=web --php-version=8.3 --database=mariadb:10.11') {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const r = run(dir, p, `ddev config ${args} --project-name=${name} --auto`, { WORKSPACE_RUNTIME: 'lando' });
  return { p, r };
}

test('detection: the x-webship block first, then .ddev/config.yaml, then a Landofile of the project\'s own', () => {
  const dir = sandbox();
  const { p } = built(dir);
  assert.match(run(dir, p, 'runtime_of; rt_find_project').out, /^lando\nlando \S+\/l1$/m);
  // From a folder inside the project (the docroot), the project is the one above.
  fs.mkdirSync(path.join(p, 'web'));
  assert.match(run(dir, path.join(p, 'web'), 'rt_find_project').out, /^lando \S+\/l1$/m);
  // A template that ships .ddev/ after `ddev config` wrote .lando.yml: the block decides.
  fs.mkdirSync(path.join(p, '.ddev')); fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), 'name: l1\ntype: drupal11\n');
  assert.match(run(dir, p, 'runtime_of').out, /^lando$/m);
  // A Landofile the Workspace did not write is Lando's too, and a DDEV project that has one stays DDEV.
  const own = path.join(dir, 'own'); fs.mkdirSync(own); fs.writeFileSync(path.join(own, '.lando.yml'), 'name: own\nrecipe: drupal11\n');
  assert.match(run(dir, own, 'runtime_of').out, /^lando$/m);
  const yaml = path.join(dir, 'yaml'); fs.mkdirSync(yaml); fs.writeFileSync(path.join(yaml, '.lando.yaml'), 'name: yaml\n');
  assert.match(run(dir, yaml, 'runtime_of').out, /^lando$/m);
  const both = path.join(dir, 'both'); fs.mkdirSync(path.join(both, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(both, '.ddev', 'config.yaml'), 'name: both\n'); fs.writeFileSync(path.join(both, '.lando.yml'), 'name: both\n');
  assert.match(run(dir, both, 'runtime_of').out, /^ddev$/m);
  // A compose.yaml block still comes before a Landofile's.
  const dc = path.join(dir, 'dc'); fs.mkdirSync(dc);
  fs.writeFileSync(path.join(dc, 'compose.yaml'), 'name: dc\nx-webship:\n  runtime: docker\n  port: 41999\n');
  fs.writeFileSync(path.join(dc, '.lando.yml'), 'name: dc\nx-webship:\n  runtime: lando\n  port: 41998\n');
  assert.match(run(dir, dc, 'runtime_of; rt_url').out, /^docker\nhttp:\/\/127\.0\.0\.1:41999$/m);
});

test('ddev config writes .lando.yml: the lamp recipe, the block, a port of this machine and the mailbox', () => {
  const dir = sandbox();
  const { p, r } = built(dir);
  assert.deepStrictEqual(r.calls, [], 'writing the file starts nothing');
  const lando = fs.readFileSync(path.join(p, '.lando.yml'), 'utf8');
  assert.match(lando, /^name: l1$/m);
  assert.match(lando, /^x-webship:\n {2}runtime: lando\n {2}stack: php\n {2}type: drupal\n {2}docroot: "web"\n {2}php: "8\.3"\n {2}database: "10\.11"\n {2}port: (\d+)\n {2}mail_port: (\d+)$/m);
  const port = lando.match(/^ {2}port: (\d+)$/m)[1];
  const mail = lando.match(/^ {2}mail_port: (\d+)$/m)[1];
  assert.notStrictEqual(port, mail);
  assert.match(lando, /^recipe: lamp\nconfig:\n {2}webroot: "web"\n {2}php: "8\.3"\n {2}database: mariadb:10\.11\n {2}via: apache$/m);
  assert.ok(lando.includes(`- "127.0.0.1:${port}:80"`), 'the site on this machine only');
  assert.ok(lando.includes(`- "127.0.0.1:${mail}:80"`), "Mailpit's page and API on this machine only");
  assert.match(lando, /WEBSHIP_RUNTIME: lando/);
  // Lando's Apache passes BACKDROP_SETTINGS to the site: valid JSON with nothing in it, not the text of the variable.
  assert.match(lando, /^ {8}BACKDROP_SETTINGS: "\{\}"$/m);
  assert.deepStrictEqual(JSON.parse(lando.match(/^ {8}BACKDROP_SETTINGS: "(.*)"$/m)[1]), {});
  assert.match(lando, /creds:\n {6}user: db\n {6}password: db\n {6}database: db/);
  assert.match(lando, /wp-cli\.phar/, 'WP-CLI, as the php stack has it');
  assert.match(lando, /aliases:\n {12}- db\n/, 'the database on the host db too, as on the other runtimes');
  const conf = fs.readFileSync(path.join(p, '.webship', 'runtime', 'lando-port.conf'), 'utf8');
  assert.match(conf, new RegExp(`^Listen ${port}$`, 'm'), 'the site reaches itself at its own address');
  assert.match(conf, /DocumentRoot \/app\/web/);
  assert.match(run(dir, p, 'rt_url; rt_mail_url').out, new RegExp(`^http://127\\.0\\.0\\.1:${port}\nhttp://127\\.0\\.0\\.1:${mail}$`, 'm'));
  // A second `ddev config` (the build's re-align after create-project) keeps the ports, the claim and what it was
  // not asked to change.
  run(dir, p, 'rt_claim wordpress');
  run(dir, p, 'ddev config --database=mariadb:10.11 --webimage-extra-packages="" --php-version=8.4');
  const again = fs.readFileSync(path.join(p, '.lando.yml'), 'utf8');
  assert.match(again, new RegExp(`^ {2}port: ${port}$`, 'm'));
  assert.match(again, new RegExp(`^ {2}mail_port: ${mail}$`, 'm'));
  assert.match(again, /^ {2}platform: wordpress$/m);
  assert.match(again, /^ {2}php: "8\.4"$/m);
  assert.match(again, /^ {2}docroot: "web"$/m);
  assert.match(run(dir, p, 'rt_is_platform "$PWD" wordpress && echo yes').out, /^yes$/m);
});

test('a Landofile of the project\'s own is never written over', () => {
  const dir = sandbox();
  const own = path.join(dir, 'own'); fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, '.lando.yml'), 'name: own\nrecipe: drupal11\n');
  const r = run(dir, own, 'ddev config --project-type=drupal --docroot=web --auto; rt_claim drupal; echo "claim rc=$?"; rt_url');
  assert.strictEqual(fs.readFileSync(path.join(own, '.lando.yml'), 'utf8'), 'name: own\nrecipe: drupal11\n');
  assert.match(r.out, /the project's own/);
  assert.match(r.out, /claim rc=1/);
  assert.match(r.out, /^https:\/\/own\.lndo\.site$/m, "Lando's proxy address for an app with no port of the Workspace");
});

test('the verbs go through lando, with its proxy off and its update notices quiet', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.writeFileSync(path.join(p, 'composer.json'), JSON.stringify({ config: { 'bin-dir': 'bin/' } }));
  fs.mkdirSync(path.join(p, 'web'));
  // What Lando is asked (a start also reads the app's containers from docker first).
  const q = (script, cwd = p) => run(dir, cwd, script).calls.filter((c) => !c.startsWith('docker ps'));
  const env = '[proxy=OFF channel=none]';
  assert.deepStrictEqual(q('ddev start -y'), [`lando start ${env}`], 'a first start');
  assert.deepStrictEqual(q('ddev stop'), [`lando stop ${env}`]);
  assert.deepStrictEqual(q('ddev composer install'), [`lando exec appserver -- bash -c cd '/app' && composer install  ${env}`]);
  assert.deepStrictEqual(q('ddev composer require drupal/token', path.join(p, 'web')), [`lando exec appserver -- bash -c cd '/app/web' && composer require drupal/token  ${env}`], 'in the folder the caller is in');
  assert.deepStrictEqual(q('ddev drush status'), [`lando exec appserver -- bash -c cd /app && bin/drush status  ${env}`], "Composer's bin-dir");
  assert.deepStrictEqual(q('ddev wp option get siteurl'), [`lando exec appserver -- bash -c cd '/app' && wp option get siteurl  ${env}`]);
  assert.deepStrictEqual(q('ddev exec "ls -la && pwd"'), [`lando exec appserver -- bash -c cd '/app' && ls -la && pwd ${env}`]);
  assert.deepStrictEqual(q('ddev exec php run.php --summary="Two words"'), [`lando exec appserver -- bash -c cd '/app' && php run.php --summary=Two\\ words  ${env}`], 'several arguments are each kept whole');
  assert.deepStrictEqual(q('ddev exec -s db "mysql -V"'), [`lando exec database -- bash -c mysql -V ${env}`], "DDEV's db is Lando's database");
  assert.deepStrictEqual(q('ddev exec -d /app/web "pwd"'), [`lando exec appserver -- bash -c cd '/app/web' && pwd ${env}`]);
  assert.deepStrictEqual(q('ddev delete -y -O'), [`lando destroy -y ${env}`]);
  assert.match(q('ddev composer create-project drupal/recommended-project:^11 .')[0], /^lando exec appserver -- bash -c cd '\/app' && rm -rf \/tmp\/webship-create && composer create-project drupal\/recommended-project:\\\^11 \/tmp\/webship-create/);
  // Nothing goes to DDEV, and Lando's proxy is never asked for.
  const all = q('ddev start; ddev drush cr; ddev launch /user/login');
  assert.ok(all.every((c) => c.startsWith('lando ') && c.endsWith(env)), all.join(' | '));
  assert.match(run(dir, p, 'ddev launch /user/login').out, /^http:\/\/127\.0\.0\.1:\d+\/user\/login$/m);
  assert.match(run(dir, p, 'ddev snapshot').out, /nothing to do here/);
  assert.notStrictEqual(run(dir, p, 'ddev artisan').status, 0, 'a verb the layer does not know fails');
});

test('a start after the Landofile was written again rebuilds the app, and only then', () => {
  const dir = sandbox();
  const { p } = built(dir);
  const env = '[proxy=OFF channel=none]';
  fs.writeFileSync(path.join(dir, 'running'), '');
  // Containers exist and no start was recorded yet: the file is new to them.
  assert.deepStrictEqual(run(dir, p, 'ddev start').calls.filter((c) => c.startsWith('lando')), [`lando rebuild -y ${env}`]);
  assert.deepStrictEqual(run(dir, p, 'ddev start').calls.filter((c) => c.startsWith('lando')), [`lando start ${env}`]);
  assert.deepStrictEqual(run(dir, p, 'ddev restart').calls.filter((c) => c.startsWith('lando')), [`lando restart ${env}`]);
  run(dir, p, 'ddev config --php-version=8.4');
  assert.deepStrictEqual(run(dir, p, 'ddev restart').calls.filter((c) => c.startsWith('lando')), [`lando rebuild -y ${env}`]);
});

test('the database: export, import and mysql in the database service, with its own credentials', () => {
  const dir = sandbox();
  const { p } = built(dir);
  const env = '[proxy=OFF channel=none]';
  fs.writeFileSync(path.join(dir, 'dump'), 'CREATE TABLE t (a int);\n');
  const file = path.join(dir, 'out.sql.gz');
  const ex = run(dir, p, `ddev export-db --file=${file}; echo "rc=$?"`);
  assert.match(ex.calls[0], /^lando exec database -- bash -c "\$\(command -v mariadb-dump \|\| echo mysqldump\)" -u"\$\{MARIADB_USER:-\$\{MYSQL_USER:-db\}\}"/);
  assert.match(ex.out, /rc=0/);
  assert.match(spawnSync('bash', ['-c', `gunzip -c ${file}`], { encoding: 'utf8' }).stdout, /CREATE TABLE t/);
  fs.unlinkSync(path.join(dir, 'dump'));
  const im = run(dir, p, `ddev import-db --file=${file}; echo "rc=$?"`);
  assert.match(im.calls[0], /^lando exec database -- bash -c "\$\(command -v mariadb \|\| echo mysql\)" -u"\$\{MARIADB_USER/);
  assert.ok(im.calls.includes('stdin: CREATE TABLE t (a int);'), 'the dump is piped in');
  assert.ok(im.calls[0].endsWith(env));
  { const r = run(dir, p, `ddev import-db --file=${dir}/none.sql; echo "rc=$?"`).out; assert.match(r, /No such file/); assert.match(r, /rc=1/); }
  // An export that wrote nothing fails, as on the other runtimes.
  assert.match(run(dir, p, `ddev export-db --file=${dir}/empty.sql.gz; echo "rc=$?"`).out, /rc=1/);
});

test('describe -j: the state from the containers Lando labels with the folder', () => {
  const dir = sandbox();
  const { p } = built(dir);
  const stopped = run(dir, p, 'ddev describe -j');
  assert.deepStrictEqual(JSON.parse(stopped.out.trim()).raw.status, 'stopped');
  assert.ok(stopped.calls.some((c) => c === `docker ps -q --filter label=io.lando.root=${p}`), stopped.calls.join(' | '));
  fs.writeFileSync(path.join(dir, 'running'), '');
  const up = JSON.parse(run(dir, p, 'ddev describe -j').out.trim()).raw;
  assert.deepStrictEqual([up.name, up.status, up.runtime], ['l1', 'running', 'lando']);
  assert.match(up.primary_url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('drupal: settings.php includes the runtime\'s database settings, whose host is Lando\'s database service', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.mkdirSync(path.join(p, 'web', 'sites', 'default'), { recursive: true });
  fs.writeFileSync(path.join(p, 'web', 'sites', 'default', 'default.settings.php'), '<?php\n');
  run(dir, p, 'ddev start');
  const inc = fs.readFileSync(path.join(p, 'web', 'sites', 'default', 'settings.webship-runtime.php'), 'utf8');
  assert.match(inc, /'host' => 'database',/);
  assert.match(fs.readFileSync(path.join(p, 'web', 'sites', 'default', 'settings.php'), 'utf8'), /getenv\('WEBSHIP_RUNTIME'\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(p, 'web', 'sites', 'default', 'settings.php'), 'utf8'), /\$databases/, 'never a $databases block in settings.php');
});

test('no Lando on the machine: said, not left to the shell', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.unlinkSync(path.join(dir, 'bin', 'lando'));
  const r = run(dir, p, 'ddev start; echo "rc=$?"', { PATH: `${dir}/bin:/usr/bin:/bin` });
  assert.match(r.out, /needs Lando/);
  assert.match(r.out, /rc=1/);
});

test('a start Lando calls failed while the app runs: the database is asked before it counts', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.writeFileSync(path.join(dir, 'fail-start'), '');
  fs.writeFileSync(path.join(dir, 'running'), '');
  fs.writeFileSync(path.join(p, '.webship', 'runtime', 'lando.sum'), 'x');
  // Every container up, the database answers: the start counts.
  const ok = run(dir, p, 'ddev start; echo "rc=$?"', { WORKSPACE_LANDO_WAIT: '5' });
  assert.match(ok.out, /its database answers now/);
  assert.match(ok.out, /rc=0/);
  assert.ok(ok.calls.some((c) => /^lando exec database -- bash -c mysql .*SELECT 1/.test(c)), ok.calls.join(' | '));
  // The database never answers: Lando's answer stands.
  fs.writeFileSync(path.join(dir, 'db-down'), '');
  assert.match(run(dir, p, 'ddev start; echo "rc=$?"', { WORKSPACE_LANDO_WAIT: '5' }).out, /rc=1/);
});

test('the web container\'s database clients skip TLS, from a script the build runs as root', () => {
  const dir = sandbox();
  const { p } = built(dir);
  assert.match(fs.readFileSync(path.join(p, '.lando.yml'), 'utf8'), /build_as_root:[\s\S]*- bash \/app\/\.webship\/runtime\/lando-clients\.sh/);
  const sh = fs.readFileSync(path.join(p, '.webship', 'runtime', 'lando-clients.sh'), 'utf8');
  assert.match(sh, /for b in mysql mariadb mysqldump mariadb-dump/);
  assert.match(sh, /exec %s "\$@" --skip-ssl/);
  assert.match(sh, /\/usr\/local\/sbin\//, "before Lando's own clients on PATH");
});
