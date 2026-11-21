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

/**
 * The guide when pandoc is missing (#572): still cut into its sections, so the Help page's contents list and its search
 * keep working. `##` and `###` become headings with the ids pandoc's gfm writer gives them (lower case, punctuation out
 * but for - and _, spaces to hyphens, a second one of a name gets -1); the text of each section stays as it is written,
 * escaped, in one plain block. Less than pandoc makes of it, never nothing and never unsafe.
 */
function plainGuideHtml(md) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (t) => t.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  const seen = new Map();
  const idOf = (title) => {
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  const out = [];
  let block = [];
  let fenced = false;
  const flush = () => {
    const text = block.join('\n').replace(/^\n+|\n+$/g, '');
    if (text) out.push(`<pre class="help-plain">${esc(text)}</pre>`);
    block = [];
  };
  for (const line of String(md || '').split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = !fenced && /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      const title = inline(h[2]);
      out.push(`<h${h[1].length} id="${esc(idOf(title))}">${esc(title)}</h${h[1].length}>`);
    } else {
      block.push(line);
    }
  }
  flush();
  return out.join('\n');
}

module.exports = { renderMarkdown, plainGuideHtml, PANDOC_ARGS, FILTER };
