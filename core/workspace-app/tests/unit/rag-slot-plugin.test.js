/**
 * The RAG slot of a project row belongs to a plugin once one registered it (#570).
 *
 * The RAG plugin (@webship.co/workspace-rag) draws the RAG menu with api.addRowMenu('rag', …), a menu
 * whose body loads when it opens. The core used to put its own RAG menu in that slot after the plugins'
 * menus, so the plugin's was replaced: by the core's menu where the folder had a cmd-tools-ragify.sh,
 * by nothing where it had not. Without such a plugin the core's own menu is drawn, as before.
 *
 * Against real servers over a temp tree: a sites folder with one project and a cmd-tools-ragify.sh, and
 * a plugin folder with a plugin that registers the rag slot. One server loads it, the other does not.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-rag-slot-'));
const servers = {};

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** A dashboard over the tree, with the plugins of `config` on: its base URL. */
async function start(name, pluginOn) {
  const config = path.join(root, `config-${name}`);
  copyConfig(path.join(REPO, 'core/config'), config);
  for (const f of ['row-actions.yml', 'row-actions.seen.json']) fs.rmSync(path.join(config, f), { force: true });
  const template = fs.readFileSync(path.join(REPO, 'core/config/settings.template.yml'), 'utf8');
  fs.writeFileSync(path.join(config, 'settings.yml'), template
    .replace(/^workspaces: \[\]$/m, 'workspaces:\n  - dev')
    .replace(/^plugins: \{\}$/m, `plugins:\n  x-rag:\n    enabled: ${pluginOn ? 'true' : 'false'}`));
  const port = await free();
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: path.join(root, 'plugins'), WORKSPACE_PLUGINS_NO_RESTART: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
  servers[name] = { proc, base: `http://127.0.0.1:${port}` };
}

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'dev/site-one/.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/site-one/.ddev/config.yaml'), 'name: site-one\ntype: drupal\ndocroot: web\n');
  // The script that makes the core's own RAG menu appear.
  fs.writeFileSync(path.join(root, 'dev/cmd-tools-ragify.sh'), '#!/usr/bin/env bash\n');
  // A plugin that draws the RAG menu: a button, a caption, and a body that loads when the menu opens.
  const dir = path.join(root, 'plugins/x-rag');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-x-rag', version: '0.1.0', main: 'index.js', workspacePlugin: { name: 'x-rag', label: 'X RAG' } }));
  fs.writeFileSync(path.join(dir, 'index.js'), `
    module.exports.register = (api) => {
      api.addRowMenu('rag', { label: 'RAG', row: 1 }, ({ key, project }) => ({
        html: '<button class="uk-button x-rag-button" type="button">RAG</button>',
        body: '/fragments/p/x-rag/menu/' + key + '/' + project,
        caption: 'built 2 hours ago',
      }));
      api.addFragment(({ send, rest }) => send('<ul class="uk-nav uk-dropdown-nav"><li data-entry="build the index"><a href class="x-rag-build">Rebuild the index of ' + rest.slice(5) + '</a></li></ul>'));
    };`);
  await start('with', true);
  await start('without', false);
});

after(() => {
  for (const s of Object.values(servers)) s.proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

/** The row of site-one on the dev page. */
async function row(name) {
  const html = await (await fetch(`${servers[name].base}/dev`)).text();
  const at = html.indexOf('"projectName":"site-one"');
  assert.ok(at > 0, 'the page has the row');
  const start = html.lastIndexOf('project-row pcard', at);
  const end = html.indexOf('project-row pcard', at);
  return html.slice(start, end === -1 ? undefined : end);
}

test('a plugin that registered the rag slot has its menu drawn there, and the core draws none of its own', async () => {
  const r = await row('with');
  assert.strictEqual((r.match(/act-menu-rag\b/g) || []).length, 1, 'one RAG menu on the row');
  assert.ok(r.includes('<button class="uk-button x-rag-button" type="button">RAG</button>'), "the plugin's button");
  assert.ok(r.includes('hx-get="/fragments/row-menu/rag/dev/site-one?body=%2Ffragments%2Fp%2Fx-rag%2Fmenu%2Fdev%2Fsite-one"'), "its body, asked through the core when the menu opens");
  assert.ok(r.includes('<span class="act-status uk-text-meta">built 2 hours ago</span>'), "the plugin's caption");
  assert.ok(!r.includes('Start it in the RAG workspace') && !r.includes('Chunks, fields and functions'), "no trace of the core's own menu");
});

test("the plugin's body loads through the core's row-menu route", async () => {
  const res = await fetch(`${servers.with.base}/fragments/row-menu/rag/dev/site-one?body=${encodeURIComponent('/fragments/p/x-rag/menu/dev/site-one')}`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Rebuild the index of dev\/site-one/);
});

test('without such a plugin the core draws its own RAG menu, as before', async () => {
  const r = await row('without');
  assert.strictEqual((r.match(/act-menu-rag\b/g) || []).length, 1, 'one RAG menu on the row');
  assert.ok(!r.includes('x-rag-button'), 'the plugin is off');
  assert.match(r, /Build the index/, "the core's menu");
});
