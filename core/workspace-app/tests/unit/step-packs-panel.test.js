/**
 * The Extra steps panel of a project, its run picker, and the buttons on them.
 *
 * The panel lists the webship-js step packs (logo, name, version, what it is for, the docs page), says which
 * the project has, and offers Add, Remove and Copy examples; the run picker lists the project's features,
 * copied examples included. Every button runs `cmd-tools-testing.sh` in a screen: these tests start the
 * dashboard on a temp workspace with a stand-in `screen` that writes down what it was asked to start, and
 * never reach npm (WORKSPACE_STEPS_OFFLINE=1: the list shipped with the core).
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
const { ROOT } = require('../../workspaces');
const sp = require(path.join(ROOT, 'core', 'scripts', 'libs', 'step_packs'));
const page = require('../../step-packs-page');

const CUCUMBER = `module.exports = {
  default: {
    require: [
      'node_modules/webship-js/tests/step-definitions/**/*.js',
      'tests/step-definitions/**/*.js',
    ],
    paths: ['tests/features/**/*.feature'],
    worldParameters: { launchUrl: 'http://localhost' },
  },
};
`;
const PKG = '{\n  "name": "site",\n  "dependencies": {\n    "webship-js": "~2.0.0"\n  }\n}\n';

function site(dir, { stack = true } = {}) {
  fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), `name: ${path.basename(dir)}\ntype: wordpress\n`);
  fs.mkdirSync(path.join(dir, 'tests', 'features'), { recursive: true });
  if (stack) {
    fs.writeFileSync(path.join(dir, 'cucumber.js'), CUCUMBER);
    fs.writeFileSync(path.join(dir, 'package.json'), PKG);
  }
  return dir;
}
const offline = () => sp.listPacks({ offline: true, root: fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-root-')) });
const pack = (short) => sp.describePack({ name: sp.packName(short), version: '2.2.4' });

test('the panel: every pack with its logo, name, version, what it is for and its docs page', async () => {
  const dir = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')));
  const html = await page.stepPacksPanelHtml({ workspace: 'dev', project: 'site1', projectDir: dir, list: await offline() });
  assert.match(html, /Extra steps for site1/);
  for (const [title, logo, short] of [['WordPress', 'wordpress.svg', 'wordpress'], ['Diffy', 'diffy.svg', 'diffy'], ['Drupal CMS', 'drupal.svg', 'drupal-cms'], ['django CMS', 'django-cms.png', 'django-cms']]) {
    const row = html.slice(html.indexOf(`data-pack="@webship-js/${short}-steps"`)).split('</li>')[0];
    assert.ok(row.includes(`>${title}</span>`), `${title}: name`);
    assert.ok(row.includes(`src="/step-packs/${logo}"`), `${title}: logo`);
    assert.ok(fs.existsSync(path.join(APP, 'public', 'step-packs', logo)), `${logo} ships`);
    assert.match(row, /<span class="uk-text-meta">\d+\.\d+\.\d+ · /, `${title}: version`);
    assert.ok(row.includes(`href="https://webship.co/docs/webship-js/2.0.x/${short}-step-definitions" target="_blank" rel="noopener noreferrer"`), `${title}: docs`);
    assert.ok(row.includes('hx-post="/actions/steps-add"'), `${title}: Add`);
  }
  assert.match(html, /for any site/, 'Diffy says it goes beside any pack');
  assert.match(html, /builds on drupal-core/, 'an extension names its base');
  assert.match(html, /In this project <span class="uk-badge">0<\/span>/);
  assert.match(html, /the list shipped with the Workspace/, 'where the list came from is said');
});

test('the panel: what a project has, and Remove only for what Add put in', async () => {
  const dir = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')));
  // WordPress the way its plugin's hook adds it (no mark); Diffy through Add.
  fs.writeFileSync(path.join(dir, 'cucumber.js'), CUCUMBER.replace("      'tests/step-definitions/**/*.js',", "      'node_modules/@webship-js/wordpress-steps/tests/step-definitions/**/*.js',\n      'tests/step-definitions/**/*.js',"));
  fs.writeFileSync(path.join(dir, 'package.json'), PKG.replace('"webship-js": "~2.0.0"', '"webship-js": "~2.0.0",\n    "@webship-js/wordpress-steps": "^2.2.0"'));
  sp.addPack(dir, pack('diffy'));
  sp.addPack(dir, pack('jira'));
  fs.mkdirSync(path.join(dir, 'node_modules', '@webship-js', 'wordpress-steps', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '@webship-js', 'wordpress-steps', 'package.json'), '{"name":"@webship-js/wordpress-steps","version":"2.2.4"}');
  const html = await page.stepPacksPanelHtml({ workspace: 'dev', project: 'site1', projectDir: dir, list: await offline() });
  const row = (short) => html.slice(html.indexOf(`data-pack="@webship-js/${short}-steps"`)).split('</li>')[0];
  assert.match(html, /In this project <span class="uk-badge">3<\/span>/);
  assert.match(row('wordpress'), /in this project/);
  assert.match(row('wordpress'), /installed 2\.2\.4/);
  assert.match(row('wordpress'), /<button class="uk-button uk-button-default uk-button-small" disabled title="A platform plugin or a person added it[^"]*">Remove<\/button>/, 'a plugin\'s pack cannot be removed from here');
  assert.match(row('diffy'), /arm-step" hx-post="\/actions\/steps-remove"[^>]*hx-trigger="confirmed-remove"/s, 'Remove asks first');
  assert.match(row('diffy'), /not installed/);
  assert.match(row('diffy'), /hx-post="\/actions\/steps-add"[^>]*>Install<\/button>/s, 'a pack not installed yet can be installed');
  assert.match(row('jira'), /profile jira/, 'a second platform says it has a profile of its own');
  assert.match(row('wordpress'), /hx-post="\/actions\/steps-examples"/);
  assert.ok(!/hx-post="\/actions\/steps-add"[^>]*>Add</s.test(row('wordpress')), 'no Add for a pack the project has');
});

test('the panel without a stack, and while a command runs', async () => {
  const bare = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')), { stack: false });
  const html = await page.stepPacksPanelHtml({ workspace: 'dev', project: 'bare', projectDir: bare, list: await offline() });
  assert.match(html, /no webship-js stack yet/);
  assert.match(html, /hx-post="\/actions\/testing-configure"/, 'it offers the setup');
  assert.match(html, /hx-post="\/actions\/steps-add"[^>]*\n?\s*disabled title="Set the testing environment up first\."/, 'Add waits for the stack');
  const dir = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')));
  const busy = await page.stepPacksPanelHtml({ workspace: 'dev', project: 'site1', projectDir: dir, busy: true, list: await offline() });
  assert.match(busy, /A testing or step-pack command is running on this project/);
  assert.ok(!/hx-post="\/actions\/steps-add"[^>]*\n?\s*title="Add /.test(busy), 'no Add is live while one runs');
});

test('a logo: the core\'s, else the one the installed pack ships, inlined; else none', () => {
  const dir = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')));
  assert.strictEqual(page.logoSrc(pack('wordpress'), dir), '/step-packs/wordpress.svg');
  const unknown = sp.describePack({ name: '@webship-js/newcms-steps' });
  assert.strictEqual(page.logoSrc(unknown, dir), '');
  const at = path.join(dir, 'node_modules', '@webship-js', 'newcms-steps', 'assets');
  fs.mkdirSync(at, { recursive: true });
  fs.writeFileSync(path.join(at, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.match(page.logoSrc(unknown, dir), /^data:image\/svg\+xml;base64,/, 'a file from npm is shown in an img, never served from this origin');
  assert.strictEqual(page.logoSrc({ ...unknown, logo: '../../server.js' }, dir).startsWith('data:'), true, 'a logo name from anywhere else is not a path');
});

test('the run picker lists every feature, the copied examples among them, with the profile they run in', () => {
  const dir = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')));
  sp.addPack(dir, pack('wordpress'));
  sp.addPack(dir, pack('jira'));
  for (const f of ['site.feature', 'wordpress-steps/login.feature', 'jira-steps/board.feature']) {
    fs.mkdirSync(path.dirname(path.join(dir, 'tests', 'features', f)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'features', f), 'Feature: x\n');
  }
  const html = page.featuresPickerHtml({ workspace: 'dev', project: 'site1', projectDir: dir });
  for (const f of ['tests/features/site.feature', 'tests/features/wordpress-steps/login.feature', 'tests/features/jira-steps/board.feature']) {
    assert.ok(html.includes(`&quot;feature&quot;:&quot;${f}&quot;`), f);
  }
  assert.match(html, /board\.feature<\/span>\s*<span class="uk-label"[^>]*>profile jira<\/span>/);
  assert.match(html, /hx-post="\/actions\/testing-run-feature"/);
  assert.match(html, /tests\/features\/wordpress-steps\/ <span class="uk-badge">1<\/span>/);
});

test('a feature whose name a command line would read as code is listed, never run', () => {
  // --path reaches `ddev exec` inside double quotes: a name with $( ), a quote or a backtick would run there.
  const dir = site(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-')));
  for (const f of ['ok name.feature', 'x$(touch pwn).feature', 'q"uote.feature', 'b`tick`.feature']) {
    fs.writeFileSync(path.join(dir, 'tests', 'features', f), 'Feature: x\n');
  }
  const files = page.projectFeatures(dir).flatMap((g) => g.files);
  assert.deepStrictEqual(files.filter((f) => f.runnable).map((f) => f.name), ['ok name.feature']);
  const html = page.featuresPickerHtml({ workspace: 'dev', project: 'site1', projectDir: dir });
  assert.strictEqual((html.match(/hx-post="\/actions\/testing-run-feature"/g) || []).length, 1);
  assert.match(html, /not runnable from here/);
  for (const bad of ['tests/features/../x.feature', 'tests/features/a/../../x.feature', '/etc/x.feature', 'tests/features/.hidden.feature']) {
    assert.ok(!page.RUNNABLE_FEATURE.test(bad), bad);
  }
});

test('the Tests menu opens the panel and the picker; the stylesheet and the logos ship', () => {
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.match(server, /data-entry="extra steps"><a href hx-get="\/fragments\/projects\/steps\/\$\{esc\(key\)\}\/\$\{encodeURIComponent\(p\)\}" hx-target="#editor-modal-body"/);
  assert.match(server, /data-entry="run one feature"><a href hx-get="\/fragments\/projects\/features\//);
  assert.ok(fs.existsSync(path.join(APP, 'public', 'css', 'components', 'step-packs.css')));
  for (const p of sp.shippedList().packs) assert.ok(fs.existsSync(path.join(APP, 'public', 'step-packs', p.logo)), `${p.name}: ${p.logo}`);
  const { files } = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(files.includes('core/workspace-app/public'), 'the logos are in the npm package');
});

// ---------------------------------------------------------------- the buttons, against a running dashboard

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-sp-server-'));
const asked = path.join(root, 'asked.txt');
let proc;
let base;
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const dev = path.join(root, 'dev');
  fs.mkdirSync(dev, { recursive: true });
  fs.writeFileSync(path.join(dev, 'cmd-tools-testing.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  site(path.join(dev, 'site1'));
  fs.writeFileSync(path.join(dev, 'site1', 'tests', 'features', 'site.feature'), 'Feature: x\n');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh\ncase "$1" in --version) echo "Screen version 4.09.01"; exit 0 ;; -ls) exit 1 ;; esac\nprintf '%s\\n' "$*" >> ${JSON.stringify(asked)}\nexit 0\n`, { mode: 0o755 });
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_STEPS_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return { status: r.status, text: await r.text() };
};
const started = () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8') : '');

test('the panel and the picker are served for a project of a workspace with the testing command', async () => {
  let r = await fetch(`${base}/fragments/projects/steps/dev/site1`);
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /Extra steps for site1/);
  r = await fetch(`${base}/fragments/projects/features/dev/site1`);
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /tests\/features\/site\.feature/);
  r = await fetch(`${base}/fragments/projects/steps/dev/nosuch`);
  assert.strictEqual(r.status, 404);
});

test('Add, Remove and Copy examples each start cmd-tools-testing.sh in a screen, with the pack\'s own name', async () => {
  let r = await post('/actions/steps-add', { workspace: 'dev', projectName: 'site1', pack: 'diffy' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.text, /add @webship-js\/diffy-steps<\/code> started on <strong>site1/);
  // Each word in single quotes: the screen runner hands the line to a shell.
  assert.match(started(), /-dmS dev--site1--steps bash -lc .*bash 'cmd-tools-testing\.sh' 'site1' '--add-steps' '@webship-js\/diffy-steps'/);
  r = await post('/actions/steps-examples', { workspace: 'dev', projectName: 'site1', pack: '@webship-js/wordpress-steps' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(started(), /'cmd-tools-testing\.sh' 'site1' '--examples' '@webship-js\/wordpress-steps'/);
  r = await post('/actions/steps-remove', { workspace: 'dev', projectName: 'site1', pack: 'diffy' });
  assert.strictEqual(r.status, 400, 'Remove needs the confirmation the dialog sends');
  r = await post('/actions/steps-remove', { workspace: 'dev', projectName: 'site1', pack: 'diffy', confirm: 'yes' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(started(), /'cmd-tools-testing\.sh' 'site1' '--remove-steps' '@webship-js\/diffy-steps'/);
});

test('the panel is drawn again when a step it started is done, and focus goes back to the same pack (#488)', async () => {
  // The panel listens for the page's "lists changed", which the step's watcher sends when its screen is done.
  const r = await fetch(`${base}/fragments/projects/steps/dev/site1`);
  const html = await r.text();
  assert.match(html, /<div class="editor-card step-packs" hx-get="\/fragments\/projects\/steps\/dev\/site1" hx-trigger="refresh-projects from:body" hx-swap="outerHTML">/);
  // Each pack's row is where focus goes back to after the redraw, to the same button when it is still there.
  const row = html.slice(html.indexOf('data-pack="@webship-js/diffy-steps"')).split('</li>')[0];
  assert.match(row, /data-refocus="step-pack:@webship-js\/diffy-steps"/);
  assert.match(row, /<button data-refocus-item="add" class="uk-button uk-button-primary uk-button-small" hx-post="\/actions\/steps-add"/);
  // Add, Remove and Copy examples leave the watcher that tells the page when the session is done.
  for (const [p, form] of [['/actions/steps-add', { pack: 'diffy' }], ['/actions/steps-examples', { pack: 'wordpress' }], ['/actions/steps-remove', { pack: 'diffy', confirm: 'yes' }]]) {
    const a = await post(p, { workspace: 'dev', projectName: 'site1', ...form });
    assert.strictEqual(a.status, 200, a.text);
    assert.match(a.text, /<span hidden class="session-watch" hx-get="\/fragments\/session-done\/dev--site1--steps" hx-trigger="every 2s"/, `${p}: ${a.text}`);
  }
  // Once the session is gone the watcher's answer tells the page: refresh-projects.
  const done = await fetch(`${base}/fragments/session-done/dev--site1--steps`);
  assert.strictEqual(done.headers.get('hx-trigger'), 'refresh-projects');
});

test('a pack, a project or a feature from the browser is checked before anything starts', async () => {
  const before = started();
  for (const pack of ['../../etc/passwd', 'https://example.com/x.tgz', '--registry=http://x', '@other/x-steps', 'a;b']) {
    const r = await post('/actions/steps-add', { workspace: 'dev', projectName: 'site1', pack });
    assert.strictEqual(r.status, 400, pack);
  }
  let r = await post('/actions/steps-add', { workspace: 'dev', projectName: 'site1', pack: 'no-such-platform' });
  assert.strictEqual(r.status, 404);
  assert.match(r.text, /not in the list/);
  r = await post('/actions/steps-add', { workspace: 'dev', projectName: '--help', pack: 'diffy' });
  assert.strictEqual(r.status, 400);
  r = await post('/actions/testing-run-feature', { workspace: 'dev', projectName: 'site1', feature: '../../../etc/passwd' });
  assert.strictEqual(r.status, 404);
  r = await post('/actions/testing-run-feature', { workspace: 'dev', projectName: 'site1', feature: 'tests/features/nope.feature' });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(started(), before, 'nothing was started for any of them');
  r = await post('/actions/testing-run-feature', { workspace: 'dev', projectName: 'site1', feature: 'tests/features/site.feature' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(started(), /-dmS dev--site1--tests bash -lc .*'cmd-tools-testing\.sh' 'site1' '--run' '--path' 'tests\/features\/site\.feature'/);
});
