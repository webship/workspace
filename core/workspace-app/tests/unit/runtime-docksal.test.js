/**
 * Docksal through the runtime layer (webship/workspace#730): a project with a .docksal/ folder is a Docksal project,
 * and the builders, tools and menus keep speaking DDEV's verbs, which fun-runtime.sh gives their meaning through `fin`
 * and the project's containers.
 *
 * A stand-in fin, docker and ddev on PATH record what each verb becomes.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { projectOfTmp } = require('./_docksal-tmp');
const projectOfTmpAtStart = projectOfTmp();
const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-docksal-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ddev'), `#!/usr/bin/env bash\necho "ddev $*" >> "${dir}/calls.log"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'fin'), `#!/usr/bin/env bash\necho "fin $* [in $PWD]" >> "${dir}/calls.log"\ntrue\n`, { mode: 0o755 });
  // docker ps answers a container id per service when the test says the project runs; docker exec records what it
  // was piped and prints the dump the test put there.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash\necho "docker $*" >> "${dir}/calls.log"\n`
    + `if [ "$1" = ps ] ; then [ -f "${dir}/running" ] && for a in "$@" ; do case "$a" in label=com.docker.compose.service=*) echo "id-\${a##*=}" ;; esac ; done ; exit 0 ; fi\n`
    + `if [ "$1" = exec ] ; then s="$(cat)" ; [ -n "$s" ] && echo "stdin: $s" >> "${dir}/calls.log" ; [ -f "${dir}/dump" ] && cat "${dir}/dump" ; fi\ntrue\n`, { mode: 0o755 });
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

function built(dir, name = 'Ds_1', args = '--project-type=drupal --docroot=web --php-version=8.3 --database=mariadb:10.11') {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const r = run(dir, p, `ddev config ${args} --project-name=${name} --auto`, { WORKSPACE_RUNTIME: 'docksal' });
  return { p, r };
}

test('detection: the x-webship block, .ddev/config.yaml and a Landofile keep their order; then a .docksal/ folder', () => {
  const dir = sandbox();
  const { p } = built(dir);
  assert.match(run(dir, p, 'runtime_of; rt_find_project').out, /^docksal\ndocksal \S+\/Ds_1$/m);
  fs.mkdirSync(path.join(p, 'web'));
  assert.match(run(dir, path.join(p, 'web'), 'rt_find_project').out, /^docksal \S+\/Ds_1$/m);
  // A template that ships .ddev/ after `ddev config` wrote .docksal/: the block decides.
  fs.mkdirSync(path.join(p, '.ddev')); fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), 'name: x\n');
  assert.match(run(dir, p, 'runtime_of').out, /^docksal$/m);
  // A .docksal/ of the project's own is Docksal's; .ddev/ and a Landofile of the project's own come first.
  const own = path.join(dir, 'own'); fs.mkdirSync(path.join(own, '.docksal'), { recursive: true });
  fs.writeFileSync(path.join(own, '.docksal', 'docksal.env'), 'DOCKSAL_STACK=default\n');
  assert.match(run(dir, own, 'runtime_of; rt_url').out, /^docksal\nhttp:\/\/own\.docksal\.site$/m);
  fs.writeFileSync(path.join(own, '.lando.yml'), 'name: own\n');
  assert.match(run(dir, own, 'runtime_of').out, /^lando$/m);
  fs.mkdirSync(path.join(own, '.ddev')); fs.writeFileSync(path.join(own, '.ddev', 'config.yaml'), 'name: own\n');
  assert.match(run(dir, own, 'runtime_of').out, /^ddev$/m);
  // Docksal's own settings in the home folder (~/.docksal/docksal.env) make no project of it, nor of a folder below.
  fs.mkdirSync(path.join(dir, '.docksal'), { recursive: true }); fs.writeFileSync(path.join(dir, '.docksal', 'docksal.env'), 'DOCKSAL_UUID=x\n');
  const fresh = path.join(dir, 'fresh'); fs.mkdirSync(fresh);
  assert.notStrictEqual(run(dir, fresh, 'rt_find_project').status, 0);
  assert.match(run(dir, fresh, 'runtime_of', { WORKSPACE_RUNTIME: 'docksal' }).out, /^docksal$/m, 'a new build still takes --runtime');
  // An empty .docksal/ is nothing.
  const empty = path.join(dir, 'empty'); fs.mkdirSync(path.join(empty, '.docksal'), { recursive: true });
  assert.notStrictEqual(run(dir, empty, 'rt_find_project').status, 0);
});

test('ddev config writes .docksal/: the default stack, the block, the host name and the mail service', () => {
  const dir = sandbox();
  const { p, r } = built(dir);
  assert.deepStrictEqual(r.calls, [], 'writing the files starts nothing');
  const env = fs.readFileSync(path.join(p, '.docksal', 'docksal.env'), 'utf8');
  for (const line of ['DOCKSAL_STACK=default', 'COMPOSE_PROJECT_NAME=ds-1', 'VIRTUAL_HOST=ds-1.docksal.site', 'DOCROOT=web',
    'CLI_IMAGE=docksal/cli:php8.3-3.10', 'DB_IMAGE=docksal/mariadb:10.11-1.4', 'MYSQL_USER=db', 'MYSQL_PASSWORD=db', 'MYSQL_DATABASE=db']) {
    assert.ok(env.split('\n').includes(line), line);
  }
  const yml = fs.readFileSync(path.join(p, '.docksal', 'docksal.yml'), 'utf8');
  assert.match(yml, /^x-webship:\n {2}runtime: docksal\n {2}name: Ds_1\n {2}stack: php\n {2}type: drupal\n {2}docroot: "web"\n {2}php: "8\.3"\n {2}database: "10\.11"\n {2}host: ds-1\.docksal\.site$/m);
  assert.match(yml, /- WEBSHIP_RUNTIME=docksal/);
  assert.match(yml, /mail:\n {4}extends:\n {6}file: \$\{HOME\}\/\.docksal\/stacks\/services\.yml\n {6}service: mail/);
  assert.match(run(dir, p, 'rt_url; rt_mail_url; rt_name "$PWD"').out, /^http:\/\/ds-1\.docksal\.site\nhttp:\/\/mail\.ds-1\.docksal\.site\nDs_1$/m);
  // A second `ddev config` keeps what it was not asked to change, and the claim.
  run(dir, p, 'rt_claim wordpress');
  run(dir, p, 'ddev config --php-version=8.4 --webimage-extra-packages=""');
  const again = fs.readFileSync(path.join(p, '.docksal', 'docksal.yml'), 'utf8');
  assert.match(again, /^ {2}platform: wordpress$/m);
  assert.match(again, /^ {2}php: "8\.4"$/m);
  assert.match(again, /^ {2}docroot: "web"$/m);
  assert.match(fs.readFileSync(path.join(p, '.docksal', 'docksal.env'), 'utf8'), /^CLI_IMAGE=docksal\/cli:php8\.4-3\.10$/m);
  assert.match(run(dir, p, 'rt_is_platform "$PWD" wordpress && echo yes').out, /^yes$/m);
});

test('a .docksal/ of the project\'s own is never written over', () => {
  const dir = sandbox();
  const own = path.join(dir, 'own'); fs.mkdirSync(path.join(own, '.docksal'), { recursive: true });
  fs.writeFileSync(path.join(own, '.docksal', 'docksal.env'), 'DOCKSAL_STACK=acquia\n');
  const r = run(dir, own, 'ddev config --project-type=drupal --auto');
  assert.strictEqual(fs.readFileSync(path.join(own, '.docksal', 'docksal.env'), 'utf8'), 'DOCKSAL_STACK=acquia\n');
  assert.ok(!fs.existsSync(path.join(own, '.docksal', 'docksal.yml')));
  assert.match(r.out, /the project's own/);
});

test('start, stop, restart and delete go through fin in the project; nothing goes to DDEV', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.mkdirSync(path.join(p, 'web'));
  const fin = (script, cwd = p) => run(dir, cwd, script).calls.filter((c) => c.startsWith('fin ') || c.startsWith('ddev '));
  assert.deepStrictEqual(fin('ddev start -y'), [`fin project start [in ${p}]`]);
  assert.deepStrictEqual(fin('ddev stop', path.join(p, 'web')), [`fin project stop [in ${p}]`], 'from a folder inside it too');
  assert.deepStrictEqual(fin('ddev restart'), [`fin project stop [in ${p}]`, `fin project start [in ${p}]`]);
  assert.deepStrictEqual(fin('ddev delete -y -O'), [`fin project remove -f [in ${p}]`]);
  assert.match(run(dir, p, 'ddev launch /user/login').out, /^http:\/\/ds-1\.docksal\.site\/user\/login$/m);
  assert.match(run(dir, p, 'ddev add-on get x').out, /nothing to do here/);
  assert.notStrictEqual(run(dir, p, 'ddev artisan').status, 0);
});

test('commands run in the project\'s containers with docker exec -i: PHP in cli as Docksal\'s user', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.writeFileSync(path.join(dir, 'running'), '');
  fs.writeFileSync(path.join(p, 'composer.json'), JSON.stringify({ config: { 'bin-dir': 'bin/' } }));
  fs.mkdirSync(path.join(p, 'web'));
  const ex = (script, cwd = p) => run(dir, cwd, script).calls.filter((c) => c.startsWith('docker exec')).map((c) => c.trimEnd());
  assert.deepStrictEqual(ex('ddev composer install'), ["docker exec -i -u docker id-cli bash -c cd '/var/www' && composer install"]);
  assert.deepStrictEqual(ex('ddev composer require drupal/token', path.join(p, 'web')), ["docker exec -i -u docker id-cli bash -c cd '/var/www/web' && composer require drupal/token"]);
  assert.deepStrictEqual(ex('ddev drush status'), ['docker exec -i -u docker id-cli bash -c cd /var/www && bin/drush status']);
  assert.deepStrictEqual(ex('ddev wp user list'), ["docker exec -i -u docker id-cli bash -c cd '/var/www' && wp user list"]);
  assert.deepStrictEqual(ex('ddev exec "ls && pwd"'), ["docker exec -i -u docker id-cli bash -c cd '/var/www' && ls && pwd"], "DDEV's web is Docksal's cli");
  assert.deepStrictEqual(ex('ddev exec php run.php --summary="Two words"'), ["docker exec -i -u docker id-cli bash -c cd '/var/www' && php run.php --summary=Two\\ words"]);
  assert.deepStrictEqual(ex('ddev exec -s db "mysql -V"'), ['docker exec -i id-db bash -c mysql -V']);
  const lookup = run(dir, p, 'ddev drush status').calls.find((c) => c.startsWith('docker ps'));
  assert.strictEqual(lookup, `docker ps -q --filter label=com.docker.compose.project.working_dir=${p}/.docksal --filter label=com.docker.compose.service=cli`);
  assert.match(ex('ddev composer create-project drupal/recommended-project:^11 .')[0], /^docker exec -i -u docker id-cli bash -c cd '\/var\/www' && rm -rf \/tmp\/webship-create && composer create-project/);
  // Not running: said, not a docker error.
  fs.unlinkSync(path.join(dir, 'running'));
  assert.match(run(dir, p, 'ddev drush status; echo "rc=$?"').out, /is not running[\s\S]*|rc=1/);
});

test('the database: export, import and mysql in the db container, what is piped in reaching it', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.writeFileSync(path.join(dir, 'running'), '');
  fs.writeFileSync(path.join(dir, 'dump'), 'CREATE TABLE t (a int);\n');
  const file = path.join(dir, 'out.sql.gz');
  const e = run(dir, p, `ddev export-db --file=${file}; echo "rc=$?"`);
  assert.match(e.out, /rc=0/);
  assert.match(e.calls.find((c) => c.startsWith('docker exec')), /^docker exec -i id-db bash -c mysqldump -u"\$\{MYSQL_USER:-user\}"/);
  assert.match(spawnSync('bash', ['-c', `gunzip -c ${file}`], { encoding: 'utf8' }).stdout, /CREATE TABLE t/);
  fs.unlinkSync(path.join(dir, 'dump'));
  const i = run(dir, p, `ddev import-db --file=${file}; echo "rc=$?"`);
  assert.ok(i.calls.includes('stdin: CREATE TABLE t (a int);'), i.calls.join(' | '));
  assert.match(i.calls.find((c) => c.startsWith('docker exec')), /^docker exec -i id-db bash -c mysql -u"\$\{MYSQL_USER/);
  assert.match(run(dir, p, `ddev export-db --file=${dir}/empty.sql.gz; echo "rc=$?"`).out, /rc=1/, 'an export that wrote nothing fails');
});

test('describe -j: running when the web and cli containers are', () => {
  const dir = sandbox();
  const { p } = built(dir);
  assert.strictEqual(JSON.parse(run(dir, p, 'ddev describe -j').out.trim()).raw.status, 'stopped');
  fs.writeFileSync(path.join(dir, 'running'), '');
  const up = JSON.parse(run(dir, p, 'ddev describe -j').out.trim()).raw;
  assert.deepStrictEqual([up.name, up.status, up.runtime, up.primary_url], ['Ds_1', 'running', 'docksal', 'http://ds-1.docksal.site']);
});

test('drupal: settings.php includes the runtime\'s database settings, on the host db', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.mkdirSync(path.join(p, 'web', 'sites', 'default'), { recursive: true });
  fs.writeFileSync(path.join(p, 'web', 'sites', 'default', 'default.settings.php'), '<?php\n');
  run(dir, p, 'ddev start');
  assert.match(fs.readFileSync(path.join(p, 'web', 'sites', 'default', 'settings.webship-runtime.php'), 'utf8'), /'host' => 'db',/);
  assert.doesNotMatch(fs.readFileSync(path.join(p, 'web', 'sites', 'default', 'settings.php'), 'utf8'), /\$databases/);
});

test('no Docksal on the machine: said, not left to the shell', () => {
  const dir = sandbox();
  const { p } = built(dir);
  fs.unlinkSync(path.join(dir, 'bin', 'fin'));
  const r = run(dir, p, 'ddev start; echo "rc=$?"', { PATH: `${dir}/bin:/usr/bin:/bin` });
  assert.match(r.out, /needs Docksal/);
  assert.match(r.out, /rc=1/);
});

test('a temporary folder is never a project, whatever .docksal/ it holds; a project below it still is (#772)', () => {
  const dir = sandbox();
  // `dir` stands for the machine's temporary folder (TMPDIR), holding what Docksal's fin left in /tmp/.docksal when it
  // took /tmp for a project. The home folder is elsewhere, so its rule does not apply here, and the workspace is the
  // repository's (run's WORKSPACE_ROOT), which `dir` is not under.
  fs.mkdirSync(path.join(dir, '.docksal'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.docksal', 'docksal.env'), 'DOCKSAL_STACK=default\n');
  fs.writeFileSync(path.join(dir, '.docksal', 'docksal.yml'), '\n');
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  const plain = path.join(dir, 'plain', 'below'); fs.mkdirSync(plain, { recursive: true });
  const tmp = { TMPDIR: dir, HOME: home };
  assert.notStrictEqual(run(dir, plain, 'rt_find_project', tmp).status, 0, 'a sandbox under it is no project');
  assert.match(run(dir, plain, 'runtime_of', tmp).out, /^ddev$/m, 'and a new build in it is not taken for a Docksal one');
  const { p } = built(dir);
  assert.match(run(dir, p, 'rt_find_project', tmp).out, /^docksal \S+\/Ds_1$/m, 'a project below it is still found');
  // The machine's own temporary folders, by name, whatever TMPDIR says.
  assert.match(run(dir, dir, 'rt_never_a_root /tmp && rt_never_a_root /var/tmp/ && rt_never_a_root /dev/shm && ! rt_never_a_root /tmp/x && ! rt_never_a_root /home/x && echo ok', { TMPDIR: '' }).out, /^ok$/m);
});

test('a look that starts in the workspace never takes the workspace\'s folder or one above it for a project (#772)', () => {
  const dir = sandbox();
  // A folder above the workspace with a .docksal/ of its own, a workspace holding a .ddev/ of its own, and a plain
  // folder in a workspace folder: none is a project, though each was found before.
  fs.mkdirSync(path.join(dir, '.docksal'));
  fs.writeFileSync(path.join(dir, '.docksal', 'docksal.env'), 'DOCKSAL_STACK=default\n');
  const ws = path.join(dir, 'ws');
  const plain = path.join(ws, 'dev', 'plain');
  fs.mkdirSync(plain, { recursive: true });
  const env = { WORKSPACE_ROOT: ws, HOME: path.join(dir, 'home') };
  assert.notStrictEqual(run(dir, plain, 'rt_find_project', env).status, 0, 'the folder above the workspace is not its project');
  assert.notStrictEqual(run(dir, ws, 'rt_find_project', env).status, 0, 'nor is the workspace\'s own folder');
  fs.mkdirSync(path.join(ws, '.ddev'));
  fs.writeFileSync(path.join(ws, '.ddev', 'config.yaml'), 'name: the-workspace\n');
  assert.notStrictEqual(run(dir, plain, 'rt_find_project', env).status, 0, 'a .ddev/ of the workspace\'s own makes no project of it');
  assert.match(run(dir, plain, 'runtime_of', { ...env, WORKSPACE_RUNTIME: 'docksal' }).out, /^docksal$/m, 'a new build there takes the runtime asked');
  // A project in the workspace is found from its own folder and from below it, the workspace given with a slash.
  const p = path.join(ws, 'dev', 'Ds_1');
  fs.mkdirSync(path.join(p, '.docksal'), { recursive: true });
  fs.writeFileSync(path.join(p, '.docksal', 'docksal.env'), 'DOCKSAL_STACK=default\n');
  fs.mkdirSync(path.join(p, 'web'));
  assert.match(run(dir, path.join(p, 'web'), 'rt_find_project', { ...env, WORKSPACE_ROOT: `${ws}/` }).out, /^docksal \S+\/ws\/dev\/Ds_1$/m);
  // A look that starts outside the workspace is as it was: the folder above with its .docksal/ is the project.
  const outside = path.join(dir, 'elsewhere');
  fs.mkdirSync(outside);
  assert.match(run(dir, outside, 'rt_find_project', env).out, new RegExp(`^docksal ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('/tmp/.docksal is as this file found it: no test above made a project of /tmp (#772)', () => {
  assert.deepStrictEqual(projectOfTmp(), projectOfTmpAtStart);
});
