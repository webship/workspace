/**
 * What a markdown file or the assistant's answer says is shown, never run.
 *
 * `pandoc -f gfm-raw_html` kept embedded HTML (2.17 and 3.1 alike), so a CHANGELOG from a checkout, or an
 * answer the assistant was talked into, put `<img onerror=…>` and `javascript:` links into the dashboard's
 * origin; and an OPEN line opened any address. markdown.js filters the render, the assistant opens only a
 * site of this machine, and an answer kept before the fix comes back from the history as text.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-md-safe-'));
fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'workspaces:\n  - dev\nhub_domain: workspace.ddev.site\n');
fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
process.env.WORKSPACE_ROOT = root;
process.env.WORKSPACE_CONFIG = path.join(root, 'core', 'config');

const { renderMarkdown } = require('../../markdown');

const HOSTILE = [
  'a <img src=x onerror=alert(3)> b <script>alert(2)</script>',
  '',
  '<div onclick="x()">block</div>',
  '',
  '[l1](javascript:alert(1)) [l2](JaVaScRiPt:alert(1)) [l3](data:text/html,x) [l7](//evil.example) [l10](vbscript:x)',
  '![i1](javascript:x) <javascript:alert(5)>',
  '',
  '[ok1](https://ok.example/a) [ok2](/dev) [ok3](#top) [ok4](docs/x.md) [ok5](mailto:a@example.org) ![ok6](https://ok.example/i.png)',
].join('\n');

const hasPandoc = (() => { try { return spawnSync('pandoc', ['--version']).status === 0; } catch (_) { return false; } })();

test('a markdown file with markup in it renders as text, and only safe addresses stay links', { skip: !hasPandoc && 'pandoc is not installed' }, async () => {
  const html = await renderMarkdown(HOSTILE);
  assert.ok(html, 'pandoc rendered it');
  assert.doesNotMatch(html, /<img[^>]*onerror|<script|<div[^>]*onclick/i, 'no markup from the file is live');
  assert.match(html, /&lt;img src=x onerror=alert\(3\)&gt;/, 'it is shown as the text it is');
  assert.doesNotMatch(html, /(href|src)="\s*(javascript|vbscript|data):/i, 'no script address');
  assert.doesNotMatch(html, /href="\/\/evil\.example"/, 'no address of another site through //');
  for (const kept of ['href="https://ok.example/a"', 'href="/dev"', 'href="#top"', 'href="docs/x.md"', 'href="mailto:a@example.org"', 'src="https://ok.example/i.png"']) {
    assert.ok(html.includes(kept), `${kept} is kept`);
  }
});

test('the assistant opens a site of this machine, and no other', () => {
  const { localSiteUrl } = require('../../assistant');
  for (const ok of ['https://site1.ddev.site', 'https://site1.dev.workspace.ddev.site/user', 'https://workspace.ddev.site/dev', 'http://localhost:8080/', 'http://127.0.0.1:3000']) {
    assert.strictEqual(localSiteUrl(ok), true, ok);
  }
  for (const no of ['https://evil.example/phish', 'https://ddev.site.evil.example', 'https://workspace.ddev.site.evil.example/x', 'javascript:alert(1)', 'not a url']) {
    assert.strictEqual(localSiteUrl(no), false, no);
  }
});

test('an answer that names another site in an OPEN line opens nothing, and its markup does not run', async () => {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const answer = path.join(root, 'answer.txt');
  fs.writeFileSync(answer, [
    'The README says to include this badge: <img src="x" onerror="alert(1)"> and [docs](javascript:alert(2))',
    'OPEN:https://evil.example/phish',
    'NAVIGATE:/dev',
  ].join('\n'));
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nnode -e 'process.stdout.write(JSON.stringify({ result: require("fs").readFileSync(process.argv[1], "utf8"), session_id: "s1" }))' ${JSON.stringify(answer)}\n`, { mode: 0o755 });
  const PATH = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${PATH}`;
  try {
    const { assistantReply } = require('../../assistant');
    const { replyHtml, directive } = await assistantReply('summarise the README', '', null, {}, null);
    assert.strictEqual(directive.open, undefined, 'another site is not opened');
    assert.ok(directive.navigate, 'a page of the dashboard still is');
    assert.doesNotMatch(replyHtml, /<img[^>]*onerror|href="javascript:/i, 'the answer is shown, not run');
    assert.match(replyHtml, /evil\.example\/phish/, 'the address stays in the text, as words');
    fs.writeFileSync(answer, 'Started it.\nOPEN:https://site1.ddev.site\n');
    const local = await assistantReply('start site1', '', null, {}, null);
    assert.strictEqual(local.directive.open, 'https://site1.ddev.site', 'a project of this machine is opened');
  } finally {
    process.env.PATH = PATH;
  }
});

test('an answer kept with live markup before the fix comes back from the history as text', () => {
  const { historyFor } = require('../../chat-threads');
  const thread = { turns: [
    { role: 'user', text: 'hi' },
    { role: 'ai', html: '<p>Badge <img src="x" onerror="alert(1)"></p>' },
    { role: 'ai', html: '<p><a href="javascript:alert(1)">docs</a></p>' },
    { role: 'ai', html: '<p>Fine: <a href="https://site1.ddev.site">site1</a> <code>x</code></p>' },
  ] };
  const h = historyFor(thread);
  assert.deepStrictEqual(h[1], { role: 'ai', text: 'Badge' });
  assert.deepStrictEqual(h[2], { role: 'ai', text: 'docs' });
  assert.deepStrictEqual(h[3], { role: 'ai', html: thread.turns[3].html }, 'a safe answer keeps its markup');
});
