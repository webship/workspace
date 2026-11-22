/**
 * The tools behind the row's menus on a project of another runtime than DDEV (webship/workspace#694): the testing
 * setup and run, the test users, remove and clone. They call `ddev`, and the runtime layer maps it; these are the
 * places where a tool itself had to know.
 *
 * Temp workspaces, and stand-in docker, podman, kubectl and ddev on PATH that record each call (and, for the
 * tests container, do what the real command would leave on disk).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const STACKS = path.join(__dirname, '..', '..', '..', 'config', 'runtimes');
const FUN = path.join(SCRIPTS, 'functions');

const compose = (name, runtime, port = 41001) => `name: ${name}\nx-webship:\n  runtime: ${runtime}\n  stack: php\n  type: drupal\n  docroot: "web"\n  php: "8.3"\n  database: "10.11"\n  port: ${port}\nservices:\n  web:\n    image: webship-${name}-web\n`;

/** A workspace root with dev/, and stand-ins that record. `docker` is a script body run after the call is recorded. */
function sandbox({ docker = '', kubectl = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-tools-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'dev'));
  const cli = (name, body) => fs.writeFileSync(path.join(root, 'bin', name), `#!/usr/bin/env bash\necho "${name} $*" >> "${root}/calls.log"\n${body}\n`, { mode: 0o755 });
  cli('docker', docker); cli('podman', docker); cli('kubectl', kubectl); cli('ddev', ''); cli('kind', '');
  return root;
}

const project = (root, name, files) => {
  const p = path.join(root, 'dev', name);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(p, f)), { recursive: true });
    fs.writeFileSync(path.join(p, f), text);
  }
  return p;
};

/** Runs `script` with the functions sourced, as a cmd-*.sh has them, in the dev folder of the workspace. */
function run(root, script, { functions = [], env = {} } = {}) {
  const sources = ['fun-runtime.sh', ...functions].map((f) => `source ${FUN}/${f}`).join('; ');
  const r = spawnSync('bash', ['-c', `WORKSPACE_SCRIPTS=${SCRIPTS}; ${sources}; RT_STACKS=${STACKS}; WORKSPACE_ROOT=${root}; doc_name=dev; cd ${root}/dev; ${script}`],
    { encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, WORKSPACE_ROOT: root, WORKSPACE_KUBE_CONTEXT: '', WORKSPACE_KIND_CLUSTER: '', ...env } });
  const log = path.join(root, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { out: r.stdout + r.stderr, calls, status: r.status };
}

/* ---------------- the Tests menu: setup and run ---------------- */

// What the tests container leaves on disk: webship-js installed, its scaffold, the dependencies.
const TESTS_CONTAINER = `
dir="" ; prev="" ; for a in "$@" ; do [ "$prev" = "-w" ] && dir="$a" ; prev="$a" ; done
case "$*" in
  *"ps --status running -q web"*) [ -f "$(dirname "$0")/../stopped" ] || echo abc123 ;;
  *"npm install --no-save webship-js"*) mkdir -p "$dir/node_modules/webship-js" "$dir/node_modules/.bin" ;;
  *"init-webship-js --skip-browsers"*) mkdir -p "$dir/tests/features" "$dir/tests/step-definitions" ; echo 'module.exports = {};' > "$dir/cucumber.js" ; echo '{"name":"project-name","scripts":{}}' > "$dir/package.json"
     [ -f "$dir/tests/features/check-homepage.feature" ] || printf 'Feature: Check the home page\\n  Scenario: Check homepage\\n    Then I should see "Love to help in speeding up the work"\\n' > "$dir/tests/features/check-homepage.feature" ;;
  *"bash -c npm install"*) mkdir -p "$dir/node_modules/@cucumber/cucumber" ;;
  *"printenv LAUNCH_URL"*) echo "http://127.0.0.1:41001" ;;
  *"cucumber.js --config cucumber.js"*) echo "1 scenario (1 passed)" ; echo "2 steps (2 passed)" ;;
esac`;

const TESTING = ['fun-testing.sh'];
const CONFIGURE = 'PROJECT_NAME=site; testing_configure_plugins() { : ; }; testing_steps_suggest() { : ; }; testing_configure; echo "status $?"';

test('the testing setup on a Docker site: webship-js scaffolds itself in the tests container, with no DDEV add-on', () => {
  const root = sandbox({ docker: TESTS_CONTAINER });
  const site = project(root, 'site', { 'compose.yaml': compose('site', 'docker') });
  const r = run(root, CONFIGURE, { functions: TESTING });
  assert.match(r.out, /status 0$/m, r.out);
  assert.match(r.out, /Adding webship-js \(Playwright \+ Cucumber-js\) in the docker tests container\./);
  assert.match(r.out, /Testing is set up on dev\/site \(webship-js\)\./);
  const inTests = r.calls.filter((c) => /^docker run /.test(c)).map((c) => c.replace(/^.* webship-workspace-tests bash -c /, '').trim());
  assert.deepStrictEqual(inTests, [
    'npm install --no-save webship-js',
    'node_modules/.bin/init-webship-js --skip-browsers',
    'npm install',
    'ldconfig -p | grep -q libnspr4',
    'PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium',
  ]);
  assert.ok(r.calls.every((c) => !/^ddev /.test(c)), 'DDEV is never called on a Docker site');
  assert.doesNotMatch(r.out, /add-on/);
  assert.ok(!r.calls.includes('docker compose up -d --build --wait'), 'a running site is not started again');
  // The sample feature, which is about webship.co, becomes one that holds on any site: what the add-on does.
  assert.match(fs.readFileSync(path.join(site, 'tests', 'features', 'check-homepage.feature'), 'utf8'), /Then I should be on homepage/);
  // What the dashboard's Tests caption reads: the browser libraries were seen where the suite runs.
  assert.ok(fs.existsSync(path.join(site, 'node_modules', '.cache', 'webship-workspace', 'browser-libs')));
});

test('a stopped Docker site is started first; a feature a person edited is kept', () => {
  const root = sandbox({ docker: TESTS_CONTAINER });
  fs.writeFileSync(path.join(root, 'stopped'), '');
  const site = project(root, 'site', { 'compose.yaml': compose('site', 'docker'), 'node_modules/webship-js/package.json': '{}',
    'tests/features/check-homepage.feature': 'Feature: mine\n' });
  const r = run(root, CONFIGURE, { functions: TESTING });
  assert.match(r.out, /status 0$/m, r.out);
  assert.ok(r.calls.includes('docker compose up -d --build --wait'), r.calls.join('\n'));
  assert.ok(!r.calls.some((c) => /npm install --no-save webship-js/.test(c)), 'webship-js is there already');
  assert.strictEqual(fs.readFileSync(path.join(site, 'tests', 'features', 'check-homepage.feature'), 'utf8'), 'Feature: mine\n', 'init-webship-js keeps what it finds, and so does the setup');
});

test('a suite on Kubernetes and on Podman runs in the same tests container, by docker and by podman', () => {
  const kube = sandbox({ docker: TESTS_CONTAINER, kubectl: 'case "$*" in *"get deploy web"*) printf 1 ;; *"get nodes"*) printf 172.18.0.2 ;; esac' });
  project(kube, 'site', { 'compose.yaml': compose('site', 'kubernetes', 30081) });
  const k = run(kube, CONFIGURE, { functions: TESTING });
  assert.match(k.out, /status 0$/m, k.out);
  assert.match(k.out, /in the kubernetes tests container/);
  assert.ok(k.calls.some((c) => /^docker run --rm --network host .* -e LAUNCH_URL=http:\/\/172\.18\.0\.2:30081 webship-workspace-tests bash -c npm install/.test(c)), k.calls.join('\n'));

  const pod = sandbox({ docker: TESTS_CONTAINER });
  project(pod, 'site', { 'compose.yaml': compose('site', 'podman') });
  const p = run(pod, CONFIGURE, { functions: TESTING });
  assert.match(p.out, /status 0$/m, p.out);
  assert.ok(p.calls.some((c) => /^podman run --rm --network host --userns=keep-id .* bash -c npm install --no-save webship-js/.test(c)), p.calls.join('\n'));
  assert.ok(p.calls.every((c) => !/^docker /.test(c)), 'Podman never calls docker');
});

test('a run on a Docker site: cucumber in the tests container, the browsers from the shared volume, the site at its own address', () => {
  const root = sandbox({ docker: TESTS_CONTAINER });
  project(root, 'site', { 'compose.yaml': compose('site', 'docker'), 'cucumber.js': 'module.exports = {};', 'package.json': '{"name":"x"}' });
  const r = run(root, 'PROJECT_NAME=site; BROWSER=chromium; HEADED=no; TESTING_PATH=tests/features/check-homepage.feature; TAGS=_none_; RETRY=_none_; DRY_RUN=no; VIDEO=_none_; TESTING_PROFILE=default; testing_run; echo "status $?"', { functions: TESTING });
  assert.match(r.out, /status 0$/m, r.out);
  assert.match(r.out, /dev\/site is already running\./);
  assert.match(r.out, /The suite passed in \d+s\./);
  const cucumber = r.calls.find((c) => /cucumber\.js --config cucumber\.js/.test(c));
  assert.match(cucumber, /^docker run --rm --network host --user \d+:\d+ -v \S+\/dev\/site:\S+\/dev\/site -v webship-workspace-tests:\/cache -w \S+\/dev\/site -e LAUNCH_URL=http:\/\/127\.0\.0\.1:41001 webship-workspace-tests bash -c /);
  assert.match(cucumber, /PLAYWRIGHT_BROWSERS_PATH=\/cache\/ms-playwright BROWSER=chromium WEBSHIP_VIDEO_DIR=tests\/videos WEBSHIP_REPORT_NAME=site FEATURES="tests\/features\/check-homepage\.feature" node \.\/node_modules\/@cucumber\/cucumber\/bin\/cucumber\.js --config cucumber\.js/);
  assert.doesNotMatch(cucumber, /ddev-global-cache/);
  assert.ok(r.calls.every((c) => !/^ddev /.test(c)));
});

test('a DDEV project keeps DDEV\'s web container and DDEV\'s browser cache, with the layer loaded', () => {
  const root = sandbox();
  project(root, 'site', { '.ddev/config.yaml': 'name: site\ntype: drupal\n' });
  const r = run(root, 'cd site; testing_on_ddev && echo "on ddev"; testing_browsers_path; echo; testing_install_browsers; testing_exec "node -v"', { functions: TESTING });
  assert.match(r.out, /^on ddev$/m);
  assert.match(r.out, /^\/mnt\/ddev-global-cache\/ms-playwright$/m);
  assert.match(r.out, /Making sure the Playwright browsers are in the shared DDEV cache\./);
  assert.deepStrictEqual(r.calls, [
    'ddev exec PLAYWRIGHT_BROWSERS_PATH=/mnt/ddev-global-cache/ms-playwright PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium',
    'ddev exec node -v',
  ]);
});

test('a folder that is no project of any runtime is still refused, in the words it always was', () => {
  const root = sandbox();
  project(root, 'plain', { 'README.md': 'x' });
  const r = run(root, 'PROJECT_NAME=plain; testing_configure; echo "status $?"', { functions: TESTING });
  assert.match(r.out, /dev\/plain is not a DDEV project — the testing stack runs inside DDEV\./);
  assert.match(r.out, /status 1$/m);
  assert.deepStrictEqual(r.calls, []);
});

/* ---------------- the test users ---------------- */

test('the test users find the docroot of a runtime project in its compose.yaml, and of a DDEV one in its config', () => {
  const root = sandbox();
  project(root, 'dock', { 'compose.yaml': compose('dock', 'docker') });
  project(root, 'dd', { '.ddev/config.yaml': 'name: dd\ndocroot: docroot\n' });
  const users = 'distribution_name=demo; set_demo_users() { : ; }; load_distribution_users; echo "webroot=${distribution_webroot}"';
  assert.match(run(root, `PROJECT_NAME=dock; ${users}`, { functions: ['fun-users.sh'] }).out, /^webroot=web$/m);
  assert.match(run(root, `PROJECT_NAME=dd; ${users}`, { functions: ['fun-users.sh'] }).out, /^webroot=docroot$/m);
});

/* ---------------- remove ---------------- */

const REMOVE = ['fun-project-name.sh', 'fun-git-worktrees.sh', 'fun-remove-project.sh'];
/** A Drupal site after an install: sites/default and what is in it have lost their write bit. */
function hardened(site) {
  const sd = path.join(site, 'web', 'sites', 'default');
  fs.mkdirSync(sd, { recursive: true });
  fs.writeFileSync(path.join(sd, 'settings.php'), '<?php\n');
  fs.chmodSync(path.join(sd, 'settings.php'), 0o444);
  fs.chmodSync(sd, 0o555);
}

test('removing a Docker site: the compose project and its volume go, then its image, then the folder Drupal made read-only', () => {
  const root = sandbox();
  const site = project(root, 'shop', { 'compose.yaml': compose('shop', 'docker') });
  hardened(site);
  const r = run(root, 'remove_project shop; echo "status $?"', { functions: REMOVE });
  assert.match(r.out, /status 0$/m, r.out);
  assert.match(r.out, /Removing dev\/shop {2}\(docker project: shop\)/);
  assert.match(r.out, /Removed .*\/dev\/shop, its containers, its database volume and its image\./);
  assert.ok(!fs.existsSync(site), 'the folder is gone, read-only sites/default included');
  assert.deepStrictEqual(r.calls, [
    'docker compose down -v --remove-orphans',
    'docker ps -a --filter label=com.docker.compose.project=shop --format {{.Names}}',
    'docker volume ls --filter label=com.docker.compose.project=shop --format {{.Name}}',
    'docker image rm webship-shop-web',
  ]);
});

test('the folder is kept while Docker still holds something of the project', () => {
  const root = sandbox({ docker: 'case "$*" in "ps -a --filter"*"--format"*) echo shop-web-1 ;; esac' });
  const site = project(root, 'shop', { 'compose.yaml': compose('shop', 'docker') });
  const r = run(root, 'remove_project shop; echo "status $?"', { functions: REMOVE });
  assert.match(r.out, /status 1$/m, r.out);
  assert.match(r.out, /KEEPING the directory: docker still holds these for 'shop':\n\s+shop-web-1/);
  assert.ok(fs.existsSync(site));
  assert.ok(!r.calls.some((c) => /image rm/.test(c)), 'the image stays while its containers do');
});

test('removing a Kubernetes site: the namespace goes, the image leaves Docker and the kind node; a backup is taken when asked', () => {
  const root = sandbox({ kubectl: 'case "$*" in *"get deploy web"*) printf 1 ;; *"get nodes"*) printf 172.18.0.2 ;; esac' });
  const site = project(root, 'k1', { 'compose.yaml': compose('k1', 'kubernetes', 30081) });
  hardened(site);
  const r = run(root, 'BACKUP=yes; remove_project k1; echo "status $?"', { functions: REMOVE });
  assert.match(r.out, /status 0$/m, r.out);
  assert.match(r.out, /Removed .*\/dev\/k1, its namespace ws-k1 and its image\./);
  assert.ok(!fs.existsSync(site));
  assert.ok(r.calls.includes('kubectl --context kind-webship delete ns ws-k1 --wait=true'), r.calls.join('\n'));
  assert.ok(r.calls.includes('docker image rm webship-k1-web'));
  assert.ok(r.calls.includes('docker exec webship-control-plane crictl rmi docker.io/library/webship-k1-web:latest'));
  // The dump the stand-in wrote is empty, which is a failed export: said, and no empty file is left as a backup.
  assert.match(r.out, /Backing the database up before anything is deleted/);
  assert.match(r.out, /no database export/);
  assert.ok(!fs.existsSync(path.join(root, 'backups', 'dev', 'k1')), 'no folder holding an empty dump');
});

test('a plain folder with a read-only folder inside is removed, and a DDEV project is still removed by DDEV', () => {
  const root = sandbox();
  const plain = project(root, 'files', { 'README.md': 'x' });
  hardened(plain);
  const p = run(root, 'remove_project files; echo "status $?"', { functions: REMOVE });
  assert.match(p.out, /files has no \.ddev\/config\.yaml — removing the directory only\./);
  assert.match(p.out, /status 0$/m, p.out);
  assert.ok(!fs.existsSync(plain));

  const dd = project(root, 'dd', { '.ddev/config.yaml': 'name: dd\n' });
  const d = run(root, 'remove_project dd; echo "status $?"', { functions: REMOVE });
  assert.match(d.out, /Removing dev\/dd {2}\(DDEV project: dd\)/);
  assert.strictEqual(d.calls[0], 'ddev delete -y -O', 'DDEV itself, as before');
  assert.ok(!fs.existsSync(dd));
});

/* ---------------- clone ---------------- */

test('a runtime project is not cloned yet: said, and nothing is copied', () => {
  const root = sandbox();
  project(root, 'shop', { 'compose.yaml': compose('shop', 'docker') });
  const r = run(root, 'PROJECT_NAME=shop; TO=shop2; TARGET_WORKSPACE=_none_; WORKTREE=no; clone_project; echo "status $?"',
    { functions: ['fun-git-worktrees.sh', 'fun-ddev-hostnames.sh', 'fun-clone-project.sh'] });
  assert.match(r.out, /'shop' runs on docker, and cloning a project of that runtime is not done yet/);
  assert.match(r.out, /status 1$/m);
  assert.ok(!fs.existsSync(path.join(root, 'dev', 'shop2')));
});

test('the drush check of a runtime project is asked in the project, where the layer finds its runtime', () => {
  const root = sandbox({ docker: 'case "$*" in *"drush --version"*) echo "Drush Commandline Tool 13" ;; esac' });
  project(root, 'dock', { 'compose.yaml': compose('dock', 'docker'), 'vendor/drush/drush/composer.json': '{}' });
  // From the workspace folder, as cmd-tools-add-users.sh runs it: no retries, and never DDEV itself.
  const r = run(root, 'PROJECT_NAME=dock; sleep() { echo slept ; }; add_drush; echo "status $?"', { functions: ['fun-drush.sh'] });
  assert.match(r.out, /status 0$/m, r.out);
  assert.doesNotMatch(r.out, /not available yet|slept/);
  assert.deepStrictEqual(r.calls, ['docker compose exec -T -u www-data -w /var/www/html web /var/www/html/vendor/bin/drush --version']);
});
