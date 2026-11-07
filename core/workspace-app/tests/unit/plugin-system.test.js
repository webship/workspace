/**
 * The plugin system end to end, against a temporary tree: a fake plugin that uses every hook, the
 * manifest reader, the installer's place / record / uninstall, and plugins.sh's verbs.
 *
 * The dashboard's own modules read ROOT and the plugins folder once at load, so each check runs in a
 * child node process with WORKSPACE_ROOT / WORKSPACE_CONFIG / WORKSPACE_PLUGINS_DIR pointing at the
 * temporary tree — the same way a test of a shipped default does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');

/** A workspace tree with one `sites` workspace, and a plugins folder with one plugin that uses every hook. */
function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-plugins-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dev', 'site1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), [
    'account:', '  name: webmaster', '  pass: CHANGE_ME', '  mail: a@example.com',
    'workspaces:', '  - dev', '  - modules',
    // The shipped Google Drive plugin is on by default; off here, so only the fake one is loaded.
    'plugins:', '  x-cloud:', '    enabled: true', '  google-drive-sync:', '    enabled: false',
    'x_cloud:', '  token: carried-over', 'git:', '  x-forge:', '    username: forge-me', '    token: CHANGE_ME', '',
  ].join('\n'));
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  fs.writeFileSync(path.join(config, 'workspace.modules.settings.yml'), 'doc:\n  name: modules\ntype: code\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  const plugins = path.join(root, 'plugins');
  const dir = path.join(plugins, 'x-cloud');
  for (const d of ['scripts/functions', 'scripts/args', 'commands', 'ddev', 'config', 'public', 'features']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: '@webship/workspace-x-cloud', version: '0.1.0', main: 'index.js',
    workspacePlugin: {
      name: 'x-cloud', label: 'X Cloud', settingsFile: 'plugin.x-cloud.settings.yml', settingsTemplate: 'config/plugin.x-cloud.settings.yml',
      legacySettingsKey: 'x_cloud', labels: 'config/labels.yml', typeActions: { 'x-cloud': ['sites'] },
      commands: { types: ['sites'], files: ['commands/cmd-tools-x-cloud.sh'] },
      scripts: { functions: ['scripts/functions/fun-x-cloud.sh'], args: ['scripts/args/arg-x-cloud.sh'] },
      ddev: { compose: ['ddev/docker-compose.x-cloud.yaml'], hostMounts: ['~/.x-cloud'] },
      css: ['public/x-cloud.css'], features: ['features/x-cloud.feature'],
    },
  }));
  fs.writeFileSync(path.join(dir, 'config', 'plugin.x-cloud.settings.yml'), '# X Cloud\ntoken: CHANGE_ME\nregion: eu\n');
  fs.writeFileSync(path.join(dir, 'config', 'labels.yml'), 'token:\n  label: X Cloud token\n');
  fs.writeFileSync(path.join(dir, 'commands', 'cmd-tools-x-cloud.sh'), '#!/usr/bin/env bash\n# in __WORKSPACE__\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'functions', 'fun-x-cloud.sh'), 'function x_cloud_tool() { echo x; }\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'args', 'arg-x-cloud.sh'), '#!/usr/bin/env bash\n');
  fs.writeFileSync(path.join(dir, 'ddev', 'docker-compose.x-cloud.yaml'), 'services:\n  web:\n    volumes:\n      - "${HOME}/.x-cloud:/x:rw"\n');
  fs.writeFileSync(path.join(dir, 'public', 'x-cloud.css'), '.x-cloud { color: red; }\n');
  fs.writeFileSync(path.join(dir, 'features', 'x-cloud.feature'), 'Feature: x\n');
  fs.writeFileSync(path.join(dir, 'index.js'), `
    module.exports.register = (api) => {
      api.addRowMenu('x-cloud', { label: 'X CLOUD', row: 0 }, ({ key, project, allowed }) => allowed.has('x-cloud') ? '<div class="act-menu-x-cloud">' + key + '/' + project + '</div>' : null);
      api.addPage(/^\\/x-cloud\\/([a-z]+)$/, ({ send, match }) => send('page:' + match[1]));
      api.addProjectChip(({ project }) => '<span class="x-chip">' + project + '</span>');
      api.addFolderSetup({ html: () => '<div class="x-setup"></div>', steps: (ws, name, form) => form.x === '1' ? ['echo x ' + name] : [], prompt: () => ['x prompt'], problem: (ws, form) => form.x === 'bad' ? 'bad x' : '' });
      api.addAction('ping', ({ send }) => send('pong'));
      api.addFragment(({ send, rest }) => send('frag:' + rest));
      api.addLabels({ region: { label: 'Region' } });
      api.addForge('forge.test', { label: 'X Forge', env: () => ({ X_TOKEN: 'secret' }), auth: () => ({ username: 'me', how: 'token' }) });
    };`);
  return { root, config, plugins, dir };
}

function node(code, env) {
  const r = spawnSync(process.execPath, ['-e', code], { cwd: APP, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`${r.stderr || r.stdout}`);
  return r.stdout;
}

function env(t) {
  // NO_RESTART: the verbs must not touch the dashboard that serves this machine.
  return { WORKSPACE_ROOT: t.root, WORKSPACE_CONFIG: t.config, WORKSPACE_PLUGINS_DIR: t.plugins, WORKSPACE_PLUGINS_NO_RESTART: '1' };
}

test('a plugin reaches every hook, and what it registers is what the dashboard draws', async () => {
  const t = tree();
  const out = node(`
    const l = require('./plugin-loader');
    const { TYPES } = require('./workspace-types');
    const rl = require('./row-layout');
    const vals = () => '';
    const menus = l.pluginRowMenus({ key: 'dev', project: 'site1', dir: '${t.root}/dev', meta: {}, allowed: new Set(['x-cloud']), vals });
    const none = l.pluginRowMenus({ key: 'modules', project: 'm', dir: '${t.root}/modules', meta: {}, allowed: new Set(), vals });
    const chips = l.pluginProjectChipsHtml({ key: 'dev', project: 'site1', dir: '${t.root}/dev', meta: {} });
    const setups = l.pluginFolderSetups();
    let page = ''; const res = { writeHead() {}, end(s) { page = s; } };
    l.pluginPage('/x-cloud/abc', {}, res).then((hit) => {
      let frag = ''; const res2 = { writeHead() {}, end(s) { frag = s; } };
      const hitF = l.pluginFragment('/fragments/p/x-cloud/one/two', { url: '/fragments/p/x-cloud/one/two' }, res2);
      console.log(JSON.stringify({ menus, none, chips, setups: setups.length, steps: setups[0].steps('dev', 'n', { x: '1' }, {}), problem: setups[0].problem('dev', { x: 'bad' }, {}),
        hit, page, hitF, frag, css: l.pluginCssFiles(), labels: l.pluginLabels(), sitesHas: TYPES.sites.actions.includes('x-cloud'), codeHas: TYPES.code.actions.includes('x-cloud'),
        button: rl.DEFAULT_ROWS[0].includes('x-cloud'), action: Object.keys(l.pluginActions), loaded: l.loadedPlugins,
        forge: l.pluginForge('FORGE.test') && l.pluginForge('FORGE.test').env(), noForge: l.pluginForge('other.test') }));
    });`, env(t));
  const r = JSON.parse(out);
  assert.strictEqual(r.menus['x-cloud'], '<div class="act-menu-x-cloud">dev/site1</div>');
  assert.strictEqual(r.none['x-cloud'], '', 'a row whose type does not allow it gets an empty slot');
  assert.strictEqual(r.chips, '<span class="x-chip">site1</span>');
  assert.strictEqual(r.setups, 1);
  assert.deepStrictEqual(r.steps, ['echo x n']);
  assert.strictEqual(r.problem, 'bad x');
  assert.strictEqual(r.hit, true); assert.strictEqual(r.page, 'page:abc');
  assert.strictEqual(r.hitF, true); assert.strictEqual(r.frag, 'frag:one/two');
  assert.ok(r.css[0].endsWith('/x-cloud/public/x-cloud.css'), 'the manifest css is served');
  assert.strictEqual(r.labels.token.label, 'X Cloud token', 'the manifest labels are merged');
  assert.strictEqual(r.labels['plugin.x-cloud.token'].label, 'X Cloud token');
  assert.strictEqual(r.labels.region.label, 'Region', 'labels from register() too');
  assert.ok(r.sitesHas && !r.codeHas, 'the type action lands on the types named');
  assert.ok(r.button, 'the row-menu slot joins the default layout');
  assert.deepStrictEqual(r.action, ['/actions/p/x-cloud/ping']);
  assert.deepStrictEqual(r.loaded, [{ name: 'x-cloud', source: 'plugins/x-cloud' }]);
  assert.deepStrictEqual(r.forge, { X_TOKEN: 'secret' }, 'a forge answers for its host, whatever the case');
  assert.strictEqual(r.noForge, null);
});

test('a dotted legacy key names a nested settings.yml block, for the reader and the installer', () => {
  const t = tree();
  const dir = path.join(t.plugins, 'x-forge');
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@webship/workspace-x-forge', version: '0.1.0', main: 'index.js',
    workspacePlugin: { name: 'x-forge', settingsFile: 'plugin.x-forge.settings.yml', settingsTemplate: 'config/plugin.x-forge.settings.yml', legacySettingsKey: 'git.x-forge' } }));
  fs.writeFileSync(path.join(dir, 'config', 'plugin.x-forge.settings.yml'), 'username: CHANGE_ME\ntoken: CHANGE_ME\n');
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  const read = node(`console.log(JSON.stringify(require('./plugin-settings').readPluginSettings('x-forge')))`, env(t));
  assert.deepStrictEqual(JSON.parse(read), { username: 'forge-me', token: 'CHANGE_ME' }, 'before the file exists, the nested block answers');
  const r = spawnSync(process.execPath, ['plugin-install.js', 'install', 'x-forge'], { cwd: APP, env: { ...process.env, ...env(t) }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const settings = fs.readFileSync(path.join(t.config, 'plugin.x-forge.settings.yml'), 'utf8');
  assert.match(settings, /^username: forge-me$/m, 'the nested block value is carried into the file');
  assert.match(settings, /^token: CHANGE_ME$/m, 'a placeholder is not carried');
});

test('the manifest reader sees a plugin folder and answers the command line', () => {
  const t = tree();
  const out = node(`const m = require('./plugin-manifest'); console.log(JSON.stringify(m.installedPlugins().map((p) => [p.name, p.module, p.spec])));`, env(t));
  assert.deepStrictEqual(JSON.parse(out).filter((x) => x[0] === 'x-cloud'), [['x-cloud', '@webship/workspace-x-cloud', 'plugins/x-cloud']]);
  const r = spawnSync(process.execPath, ['plugin-manifest.js', 'nope'], { cwd: APP, env: { ...process.env, ...env(t) }, encoding: 'utf8' });
  assert.strictEqual(r.status, 1, 'an unknown name is a non-zero exit, for the shell');
});

test('install places what the manifest names, records it, carries the legacy block, and uninstall removes exactly that', () => {
  const t = tree();
  const run = (verb) => spawnSync(process.execPath, ['plugin-install.js', verb, 'x-cloud'], { cwd: APP, env: { ...process.env, ...env(t) }, encoding: 'utf8' });
  const r = run('install');
  assert.strictEqual(r.status, 0, r.stderr);
  const placed = r.stdout.split('\n').filter((l) => l.startsWith('  placed ')).map((l) => l.replace('  placed ', ''));
  const expect = [
    'core/scripts/plugins/x-cloud/functions/fun-x-cloud.sh', 'core/scripts/plugins/x-cloud/args/arg-x-cloud.sh', 'core/scripts/plugins/x-cloud/host-mounts.txt',
    'core/workspace-app/.ddev/docker-compose.plugin-x-cloud-x-cloud.yaml', 'dev/cmd-tools-x-cloud.sh',
    'core/workspace-app/tests/features/plugins/x-cloud/x-cloud.feature', 'core/config/plugin.x-cloud.settings.yml',
  ];
  for (const p of expect) {
    assert.ok(placed.includes(p), `${p} is reported placed`);
    assert.ok(fs.existsSync(path.join(t.root, p)), `${p} exists`);
  }
  assert.ok(!fs.existsSync(path.join(t.root, 'modules', 'cmd-tools-x-cloud.sh')), 'a code workspace gets no sites command');
  assert.match(fs.readFileSync(path.join(t.root, 'dev', 'cmd-tools-x-cloud.sh'), 'utf8'), /# in dev\n/, '__WORKSPACE__ is filled in');
  const settings = fs.readFileSync(path.join(t.config, 'plugin.x-cloud.settings.yml'), 'utf8');
  assert.match(settings, /^token: carried-over$/m, 'the legacy block value replaces the template placeholder');
  assert.match(settings, /^region: eu$/m, 'the rest of the template stays');
  assert.match(r.stdout, /RESTART_NEEDED/, 'a compose file means the container has to restart');
  assert.match(fs.readFileSync(path.join(t.root, 'core', 'config', 'plugins.installed.yml'), 'utf8'), /x-cloud:/);
  const gi = fs.readFileSync(path.join(t.root, '.gitignore'), 'utf8');
  assert.match(gi, /managed by core\/scripts\/plugins\.sh/);
  assert.match(gi, /^\/dev\/cmd-tools-x-cloud\.sh$/m);
  assert.match(gi, /^node_modules\/$/m, 'what the file had stays');
  // Again: idempotent, and nothing doubled.
  assert.strictEqual(run('install').status, 0);
  assert.strictEqual((fs.readFileSync(path.join(t.root, '.gitignore'), 'utf8').match(/managed by/g) || []).length, 1);
  const u = run('uninstall');
  assert.strictEqual(u.status, 0, u.stderr);
  for (const p of expect) assert.ok(!fs.existsSync(path.join(t.root, p)), `${p} is gone`);
  assert.ok(!fs.existsSync(path.join(t.root, 'core', 'scripts', 'plugins', 'x-cloud')), 'the scripts folder is gone');
  assert.doesNotMatch(fs.readFileSync(path.join(t.root, '.gitignore'), 'utf8'), /cmd-tools-x-cloud/);
});

test('plugins.sh lists the step a plugin is at, activates and deactivates it in settings.yml', () => {
  const t = tree();
  const sh = (...args) => spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), ...args], { cwd: t.root, env: { ...process.env, ...env(t), WORKSPACE_SCRIPTS: SCRIPTS }, encoding: 'utf8', timeout: 60000 });
  let r = sh('--list');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /x-cloud\s+@webship\/workspace-x-cloud\s+0\.1\.0\s+activated · next: install/);
  r = sh('--deactivate', 'x-cloud');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(t.config, 'settings.yml'), 'utf8'), /x-cloud:\n(?:    .*\n)*?    enabled: false/);
  assert.match(sh('--list').stdout, /x-cloud.*required · next: activate/);
  r = sh('--activate', 'x-cloud');
  assert.strictEqual(r.status, 0, r.stderr);
  const s = fs.readFileSync(path.join(t.config, 'settings.yml'), 'utf8');
  assert.match(s, /x-cloud:\n(?:    .*\n)*?    enabled: true/, 'enabled, wherever in the block the writer put it');
  assert.match(s, /module: "@webship\/workspace-x-cloud"/, 'a module name starting with @ is quoted');
  assert.match(sh('--list').stdout, /x-cloud.*activated · next: install/);
  assert.strictEqual(sh('--activate', 'nope').status, 1, 'an unknown plugin is refused');
});
