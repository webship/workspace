/**
 * A site on Docker Compose, Podman or Kubernetes is a first-class row of the dashboard (webship/workspace#694):
 * the state chip, the site link, the runtime menu where the DDEV menu sits, and each place that asked "is this a
 * DDEV project?" answered for a runtime project. DDEV rows are the rows they were.
 *
 * Against a real server over a temp workspace tree, with stand-in docker, podman, kubectl, ddev and screen on
 * PATH: the first four answer what the real ones would for the projects below, and screen records the line each
 * action starts.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runtime-rows-'));
const bin = path.join(root, 'bin');
const flags = path.join(root, 'flags');
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const compose = (name, runtime, port, mailPort = '') => `name: ${name}\nx-webship:\n  runtime: ${runtime}\n  stack: php\n  type: drupal\n  docroot: "web"\n  php: "8.3"\n  database: "10.11"\n  port: ${port}\n${mailPort ? `  mail_port: ${mailPort}\n` : ''}services:\n  web:\n    image: webship-${name}-web\n`;
const dev = (...p) => path.join(root, 'dev', ...p);
const standIn = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  fs.mkdirSync(bin); fs.mkdirSync(flags);
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const f of ['row-actions.yml', 'row-actions.seen.json']) fs.rmSync(path.join(root, 'core/config', f), { force: true });

  // A site on each runtime, a DDEV one, a plain folder, and a compose project the Workspace did not write.
  for (const [name, runtime, port] of [['dock-site', 'docker', 41001], ['pod-site', 'podman', 41002], ['kube-site', 'kubernetes', 30081]]) {
    fs.mkdirSync(dev(name, 'web'), { recursive: true });
    fs.writeFileSync(dev(name, 'compose.yaml'), compose(name === 'kube-site' ? 'kube1' : name, runtime, port, name === 'dock-site' ? 42001 : ''));
  }
  fs.writeFileSync(dev('dock-site', 'composer.json'), JSON.stringify({ name: 'acme/dock-site', require: { 'drupal/core': '^11' } }));
  fs.writeFileSync(dev('dock-site', 'composer.lock'), '{}');
  fs.writeFileSync(dev('dock-site', 'package.json'), JSON.stringify({ name: 'dock-site', scripts: { test: 'cucumber-js' } }));
  fs.mkdirSync(dev('ddev-site', '.ddev'), { recursive: true });
  fs.writeFileSync(dev('ddev-site', '.ddev/config.yaml'), 'name: ddev-site\ntype: drupal\ndocroot: web\n');
  fs.writeFileSync(dev('ddev-site', 'composer.json'), JSON.stringify({ name: 'acme/ddev-site' }));
  fs.mkdirSync(dev('plain-folder'), { recursive: true });
  fs.mkdirSync(dev('hand-compose'), { recursive: true });
  fs.writeFileSync(dev('hand-compose', 'compose.yaml'), 'name: hand\nservices:\n  web:\n    image: nginx:alpine\n');
  for (const f of ['cmd-tools-testing.sh', 'cmd-tools-add-users.sh', 'cmd-tools-cancel-users.sh', 'cmd-tools-remove.sh', 'cmd-tools-clone.sh', 'cmd-tools-backup-dev.sh']) {
    fs.writeFileSync(dev(f), '#!/usr/bin/env bash\n');
  }

  // docker: the Docker site runs until flags/docker-stopped is there. A real daemon never answers here.
  standIn('docker', `echo "docker $*" >> "${root}/calls.log"
case "$*" in "compose ls"*)
  if [ -f "${flags}/docker-stopped" ] ; then st="exited(3)" ; else st="running(3)" ; fi
  echo "[{\\"Name\\":\\"dock-site\\",\\"Status\\":\\"$st\\",\\"ConfigFiles\\":\\"${dev('dock-site', 'compose.yaml')}\\"},{\\"Name\\":\\"ddev-other\\",\\"Status\\":\\"running(2)\\",\\"ConfigFiles\\":\\"/x/.ddev/c.yaml\\"}]" ;;
esac`);
  standIn('podman', `echo "podman $*" >> "${root}/calls.log"\necho '[]'`);
  // kubectl: the cluster hangs while flags/kube-hangs is there; the web Deployment is scaled to 0 otherwise.
  standIn('kubectl', `echo "kubectl $*" >> "${root}/calls.log"
[ -f "${flags}/kube-hangs" ] && exec sleep 30
case "$*" in
  *"get nodes"*) printf '172.18.0.2' ;;
  *"-n ws-kube1 get deploy"*) echo '{"items":[{"metadata":{"name":"web"},"spec":{"replicas":0},"status":{}}]}' ;;
  *) echo '{"items":[]}' ;;
esac`);
  standIn('ddev', `case "$*" in "list --json-output") echo '{"raw":[]}' ;; *) echo "ddev $*" >> "${root}/calls.log" ;; esac`);
  // screen: no session runs, and the line a start hands it is recorded.
  standIn('screen', `case "$1" in --version) echo "Screen version 4.09 (stand-in)" ;; -ls) echo "No Sockets found." ; exit 1 ;;
  *) while [ $# -gt 0 ] ; do if [ "$1" = "-lc" ] ; then echo "$2" >> "${root}/screen.log" ; fi ; shift ; done ;; esac`);

  fs.writeFileSync(path.join(flags, 'kube-hangs'), '');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_PLUGINS_NO_RESTART: '1',
      WORKSPACE_RUNTIME_TIMEOUT_MS: '800', WORKSPACE_KUBE_CONTEXT: '', WORKSPACE_KIND_CLUSTER: '' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const text = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };
const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  return { status: r.status, html: await r.text() };
};
const rowOf = (html, name) => {
  // Every row has a SCREENS menu, whatever else it carries.
  const at = html.indexOf(`/fragments/row-menu/screens/dev/${name}"`);
  assert.ok(at > 0, `no row for ${name}`);
  const start = html.lastIndexOf('project-row pcard', at);
  const end = html.indexOf('project-row pcard', at);
  return html.slice(start, end < 0 ? undefined : end);
};
const rowNames = (html) => [...html.matchAll(/<h3 class="pcard-title"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).sort();
/** Every state the dashboard read is forgotten: a watcher asking about a session that is gone does it. */
const forget = () => text('/fragments/session-done/dev--nobody--nothing');
const screenLines = () => (fs.existsSync(path.join(root, 'screen.log')) ? fs.readFileSync(path.join(root, 'screen.log'), 'utf8').trim().split('\n') : []);
const lastLine = () => screenLines().pop() || '';
const verb = path.join(root, 'core', 'scripts', 'runtime-verb.sh');

test('a cluster that does not answer never hangs the page: the row says unknown, in bounded time', async () => {
  const started = Date.now();
  const { status, html } = await text('/fragments/dev/projects');
  const took = Date.now() - started;
  assert.strictEqual(status, 200);
  assert.ok(took < 6000, `the list answered in ${took} ms`);
  const kube = rowOf(html, 'kube-site');
  assert.match(kube, /<span class="uk-label state-chip state-chip-off"><span class="state-dot" aria-hidden="true"><\/span>unknown<\/span>/);
  assert.doesNotMatch(kube, /state-toggle/, 'an unknown state is not a switch');
  assert.match(rowOf(html, 'dock-site'), /<span class="state-word">Running<\/span>/, 'the Docker site was answered for');
  fs.rmSync(path.join(flags, 'kube-hangs'));
  await forget();
});

test('the row of a Docker site: Running, its own address as the link and the Launch, the DOCKER menu where DDEV sits', async () => {
  const { html } = await text('/fragments/dev/projects');
  const row = rowOf(html, 'dock-site');
  assert.match(row, /class="uk-label uk-label-success state-chip state-toggle arm-step"\s+hx-post="\/actions\/runtime-stop" hx-trigger="confirmed-remove"/, 'the chip stops it, asked first');
  assert.match(row, /<span class="state-word">Running<\/span>/);
  assert.match(row, /<a class="pcard-host" href="http:\/\/127\.0\.0\.1:41001" target="_blank" rel="noopener" title="The site's address on Docker Compose">/);
  assert.match(row, /pcard-launch" href="http:\/\/127\.0\.0\.1:41001"/);
  assert.doesNotMatch(row, /ddev\.site/, 'no DDEV address on a Docker site');
  assert.match(row, /<div class="uk-inline act-menu act-menu-runtime act-menu-runtime-docker">/);
  assert.match(row, /title="Start, stop, back up and inspect this Docker Compose project">[\s\S]*? DOCKER </);
  assert.match(row, /hx-get="\/fragments\/row-menu\/runtime\/dev\/dock-site"/, 'its body loads when it opens');
  assert.match(row, /<span class="act-status uk-text-meta">\d+ commands<\/span>/);
  assert.doesNotMatch(row, /act-menu-ddev|Configure DDEV|act-ddev-config/, 'no DDEV menu, and no offer to configure DDEV in it');
  assert.match(row, /act-menu-tests/, 'the Tests menu is offered');
  assert.match(row, /act-menu-composer/);
  // Backup lives in the runtime menu, as it does in the DDEV menu; Clone is not offered on a runtime yet.
  assert.doesNotMatch(row, /hx-post="\/actions\/backup"|clone-form/);
});

test('Kubernetes and Podman rows: K8S and PODMAN, the node address with the NodePort, Stopped starts it', async () => {
  // The node's address is read behind the first answer; the next page has it.
  await text('/fragments/dev/projects');
  await new Promise((r) => setTimeout(r, 400));
  const { html } = await text('/fragments/dev/projects');
  const kube = rowOf(html, 'kube-site');
  assert.match(kube, /act-menu-runtime-kubernetes">[\s\S]*? K8S </);
  assert.match(kube, /<span class="state-word">Stopped<\/span>/);
  assert.match(kube, /state-chip-off state-chip-stopped state-chip state-toggle"\s+hx-post="\/actions\/runtime-start"/);
  assert.match(kube, /<span class="pcard-host" title="Stopped: start it from the K8S menu">/, 'a stopped site has no link');
  assert.match(kube, /172\.18\.0\.2:30081/);
  assert.match(kube, /pcard-launch" href="http:\/\/172\.18\.0\.2:30081"/);
  const pod = rowOf(html, 'pod-site');
  assert.match(pod, /act-menu-runtime-podman">[\s\S]*? PODMAN </);
  assert.match(pod, /<span class="state-word">Stopped<\/span>/);
});

/** GET a path with the Host a browser on that address sends: the hub's own, or a plain address. */
const asHost = (host, p) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const req = require('http').request({ host: u.hostname, port: u.port, path: p, headers: { Host: host } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, html: body }));
  });
  req.on('error', reject);
  req.end();
});

test('a DDEV row\'s Launch: the canonical address on a plain address, the hub\'s on the hub (#764)', async () => {
  const launch = (html, name) => (rowOf(html, name).match(/pcard-launch" href="([^"]+)"/) || [])[1];
  const plain = (await text('/fragments/dev/projects')).html;
  assert.strictEqual(launch(plain, 'ddev-site'), 'https://ddev-site.ddev.site', 'on a plain address: the address beside its name');
  const hub = await asHost('dev.workspace.ddev.site', '/fragments/dev/projects');
  assert.strictEqual(hub.status, 200);
  assert.strictEqual(launch(hub.html, 'ddev-site'), 'https://ddev-site.dev.workspace.ddev.site', 'on the hub: the hub\'s address, as before');
  // A runtime's site keeps its own address on both.
  assert.strictEqual(launch(plain, 'dock-site'), 'http://127.0.0.1:41001');
  assert.strictEqual(launch(hub.html, 'dock-site'), 'http://127.0.0.1:41001');
});

test('a DDEV row, a plain folder and a hand-written compose project are the rows they were', async () => {
  const { html } = await text('/fragments/dev/projects');
  const ddev = rowOf(html, 'ddev-site');
  assert.match(ddev, /hx-post="\/actions\/ddev-start"/);
  assert.match(ddev, /act-menu act-menu-ddev/);
  assert.match(ddev, /title="Stopped: start it from the DDEV menu">/);
  assert.match(ddev.replace(/<[^>]+>/g, ''), /ddev-site\.ddev\.site/, 'its ddev.site address');
  assert.doesNotMatch(ddev, /act-menu-runtime|\/actions\/runtime-/);
  for (const name of ['plain-folder', 'hand-compose']) {
    const row = rowOf(html, name);
    assert.match(row, /act-ddev-config/, `${name}: Configure DDEV is offered, as before`);
    assert.doesNotMatch(row, /act-menu-runtime|state-chip/, `${name}: not a runtime's project`);
    assert.match(row, /hx-post="\/actions\/backup"/, `${name}: Backup stays a button`);
  }
});

test('the runtime menu lists start or stop, restart, describe, logs, a shell, the mail it captured, an import and delete; what is DDEV\'s alone is said, not offered', async () => {
  const dock = await text('/fragments/row-menu/runtime/dev/dock-site');
  assert.strictEqual(dock.status, 200);
  assert.match(dock.html, /<li class="uk-nav-header" data-group="project">dock-site · Docker Compose<\/li>/);
  for (const v of ['stop', 'restart', 'describe', 'logs', 'shell', 'export-db']) assert.match(dock.html, new RegExp(`hx-post="/actions/runtime-${v}"`), v);
  assert.doesNotMatch(dock.html, /hx-post="\/actions\/runtime-start"/, 'running: Stop, not Start');
  assert.match(dock.html, /class="uk-text-danger arm-step" hx-post="\/actions\/runtime-delete" [^>]*"confirm":"yes"[^>]*hx-trigger="confirmed-remove"/, 'delete asks first');
  assert.match(dock.html, /<a href="http:\/\/127\.0\.0\.1:41001" target="_blank" rel="noopener">[\s\S]*?Open the site<\/a>/);
  assert.match(dock.html, /hx-post="\/actions\/backup"/);
  assert.match(dock.html, /\/fragments\/projects\/remove-form\/dev\/dock-site/);
  assert.match(dock.html, /Not on Docker Compose yet: clone, snapshots, add-ons and extra domains\./, 'only what is still DDEV\'s (#859)');
  // The mail it captured (#859): the panel a DDEV row opens, fed from the mailbox the project's runtime file names.
  assert.match(dock.html, /hx-get="\/fragments\/projects\/mail\/dev\/dock-site"[\s\S]*?Mail it captured \(Mailpit\)…<\/a>/);
  // An import, where the project has a database: the panel of a dump this workspace holds.
  assert.match(dock.html, /<li data-entry="import"><a href hx-get="\/fragments\/projects\/import-db\/dev\/dock-site"[\s\S]*?Import a database…<\/a>/);
  assert.doesNotMatch(dock.html, /\/actions\/ddev-|ddev-config|hostnames|snapshots\/dev|addons\/dev|clone-form/, 'nothing of the DDEV menu');

  const kube = await text('/fragments/row-menu/runtime/dev/kube-site');
  assert.match(kube.html, /data-group="project">kube1 · Kubernetes · ws-kube1<\/li>/);
  assert.match(kube.html, /hx-post="\/actions\/runtime-start"/);
  assert.doesNotMatch(kube.html, /runtime-shell|runtime-export-db|Open the site|Mail it captured|Import a database/, 'stopped: nothing that needs it running');
  assert.match(kube.html, /Delete the namespace \(keeps the files\)/);

  for (const name of ['ddev-site', 'plain-folder', 'hand-compose']) {
    assert.strictEqual((await text(`/fragments/row-menu/runtime/dev/${name}`)).status, 404, `${name} has no runtime menu`);
  }
  const noDdev = await text('/fragments/row-menu/ddev/dev/dock-site');
  assert.strictEqual(noDdev.status, 404);
  assert.match(noDdev.html, /Not a DDEV project\./);
  assert.strictEqual((await text('/fragments/row-menu/ddev/dev/ddev-site')).status, 200, 'the DDEV menu of a DDEV project');
});

test('COMPOSER and NODE say where they run on a runtime, and DDEV\'s sentence is DDEV\'s', async () => {
  const composer = await text('/fragments/row-menu/composer/dev/dock-site');
  assert.match(composer.html, /Runs as composer in this project's Docker Compose web container\./);
  assert.doesNotMatch(composer.html, /ddev composer|dashboard's DDEV container/);
  const node = await text('/fragments/row-menu/node/dev/dock-site');
  assert.match(node.html, /Runs as npm \/ yarn in the Docker Compose tests container of this project \(Node\.js 26\)\./);
  assert.match((await text('/fragments/row-menu/composer/dev/ddev-site')).html, /Runs as ddev composer in this project\./);
});

test('the Tests menu of a runtime site offers the setup and the test users', async () => {
  const { status, html } = await text('/fragments/row-menu/tests/dev/dock-site');
  assert.strictEqual(status, 200);
  assert.match(html, /hx-post="\/actions\/testing-configure"/);
  assert.match(html, /Set up the testing environment/);
  assert.match(html, /hx-post="\/actions\/add-users"/, 'a Drupal site on Docker has Drupal\'s list of test users');
  assert.match(html, /hx-post="\/actions\/cancel-users"/);
});

test('the filters: Running and Stopped count runtime sites, and "no config" is neither DDEV nor a runtime', async () => {
  assert.deepStrictEqual(rowNames((await text('/fragments/dev/projects?status=running')).html), ['dock-site']);
  assert.deepStrictEqual(rowNames((await text('/fragments/dev/projects?status=stopped')).html), ['ddev-site', 'kube-site', 'pod-site']);
  assert.deepStrictEqual(rowNames((await text('/fragments/dev/projects?status=nodddev')).html), ['hand-compose', 'plain-folder']);
  assert.match((await text('/fragments/dev/projects')).html, /<option value="nodddev">No DDEV or runtime config<\/option>/);
});

test('each verb starts a screen session that runs runtime-verb.sh in the project: the layer does the mapping', async () => {
  const start = await post('/actions/runtime-start', { workspace: 'dev', projectName: 'kube-site' });
  assert.strictEqual(start.status, 200, start.html);
  assert.match(start.html, /<code>kubernetes start<\/code> started on <strong>kube-site<\/strong>/);
  assert.match(start.html, /class="session-watch" hx-get="\/fragments\/session-done\/dev--kube-site--start"/, 'the page hears when it is done');
  assert.doesNotMatch(start.html, /data-reload-on-close/);
  assert.ok(lastLine().startsWith(`{ bash '${verb}' start -y ; }`), lastLine());

  for (const [route, line] of [['restart', 'restart'], ['describe', 'describe'], ['logs', 'logs'], ['shell', 'ssh'], ['stop', 'stop']]) {
    const r = await post(`/actions/runtime-${route}`, { workspace: 'dev', projectName: 'dock-site' });
    assert.strictEqual(r.status, 200, `${route}: ${r.html}`);
    assert.match(r.html, new RegExp(`<code>docker ${route}</code>`));
    assert.ok(lastLine().startsWith(`{ bash '${verb}' ${line} ; }`), `${route}: ${lastLine()}`);
  }
  const dump = await post('/actions/runtime-export-db', { workspace: 'dev', projectName: 'dock-site' });
  assert.strictEqual(dump.status, 200, dump.html);
  assert.match(lastLine(), new RegExp(`^\\{ bash '${verb.replace(/[.]/g, '\\.')}' export-db --file=${root}/backups/dev/dock-site--db--[0-9-]+\\.sql\\.gz ; \\}`), 'into the workspace\'s backups');
  for (const line of screenLines()) assert.doesNotMatch(line.split(' 2>&1 | tee')[0], /\$/, 'no $ in a line the runner hands to an outer shell');
});

test('what must not run does not: delete without the confirm, a verb that needs a running site, a folder that is not a runtime\'s', async () => {
  const before = screenLines().length;
  const noConfirm = await post('/actions/runtime-delete', { workspace: 'dev', projectName: 'dock-site' });
  assert.strictEqual(noConfirm.status, 400);
  assert.match(noConfirm.html, /docker delete removes the containers and the database of this site \(its files stay\): it needs confirmation\./);
  const stopped = await post('/actions/runtime-shell', { workspace: 'dev', projectName: 'kube-site' });
  assert.strictEqual(stopped.status, 400);
  assert.match(stopped.html, /kube-site is not running: start it first\./);
  for (const name of ['ddev-site', 'plain-folder', 'hand-compose']) {
    const r = await post('/actions/runtime-start', { workspace: 'dev', projectName: name });
    assert.strictEqual(r.status, 400, name);
    assert.match(r.html, /Not a project on another runtime than DDEV/);
  }
  assert.strictEqual((await post('/actions/runtime-start', { workspace: 'dev', projectName: '../etc' })).status, 400);
  const ddevVerb = await post('/actions/ddev-start', { workspace: 'dev', projectName: 'dock-site' });
  assert.strictEqual(ddevVerb.status, 400);
  assert.match(ddevVerb.html, /Not a DDEV project\./);
  assert.strictEqual(screenLines().length, before, 'nothing was started');

  const confirmed = await post('/actions/runtime-delete', { workspace: 'dev', projectName: 'dock-site', confirm: 'yes' });
  assert.strictEqual(confirmed.status, 200, confirmed.html);
  assert.ok(lastLine().startsWith(`{ bash '${verb}' delete -O -y ; }`), lastLine());
});

test('stop and start change the badge: the state is read again after a verb', async () => {
  assert.match(rowOf((await text('/fragments/dev/projects')).html, 'dock-site'), /<span class="state-word">Running<\/span>/);
  fs.writeFileSync(path.join(flags, 'docker-stopped'), '');
  await post('/actions/runtime-stop', { workspace: 'dev', projectName: 'dock-site' });
  let row = rowOf((await text('/fragments/dev/projects')).html, 'dock-site');
  assert.match(row, /<span class="state-word">Stopped<\/span>/);
  assert.match(row, /hx-post="\/actions\/runtime-start"/);
  assert.match(row, /<span class="pcard-host" title="Stopped: start it from the DOCKER menu">/);
  fs.rmSync(path.join(flags, 'docker-stopped'));
  await post('/actions/runtime-start', { workspace: 'dev', projectName: 'dock-site' });
  row = rowOf((await text('/fragments/dev/projects')).html, 'dock-site');
  assert.match(row, /<span class="state-word">Running<\/span>/);
});

test('Composer and Node run in the runtime project\'s own containers, through the layer; a DDEV project keeps ddev composer', async () => {
  const composer = await post('/actions/composer-install', { workspace: 'dev', projectName: 'dock-site' });
  assert.ok(composer.status < 400, composer.html);
  assert.ok(lastLine().startsWith(`{ bash '${verb}' composer --no-interaction --ansi install`), lastLine());
  assert.doesNotMatch(lastLine(), /ddev exec -d/, "never the dashboard's own container");
  const node = await post('/actions/node-install', { workspace: 'dev', projectName: 'dock-site', manager: 'npm' });
  assert.ok(node.status < 400, node.html);
  assert.ok(lastLine().startsWith(`{ bash '${verb}' npm install`), lastLine());
  const ddev = await post('/actions/composer-install', { workspace: 'dev', projectName: 'ddev-site' });
  assert.ok(ddev.status < 400, ddev.html);
  assert.ok(lastLine().startsWith('{ ddev composer --no-interaction --ansi install'), lastLine());
});

test('the remove form says what goes on the runtime, and offers the database backup', async () => {
  const kube = await text('/fragments/projects/remove-form/dev/kube-site');
  assert.match(kube.html, /On Kubernetes, <strong>kube1<\/strong>: its namespace <code>ws-kube1<\/code> goes, with its pods and its database, and the image built for it\./);
  assert.match(kube.html, /<input class="uk-checkbox" type="checkbox" name="backup" value="yes">/, 'not disabled');
  assert.doesNotMatch(kube.html, /ddev delete/);
  const dock = await text('/fragments/projects/remove-form/dev/dock-site');
  assert.match(dock.html, /On Docker Compose, <strong>dock-site<\/strong>: its containers and its database volume go, and the image built for it\./);
  const ddev = await text('/fragments/projects/remove-form/dev/ddev-site');
  assert.match(ddev.html, /<code>ddev delete -y -O<\/code> on <strong>ddev-site<\/strong>/);
  const plain = await text('/fragments/projects/remove-form/dev/plain-folder');
  assert.match(plain.html, /name="backup" value="yes" disabled>/);
  assert.match(plain.html, /not a DDEV project, nothing to export/);
});

test('the source: a restored runtime project starts and imports through the layer, and the plugins\' own runtime menus are left out on it', () => {
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const restore = server.slice(server.indexOf("pathname === '/actions/restore'"), server.indexOf("pathname === '/actions/backup-delete'"));
  assert.match(restore, /const viaRuntime = projectRuntime\.verbLine\(\[\]\);/);
  assert.match(restore, /\$\{viaRuntime\} start -y && echo "Importing database…" && \$\{viaRuntime\} import-db --file='\$\{dbFile\}'/);
  assert.match(restore, /grep -qs '\^x-webship:' \$\{projectRuntime\.META_FILES\.map\(\(f\) => `'\$\{targetDir\}\/\$\{f\}'`\)\.join\(' '\)\}/, 'every file that carries the block');
  assert.match(server, /if \(isRuntime\) for \(const id of projectRuntime\.RUNTIMES\) if \(id in pluginMenus\) pluginMenus\[id\] = '';/);
  assert.match(server, /const siteButton = ddevButton \|\| runtimeButton;/);
});

test('the test users and the platform of a runtime project are read from its compose.yaml', () => {
  const platform = require(path.join(APP, 'project-platform'));
  assert.deepStrictEqual(platform.declaredOf(dev('dock-site')), { type: 'drupal', docroot: 'web' });
  assert.deepStrictEqual(platform.declaredOf(dev('ddev-site')), { type: 'drupal', docroot: 'web' });
  assert.strictEqual(platform.declaredOf(dev('plain-folder')), null);
  assert.strictEqual(platform.declaredOf(dev('hand-compose')), null);
  assert.strictEqual(platform.userListOfProject(dev('dock-site'), { root }), 'drupal');
  assert.strictEqual(platform.userListOfProject(dev('hand-compose'), { root }), '');
  fs.mkdirSync(dev('kube-site', 'web', 'profiles', 'contrib', 'webship'), { recursive: true });
  assert.strictEqual(platform.profileOfProject(dev('kube-site')), 'webship', 'the distribution, from the docroot the compose file names');
  fs.rmSync(dev('kube-site', 'web', 'profiles'), { recursive: true });
  // A type that is not a plain name never becomes part of a bash function name.
  const odd = path.join(root, 'odd'); fs.mkdirSync(odd);
  fs.writeFileSync(path.join(odd, 'compose.yaml'), compose('odd', 'docker', 1).replace('type: drupal', 'type: "word;rm -rf"'));
  assert.strictEqual(platform.platformOfProject(odd), '');
});

test('a runtime site\'s import (#859): the panel of this workspace\'s dumps, an export into the backups first, then the layer\'s import; what must not run does not', async () => {
  const backups = path.join(root, 'backups', 'dev');
  fs.mkdirSync(backups, { recursive: true });
  fs.writeFileSync(path.join(backups, 'dock-site--db--2026-11-24-10-00.sql.gz'), 'x');
  const panel = await text('/fragments/projects/import-db/dev/dock-site');
  assert.strictEqual(panel.status, 200, panel.html);
  assert.match(panel.html, /hx-post="\/actions\/runtime-import-db"/, 'the runtime\'s import, not DDEV\'s');
  assert.match(panel.html, /The database is exported into this list first, in the same command/);
  assert.doesNotMatch(panel.html, /snapshot/i, 'a runtime has no snapshot');
  assert.match(panel.html, /dock-site--db--2026-11-24-10-00\.sql\.gz/);
  const before = screenLines().length;
  const noConfirm = await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'dock-site', dump: 'dock-site--db--2026-11-24-10-00.sql.gz' });
  assert.strictEqual(noConfirm.status, 400);
  assert.match(noConfirm.html, /it needs confirmation/);
  for (const dump of ['../../etc/passwd', 'missing.sql.gz', '/tmp/x.sql']) {
    const r = await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'dock-site', dump, confirm: 'yes' });
    assert.strictEqual(r.status, 404, dump);
    assert.match(r.html, /No such dump in this workspace's backups\./);
  }
  const stopped = await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'kube-site', dump: 'dock-site--db--2026-11-24-10-00.sql.gz', confirm: 'yes' });
  assert.match(stopped.html, /kube-site is not running: start it first\./);
  assert.strictEqual(screenLines().length, before, 'nothing was started');
  const ok = await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'dock-site', dump: 'dock-site--db--2026-11-24-10-00.sql.gz', confirm: 'yes' });
  assert.strictEqual(ok.status, 200, ok.html);
  assert.match(ok.html, /<code>docker import-db dock-site--db--2026-11-24-10-00\.sql\.gz<\/code> started on <strong>dock-site<\/strong>/);
  const line = lastLine();
  const exportAt = line.indexOf(`' export-db '--file=${backups}/dock-site--db--before-import-`);
  const importAt = line.indexOf(`' import-db '--file=${backups}/dock-site--db--2026-11-24-10-00.sql.gz'`);
  assert.ok(exportAt > 0 && importAt > exportAt, line);
  assert.match(line.slice(exportAt, importAt), / && /, 'the import runs only if the export did');
});

test('a runtime site\'s mail (#859): the panel a DDEV row opens, from the mailbox its runtime file names', async () => {
  // A stand-in Mailpit on a port of its own, which only this site's runtime file names.
  const http = require('http');
  const box = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/api/v1/info')) return res.end(JSON.stringify({ Messages: 1, Unread: 1, Version: 'stand-in' }));
    return res.end(JSON.stringify({ messages: [{ ID: 'm1', From: { Address: 'site@example.com' }, To: [{ Address: 'someone@example.com' }], Subject: 'From the runtime mailbox', Created: new Date().toISOString(), Read: false }], messages_count: 1, total: 1 }));
  });
  await new Promise((resolve) => box.listen(0, '127.0.0.1', resolve));
  try {
    fs.mkdirSync(dev('mail-site', 'web'), { recursive: true });
    fs.writeFileSync(dev('mail-site', 'compose.yaml'), compose('mail-site', 'docker', 41009, box.address().port));
    const mail = await text('/fragments/projects/mail/dev/mail-site');
    assert.strictEqual(mail.status, 200);
    assert.match(mail.html, /Mail from mail-site/);
    assert.match(mail.html, /From the runtime mailbox/, 'the messages of its own mailbox');
    // A site whose file names no mailbox says so, and reaches none.
    const none = await text('/fragments/projects/mail/dev/kube-site');
    assert.match(none.html, /This project has no Mailpit URL/);
  } finally {
    box.close();
    fs.rmSync(dev('mail-site'), { recursive: true, force: true });
  }
});

test('the export before an import (#859 review): stamped to the second, never a file there, never the dump being imported, never a name given twice', () => {
  const { beforeImportPath } = require('../../actions/runtime');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-before-import-'));
  const at = new Date('2026-11-24T16:52:10.400Z');
  // Two imports in the same second give two exports, though neither is on disk yet.
  const first = beforeImportPath(dir, 'x', 'some.sql.gz', at);
  const second = beforeImportPath(dir, 'x', 'some.sql.gz', new Date('2026-11-24T16:52:10.900Z'));
  assert.strictEqual(path.basename(first), 'x--db--before-import-2026-11-24-16-52-10.sql.gz');
  assert.strictEqual(path.basename(second), 'x--db--before-import-2026-11-24-16-52-10-2.sql.gz');
  // Undoing an import with the newest before-import export, in the second it was named: the export taken first gets
  // a name of its own, and the file being imported is left as it is.
  const undo = 'y--db--before-import-2026-11-24-16-52-40.sql.gz';
  fs.writeFileSync(path.join(dir, undo), 'the database as it was');
  const kept = beforeImportPath(dir, 'y', undo, new Date('2026-11-24T16:52:40.100Z'));
  assert.notStrictEqual(path.basename(kept), undo);
  assert.strictEqual(path.basename(kept), 'y--db--before-import-2026-11-24-16-52-40-2.sql.gz');
  assert.strictEqual(fs.readFileSync(path.join(dir, undo), 'utf8'), 'the database as it was', 'not touched');
  // A name the dump has but no file has yet is skipped too, and so is one on disk.
  fs.writeFileSync(path.join(dir, 'z--db--before-import-2026-11-24-17-00-00-2.sql.gz'), '');
  const z = beforeImportPath(dir, 'z', 'z--db--before-import-2026-11-24-17-00-00.sql.gz', new Date('2026-11-24T17:00:00Z'));
  assert.strictEqual(path.basename(z), 'z--db--before-import-2026-11-24-17-00-00-3.sql.gz');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two imports through the dashboard name two exports, and an undo with the newest export keeps it', async () => {
  const backups = path.join(root, 'backups', 'dev');
  fs.mkdirSync(backups, { recursive: true });
  const dump = 'dock-site--db--2026-11-24-10-00.sql.gz';
  fs.writeFileSync(path.join(backups, dump), 'x');
  const exportOf = (line) => (line.match(/' export-db '--file=([^']+)'/) || [])[1];
  await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'dock-site', dump, confirm: 'yes' });
  const one = exportOf(lastLine());
  await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'dock-site', dump, confirm: 'yes' });
  const two = exportOf(lastLine());
  assert.ok(one && two && one !== two, `${one} / ${two}`);
  // The newest before-import export, imported to undo: the export taken first is another file.
  fs.writeFileSync(two, 'the database as it was');
  await post('/actions/runtime-import-db', { workspace: 'dev', projectName: 'dock-site', dump: path.basename(two), confirm: 'yes' });
  const line = lastLine();
  assert.notStrictEqual(exportOf(line), two, line);
  assert.ok(line.includes(`' import-db '--file=${two}'`), line);
  assert.strictEqual(fs.readFileSync(two, 'utf8'), 'the database as it was');
});
