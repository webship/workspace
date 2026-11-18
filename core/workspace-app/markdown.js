/**
 * Markdown to HTML, for what this dashboard did not write: a CHANGELOG from one of the git checkouts,
 * the user guide, the assistant's answer.
 *
 * Through pandoc's `gfm-raw_html` and the filter `markdown-safe.lua`. `-raw_html` was meant to drop
 * embedded HTML and does not: pandoc's gfm reader keeps it as raw HTML (2.17 in the dashboard's image,
 * 3.1 on Ubuntu 24.04) and the HTML writer writes it out, so a changelog or an answer could carry
 * `<img onerror=…>` or a `javascript:` link into the dashboard's own origin. The filter turns raw HTML
 * into text, and keeps a link or an image only when it points at http(s), mailto, or a path of this
 * dashboard.
 *
 * Null when pandoc is missing or fails: every caller then shows the text, escaped.
 */

const path = require('path');
const { spawn } = require('child_process');

const FILTER = path.join(__dirname, 'markdown-safe.lua');
const PANDOC_ARGS = ['-f', 'gfm-raw_html', '-t', 'html', '--lua-filter', FILTER];

function renderMarkdown(md) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn('pandoc', PANDOC_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (_) { return resolve(null); }
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve(code === 0 ? out : null));
    child.on('error', () => resolve(null));
    child.stdin.on('error', () => { /* pandoc is gone: the close says so */ });
    child.stdin.write(String(md));
    child.stdin.end();
  });
}

module.exports = { renderMarkdown, PANDOC_ARGS, FILTER };
