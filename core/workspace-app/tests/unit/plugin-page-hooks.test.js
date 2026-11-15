/**
 * What a plugin reaches in the page: its own browser scripts (the manifest's `js`, api.addScript), an
 * action that takes a binary body (api.addUpload), and the assistant's turn (ui.js).
 *
 * The loader reads its plugins once at load, so it runs in a child process against a temporary tree.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-page-hooks-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), ['workspaces:', '  - dev', 'plugins:', '  x-voice:', '    enabled: true', ''].join('\n'));
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  const dir = path.join(root, 'plugins', 'x-voice');
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: '@webship.co/workspace-x-voice', version: '0.1.0', main: 'index.js',
    workspacePlugin: { name: 'x-voice', label: 'X Voice', js: ['public/first.js', 'public/Bad Name.js'] },
  }));
  fs.writeFileSync(path.join(dir, 'public', 'first.js'), 'window.xFirst = 1;\n');
  fs.writeFileSync(path.join(dir, 'public', 'second.js'), 'window.xSecond = 2;\n');
  fs.writeFileSync(path.join(dir, 'public', 'secret.js'), 'window.notDeclared = 3;\n');
  fs.writeFileSync(path.join(dir, 'index.js'), `
    const path = require('path');
    module.exports.register = (api) => {
      api.addScript(path.join(__dirname, 'public', 'second.js'));
      api.addUpload('hear', ({ body, searchParams, json }) => json({ bytes: body.length, lang: searchParams.get('lang') }), { maxBytes: 16 });
    };`);
  return { root, config, plugins: path.join(root, 'plugins') };
}

function node(code, t) {
  const r = spawnSync(process.execPath, ['-e', code], { cwd: APP, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, WORKSPACE_ROOT: t.root, WORKSPACE_CONFIG: t.config, WORKSPACE_PLUGINS_DIR: t.plugins, WORKSPACE_PLUGINS_NO_RESTART: '1' } });
  if (r.status !== 0) throw new Error(`${r.stderr || r.stdout}`);
  return r.stdout;
}

test('a plugin\'s scripts are listed in order and served, and nothing it did not declare is', () => {
  const t = tree();
  const r = JSON.parse(node(`
    const l = require('./plugin-loader');
    const get = (p) => { let out = { hit: false }; const res = { writeHead(s, h) { out.status = s; out.type = h['Content-Type']; }, end(b) { out.body = String(b); } }; out.hit = l.pluginScript(p, res); return out; };
    console.log(JSON.stringify({ scripts: l.pluginScripts().map((s) => s.url.replace(/\\?v=\\d+$/, '?v=N')),
      first: get('/plugin-js/x-voice/first.js'), second: get('/plugin-js/x-voice/second.js'), secret: get('/plugin-js/x-voice/secret.js'),
      climb: get('/plugin-js/x-voice/../index.js'), other: get('/plugin-js/nobody/first.js'), caps: [...l.loadedPlugins].length }));`, t));
  assert.deepStrictEqual(r.scripts, ['/plugin-js/x-voice/first.js?v=N', '/plugin-js/x-voice/second.js?v=N'], 'the manifest\'s, then register()\'s; a badly named file is left out');
  assert.deepStrictEqual({ hit: r.first.hit, status: r.first.status, body: r.first.body }, { hit: true, status: 200, body: 'window.xFirst = 1;\n' });
  assert.match(r.first.type, /^text\/javascript/);
  assert.strictEqual(r.second.hit, true);
  assert.strictEqual(r.secret.hit, false, 'a file beside the declared ones is not served');
  assert.strictEqual(r.climb.hit, false);
  assert.strictEqual(r.other.hit, false);
});

test('an upload is registered with its limit, and its handler is given the body', () => {
  const t = tree();
  const r = JSON.parse(node(`
    const l = require('./plugin-loader');
    const u = l.pluginUpload('/actions/p/x-voice/hear');
    let answer = null;
    u.handler({ body: Buffer.from('abcd'), searchParams: new URLSearchParams('lang=en'), json: (o) => { answer = o; } });
    console.log(JSON.stringify({ max: u.maxBytes, answer, none: l.pluginUpload('/actions/p/x-voice/other'), form: Object.keys(l.pluginActions) }));`, t));
  assert.strictEqual(r.max, 16);
  assert.deepStrictEqual(r.answer, { bytes: 4, lang: 'en' });
  assert.strictEqual(r.none, null);
  assert.deepStrictEqual(r.form, [], 'an upload is not a form action');
});

test('the server loads the scripts in the page, answers an upload before the form parser, and guards it', () => {
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.match(src, /pluginScripts\(\)\.map\(\(p\) => `<script src="\$\{esc\(p\.url\)\}" defer><\/script>/);
  assert.match(src, /pathname\.startsWith\('\/plugin-js\/'\) && pluginScript\(pathname, res\)/);
  const at = src.indexOf('pluginUpload(pathname) : null');
  assert.ok(at > 0 && at < src.indexOf("req.on('end', () => handleAction(pathname, querystring.parse(body), res, req));"), 'the upload is answered before the form parser');
  const block = src.slice(at, at + 1400);
  assert.match(block, /foreignOrigin\(req\)\) return json\(\{ error: 'Refused/);
  assert.match(block, /413/);
});

test('the page offers the assistant to a plugin\'s script: send a turn, add to its body, speak the answer', () => {
  const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');
  assert.match(ui, /window\.wsAssistantSend = \(text\) =>/);
  assert.match(ui, /window\.wsAssistantHooks\.beforeSend/);
  assert.match(ui, /new CustomEvent\('ws-assistant-answer', \{ cancelable: true/);
  assert.match(ui, /const speakHere = document\.dispatchEvent\(answer\);\s+setWorking\(false\);\s+if \(response && response\.html\) \{ if \(speakHere\) narrator\.narrate/);
  const loader = fs.readFileSync(path.join(APP, 'plugin-loader.js'), 'utf8');
  assert.match(loader, /'scripts', 'uploads', 'assistant-answer', 'assistant-ear'\]\)/);
  const doc = fs.readFileSync(path.join(APP, 'PLUGINS.md'), 'utf8');
  for (const s of ['`api.addScript(file)`', '`api.addUpload(name, handler, { maxBytes })`', 'ws-assistant-answer', 'wsAssistantSend', '"js": [']) assert.ok(doc.includes(s), `PLUGINS.md says ${s}`);
});

test('the dock\'s talk buttons and the Space bar go to a plugin\'s ear when one is set, and to the browser\'s recogniser otherwise', () => {
  const src = fs.readFileSync(path.join(APP, 'public', 'assistant-avatar-ui.js'), 'utf8');
  assert.match(src, /const ear = \(\) => \{ const e = window\.wsAssistantEar;/);
  assert.match(src, /function listen\(on\) \{\n    if \(ear\(\)\) \{ ear\(\)\.hold\(Boolean\(on\)\); return; \}\n    if \(!Recognition \|\| keep\) return;/);
  assert.match(src, /function keepListening\(on\) \{\n    if \(ear\(\)\) \{ ear\(\)\.keep\(Boolean\(on\)\); return; \}/);
  assert.match(src, /keepListening\(ear\(\) \? !earKeeps\(\) : !keep\)/);
  assert.ok(fs.readFileSync(path.join(APP, 'PLUGINS.md'), 'utf8').includes('window.wsAssistantEar'));
});
