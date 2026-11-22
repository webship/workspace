/**
 * Help without pandoc (webship/workspace#572): the guide is still cut into its sections, with the ids pandoc gives them,
 * so the contents list and the search work; the text stays escaped; the page says why it is plain.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { plainGuideHtml } = require('../../markdown.mts');

test('## and ### become headings with pandoc\'s ids, and each section keeps its text', () => {
  const html = plainGuideHtml('# Guide\nIntro\n\n## Getting started\nText one\n\n### The `screens` page, **at last**\nMore\n\n## Getting started\nAgain\n');
  assert.match(html, /<h2 id="getting-started">Getting started<\/h2>\n<pre class="help-plain">Text one<\/pre>/);
  assert.match(html, /<h3 id="the-screens-page-at-last">The screens page, at last<\/h3>/);
  assert.match(html, /<h2 id="getting-started-1">Getting started<\/h2>/, 'a second heading of the same name gets -1, as in pandoc');
  assert.match(html, /^<pre class="help-plain"># Guide\nIntro<\/pre>/, 'the text before the first section is kept');
});

test('everything is escaped, and a heading inside a code fence stays text', () => {
  const html = plainGuideHtml('## Safe <img src=x onerror=alert(1)>\n<script>alert(1)</script>\n```\n## not a heading\n```\n');
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.strictEqual((html.match(/<h2 /g) || []).length, 1);
  assert.match(html, /## not a heading/);
});

test('the real guide comes out as its sections, each id once', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'USER-GUIDE.md'), 'utf8');
  const ids = [...plainGuideHtml(md).matchAll(/<h[23] id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 10, `${ids.length} sections`);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the Help page uses it when pandoc is missing, and says why', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /const withImages = \(html \|\| noPandoc\(\)\)/);
  assert.match(server, /pandoc is not installed where the dashboard runs, so\s+the guide below is plain text, cut into its sections\./);
  // The guide without its first line: its title is the page's h1 (#575).
  assert.match(server, /require\('\.\/markdown\.mts'\)\.plainGuideHtml\(guideBody\)/);
});
