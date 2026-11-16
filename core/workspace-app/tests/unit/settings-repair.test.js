/**
 * webship-workspace update repairs a settings.yml that 1.0.2 to 1.0.6 broke (#405): the template's
 * `plugins: {}` and the `plugins:` block the first --activate wrote below it, so the file did not parse,
 * and a workspaces list cut down to the last folder activated. Nothing else in the file changes, and the
 * file as it was is kept.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const APP = path.join(__dirname, '..', '..');
const BIN = path.join(APP, '..', 'bin', 'workspace.js');

function folderPlugin(plugins, name) {
  const dir = path.join(plugins, name);
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@webship.co/workspace-${name}`, version: '1.0.2', main: 'index.js',
    workspacePlugin: { name, workspace: { key: name, settingsTemplate: `config/workspace.${name}.settings.yml` } } }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  fs.writeFileSync(path.join(dir, 'config', `workspace.${name}.settings.yml`), `doc:\n  name: ${name}\ntype: sites\n`);
}

/** A workspace made by init, with what 1.0.2's activate and install left in it. */
function brokenWorkspace() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-repair-')), 'workspace');
  const cli = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8',
    env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1', ...env } });
  assert.strictEqual(cli(['init', dir]).status, 0);
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(dir, 'core', 'workspace-app', 'node_modules'), 'dir');
  const plugins = path.join(dir, 'local-plugins');
  for (const n of ['ai-agents', 'dev', 'docs']) { folderPlugin(plugins, n); fs.mkdirSync(path.join(dir, n)); }
  const config = path.join(dir, 'core', 'config');
  const settings = path.join(config, 'settings.yml');
  // The template, a person's own value, then what three activations wrote: the second block, and the
  // list cut down to the last folder.
  let text = fs.readFileSync(settings, 'utf8').replace(/^workspaces: \[\]$/m, 'workspaces:\n  - "docs"');
  text = text.replace(/^  name: webmaster$/m, '  name: mine');
  text += '\nplugins:\n  docs:\n    module: "@webship.co/workspace-docs"\n    enabled: true\n  dev:\n    module: "@webship.co/workspace-dev"\n    enabled: true\n  ai-agents:\n    module: "@webship.co/workspace-ai-agents"\n    enabled: true\n  git:\n    module: "@webship.co/workspace-git"\n    enabled: true\n';
  fs.writeFileSync(settings, text, { mode: 0o600 });
  fs.writeFileSync(path.join(config, 'plugins.installed.yml'), 'ai-agents:\n  placed: []\ndev:\n  placed: []\ndocs:\n  placed: []\n');
  return { dir, config, settings, text, cli, env: { WORKSPACE_PLUGINS_DIR: plugins } };
}

test('update repairs the two plugins: blocks of 1.0.2 to 1.0.6, puts the lost folders back, and keeps the file as it was', () => {
  const t = brokenWorkspace();
  assert.throws(() => yaml.load(t.text), /duplicated mapping key/, 'the shape 1.0.2 left');
  const u = t.cli(['update', t.dir], t.env);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.match(u.stdout, /repaired core\/config\/settings\.yml: it had two plugins: blocks/);
  assert.match(u.stdout, /put the folders of the enabled plugins back on the workspaces list, in the order they were installed \(2 the broken file had lost: ai-agents, dev\)/);
  const doc = yaml.load(fs.readFileSync(t.settings, 'utf8'));
  assert.deepStrictEqual(doc.workspaces, ['ai-agents', 'dev', 'docs']);
  assert.deepStrictEqual(Object.keys(doc.plugins), ['docs', 'dev', 'ai-agents', 'git'], 'every plugin the second block held');
  assert.strictEqual(doc.account.name, 'mine', 'the rest of the file is as the person left it');
  const before = path.join(t.config, 'settings.yml.before-update');
  assert.strictEqual(fs.readFileSync(before, 'utf8'), t.text, 'the file as it was is kept');
  assert.strictEqual(fs.statSync(before).mode & 0o777, 0o600, 'and only its owner reads it: it holds tokens');
  assert.strictEqual(fs.statSync(t.settings).mode & 0o777, 0o600);
  // A second update has nothing to repair and says nothing about it.
  const again = t.cli(['update', t.dir], t.env);
  assert.strictEqual(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /repaired|put the folders/);
});

test('a settings.yml that parses is never touched, and one broken another way is left as it is', () => {
  const t = brokenWorkspace();
  // Fine already: the person fixed it by hand.
  const fine = t.text.replace(/^plugins: \{\}$/m, '');
  fs.writeFileSync(t.settings, fine);
  assert.strictEqual(t.cli(['update', t.dir], t.env).status, 0);
  assert.strictEqual(fs.readFileSync(t.settings, 'utf8'), fine);
  assert.ok(!fs.existsSync(path.join(t.config, 'settings.yml.before-update')));
  // Two blocks, and a second fault of its own: said, not changed.
  const worse = `${t.text}\naccount:\n  name: twice\n`;
  fs.writeFileSync(t.settings, worse);
  const u = t.cli(['update', t.dir], t.env);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.match(u.stdout, /still does not parse without its empty plugins: \{\} line: it is left as it is/);
  assert.strictEqual(fs.readFileSync(t.settings, 'utf8'), worse);
});
