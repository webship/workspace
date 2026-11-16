/**
 * `plugins.sh --configure <name>`: it finds the settings a plugin has (its own file, under the manifest's
 * name or the default one, and the file of the folder it is), and says so when there is nothing to configure.
 * `--install` names configure as the next step only when there is something to configure.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-configure-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), 'account:\n  name: webmaster\nworkspaces: []\nplugins: {}\n');
  const plugins = path.join(root, 'plugins');
  fs.mkdirSync(plugins);
  return { root, config, plugins };
}
function plugin(t, name, manifest, files = {}) {
  const dir = path.join(t.plugins, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@webship.co/workspace-${name}`, version: '0.1.0', main: 'index.js', workspacePlugin: { name, ...manifest } }));
}
const sh = (t, ...args) => spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), ...args], { cwd: t.root, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WORKSPACE_ROOT: t.root, WORKSPACE_CONFIG: t.config, WORKSPACE_PLUGINS_DIR: t.plugins, WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_PLUGINS_NEEDS_CHAIN: '' } });
const ok = (r) => { assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`); return r; };

test('configure shows the settings of a folder plugin, of a plugin that only names a template, and says when there are none', () => {
  const t = tree();
  // A workspace folder: its settings are the folder's file.
  plugin(t, 'dev', { workspace: { key: 'dev', settingsTemplate: 'config/workspace.dev.settings.yml', files: ['commands/cmd-tools-dev.sh'] } },
    { 'config/workspace.dev.settings.yml': 'doc:\n  name: dev\ntype: sites\n', 'commands/cmd-tools-dev.sh': '#!/usr/bin/env bash\n' });
  // A feature with a template and no settingsFile: the default name.
  plugin(t, 'host', { settingsTemplate: 'config/host.yml' }, { 'config/host.yml': '# Host\napi_token: CHANGE_ME\nregion: eu\n' });
  // A plugin with commands only: nothing to configure.
  plugin(t, 'tool', { commands: { types: ['sites'], workspaces: ['dev'], files: ['commands/cmd-tools-tool.sh'] } }, { 'commands/cmd-tools-tool.sh': '#!/usr/bin/env bash\n' });
  for (const n of ['dev', 'host', 'tool']) ok(sh(t, '--activate', n));

  const dev = ok(sh(t, '--install', 'dev'));
  assert.match(dev.stdout, /Installed\. Next: --configure dev\./);
  const devConf = ok(sh(t, '--configure', 'dev'));
  assert.match(devConf.stdout, /The settings of its folder: .*core\/config\/workspace\.dev\.settings\.yml/);
  assert.match(devConf.stdout, /^type: sites$/m, 'the file is shown');
  assert.doesNotMatch(devConf.stdout, /no settings file|nothing to configure/);

  ok(sh(t, '--install', 'host'));
  fs.writeFileSync(path.join(t.config, 'plugin.host.settings.yml'), '# Host\napi_token: tok-123\nregion: eu\n');
  const host = ok(sh(t, '--configure', 'host'));
  assert.match(host.stdout, /Its settings: .*core\/config\/plugin\.host\.settings\.yml/);
  assert.match(host.stdout, /^api_token: <hidden>$/m);
  assert.match(host.stdout, /^region: eu$/m);
  assert.ok(!host.stdout.includes('tok-123'));

  const tool = ok(sh(t, '--install', 'tool'));
  assert.match(tool.stdout, /Installed\. tool has nothing to configure: it is ready\./);
  assert.doesNotMatch(tool.stdout, /Next: --configure/);
  assert.match(ok(sh(t, '--configure', 'tool')).stdout, /tool has nothing to configure/);
});
