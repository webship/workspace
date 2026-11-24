/**
 * A project's own PHP settings and a task kept running beside its web server, on every runtime (webship/workspace#825):
 * rt_php_ini writes the settings where the runtime reads them, and every web container scans that folder after the
 * stack's own settings; rt_daemon declares a task in the x-webship block, which Docker Compose, Podman and Kubernetes
 * run beside the web server, and DDEV as a web_extra_daemons entry.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-php-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const cli of ['docker', 'podman', 'ddev', 'kind', 'lando', 'fin']) {
    fs.writeFileSync(path.join(bin, cli), `#!/usr/bin/env bash\necho "${cli} $*" >> "${dir}/calls.log"\n[ -t 0 ] || cat > /dev/null\n`, { mode: 0o755 });
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

/** A project the Workspace configured on a runtime: `ddev config` in an empty folder. */
function built(dir, runtime, name) {
  const p = path.join(dir, name); fs.mkdirSync(p);
  const r = run(dir, p, `ddev config --project-type=php --docroot=public --php-version=8.3 --project-name=${name}`, { WORKSPACE_RUNTIME: runtime });
  assert.strictEqual(r.status, 0, r.out);
  return p;
}

/** A DDEV project, as `ddev config` leaves it. */
function ddevProject(dir, name) {
  const p = path.join(dir, name); fs.mkdirSync(path.join(p, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(p, '.ddev', 'config.yaml'), `name: ${name}\ntype: php\ndocroot: public\n`);
  return p;
}

const read = (...f) => fs.readFileSync(path.join(...f), 'utf8');

test('rt_php_ini: DDEV\'s own folder on DDEV, .webship/php on another runtime, from its input', () => {
  const dir = sandbox();
  const d = ddevProject(dir, 'dd');
  assert.strictEqual(run(dir, d, "printf 'max_input_vars = 5000\\n' | rt_php_ini moodle").status, 0);
  assert.strictEqual(read(d, '.ddev', 'php', 'moodle.ini'), 'max_input_vars = 5000\n', 'DDEV reads .ddev/php/*.ini itself');
  assert.ok(!fs.existsSync(path.join(d, '.webship')), 'nothing else on DDEV');
  for (const runtime of ['docker', 'podman', 'kubernetes', 'lando', 'docksal']) {
    const p = built(dir, runtime, `p${runtime}`);
    const r = run(dir, path.join(p), "printf 'memory_limit = 512M\\n' | rt_php_ini nextcloud");
    assert.strictEqual(r.status, 0, `${runtime}: ${r.out}`);
    assert.strictEqual(read(p, '.webship', 'php', 'nextcloud.ini'), 'memory_limit = 512M\n', runtime);
    assert.ok(!fs.existsSync(path.join(p, '.ddev')), `${runtime}: nothing of DDEV's is written`);
  }
  assert.match(run(dir, d, 'echo x | rt_php_ini "Bad Name"').out, /rt_php_ini: a name, please/);
  assert.match(run(dir, dir, 'echo x | rt_php_ini moodle').out, /rt_php_ini: no project in/);
});

test('every runtime\'s web container scans the project\'s settings after the stack\'s own', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const compose = read(built(dir, runtime, `s${runtime}`), 'compose.yaml');
    const web = compose.slice(compose.indexOf('\n  web:\n'), compose.indexOf('\n  db:\n'));
    assert.match(web, /\n {6}PHP_INI_SCAN_DIR: ":\/var\/www\/html\/\.webship\/php"\n/, runtime);
    assert.doesNotMatch(compose, /\n {2}daemons:\n/, `${runtime}: no task until one is asked for`);
  }
  const k = built(dir, 'kubernetes', 'sk');
  const stack = read(k, 'k8s', 'stack.yaml');
  assert.match(stack, /\n {12}- \{name: PHP_INI_SCAN_DIR, value: ":\/var\/www\/html\/\.webship\/php"\}\n/);
  assert.doesNotMatch(stack, /- name: daemons/);
  assert.match(read(built(dir, 'lando', 'sl'), '.lando.yml'), /\n {8}PHP_INI_SCAN_DIR: ":\/app\/\.webship\/php"\n/, 'Lando: in the appserver, where the project is /app');
  const ss = built(dir, 'docksal', 'ss');
  assert.match(read(ss, '.docksal', 'docksal.yml'), /\n {6}- PHP_INI_SCAN_DIR=:\/var\/www\/\.webship\/php\n/, 'Docksal: in cli, where PHP runs');
  // Docksal's own pool settings (php_value) win over ini files for the web server: the project's pool file is read
  // first, as php-fpm keeps the first value it reads for a setting.
  assert.match(read(ss, '.docksal', 'docksal.yml'), /\n {4}volumes:\n {6}# [^\n]+\n {6}- \$\{PROJECT_ROOT\}\/\.webship\/runtime\/docksal-fpm\.conf:\/usr\/local\/etc\/php-fpm\.d\/00-webship\.conf:ro\n {2}# Mailpit/);
  assert.match(read(ss, '.webship', 'runtime', 'docksal-fpm.conf'), /\n\[www\]\n$/, 'nothing to say yet');
  run(dir, ss, "printf 'max_input_vars = 5000\\n; a comment\\nmemory_limit=512M\\n[section]\\n' | rt_php_ini moodle");
  assert.match(read(ss, '.webship', 'runtime', 'docksal-fpm.conf'), /\n\[www\]\nphp_value\[max_input_vars\] = 5000\nphp_value\[memory_limit\] = 512M\n$/, 'rt_php_ini says the settings to php-fpm too');
});

test('rt_daemon on Docker Compose and Podman: the task in the block, its script, and a service of the project that runs it', () => {
  const dir = sandbox();
  for (const runtime of ['docker', 'podman']) {
    const p = built(dir, runtime, `d${runtime}`);
    const before = read(p, 'compose.yaml');
    const port = before.match(/^ {2}port: (\d+)$/m)[1];
    const r = run(dir, p, "rt_daemon cron 'while true ; do php public/cron.php ; sleep 60 ; done'");
    assert.strictEqual(r.status, 0, `${runtime}: ${r.out}`);
    assert.match(read(p, '.webship', 'daemons', 'cron.sh'), /^#!\/usr\/bin\/env bash\n# Written by the Webship Workspace \(rt_daemon[^\n]*\nwhile true ; do php public\/cron\.php ; sleep 60 ; done\n$/);
    const compose = read(p, 'compose.yaml');
    const block = compose.slice(compose.indexOf('x-webship:\n'), compose.indexOf('\nservices:\n'));
    assert.match(block, /\n {2}daemons: cron$/, `${runtime}: declared in the block`);
    assert.match(compose, new RegExp(`^ {2}port: ${port}$`, 'm'), `${runtime}: the address is kept`);
    const svc = compose.slice(compose.indexOf('\n  daemons:\n'), compose.indexOf('\nvolumes:\n'));
    assert.ok(svc.length > 0, `${runtime}: the service of the tasks`);
    assert.match(svc, /\n {4}image: webship-d\w+-web\n/, `${runtime}: the web service's image`);
    assert.match(svc, / {4}command: \["runuser", "-u", "www-data", "--", "bash", "-c", "for f in \/var\/www\/html\/\.webship\/daemons\/\*\.sh ; do \[ -f \\"\$\$f\\" \] && bash \\"\$\$f\\" & done ; wait"\]\n/, `${runtime}: every task, as the web server's user, compose's $$`);
    assert.match(svc, /\n {6}PHP_INI_SCAN_DIR: ":\/var\/www\/html\/\.webship\/php"\n/, `${runtime}: with the project's settings`);
    assert.match(svc, /\n {6}- \.:\/var\/www\/html\n/, `${runtime}: and its code`);
    assert.doesNotMatch(svc, /ports:/, `${runtime}: no port of the machine`);
    if (runtime === 'podman') assert.match(svc, /\n {4}userns_mode: keep-id\n {4}user: "0:0"\n/, 'Podman: the same users as the web service');
    // A second task joins the list once; writing the file again keeps them.
    run(dir, p, "rt_daemon queue 'php worker.php' ; rt_daemon cron 'while true ; do php public/cron.php ; sleep 60 ; done'");
    assert.match(read(p, 'compose.yaml'), /^ {2}daemons: cron,queue$/m, runtime);
    run(dir, p, 'ddev config --php-version=8.4');
    const again = read(p, 'compose.yaml');
    assert.match(again, /^ {2}daemons: cron,queue$/m, `${runtime}: the tasks stay when the file is written again`);
    assert.match(again, /^ {2}php: "8\.4"$/m);
    assert.strictEqual((again.match(/\n {2}daemons:\n/g) || []).length, 1, `${runtime}: one service for every task`);
  }
});

test('rt_daemon on Kubernetes: a second container of the web pod, with its image, code and settings; logs read the web container', () => {
  const dir = sandbox();
  const k = built(dir, 'kubernetes', 'dk');
  assert.strictEqual(run(dir, k, "rt_daemon cron 'php cron.php'").status, 0);
  const stack = read(k, 'k8s', 'stack.yaml');
  const web = stack.slice(stack.indexOf('  name: web\nspec:\n  replicas'));
  assert.match(web, /\n {8}- name: web\n/);
  assert.match(web, /\n {8}- name: daemons\n {10}image: webship-dk-web\n {10}imagePullPolicy: Never\n {10}command: \["runuser", "-u", "www-data", "--", "bash", "-c", "for f in \/var\/www\/html\/\.webship\/daemons\/\*\.sh ; do \[ -f \\"\$f\\" \] && bash \\"\$f\\" & done ; wait"\]\n/);
  assert.match(web, /- name: daemons[\s\S]*?- \{name: PHP_INI_SCAN_DIR, value: ":\/var\/www\/html\/\.webship\/php"\}\n {10}volumeMounts: \[\{name: code, mountPath: \/var\/www\/html\}\]\n {6}volumes:/);
  assert.match(read(k, 'compose.yaml'), /^ {2}daemons: cron$/m);
  const logs = run(dir, k, 'ddev logs').calls.filter((c) => c.startsWith('kubectl'));
  assert.deepStrictEqual(logs, ['kubectl --context kind-webship -n ws-dk logs deploy/web -c web --tail 200'], 'the web server\'s logs, not the task\'s');
});

test('rt_daemon on DDEV: a web_extra_daemons entry of its own', () => {
  const dir = sandbox();
  const d = ddevProject(dir, 'dd');
  assert.strictEqual(run(dir, d, 'rt_daemon cron \'bash /var/www/html/.ddev/cron.sh "a b"\'').status, 0);
  assert.strictEqual(read(d, '.ddev', 'config.daemon-cron.yaml'), [
    '# Written by the Webship Workspace (rt_daemon, webship/workspace#825): a task kept running beside the web server.',
    'web_extra_daemons:', '  - name: "cron"', '    command: "bash /var/www/html/.ddev/cron.sh \\"a b\\""', '    directory: /var/www/html', ''].join('\n'));
  assert.ok(!fs.existsSync(path.join(d, '.webship')), 'nothing else on DDEV');
  assert.match(run(dir, d, 'rt_daemon cron').out, /rt_daemon: a name \(lower case, digits, - and _\) and a command, please\./);
});

test('rt_daemon on Lando: the appserver runs the tasks after each start, once, as the web server\'s user', () => {
  const dir = sandbox();
  const p = built(dir, 'lando', 'dl');
  const port = read(p, '.lando.yml').match(/^ {2}port: (\d+)$/m)[1];
  assert.doesNotMatch(read(p, '.lando.yml'), /^events:/m, 'no event until a task is asked for');
  assert.strictEqual(run(dir, p, "rt_daemon cron 'php cron.php'").status, 0);
  assert.match(read(p, '.webship', 'daemons', 'cron.sh'), /\nphp cron\.php\n$/);
  const lando = read(p, '.lando.yml');
  assert.match(lando.slice(0, lando.indexOf('\nrecipe:')), /\n {2}daemons: cron$/, 'declared in the block');
  assert.match(lando, new RegExp(`^ {2}port: ${port}$`, 'm'), 'the address is kept');
  assert.match(lando, /\nevents:\n {2}post-start:\n {4}# [^\n]+\n {4}- appserver: bash \/app\/\.webship\/runtime\/lando-daemons\.sh\n$/);
  const runner = read(p, '.webship', 'runtime', 'lando-daemons.sh');
  assert.match(runner, /^exec 9> \/tmp\/webship-daemons\.lock\nflock -n 9 \|\| exit 0$/m, 'one set of tasks, however often Lando starts the app');
  assert.match(runner, /\[ "\$\(id -u\)" = 0 \] && run='runuser -u www-data --'/, 'as the web server\'s user');
  assert.match(runner, /nohup setsid \$\{run\} bash -c 'for f in \/app\/\.webship\/daemons\/\*\.sh ; do \[ -f "\$f" \] && bash "\$f" & done ; wait' < \/dev\/null > \/tmp\/webship-daemons\.log 2>&1 &/);
  run(dir, p, 'ddev config --php-version=8.4');
  assert.match(read(p, '.lando.yml'), /\n {2}daemons: cron\n[\s\S]*\n {4}- appserver: bash \/app\/\.webship\/runtime\/lando-daemons\.sh\n$/, 'written again, the task stays');
});

test('rt_daemon on Docksal: a program of cli\'s supervisor, where PHP runs, as the project\'s user', () => {
  const dir = sandbox();
  const p = built(dir, 'docksal', 'ds');
  assert.doesNotMatch(read(p, '.docksal', 'docksal.yml'), /webship-daemons/, 'no program until a task is asked for');
  assert.strictEqual(run(dir, p, "rt_daemon cron 'php cron.php'").status, 0);
  assert.match(read(p, '.webship', 'daemons', 'cron.sh'), /\nphp cron\.php\n$/);
  const yml = read(p, '.docksal', 'docksal.yml');
  assert.match(yml.slice(0, yml.indexOf('\nservices:')), /\n {2}daemons: cron$/, 'declared in the block');
  assert.match(yml, /\n {6}- \$\{PROJECT_ROOT\}\/\.webship\/runtime\/docksal-daemons\.conf:\/etc\/supervisor\/conf\.d\/webship-daemons\.conf:ro\n {2}# Mailpit/);
  const conf = read(p, '.webship', 'runtime', 'docksal-daemons.conf');
  // A script, not a command line: the supervisor reads " ;" as the start of a comment.
  assert.match(conf, /^\[program:webship-daemons\]\ncommand = runuser -u docker -- bash \/var\/www\/\.webship\/runtime\/docksal-daemons\.sh\ndirectory = \/var\/www\nautorestart = true\n/m);
  assert.doesNotMatch(conf.split('\n').filter((l) => !l.startsWith(';')).join('\n'), / ;/);
  assert.match(read(p, '.webship', 'runtime', 'docksal-daemons.sh'), /\nfor f in \/var\/www\/\.webship\/daemons\/\*\.sh ; do \[ -f "\$f" \] && bash "\$f" & done\nwait\n$/);
  run(dir, p, 'ddev config --php-version=8.4');
  assert.match(read(p, '.docksal', 'docksal.yml'), /webship-daemons\.conf/, 'written again, the task stays');
});
