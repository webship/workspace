/**
 * What a plugin needs from another plugin: the manifest's `needs` and `suggests`, read by
 * plugin-needs.js, honoured by plugins.sh (--require, --activate, --install, --deactivate,
 * --uninstall, --list), by the installer and by the Plugins page.
 *
 * Every check runs against a temporary tree with fake plugin folders, the way plugin-system.test.js
 * does. Where a needed package is not there yet, `npm` is a stand-in first on PATH that copies a fake
 * package out of a store folder, so no test reaches the network or the dashboard's own package.json.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');

/** A fake plugin folder: a manifest, and one file for each thing the manifest places. */
function plugin(into, name, manifest = {}) {
  const dir = path.join(into, name);
  fs.mkdirSync(path.join(dir, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'commands', `cmd-${name}-project.sh`), '#!/usr/bin/env bash\n# in __WORKSPACE__\n');
  fs.writeFileSync(path.join(dir, 'commands', `cmd-tools-${name}.sh`), '#!/usr/bin/env bash\n# in __WORKSPACE__\n');
  fs.writeFileSync(path.join(dir, 'config', `workspace.${name}.settings.yml`), `doc:\n  name: ${name}\ntype: ${manifest.type || 'sites'}\n`);
  fs.writeFileSync(path.join(dir, 'agents', `${name}-builder.md`), `# ${name} builder\n`);
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  const m = { name, ...manifest };
  delete m.type;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@webship.co/workspace-${name}`, version: '0.1.0', main: 'index.js', workspacePlugin: m }));
  return dir;
}

/** A workspace folder as a plugin, and a platform as a plugin: the two shapes the needs are between. */
const folder = (into, name, type = 'sites') => plugin(into, name, { type, workspace: { key: name, settingsTemplate: `config/workspace.${name}.settings.yml`, files: [`commands/cmd-tools-${name}.sh`] } });
const platform = (into, name, extra = {}) => plugin(into, name, {
  commands: { types: ['sites'], workspaces: ['dev', 'test'], files: [`commands/cmd-${name}-project.sh`] },
  ai: { agents: [`agents/${name}-builder.md`] }, ...extra });

/** An empty workspace (no folders, no plugins activated), a plugins folder, a store a stand-in npm installs from. */
function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-needs-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), 'account:\n  name: webmaster\nworkspaces: []\nplugins: {}\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  const plugins = path.join(root, 'plugins');
  const store = path.join(root, 'store');
  const bin = path.join(root, 'bin');
  for (const d of [plugins, store, bin]) fs.mkdirSync(d);
  // npm install <spec>: @webship.co/workspace-<name> comes out of the store, anything else is not found.
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash
spec="\${@: -1}"; name="\${spec#@webship.co/workspace-}"
echo "$spec" >> "${path.join(root, 'npm.log')}"
[ -d "${store}/$name" ] || { echo "npm error 404 $spec" >&2 ; exit 1 ; }
cp -r "${store}/$name" "${plugins}/$name"
`, { mode: 0o755 });
  return { root, config, plugins, store, bin };
}

const env = (t) => ({ ...process.env, PATH: `${t.bin}:${process.env.PATH}`, WORKSPACE_ROOT: t.root, WORKSPACE_CONFIG: t.config, WORKSPACE_PLUGINS_DIR: t.plugins,
  WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_PLUGINS_NEEDS_CHAIN: '' });
const sh = (t, ...args) => spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), ...args], { cwd: t.root, env: env(t), encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
const node = (t, code) => {
  const r = spawnSync(process.execPath, ['-e', code], { cwd: APP, env: env(t), encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
};
const settings = (t) => yaml.load(fs.readFileSync(path.join(t.config, 'settings.yml'), 'utf8')) || {};
const record = (t) => { try { return yaml.load(fs.readFileSync(path.join(t.config, 'plugins.installed.yml'), 'utf8')) || {}; } catch (_) { return {}; } };
const enabled = (t, name) => !!(settings(t).plugins && settings(t).plugins[name] && settings(t).plugins[name].enabled === true);
const ok = (r) => { assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`); return r; };
/** Everything under the root, so "nothing was changed" can be said of a whole tree. */
const snapshot = (t) => {
  const out = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else out.push(`${path.relative(t.root, p)}:${fs.readFileSync(p, 'utf8')}`); } };
  walk(t.root);
  return out.filter((l) => !l.startsWith('npm.log')).sort().join('\n');
};

test('needs and suggests are one shape: a name, or a list of names when any one will do; what is wrong is said, not guessed', () => {
  const { normalize } = require('../../plugin-needs');
  assert.deepStrictEqual(normalize(undefined), { groups: [], problems: [] });
  assert.deepStrictEqual(normalize([['dev', 'test', 'dev'], 'ai-agents']).groups, [['dev', 'test'], ['ai-agents']]);
  assert.strictEqual(normalize('dev').problems.length, 1, 'a bare string is not a list');
  assert.deepStrictEqual(normalize({ plugins: ['dev'] }), { groups: [['dev']], problems: [] }, 'an object holds the plugins under plugins (and commands beside them)');
  assert.strictEqual(normalize({ plugin: ['dev'] }).problems.length, 1, 'a key that is not a kind of need is said');
  const bad = normalize(['Dev!', [], ['ok', 7], 'self'], 'self');
  assert.deepStrictEqual(bad.groups, []);
  assert.strictEqual(bad.problems.length, 4);
  assert.match(bad.problems[3], /self names itself/);
});

test('a needed package is required from the same source as the plugin that needs it', () => {
  const { specFor } = require('../../plugin-needs');
  assert.strictEqual(specFor({ module: '@webship.co/workspace-wordpress', spec: '^1.0.8' }, 'dev'), '@webship.co/workspace-dev');
  assert.strictEqual(specFor({ module: '@acme/workspace-shop', spec: '1.2.3' }, 'dev'), '@acme/workspace-dev', 'the scope of the plugin that needs it');
  assert.strictEqual(specFor({ module: '@webship.co/workspace-wordpress', spec: 'github:webship/workspace-wordpress#1.0.x' }, 'dev'), 'github:webship/workspace-dev', 'the repository beside it, on its default branch');
  assert.strictEqual(specFor({ module: '@webship.co/workspace-wordpress', spec: 'git+https://github.com/webship/workspace-wordpress.git' }, 'ai-agents'), 'git+https://github.com/webship/workspace-ai-agents.git');
  assert.strictEqual(specFor({ module: '', spec: 'plugins/wordpress' }, 'dev'), '@webship.co/workspace-dev', 'a plugin folder has no source: the npm name');
  // A path: the folder beside it, when there is one with a package.json.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-needs-src-'));
  fs.mkdirSync(path.join(base, 'workspace-wordpress'));
  fs.mkdirSync(path.join(base, 'workspace-dev'));
  fs.writeFileSync(path.join(base, 'workspace-dev', 'package.json'), '{}');
  const rel = path.relative(APP, path.join(base, 'workspace-wordpress'));
  assert.strictEqual(specFor({ module: '@webship.co/workspace-wordpress', spec: `file:${rel}` }, 'dev'), path.join(base, 'workspace-dev'));
  assert.strictEqual(specFor({ module: '@webship.co/workspace-wordpress', spec: `file:${rel}` }, 'test'), '@webship.co/workspace-test', 'no folder beside it: the npm name');
});

test('a need is met by a plugin that is activated AND installed here, never by a package in node_modules alone', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: [['dev', 'test'], 'ai-agents'], suggests: ['graph'] });
  folder(t.plugins, 'dev');
  folder(t.plugins, 'ai-agents', 'ai-items');
  const check = () => JSON.parse(node(t, 'console.log(JSON.stringify(require("./plugin-needs").check("wp")))'));
  let c = check();
  assert.deepStrictEqual(c.needs.map((n) => [n.anyOf.join('|'), n.metBy, n.pick, n.required]), [['dev|test', null, 'dev', true], ['ai-agents', null, 'ai-agents', true]], 'the packages are there, the needs are not met');
  assert.deepStrictEqual(c.suggests.map((n) => [n.pick, n.metBy, n.required, n.spec]), [['graph', null, false, '@webship.co/workspace-graph']]);
  assert.strictEqual(c.unmet.length, 2);
  ok(sh(t, '--activate', 'dev'));
  assert.strictEqual(check().needs[0].metBy, null, 'activated is not installed');
  ok(sh(t, '--install', 'dev'));
  c = check();
  assert.strictEqual(c.needs[0].metBy, 'dev');
  assert.deepStrictEqual(c.unmet.map((n) => n.pick), ['ai-agents']);
});

test('a workspace folder that was here before folders were plugins meets the need for it', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: [['dev', 'test']] });
  fs.mkdirSync(path.join(t.root, 'test'));
  fs.writeFileSync(path.join(t.config, 'workspace.test.settings.yml'), 'doc:\n  name: test\ntype: sites\n');
  fs.writeFileSync(path.join(t.config, 'settings.yml'), 'workspaces:\n  - test\nplugins: {}\n');
  const c = JSON.parse(node(t, 'console.log(JSON.stringify(require("./plugin-needs").check("wp")))'));
  assert.strictEqual(c.needs[0].metBy, 'test');
  ok(sh(t, '--activate', 'wp'));
  ok(sh(t, '--install', 'wp'));
  assert.ok(fs.existsSync(path.join(t.root, 'test', 'cmd-wp-project.sh')), 'and the builder lands in it');
  // A folder that is on disk but not on the workspaces list is not a workspace.
  fs.writeFileSync(path.join(t.config, 'settings.yml'), 'workspaces: []\nplugins: {}\n');
  assert.strictEqual(JSON.parse(node(t, 'console.log(JSON.stringify(require("./plugin-needs").check("wp")))')).needs[0].metBy, null);
});

test('declined: without --with-needs an activate and an install stop, say the exact commands, and change nothing', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: [['dev', 'test'], 'ai-agents'] });
  folder(t.plugins, 'ai-agents', 'ai-items');
  folder(t.store, 'dev');
  const before = snapshot(t);
  for (const [verb, done] of [['--activate', 'activated'], ['--install', 'installed']]) {
    const r = sh(t, verb, 'wp');
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /wp needs what this workspace does not have yet:\n {2}one of dev, test \(not here; dev is the one added\)\n {2}ai-agents \(not here\)/);
    assert.match(r.stdout, new RegExp(`Nothing was changed: wp was not ${done}`));
    // dev's package is not here: its require line is said; ai-agents' is, so only the two steps.
    assert.match(r.stdout, /--require @webship\.co\/workspace-dev\n.*--activate dev\n.*--install dev\n.*--activate ai-agents\n.*--install ai-agents\n/);
    assert.doesNotMatch(r.stdout, /--require @webship\.co\/workspace-ai-agents/);
    assert.match(r.stdout, new RegExp(`plugins\\.sh ${verb} wp --with-needs`));
    assert.strictEqual(snapshot(t), before, 'not a file of the workspace changed');
  }
  assert.ok(!fs.existsSync(path.join(t.root, 'npm.log')), 'nothing was fetched');
  // The installer itself refuses too, for whoever calls it without the script.
  const direct = spawnSync(process.execPath, ['plugin-install.js', 'install', 'wp'], { cwd: APP, env: env(t), encoding: 'utf8' });
  assert.strictEqual(direct.status, 1);
  assert.match(direct.stderr, /wp needs one of dev, test \(not here; dev is the one added\)[\s\S]*Nothing was placed[\s\S]*--install wp --with-needs/);
  assert.strictEqual(snapshot(t), before);
});

test('accepted: --with-needs requires, activates and installs what is missing first, then the plugin; the record says what met each need', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: [['dev', 'test'], 'ai-agents'] });
  folder(t.store, 'dev');
  folder(t.store, 'ai-agents', 'ai-items');
  const a = ok(sh(t, '--activate', 'wp', '--with-needs'));
  assert.match(a.stdout, /→ wp needs dev: requiring @webship\.co\/workspace-dev\n→ wp needs dev: activating and installing it/);
  assert.match(a.stdout, /→ wp needs ai-agents: requiring @webship\.co\/workspace-ai-agents/);
  assert.match(a.stdout, /Activated: plugins\.wp/);
  assert.deepStrictEqual(fs.readFileSync(path.join(t.root, 'npm.log'), 'utf8').trim().split('\n'), ['@webship.co/workspace-dev', '@webship.co/workspace-ai-agents'], 'only what was missing, in the order it is needed');
  assert.deepStrictEqual(settings(t).workspaces, ['dev', 'ai-agents']);
  for (const n of ['dev', 'ai-agents', 'wp']) assert.ok(enabled(t, n), `${n} is activated`);
  assert.deepStrictEqual(Object.keys(record(t)).sort(), ['ai-agents', 'dev'], 'the needs are installed; the plugin itself waits for its own install');
  // Its own install needs nothing more, and no flag.
  const i = ok(sh(t, '--install', 'wp'));
  assert.doesNotMatch(i.stdout, /needs/);
  assert.ok(fs.existsSync(path.join(t.root, 'dev', 'cmd-wp-project.sh')), 'the builder is in the sites folder');
  assert.ok(fs.existsSync(path.join(t.root, 'ai-agents', 'wp-builder.md')), 'the agent is in the AI Agents folder');
  assert.deepStrictEqual(record(t).wp.needs, [['dev', 'test'], ['ai-agents']]);
  assert.deepStrictEqual(record(t).wp.metBy, ['dev', 'ai-agents']);
  // --install --with-needs from nothing does the same in one run, for a plugin activated by hand.
  const t2 = tree();
  platform(t2.plugins, 'wp', { needs: ['dev'] });
  folder(t2.store, 'dev');
  ok(sh(t2, '--install', 'wp', '--with-needs'));
  assert.ok(fs.existsSync(path.join(t2.root, 'dev', 'cmd-wp-project.sh')));
});

test('one of several: what is already here is used, and nothing else is added', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: [['dev', 'test']] });
  folder(t.plugins, 'test');
  folder(t.store, 'dev');
  ok(sh(t, '--activate', 'test'));
  ok(sh(t, '--install', 'test'));
  const a = ok(sh(t, '--activate', 'wp'));
  assert.doesNotMatch(a.stdout, /needs/, 'met by test: no question, no flag');
  ok(sh(t, '--install', 'wp'));
  assert.ok(!fs.existsSync(path.join(t.root, 'npm.log')), 'dev was never fetched');
  assert.deepStrictEqual(record(t).wp.metBy, ['test']);
  // An alternative whose package is here is the one added, before the first of the list.
  const t2 = tree();
  platform(t2.plugins, 'wp', { needs: [['dev', 'test']] });
  folder(t2.plugins, 'test');
  folder(t2.store, 'dev');
  ok(sh(t2, '--activate', 'wp', '--with-needs'));
  assert.deepStrictEqual(settings(t2).workspaces, ['test']);
  assert.ok(!fs.existsSync(path.join(t2.root, 'npm.log')));
});

test('a need of a need is added first; a cycle is reported and nothing is changed', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: ['dev'] });
  plugin(t.store, 'dev', { workspace: { key: 'dev', settingsTemplate: 'config/workspace.dev.settings.yml' }, needs: ['base'] });
  folder(t.store, 'base', 'files');
  ok(sh(t, '--activate', 'wp', '--with-needs'));
  assert.deepStrictEqual(settings(t).workspaces, ['base', 'dev'], 'base before dev, dev before wp');
  // a → b → a, both packages here: said before anything is done.
  const c = tree();
  plugin(c.plugins, 'a', { needs: ['b'] });
  plugin(c.plugins, 'b', { needs: ['a'] });
  const before = snapshot(c);
  for (const flags of [[], ['--with-needs']]) {
    const r = sh(c, '--activate', 'a', ...flags);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /a cannot be activated: its manifest's needs are wrong\.\n.*a cycle \(a → b → a\)/);
    assert.strictEqual(snapshot(c), before);
  }
  // a → b → a, where b arrives only when it is fetched: the run stops at the cycle instead of looping.
  const l = tree();
  plugin(l.plugins, 'a', { needs: ['b'] });
  plugin(l.store, 'b', { needs: ['a'] });
  const r = sh(l, '--activate', 'a', '--with-needs');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /cycle/);
  assert.match(r.stdout, /Stopped: a was not activated/);
  assert.ok(!enabled(l, 'a') && !enabled(l, 'b'), 'neither is activated');
  assert.deepStrictEqual(record(l), {});
});

test('an unknown need is reported; the plugin is not activated, and what was added before the stop is complete on its own', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: ['dev', 'nowhere'] });
  folder(t.store, 'dev');
  const r = sh(t, '--activate', 'wp', '--with-needs');
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /wp needs 'nowhere', and @webship\.co\/workspace-nowhere could not be required as a plugin of that name/);
  assert.match(r.stdout, /Stopped: wp was not activated\. Added before the stop: dev \(each one complete on its own\)/);
  assert.ok(!enabled(t, 'wp'), 'wp is not activated');
  assert.ok(!record(t).wp, 'and nothing of it is placed');
  assert.ok(enabled(t, 'dev') && record(t).dev, 'dev is activated and installed: a whole plugin, not half of one');
  // A package that is there under that npm name but is not a plugin of that name is unknown too.
  const t2 = tree();
  platform(t2.plugins, 'wp', { needs: ['dev'] });
  plugin(t2.store, 'dev', {});
  fs.writeFileSync(path.join(t2.store, 'dev', 'package.json'), JSON.stringify({ name: '@webship.co/workspace-dev', version: '0.1.0', workspacePlugin: { name: 'other' } }));
  const r2 = sh(t2, '--activate', 'wp', '--with-needs');
  assert.strictEqual(r2.status, 1);
  assert.match(r2.stdout, /could not be required as a plugin of that name/);
  assert.ok(!enabled(t2, 'wp'));
});

test('--require says what the package needs; with --with-needs it fetches the packages too, and activates nothing', () => {
  const t = tree();
  platform(t.store, 'wp', { needs: [['dev', 'test'], 'ai-agents'], suggests: ['graph'] });
  folder(t.store, 'dev');
  folder(t.store, 'ai-agents', 'ai-items');
  const r = ok(sh(t, '--require', '@webship.co/workspace-wp'));
  assert.match(r.stdout, /wp declares:\n {2}wp needs one of dev, test \(not here; dev is the one added\)\n {2}wp needs ai-agents \(not here\)\n {2}wp suggests graph \(not here\)/);
  assert.match(r.stdout, /--activate wp --with-needs adds what is not here/);
  assert.deepStrictEqual(fs.readdirSync(t.plugins), ['wp'], 'only the package asked for');
  const t2 = tree();
  platform(t2.store, 'wp', { needs: [['dev', 'test'], 'ai-agents'], suggests: ['graph'] });
  folder(t2.store, 'dev');
  folder(t2.store, 'ai-agents', 'ai-items');
  ok(sh(t2, '--require', '@webship.co/workspace-wp', '--with-needs'));
  assert.deepStrictEqual(fs.readdirSync(t2.plugins).sort(), ['ai-agents', 'dev', 'wp'], 'the needs are fetched; what is only suggested is not');
  assert.deepStrictEqual(settings(t2).plugins, {}, 'nothing is activated by a require');
  assert.deepStrictEqual(settings(t2).workspaces, []);
});

test('--deactivate and --uninstall refuse, with the list, while a plugin in use needs this one — unless another one meets the need', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: [['dev', 'test'], 'ai-agents'] });
  platform(t.plugins, 'shop', { needs: ['dev'] });
  for (const n of ['dev', 'test']) folder(t.plugins, n);
  folder(t.plugins, 'ai-agents', 'ai-items');
  ok(sh(t, '--install', 'wp', '--with-needs'));
  ok(sh(t, '--activate', 'wp'));
  ok(sh(t, '--install', 'shop'));
  const before = snapshot(t);
  for (const [verb, done] of [['--uninstall', 'uninstalled'], ['--deactivate', 'deactivated']]) {
    const r = sh(t, verb, 'dev');
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, new RegExp(`dev cannot be ${done}: another plugin in use needs it\\.\\n {2}shop needs dev, and dev is the only one here\\n {2}wp needs one of dev, test, and dev is the only one here`));
    assert.match(r.stdout, /Nothing was changed\. Take those off first:\n.*--uninstall shop\n.*--uninstall wp/);
    assert.doesNotMatch(r.stdout, /--force/);
    assert.strictEqual(snapshot(t), before);
  }
  // The installer refuses too.
  const direct = spawnSync(process.execPath, ['plugin-install.js', 'uninstall', 'ai-agents'], { cwd: APP, env: env(t), encoding: 'utf8' });
  assert.strictEqual(direct.status, 1);
  assert.match(direct.stderr, /ai-agents is needed by wp \(ai-agents\)[\s\S]*Nothing was removed/);
  assert.strictEqual(snapshot(t), before);
  // Another sites folder arrives: wp no longer depends on dev alone, shop still does.
  ok(sh(t, '--activate', 'test'));
  const it = ok(sh(t, '--install', 'test'));
  assert.match(it.stdout, /wp: placed 1 more file\(s\) now that test\/ is here \(test\/cmd-wp-project\.sh\)/, 'the builder reaches the folder that came later');
  let r = sh(t, '--uninstall', 'dev');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /shop needs dev/);
  assert.doesNotMatch(r.stdout, /wp needs/);
  ok(sh(t, '--uninstall', 'shop'));
  r = ok(sh(t, '--uninstall', 'dev'));
  assert.deepStrictEqual(settings(t).workspaces, ['ai-agents', 'test'], 'dev is off the list');
  assert.ok(fs.existsSync(path.join(t.root, 'test', 'cmd-wp-project.sh')), 'wp still has its builder, in test');
  // Now test is the only one, and it is kept.
  assert.strictEqual(sh(t, '--uninstall', 'test').status, 1);
  // Once the plugin that needs them is uninstalled, they can go.
  ok(sh(t, '--uninstall', 'wp'));
  ok(sh(t, '--uninstall', 'test'));
  ok(sh(t, '--deactivate', 'ai-agents'));
});

test('a plugin whose package was removed still keeps what it needs, from what its install recorded', () => {
  const t = tree();
  platform(t.plugins, 'wp', { needs: ['dev'] });
  folder(t.plugins, 'dev');
  ok(sh(t, '--install', 'wp', '--with-needs'));
  ok(sh(t, '--activate', 'wp'));
  fs.rmSync(path.join(t.plugins, 'wp'), { recursive: true });
  const r = sh(t, '--uninstall', 'dev');
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /wp needs dev, and dev is the only one here/);
});

test('suggests is only said: it never stops a step and never adds anything', () => {
  const t = tree();
  plugin(t.plugins, 'git', { commands: { workspaces: ['dev'], files: ['commands/cmd-tools-git.sh'] }, suggests: [['dev', 'test']] });
  folder(t.store, 'dev');
  const a = ok(sh(t, '--activate', 'git', '--with-needs'));
  assert.doesNotMatch(a.stdout, /requiring/);
  ok(sh(t, '--install', 'git'));
  assert.ok(!fs.existsSync(path.join(t.root, 'npm.log')));
  // Said without "is the one added": a suggestion is never added.
  assert.match(sh(t, '--list').stdout, /git .*\n\s+suggests: one of dev, test \(not here\)\n/);
  // Once one of them is in the workspace, the line says which.
  folder(t.plugins, 'test');
  ok(sh(t, '--activate', 'test'));
  ok(sh(t, '--install', 'test'));
  assert.match(sh(t, '--list').stdout, /suggests: one of dev, test \(here: test\)/);
  assert.ok(!record(t).git.needs, 'nothing to record');
});

test('--list and the Plugins page say what each plugin needs, whether it is met, and who needs it', () => {
  const t = tree();
  platform(t.plugins, 'wp', { label: 'WP', needs: [['dev', 'test'], 'ai-agents'], suggests: ['graph'] });
  folder(t.plugins, 'dev');
  folder(t.plugins, 'ai-agents', 'ai-items');
  plugin(t.plugins, 'broken', { needs: 'dev' });
  let list = sh(t, '--list').stdout;
  assert.match(list, /wp .*required · next: activate\n\s+needs: one of dev, test \(not here; dev is the one added\) · ai-agents \(not here\) {3}suggests: graph \(not here\)/);
  assert.match(list, /broken .*\n\s+problem: needs: must be a list of plugin names/);
  // Each plugin's own page in Settings (the Plugins page used to carry a card per plugin).
  const pages = () => node(t, 'const m=require("./settings-model"),pg=require("./settings-plugin-page");const g=m.groupByFamily(require("./plugins-page").rows()).flatMap((f)=>f.plugins);const known=new Set(g.map((p)=>p.name));console.log(g.map((p)=>"PLUGIN-PAGE "+pg.pluginPageHtml(p,{known,files:[]})).join(""))');
  const page = () => node(t, 'console.log(require("./plugins-page").pluginsPageHtml())');
  let html = pages();
  const card = (h, label) => h.split('PLUGIN-PAGE ').find((c) => c.includes(`<h2 class="plugin-head-name">${label}</h2>`)) || '';
  assert.match(card(html, 'WP'), /<strong>dev or test<\/strong>: not here\.\s+dev is the one that is added\./);
  assert.match(card(html, 'WP'), /graph: not here, and not needed/);
  // The step says what it adds and runs the script with --with-needs: no question in a dialog.
  assert.match(card(html, 'WP'), /It needs dev and ai-agents, which are not here yet: one run adds them first/);
  assert.match(card(html, 'WP'), /&quot;verb&quot;:&quot;activate&quot;,&quot;name&quot;:&quot;wp&quot;,&quot;withNeeds&quot;:&quot;1&quot;[^>]*>Activate with dev and ai-agents</);
  assert.match(card(html, 'WP'), /<code>bash core\/scripts\/plugins\.sh --activate wp --with-needs<\/code>/);
  assert.doesNotMatch(card(html, 'dev'), /withNeeds/, 'a plugin with no needs is a plain button');
  assert.match(card(html, 'broken'), /needs: must be a list/);
  assert.doesNotMatch(card(html, 'broken'), /withNeeds/, 'a manifest that is wrong is not offered a fix it cannot have');
  // The catalogue does not repeat what a plugin needs: its row is its name and what it does, and its page says the rest.
  platform(t.plugins, 'wordpress', { needs: ['dev'] });
  assert.doesNotMatch(page(), /needs: dev \(not here\)/);
  assert.match(pages(), /<strong>dev<\/strong>: not here\./);
  fs.rmSync(path.join(t.plugins, 'wordpress'), { recursive: true });
  fs.rmSync(path.join(t.plugins, 'broken'), { recursive: true });
  ok(sh(t, '--install', 'wp', '--with-needs'));
  ok(sh(t, '--activate', 'wp'));
  list = sh(t, '--list').stdout;
  assert.match(list, /needs: one of dev, test \(met by dev\) · ai-agents \(met by ai-agents\)/);
  assert.match(list, /dev .*ready\n\s+needed by: wp/);
  html = pages();
  assert.match(card(html, 'WP'), /<strong>dev or test<\/strong>: met by <a href="\/settings\/plugin\/dev">dev<\/a>/);
  assert.match(card(html, 'WP'), /<strong>ai-agents<\/strong>: met by <a href="\/settings\/plugin\/ai-agents">ai-agents<\/a>/);
  assert.doesNotMatch(card(html, 'WP'), /withNeeds/, 'met: nothing to add');
  assert.match(card(html, 'dev'), /dev cannot be deactivated or uninstalled while wp needs it/);
});

test('the Plugins page action passes --with-needs only when the card asked, and only to the three verbs that take it', () => {
  const src = fs.readFileSync(path.join(APP, 'actions', 'plugins.js'), 'utf8');
  assert.match(src, /const WITH_NEEDS = new Set\(\['require', 'activate', 'install'\]\)/);
  assert.match(src, /WITH_NEEDS\.has\(verb\) && String\(form\.withNeeds \|\| ''\) === '1'/);
  assert.match(src, /\.\.\.\(withNeeds \? \['--with-needs'\] : \[\]\)/);
});

test('webship-workspace plugin passes --with-needs on to plugins.sh, and nothing else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-needs-bin-'));
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'scripts', 'plugins.sh'), '#!/usr/bin/env bash\necho "ARGS: $*"\n');
  const bin = path.join(APP, '..', 'bin', 'workspace.js');
  const run = (...args) => spawnSync(process.execPath, [bin, 'plugin', ...args], { encoding: 'utf8', env: { ...process.env, WORKSPACE_ROOT: root } }).stdout.trim();
  assert.strictEqual(run('activate', 'wordpress', '--with-needs'), 'ARGS: --activate wordpress --with-needs');
  assert.strictEqual(run('require', '--with-needs', 'wordpress'), 'ARGS: --require @webship.co/workspace-wordpress --with-needs');
  assert.strictEqual(run('install', 'wordpress', '--anything'), 'ARGS: --install wordpress');
  assert.strictEqual(run('activate', 'wordpress'), 'ARGS: --activate wordpress');
});

test('the first words a new workspace reads say that a plugin can need another one, and how to add it', () => {
  const bin = path.join(APP, '..', 'bin', 'workspace.js');
  const r = spawnSync(process.execPath, [bin, 'catalog'], { encoding: 'utf8' });
  assert.match(r.stdout, /A plugin that needs another one says so when you require it; add --with-needs to activate/);
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const empty = server.slice(server.indexOf('function emptyWorkspaceHtml'), server.indexOf('function emptyWorkspaceHtml') + 1800);
  assert.match(empty, /plugin activate wordpress --with-needs<\/code> adds what is missing first, and the Activate step on the plugin's page says what it adds/);
});

test('a plugin\'s commands and its agents, skills, commands and prompts land in the folders that are active here, follow the workspaces list, and go with the plugin', () => {
  const t = tree();
  // A plugin with a builder for dev and test, and one AI item of each kind.
  const dir = platform(t.plugins, 'wp', { needs: [['dev', 'test']], ai: { agents: ['agents/wp-builder.md'], skills: ['skills/wp-skill'], commands: ['aicommands/wp-command.md'], prompts: ['prompts/wp-prompt.md'] } });
  fs.mkdirSync(path.join(dir, 'skills', 'wp-skill'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'wp-skill', 'SKILL.md'), '# skill\n');
  for (const [d, f] of [['aicommands', 'wp-command.md'], ['prompts', 'wp-prompt.md']]) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, f), `# ${f}\n`); }
  for (const n of ['dev', 'test']) folder(t.plugins, n);
  for (const n of ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts']) folder(t.plugins, n, 'ai-items');
  const has = (f) => fs.existsSync(path.join(t.root, f));
  const items = ['ai-agents/wp-builder.md', 'ai-skills/wp-skill/SKILL.md', 'ai-commands/wp-command.md', 'ai-prompts/wp-prompt.md'];
  // dev and the agents folder are active; a test/ and an ai-skills/ folder lie on disk, off the list.
  for (const n of ['dev', 'ai-agents']) { ok(sh(t, '--activate', n)); ok(sh(t, '--install', n)); }
  fs.mkdirSync(path.join(t.root, 'test'));
  fs.mkdirSync(path.join(t.root, 'ai-skills'));
  ok(sh(t, '--activate', 'wp'));
  const i = ok(sh(t, '--install', 'wp'));
  assert.ok(has('dev/cmd-wp-project.sh') && has(items[0]), 'in the folders that are workspaces here');
  assert.ok(!has('test/cmd-wp-project.sh') && !has(items[1]), 'not in a folder that is only on disk');
  for (const kind of ['skills', 'commands', 'prompts']) assert.match(i.stdout, new RegExp(`skipped 1 ${kind}: there is no ai-${kind}/ workspace here \\(add the ai-${kind} workspace: they are placed when it is installed\\)`));
  // The folders arrive later, activated then installed or installed then activated: the items appear with no second step for the plugin.
  // ai-skills/ is on disk already: listing it is what makes it a workspace, and the skill arrives then.
  const s = ok(sh(t, '--activate', 'ai-skills'));
  assert.match(s.stdout, /wp: placed 1 more file\(s\) \(ai-skills\/wp-skill\/SKILL\.md\)/);
  ok(sh(t, '--install', 'ai-skills'));
  ok(sh(t, '--install', 'ai-commands'));
  assert.ok(!has(items[2]), 'installed but not activated: not a workspace yet');
  const a = ok(sh(t, '--activate', 'ai-commands'));
  assert.match(a.stdout, /wp: placed 1 more file\(s\) \(ai-commands\/wp-command\.md\)/);
  // A folder that is not on disk yet: activated, then installed, which is when the items arrive.
  ok(sh(t, '--activate', 'ai-prompts'));
  assert.match(ok(sh(t, '--install', 'ai-prompts')).stdout, /wp: placed 1 more file\(s\) now that ai-prompts\/ is here \(ai-prompts\/wp-prompt\.md\)/);
  ok(sh(t, '--activate', 'test'));
  ok(sh(t, '--install', 'test'));
  for (const f of [...items, 'dev/cmd-wp-project.sh', 'test/cmd-wp-project.sh']) assert.ok(has(f), `${f} is there`);
  for (const f of [...items, 'dev/cmd-wp-project.sh', 'test/cmd-wp-project.sh']) assert.ok(record(t).wp.placed.includes(f), `${f} is recorded`);
  // A folder taken off the list keeps its own content and loses what other plugins placed in it; back on the list, it gets it back.
  const d = ok(sh(t, '--deactivate', 'dev'));
  assert.match(d.stdout, /wp: took 1 file\(s\) out of a folder that is no longer a workspace here \(dev\/cmd-wp-project\.sh\)/);
  assert.ok(!has('dev/cmd-wp-project.sh') && has('dev/cmd-tools-dev.sh') && has('test/cmd-wp-project.sh'));
  ok(sh(t, '--activate', 'dev'));
  assert.ok(has('dev/cmd-wp-project.sh'));
  // Uninstalling a folder: nothing of another plugin is left behind in it.
  ok(sh(t, '--uninstall', 'dev'));
  assert.ok(!has('dev/cmd-wp-project.sh') && !record(t).wp.placed.includes('dev/cmd-wp-project.sh'));
  // Uninstalling the plugin removes every item and its record; the folders and what a person edited stay.
  fs.writeFileSync(path.join(t.root, items[3]), '# mine now\n');
  const u = ok(sh(t, '--uninstall', 'wp'));
  for (const f of [items[0], items[1], items[2], 'test/cmd-wp-project.sh']) assert.ok(!has(f), `${f} is gone`);
  assert.ok(has(items[3]), 'the prompt a person edited stays');
  assert.match(u.stdout, /kept ai-prompts\/wp-prompt\.md \(edited here, so it stays\)/);
  assert.ok(!record(t).wp, 'the record is gone');
  assert.ok(!enabled(t, 'wp'));
  assert.ok(has('ai-agents/cmd-tools-ai-agents.sh') && has('test/cmd-tools-test.sh'), 'the folders keep their own');
});
