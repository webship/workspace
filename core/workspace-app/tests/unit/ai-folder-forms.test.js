/**
 * The forms of the AI folders answer under the folders' own names.
 *
 * The folders were renamed ai-agents, ai-skills, ai-commands and ai-prompts; four routes and two lookup
 * tables kept the old names (agents, skills, prompts). The buttons on every AI folder page asked for
 * /fragments/ai-agents/add-form and the like and got "Not found": Add from GitHub, Generate with AI,
 * Clone and Propose PR. "New agent" opened with the template of a document.
 *
 * Against a real server over a temp workspace tree, like the row-menu test.
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
const { ITEM_TEMPLATES } = require('../../ai-items');

const AI = ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts'];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ai-forms-'));
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const k of AI) {
    fs.mkdirSync(path.join(root, k), { recursive: true });
    fs.writeFileSync(path.join(root, k, 'cmd-tools-ai-items.sh'), '#!/usr/bin/env bash\n');
  }
  fs.writeFileSync(path.join(root, 'ai-agents/one-agent.md'), '---\nname: one-agent\ndescription: Use this agent to be listed.\ntools:\n  - Read\n---\n\n# one-agent\n');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('every form a button of an AI folder page asks for is answered', async () => {
  const page = await text('/ai-agents');
  assert.strictEqual(page.status, 200);
  const asked = [...page.html.matchAll(/hx-get="(\/fragments\/ai-agents\/[^"?]+)/g)].map((m) => m[1]);
  for (const want of ['/fragments/ai-agents/add-form', '/fragments/ai-agents/ai-form', '/fragments/ai-agents/clone/one-agent', '/fragments/ai-agents/propose/one-agent']) {
    assert.ok(asked.includes(want), `the page has a button for ${want}`);
  }
  for (const p of [...new Set(asked)]) {
    const r = await text(p);
    assert.strictEqual(r.status, 200, `${p} answers`);
    assert.doesNotMatch(r.html, /^Not found$|undefined/, `${p} is a form`);
  }
});

test('Clone, Propose PR and Generate with AI answer for each AI folder, Add from GitHub for the three that install', async () => {
  for (const k of AI) {
    for (const p of [`/fragments/${k}/clone/some-item`, `/fragments/${k}/propose/some-item`, `/fragments/${k}/ai-form`]) {
      const r = await text(p);
      assert.strictEqual(r.status, 200, `${p} answers`);
      assert.match(r.html, new RegExp(`name="workspace" value="${k}"`), `${p} posts back for ${k}`);
    }
    const add = await text(`/fragments/${k}/add-form`);
    assert.strictEqual(add.status, k === 'ai-prompts' ? 404 : 200, `${k}: add-form (a prompt is run, not installed)`);
    if (k !== 'ai-prompts') assert.match(add.html, new RegExp(`name="workspace" value="${k}"`));
  }
  // The names the folders had before answer nothing, rather than a form for a folder that is not there.
  for (const old of ['agents', 'skills', 'prompts']) assert.strictEqual((await text(`/fragments/${old}/add-form`)).status, 404, `${old}/add-form`);
});

test('a new item opens with the template of its own kind, not the one of a document', async () => {
  assert.deepStrictEqual(AI.filter((k) => typeof ITEM_TEMPLATES[k] !== 'function'), [], 'a template per AI folder');
  for (const old of ['agents', 'skills', 'prompts']) assert.strictEqual(ITEM_TEMPLATES[old], undefined, `no template under the old name ${old}`);
  const shape = {
    'ai-agents': /^---\nname: my-agent\ndescription: Use this agent to /,
    'ai-skills': /^---\nname: my-skill\ndescription: /,
    'ai-commands': /^---\ndescription: [^\n]+\nargument-hint: '[^\n]+'\n---\n[\s\S]*\$ARGUMENTS/,
    'ai-prompts': /^<[^\n]+>\n\n```\nclaude """\n[\s\S]+\n"""\n```\n$/,
  };
  for (const k of AI) {
    const noun = k.replace(/^ai-/, '').replace(/s$/, '');
    assert.match(ITEM_TEMPLATES[k](`my-${noun}`), shape[k], `${k}: the template has the shape of its kind`);
    const form = await text(`/fragments/${k}/new`);
    assert.strictEqual(form.status, 200, `${k}: the New form answers`);
    assert.doesNotMatch(form.html, /Make PDF/, `${k}: not the template of a document`);
  }
});
