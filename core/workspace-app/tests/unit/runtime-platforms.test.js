/**
 * What a platform plugin (WordPress, the reference; then Laravel, Joomla, …) needs of the container runtimes
 * (webship/workspace#694): its CLI in the php stack (`ddev wp`), a way to know a project is its own on any runtime
 * (`rt_is_platform`), the claim of a project on a runtime (`rt_claim`: `platform:` in the x-webship block, where
 * DDEV has `.ddev/config.<plugin>.yaml`), read by the dashboard for the user list, and one real site in its CI
 * (`featuresSite` in the manifest, built by the reusable workflow).
 *
 * A stand-in docker/ddev/kubectl/kind on PATH records what each verb becomes, as runtime-layer.test.js does.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const REPO = path.join(APP, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');
const STACKS = path.join(APP, '..', 'config', 'runtimes');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-platforms-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kubectl', 'kind']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > "${dir}/stdin.log"\n`, { mode: 0o755 });
  }
  return dir;
}

function run(dir, cwd, script, env = {}) {
  const r = spawnSync('bash', ['-c', `RT_STACKS=${STACKS}; source ${SCRIPTS}/functions/fun-runtime.sh; RT_STACKS=${STACKS}; ${script}`],
    { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, WORKSPACE_ROOT: REPO, ...env } });
  const log = path.join(dir, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  if (fs.existsSync(log)) fs.unlinkSync(log);
  return { out: r.stdout + r.stderr, calls, status: r.status };
}

/** A project of a runtime, configured the way a platform's builder does it. */
function built(dir, name, runtime, type = 'wordpress') {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const r = run(dir, p, `ddev config --project-type=${type} --docroot="" --project-name=${name} --auto`, { WORKSPACE_RUNTIME: runtime });
  assert.strictEqual(r.status, 0, r.out);
  return p;
}

function ddevProject(dir, name, type, files = {}) {
  const p = path.join(dir, name); fs.mkdirSync(path.join(p, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), `name: ${name}\ntype: ${type}\ndocroot: ""\n`);
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(p, rel), text);
  return p;
}

test('the php stack carries WP-CLI at a named release, so `ddev wp` answers where DDEV\'s own image is not', () => {
  const dockerfile = fs.readFileSync(path.join(STACKS, 'php', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^ARG WP_CLI_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(dockerfile, /-o \/usr\/local\/bin\/wp "https:\/\/github\.com\/wp-cli\/wp-cli\/releases\/download\/v\$\{WP_CLI_VERSION\}\/wp-cli-\$\{WP_CLI_VERSION\}\.phar"/);
  assert.match(dockerfile, /chmod \+x \/usr\/local\/bin\/wp/);
});

test('`ddev wp` runs in the web container as the site\'s user, in the folder the builder is in, with its stdin', () => {
  const dir = sandbox();
  const d = built(dir, 'wpd', 'docker');
  const onDocker = run(dir, d, 'ddev wp core download --version=latest; echo "// extra" | ddev wp config create --dbname=db --dbhost=db --extra-php');
  assert.deepStrictEqual(onDocker.calls, [
    'docker compose exec -T -u www-data -w /var/www/html web wp core download --version=latest',
    'docker compose exec -T -u www-data -w /var/www/html web wp config create --dbname=db --dbhost=db --extra-php',
  ]);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'stdin.log'), 'utf8'), '// extra\n', 'what is piped in reaches WP-CLI');
  const k = built(dir, 'wpk', 'kubernetes');
  const onKube = run(dir, k, 'ddev wp user list --fields=user_login');
  assert.deepStrictEqual(onKube.calls, [
    'kubectl --context kind-webship -n ws-wpk exec -i deploy/web -c web -- runuser -u www-data -- bash -c cd \'/var/www/html\' && wp user list --fields=user_login',
  ]);
});

test('on Docker Compose and Podman the site reaches itself at its own address: Apache also answers on its port inside the container', () => {
  const dockerfile = fs.readFileSync(path.join(STACKS, 'php', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /<VirtualHost \*:80 \*:\$\{WEBSHIP_PORT\}>/);
  assert.match(dockerfile, /printf 'Listen \$\{WEBSHIP_PORT\}\\n' >> \/etc\/apache2\/ports\.conf/);
  assert.match(dockerfile, /^ENV .*\bWEBSHIP_PORT=8080\b/m, 'a port of its own where compose.yaml names none (an older project, Kubernetes): never 80 twice');
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const compose = fs.readFileSync(path.join(built(dir, `self-${runtime}`, runtime), 'compose.yaml'), 'utf8');
    const port = compose.match(/^ {2}port: (\d+)$/m)[1];
    assert.match(compose, new RegExp(`^ {6}WEBSHIP_PORT: "${port}"$`, 'm'), 'the port of the machine, in the web container');
    assert.match(compose, new RegExp(`^ {6}- "127\\.0\\.0\\.1:${port}:80"$`, 'm'));
  }
  // On Kubernetes the address is the node's, which a pod reaches as it is: no port of this machine anywhere.
  const k = built(dir, 'self-kube', 'kubernetes');
  assert.doesNotMatch(fs.readFileSync(path.join(k, 'compose.yaml'), 'utf8'), /WEBSHIP_PORT|127\.0\.0\.1/);
  assert.doesNotMatch(fs.readFileSync(path.join(k, 'k8s', 'stack.yaml'), 'utf8'), /WEBSHIP_PORT/);
});

test('a project built with a platform\'s type is that platform\'s on every runtime: rt_is_platform', () => {
  const dir = sandbox();
  const d = built(dir, 'wp1', 'docker');
  const k = built(dir, 'wp2', 'kubernetes');
  const v = ddevProject(dir, 'wp3', 'wordpress');
  for (const p of [d, k, v]) {
    assert.strictEqual(run(dir, dir, `rt_is_platform ${p} wordpress`).status, 0, p);
    assert.strictEqual(run(dir, dir, `rt_is_platform ${p} laravel`).status, 1, p);
  }
  assert.match(fs.readFileSync(path.join(d, 'compose.yaml'), 'utf8'), /^ {2}type: wordpress$/m);
  // The project is the folder itself: not a folder inside it, not a folder with no project.
  fs.mkdirSync(path.join(d, 'wp-content'));
  assert.strictEqual(run(dir, dir, `rt_is_platform ${path.join(d, 'wp-content')} wordpress`).status, 1);
  assert.strictEqual(run(dir, dir, `rt_is_platform ${dir} wordpress`).status, 1);
  assert.strictEqual(run(dir, dir, `rt_is_platform ${path.join(dir, 'not-there')} wordpress`).status, 1);
  // On DDEV a plugin's own file claims a project of another type, as the dashboard reads it (#490); - and _ are one.
  const claimed = ddevProject(dir, 'app1', 'php', { '.ddev/config.django-cms.yaml': '{}\n' });
  assert.strictEqual(run(dir, dir, `rt_is_platform ${claimed} django_cms`).status, 0);
  assert.strictEqual(run(dir, dir, `rt_is_platform ${claimed} django-cms`).status, 0);
  assert.strictEqual(run(dir, dir, `rt_is_platform ${claimed} php`).status, 0, 'its type still answers');
});

test('rt_claim: a plugin claims a project of a runtime in the x-webship block, and the claim stays', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'kubernetes']) {
    const p = built(dir, `app-${runtime}`, runtime, 'php');
    assert.doesNotMatch(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8'), /platform:/, 'no claim until a plugin makes one');
    assert.strictEqual(run(dir, dir, `rt_is_platform ${p} codeigniter`).status, 1);
    assert.strictEqual(run(dir, p, 'rt_claim codeigniter').status, 0);
    assert.match(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8'), /^x-webship:\n {2}platform: codeigniter\n {2}runtime: /m);
    assert.strictEqual(run(dir, dir, `rt_is_platform ${p} codeigniter`).status, 0);
    assert.strictEqual(run(dir, dir, `rt_is_platform ${p} php`).status, 0, 'the type still answers');
    // The layer still reads the block: the runtime, the type, the port.
    assert.match(run(dir, p, 'runtime_of; rt_meta type "$PWD"; rt_meta platform "$PWD"').out, new RegExp(`^${runtime}\nphp\ncodeigniter\n$`));
    // A second `ddev config` (a builder changing the PHP version) writes the file again, with the claim and the port.
    const port = fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8').match(/^ {2}port: (\d+)$/m)[1];
    assert.strictEqual(run(dir, p, 'ddev config --php-version=8.4').status, 0);
    const again = fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8');
    assert.match(again, /^ {2}platform: codeigniter$/m);
    assert.match(again, /^ {2}php: "8\.4"$/m);
    assert.match(again, new RegExp(`^ {2}port: ${port}$`, 'm'));
    // Claimed again by another name: one line, replaced.
    assert.strictEqual(run(dir, path.join(p), 'rt_claim craft-cms').status, 0);
    assert.deepStrictEqual(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8').match(/^ {2}platform: .*$/gm), ['  platform: craft-cms']);
    assert.strictEqual(run(dir, dir, `rt_is_platform ${p} craft_cms`).status, 0);
  }
  // From another folder, by the project's path.
  const other = built(dir, 'app-path', 'docker', 'php');
  assert.strictEqual(run(dir, dir, `rt_claim matomo ${other}`).status, 0);
  assert.match(fs.readFileSync(path.join(other, 'compose.yaml'), 'utf8'), /^ {2}platform: matomo$/m);
});

test('rt_claim changes nothing on a DDEV project, and refuses a name that is not one, or a folder with no project', () => {
  const dir = sandbox();
  const v = ddevProject(dir, 'site', 'php');
  const before = fs.readdirSync(path.join(v, '.ddev'));
  const r = run(dir, v, 'rt_claim codeigniter');
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(fs.readdirSync(path.join(v, '.ddev')), before, 'on DDEV the plugin writes its own .ddev/config.<plugin>.yaml');
  assert.deepStrictEqual(r.calls, []);
  const p = built(dir, 'app', 'docker', 'php');
  const compose = fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8');
  for (const bad of ['', 'Bad Name', 'x; rm -rf /', '../x']) assert.strictEqual(run(dir, p, `rt_claim ${JSON.stringify(bad)}`).status, 1, bad);
  assert.strictEqual(fs.readFileSync(path.join(p, 'compose.yaml'), 'utf8'), compose);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-platforms-none-'));
  assert.strictEqual(run(dir, empty, 'rt_claim codeigniter').status, 1);
});

test('the dashboard reads the claim of a project on a runtime: its user list is the claiming plugin\'s, then its type\'s', () => {
  const { claimOfProject, userListOfProject, platformOfProject, userListNames } = require('../../project-platform');
  const { readProject } = require('../../project-runtime');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-platforms-lists-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('core/scripts/plugins/wordpress/functions/fun-wordpress.sh', 'function set_wordpress_users() {\n  users=(a)\n}\n');
  put('core/scripts/plugins/woocommerce/functions/fun-woocommerce.sh', 'function set_woocommerce_users() {\n  users=(a)\n}\n');
  put('core/scripts/plugins/django-cms/functions/fun-django-cms.sh', 'function set_django_cms_users() {\n  users=(a)\n}\n');
  put('core/scripts/plugins/nextjs/functions/fun-nextjs.sh', 'function build_nextjs() { : ; }\n');
  const names = userListNames(root);
  const dir = sandbox();
  const claim = (p, plugin) => assert.strictEqual(run(dir, p, `rt_claim ${plugin}`).status, 0);

  for (const runtime of ['docker', 'kubernetes']) {
    // The type alone: WordPress needs no claim.
    const wp = built(dir, `wp-${runtime}`, runtime);
    assert.strictEqual(readProject(wp).platform, '');
    assert.strictEqual(claimOfProject(wp, names), '');
    assert.strictEqual(platformOfProject(wp), 'wordpress');
    assert.strictEqual(userListOfProject(wp, { root }), 'wordpress');
    // A shop on the WordPress type: the claim comes before the type, as on DDEV.
    const shop = built(dir, `shop-${runtime}`, runtime);
    claim(shop, 'woocommerce');
    assert.strictEqual(readProject(shop).platform, 'woocommerce');
    assert.strictEqual(readProject(shop).runtime, runtime, 'the block is still read whole');
    assert.match(readProject(shop).port, /^\d+$/);
    assert.strictEqual(userListOfProject(shop, { root }), 'woocommerce');
    // A type of no platform, claimed by a plugin whose name has a dash.
    const app = built(dir, `app-${runtime}`, runtime, 'php');
    assert.strictEqual(userListOfProject(app, { root }), '', 'claimed by nothing: no list');
    claim(app, 'django-cms');
    assert.strictEqual(userListOfProject(app, { root }), 'django_cms');
    // A plugin with no user list claims nothing.
    const front = built(dir, `front-${runtime}`, runtime, 'php');
    claim(front, 'nextjs');
    assert.strictEqual(claimOfProject(front, names), '');
    assert.strictEqual(userListOfProject(front, { root }), '');
  }
  // A DDEV project is DDEV's, whatever compose.yaml lies beside it.
  const v = ddevProject(dir, 'ddev-site', 'php');
  fs.writeFileSync(path.join(v, 'compose.yaml'), 'name: x\nx-webship:\n  platform: woocommerce\n  runtime: docker\n  port: 1\n');
  assert.strictEqual(claimOfProject(v, names), '');
  assert.strictEqual(userListOfProject(v, { root }), '');
  // What is not a name is no claim.
  const odd = built(dir, 'odd', 'docker', 'php');
  fs.writeFileSync(path.join(odd, 'compose.yaml'), fs.readFileSync(path.join(odd, 'compose.yaml'), 'utf8').replace('x-webship:\n', 'x-webship:\n  platform: "$(id)"\n'));
  assert.strictEqual(claimOfProject(odd, names), '');
});

test('a plugin\'s CI builds the one site its manifest names, on Docker Compose, before its features run', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'plugin-browser-suite.yml'), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: the site the plugin\'s features drive'), workflow.indexOf('- name: a placeholder project in every workspace folder'));
  assert.ok(step.length > 200, 'the step is there, after the plugin is installed and before the dashboard starts');
  assert.ok(workflow.indexOf('- name: add the plugin, with what it needs') < workflow.indexOf('- name: the site the plugin\'s features drive'));
  assert.ok(workflow.indexOf('- name: the site the plugin\'s features drive') < workflow.indexOf('- name: start the dashboard'));
  assert.match(step, /WORKSPACE_RUNTIME: docker/);
  assert.match(step, /workspacePlugin \|\| \{\}\)\.featuresSite/);
  // Only a builder and plain arguments are run: the pattern the step checks the line against.
  const pattern = new RegExp(step.match(/grep -Eq '([^']+)'/)[1]);
  for (const ok of ['cmd-wordpress-project.sh ci-wordpress --install --add-users --runtime docker', 'cmd-laravel-project.sh ci1 --version=12.0', 'cmd-x-project.sh']) assert.match(ok, pattern);
  for (const bad of ['cmd-x-project.sh a; curl x', 'bash cmd-x.sh', 'cmd-x-project.sh $(id)', '../cmd-x.sh a', 'cmd-x-project.sh a && b', 'cmd-x-project.sh `id`', 'cmd-x-project.sh a|b']) assert.doesNotMatch(bad, pattern, bad);
});

test('the site a plugin\'s CI builds gets an account an installer accepts: the placeholder password is too short for some', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'plugin-browser-suite.yml'), 'utf8');
  const step = workflow.slice(workflow.indexOf('- name: the site the plugin\'s features drive'), workflow.indexOf('- name: a placeholder project in every workspace folder'));
  const line = step.split('\n').find((l) => /^\s*sed -i .* core\/config\/settings\.yml$/.test(l));
  assert.ok(line, 'the step sets the account of the job');
  assert.ok(step.indexOf(line) < step.indexOf('bash $line'), 'before the site is built');
  // Run on the settings the repository ships: the account's password, and no other line.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-account-'));
  fs.mkdirSync(path.join(dir, 'core', 'config'), { recursive: true });
  const shipped = fs.readFileSync(path.join(REPO, 'core', 'config', 'settings.yml'), 'utf8');
  fs.writeFileSync(path.join(dir, 'core', 'config', 'settings.yml'), shipped);
  const r = spawnSync('bash', ['-c', line.trim()], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const after = fs.readFileSync(path.join(dir, 'core', 'config', 'settings.yml'), 'utf8').split('\n');
  const changed = shipped.split('\n').map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
  assert.strictEqual(changed.length, 1, 'one line');
  assert.strictEqual(changed[0][0], '  pass: CHANGE_ME');
  const pass = changed[0][1].replace(/^  pass: /, '');
  assert.ok(pass.length >= 12, 'long enough for the installers that ask for 10 or 12 characters');
  assert.match(pass, /^[a-z0-9-]+$/, 'plain: nothing a shell or YAML reads');
  assert.strictEqual(after[shipped.split('\n').indexOf('  pass: CHANGE_ME') - 2], 'account:', 'the account\'s own');
  // A workspace whose owner set a password keeps it.
  fs.writeFileSync(path.join(dir, 'core', 'config', 'settings.yml'), shipped.replace('  pass: CHANGE_ME', '  pass: mine-and-long-enough'));
  spawnSync('bash', ['-c', line.trim()], { cwd: dir });
  assert.match(fs.readFileSync(path.join(dir, 'core', 'config', 'settings.yml'), 'utf8'), /^  pass: mine-and-long-enough$/m);
});

test('a feature can open a page of the site itself, and ask for a site of its own platform', () => {
  const steps = fs.readFileSync(path.join(APP, 'tests', 'step-definitions', 'runtimes.steps.js'), 'utf8');
  assert.match(steps, /When\('I open \{string\} on the \{string\} site'/);
  // @needs-platform-<name> beside @needs-runtime-<runtime>: the type or the claim, - and _ being one.
  assert.match(steps, /const NEEDS_PLATFORM = \/\^@needs-platform-/);
  const isPlatform = new Function(`${steps.match(/^const isPlatform = .*$/m)[0]}; return isPlatform;`)();
  assert.strictEqual(isPlatform({ type: 'wordpress', platform: '' }, 'wordpress'), true);
  assert.strictEqual(isPlatform({ type: 'wordpress', platform: 'woocommerce' }, 'woocommerce'), true);
  assert.strictEqual(isPlatform({ type: 'php', platform: 'django-cms' }, 'django_cms'), true);
  assert.strictEqual(isPlatform({ type: 'drupal11', platform: '' }, 'wordpress'), false);
  assert.strictEqual(isPlatform({ type: '', platform: '' }, 'wordpress'), false);
});
