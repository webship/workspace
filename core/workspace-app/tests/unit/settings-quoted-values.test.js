/**
 * A value written in quotes is shown without them, and saved back quoted (#330).
 *
 * The form showed a quoted value with its quotes: Jira's site read `"https://CHANGE_ME.atlassian.net"` in
 * the field, Google Drive's empty `account: ""` read `""`, and a person who typed at the end of the value
 * saved the quotes into it (`"\"https://…\"-r2"`). An empty secret written `""` was even called "set".
 *
 * The rows now carry what YAML reads (`display`) and how the line wrote it (`quote`); the form shows the
 * first, a save compares with it and keeps the line's quotes, so an emptied `""` stays a string.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const yaml = require('js-yaml');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-quoted-'));
process.env.WORKSPACE_CONFIG = TMP;
const { readSettingsRows, writeSettingsValues, unquote } = require('../../settings-file');

const FILE = [
  'site: "https://CHANGE_ME.atlassian.net"',
  'account: ""',
  "motto: 'it''s here'",
  'plain: value',
  'escaped: "a \\"b\\" c"',
  'token: ""',
  '',
].join('\n');

test('a row carries the value as YAML reads it, and the quote its line wrote it in', () => {
  fs.writeFileSync(path.join(TMP, 'plugin.x-quoted.settings.yml'), FILE);
  const rows = Object.fromEntries(readSettingsRows('plugin.x-quoted.settings.yml').map((r) => [r.key, r]));
  const parsed = yaml.load(FILE);
  for (const key of ['site', 'account', 'motto', 'plain', 'escaped']) {
    assert.strictEqual(rows[key].display, parsed[key], `${key} as YAML reads it`);
  }
  assert.deepStrictEqual([rows.site.quote, rows.motto.quote, rows.plain.quote], ['"', "'", '']);
  assert.strictEqual(rows.site.value, '"https://CHANGE_ME.atlassian.net"', 'the line itself is still there');
  assert.strictEqual(unquote('"\\u00e9t\\u00e9"'), 'été');
  assert.strictEqual(unquote('"'), '"', 'a lone quote is a value, not an empty quoted one');
});

test('a write keeps the line\'s quotes: an emptied "" stays a string, a single-quoted value stays single-quoted', () => {
  fs.writeFileSync(path.join(TMP, 'plugin.x-quoted.settings.yml'), FILE);
  const rows = Object.fromEntries(readSettingsRows('plugin.x-quoted.settings.yml').map((r) => [r.key, r]));
  const set = (key, value) => ({ line: rows[key].line, key, value, quote: rows[key].quote });
  writeSettingsValues('plugin.x-quoted.settings.yml', [set('site', 'https://acme.example'), set('account', ''),
    set('motto', "it's mine"), set('plain', 'other')]);
  const text = fs.readFileSync(path.join(TMP, 'plugin.x-quoted.settings.yml'), 'utf8');
  assert.match(text, /^site: "https:\/\/acme\.example"$/m);
  assert.match(text, /^account: ""$/m);
  assert.match(text, /^motto: 'it''s mine'$/m);
  assert.match(text, /^plain: other$/m);
  assert.deepStrictEqual(yaml.load(text), { site: 'https://acme.example', account: '', motto: "it's mine", plain: 'other', escaped: 'a "b" c', token: '' });
});

// ---- the form and its save, against a real server -------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-quoted-form-'));
const config = path.join(root, 'core', 'config');
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(config, { recursive: true });
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces:\n  - dev\n');
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'plugin.x-quoted.settings.yml'), FILE);
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: path.join(root, 'plugins'), WORKSPACE_PLUGINS_NO_RESTART: '1' } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

const formHtml = async () => (await fetch(`${base}/settings/plugin.x-quoted.settings.yml`)).text();
/** The fields of the form as the browser would post them back unchanged: name → value. */
const fieldsOf = (html) => {
  const out = { file: 'plugin.x-quoted.settings.yml' };
  for (const m of html.matchAll(/<input[^>]*\bname="([kv]_\d+|secret_\d+)"[^>]*>/g)) {
    const v = (m[0].match(/\bvalue="([^"]*)"/) || [])[1];
    out[m[1]] = v === undefined ? '' : v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  return out;
};
const save = (fields) => fetch(`${base}/actions/save-settings`, { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true', Origin: base }, body: new URLSearchParams(fields).toString() }).then((r) => r.text());

test('the form shows each value without its quotes, and an empty secret written "" is not set', async () => {
  const html = await formHtml();
  assert.match(html, /value="https:\/\/CHANGE_ME\.atlassian\.net"/);
  assert.ok(!html.includes('value="&quot;https://CHANGE_ME'), 'no quotes in the field');
  assert.match(html, /value="it&#39;s here"|value="it's here"/);
  assert.match(html, /value="a &quot;b&quot; c"/);
  const token = html.slice(html.indexOf('value="token"') - 900, html.indexOf('value="token"'));
  assert.match(token, /placeholder="not set"/, 'token: "" holds nothing');
});

test('saving the form as shown changes nothing; typing at the end of a quoted value keeps it one string, quoted', async () => {
  const fields = fieldsOf(await formHtml());
  assert.match(await save(fields), /Nothing to change/);
  assert.strictEqual(fs.readFileSync(path.join(config, 'plugin.x-quoted.settings.yml'), 'utf8'), FILE, 'byte for byte');
  const siteLine = Object.keys(fields).find((k) => k.startsWith('k_') && fields[k] === 'site').slice(2);
  fields[`v_${siteLine}`] = `${fields[`v_${siteLine}`]}-r9`;
  assert.match(await save(fields), /1 key\(s\) updated: <code>site<\/code>/);
  const text = fs.readFileSync(path.join(config, 'plugin.x-quoted.settings.yml'), 'utf8');
  assert.match(text, /^site: "https:\/\/CHANGE_ME\.atlassian\.net-r9"$/m);
  assert.strictEqual(yaml.load(text).site, 'https://CHANGE_ME.atlassian.net-r9');
});
