/**
 * The Obsidian vault a graphed project can have, and the menu entries that make and read it.
 *
 * A vault is made FROM the graph — `cmd-tools-obsidian.sh` reads `graph.json` and writes notes,
 * wikilinks and a JSON Canvas — so it lives inside the graph store at
 * `graphs/<workspace>/<project>/obsidian/` and is thrown away with it. It also means the entries
 * belong in the Graph menu rather than a menu of their own: without a graph there is nothing to
 * convert, and a second button that is disabled most of the time only adds noise to the row.
 *
 * `views.js` builds the row's menu from this and `server.js` serves what the menu points at, so
 * the menu cannot offer a file the server will not find.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');
const { esc } = require('./html');
const { graphStoreDir } = require('./graphs');

// Where a project's vault lives. Inside its graph, never inside the project.
function vaultDir(wsKey, project) {
  return path.join(graphStoreDir(wsKey, project), 'obsidian');
}

// The index note is named after the project, with the same sanitising the builder applies, so the
// server and the builder agree on one filename.
function indexNote(project) {
  return `${String(project).replace(/[\\/:*?"<>|[\]#^]+/g, '-').replace(/^[ .-]+|[ .-]+$/g, '').slice(0, 120) || 'unnamed'}.md`;
}

// Same memo window as the graph's: a row re-renders once a second while a job runs, and asking the
// filesystem per render turns a list of twenty projects into a stream of stat calls.
let _cache = new Map();
let _cacheAt = 0;
function hasVault(wsKey, project) {
  const now = Date.now();
  if (now - _cacheAt > 2000) { _cache = new Map(); _cacheAt = now; }
  const k = `${wsKey}/${project}`;
  if (!_cache.has(k)) _cache.set(k, fs.existsSync(path.join(vaultDir(wsKey, project), '.obsidian')));
  return _cache.get(k);
}

/**
 * The Obsidian entries of the Graph menu.
 *
 * Returned as a list of `<li>` strings rather than a menu, because they hang off the Graph button:
 * `graphMenuHtml` decides where they sit and only asks for them once a graph exists.
 */
function obsidianMenuItems(key, project, vals, busy) {
  const built = hasVault(key, project);
  const items = ['<li class="uk-nav-divider"></li>', '<li class="uk-nav-header">Obsidian</li>'];

  items.push(`<li><a href hx-post="/actions/obsidian" ${vals()} class="${busy ? 'uk-disabled' : ''}"><span uk-icon="icon: file-edit; ratio: .7"></span> ${built ? 'Rebuild the vault' : 'Build the vault'}${busy ? ' (running…)' : ''}</a></li>`);

  if (built) {
    // A desktop protocol link, not an HTTP one: it hands the absolute path to the Obsidian app on
    // the machine running the browser. Every reserved character has to be encoded — an unescaped
    // slash makes Obsidian read the path as a vault name and open the wrong thing, or nothing.
    const uri = `obsidian://open?path=${encodeURIComponent(vaultDir(key, project))}`;
    items.push(`<li><a href="${esc(uri)}" title="Opens the Obsidian app on this machine"><span uk-icon="icon: link-external; ratio: .7"></span> Open in Obsidian</a></li>`);
    // The reader first: the vault lives on the machine running the dashboard, which is not
    // necessarily the machine looking at it, and this needs nothing installed.
    items.push(`<li><a href="/obsidian/${esc(key)}/${esc(project)}/view" target="_blank"><span uk-icon="icon: file-text; ratio: .7"></span> Read the notes</a></li>`);
    items.push(`<li><a href="/obsidian/${esc(key)}/${esc(project)}/canvas" target="_blank"><span uk-icon="icon: git-fork; ratio: .7"></span> Open the map</a></li>`);
    items.push(`<li><a href="/obsidian/${esc(key)}/${esc(project)}/download" title="The vault as a .tar.gz, to open on another machine"><span uk-icon="icon: download; ratio: .7"></span> Download the vault</a></li>`);
    items.push(`<li><a href class="uk-text-danger arm-step" data-armed="0" hx-post="/actions/obsidian-remove" ${vals(',"confirm":"yes"')} hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete the vault</a></li>`);
  }

  return items.join('');
}

module.exports = { vaultDir, hasVault, obsidianMenuItems, indexNote };

/* ---------------------------------------------------------------------------
 * The web reader.
 *
 * Obsidian is a desktop app, and the vault lives on the machine running the
 * dashboard — which is not necessarily the machine looking at it. So the vault is
 * also readable in the browser: the notes with their wikilinks working, and the
 * canvas drawn as the map it describes.
 *
 * Everything is served from this app. No CDN, because the graph viewer already
 * needs the internet for vis-network and having one thing in the dashboard that
 * stops working on a train is enough.
 * ------------------------------------------------------------------------- */

// The notes, by name. One pass over the vault, because every view needs the full
// set: the list, and the link resolver that decides which [[targets]] are real.
function vaultNotes(wsKey, project) {
  const dir = vaultDir(wsKey, project);
  const found = new Map();
  const walk = (d, rel) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.name === '.obsidian') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, path.join(rel, e.name));
      else if (e.name.endsWith('.md')) found.set(e.name.slice(0, -3), path.join(rel, e.name));
    }
  };
  walk(dir, '');
  return found;
}

/**
 * The note shape this workspace writes, rendered.
 *
 * Not a general markdown parser — a parser that handles every construct would be a
 * dependency and a much larger surface, and these notes are written by
 * fun-obsidian.sh, so their shape is known: frontmatter, a heading, a source line,
 * two link lists, a rule and a footer.
 *
 * Everything is escaped first and marked up second, so a note whose content happens
 * to contain markup is displayed rather than obeyed.
 */
function renderNote(md, linkHref, exists) {
  let meta = {};
  let body = md;
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = md.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }

  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[\[([^\]|#]+)(\|[^\]]+)?\]\]/g, (_, name) => {
      const n = name.trim();
      return exists(n)
        ? `<a class="wl" href="${linkHref(n)}">${esc(n)}</a>`
        : `<span class="wl wl-missing" title="No note of that name in this vault">${esc(n)}</span>`;
    });

  const out = [];
  let inList = false;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (/^-{3,}$/.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<hr>'); continue; }
    const li = line.match(/^-\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul class="links">'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (!line) continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return { meta, html: out.join('\n') };
}

// One stylesheet for both views, using the dashboard's own theme tokens so the reader
// follows whatever theme is set instead of picking its own colours.
const VAULT_CSS = `
  body { background: var(--surface); color: var(--ink); margin: 0; }
  .vault { display: grid; grid-template-columns: 16rem 1fr; gap: 0; height: calc(100vh - 3.5rem); }
  .vault-list { border-right: 1px solid var(--line); overflow-y: auto; padding: .5rem; }
  .vault-list input { width: 100%; margin-bottom: .5rem; padding: .35rem .5rem;
    border: 1px solid var(--line); border-radius: 4px; background: var(--surface);
    color: var(--ink); }
  .vault-list a { display: block; padding: .25rem .4rem; border-radius: 4px;
    color: var(--ink); text-decoration: none; font-size: .82rem; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .vault-list a:hover { background: var(--surface-sunken); }
  .vault-list a.on { background: var(--link); color: var(--danger-ink); }
  .vault-body { overflow-y: auto; padding: 1.25rem 1.75rem; }
  .vault-body h1 { font-size: 1.5rem; margin: 0 0 .75rem; }
  .vault-body h2 { font-size: 1rem; margin: 1.25rem 0 .4rem; color: var(--text-subtle); }
  .vault-body ul.links { list-style: none; padding-left: 0; }
  .vault-body ul.links li { padding: .15rem 0; }
  .wl { color: var(--link); text-decoration: none; border-bottom: 1px solid transparent; }
  .wl:hover { border-bottom-color: var(--link); }
  .wl-missing { color: var(--text-subtle); border-bottom: 1px dotted var(--text-subtle); }
  .vault-meta { font-size: .78rem; color: var(--text-subtle); margin-bottom: 1rem; }
  .vault-meta code { background: var(--surface-sunken); padding: .05rem .3rem; border-radius: 3px; }
  .vault-bar { display: flex; gap: .5rem; align-items: center; padding: .5rem .75rem;
    border-bottom: 1px solid var(--line); background: var(--surface-raised); }
  .vault-bar a, .vault-bar span { font-size: .82rem; }
  #cv { width: 100%; height: calc(100vh - 7rem); background: var(--surface); cursor: grab; }
  #cv:active { cursor: grabbing; }
  #cv text { font: 11px system-ui, sans-serif; fill: var(--ink); pointer-events: none; }
  #cv .n rect { fill: var(--surface-raised); stroke: var(--line); }
  #cv .n:hover rect { stroke: var(--link); stroke-width: 2; }
  #cv .e { stroke: var(--line); fill: none; }
`;

// A page frame that inherits the dashboard's assembled theme sheet.
function vaultPage(title, cssVersion, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/style.css?v=${esc(String(cssVersion))}">
<style>${VAULT_CSS}</style>
</head><body>${bodyHtml}</body></html>`;
}

/** The note browser: the list, and one note with its links live. */
function vaultView(wsKey, project, note, cssVersion) {
  const notes = vaultNotes(wsKey, project);
  const names = [...notes.keys()].sort((a, b) => a.localeCompare(b));
  const current = notes.has(note) ? note : (names.includes(project) ? project : names[0]);
  const base = `/obsidian/${encodeURIComponent(wsKey)}/${encodeURIComponent(project)}/view`;
  const href = (n) => `${base}?note=${encodeURIComponent(n)}`;

  let rendered = { meta: {}, html: '<p class="uk-text-meta">This vault has no notes.</p>' };
  if (current) {
    try {
      rendered = renderNote(fs.readFileSync(path.join(vaultDir(wsKey, project), notes.get(current)), 'utf8'),
        href, (n) => notes.has(n));
    } catch (_) {
      rendered = { meta: {}, html: '<p class="msg error">That note could not be read.</p>' };
    }
  }

  const meta = rendered.meta;
  const metaLine = [
    meta.source_file ? `<code>${esc(meta.source_file)}</code>` : '',
    meta.source_location ? esc(meta.source_location) : '',
    meta.cluster !== undefined ? `cluster ${esc(meta.cluster)}` : '',
    meta.tags ? esc(meta.tags) : '',
  ].filter(Boolean).join(' · ');

  return vaultPage(`${current || project} · ${project}`, cssVersion, `
    <div class="vault-bar">
      <strong>${esc(project)}</strong>
      <span class="uk-text-meta">${names.length} notes</span>
      <a href="/obsidian/${esc(wsKey)}/${esc(project)}/canvas">Map</a>
      <a href="/obsidian/${esc(wsKey)}/${esc(project)}/download">Download</a>
      <a href="obsidian://open?path=${encodeURIComponent(vaultDir(wsKey, project))}">Open in the Obsidian app</a>
      <span style="margin-left:auto"><a href="/">${esc(wsKey)} workspace</a></span>
    </div>
    <div class="vault">
      <nav class="vault-list">
        <input id="q" type="search" placeholder="Filter ${names.length} notes…" autocomplete="off">
        <div id="ls">
          ${names.map((n) => `<a href="${href(n)}" class="${n === current ? 'on' : ''}" data-n="${esc(n.toLowerCase())}">${esc(n)}</a>`).join('')}
        </div>
      </nav>
      <article class="vault-body">
        ${metaLine ? `<div class="vault-meta">${metaLine}</div>` : ''}
        ${rendered.html}
      </article>
    </div>
    <script>
      // Filtering is the one thing worth scripting here: every link is a real URL, so
      // the reader works with scripting off apart from this.
      var q = document.getElementById('q'), ls = document.getElementById('ls');
      q.addEventListener('input', function () {
        var v = q.value.toLowerCase();
        for (var i = 0; i < ls.children.length; i++) {
          var a = ls.children[i];
          a.style.display = a.dataset.n.indexOf(v) === -1 ? 'none' : '';
        }
      });
    </script>`);
}

/**
 * The canvas, drawn.
 *
 * The .canvas file already carries a position for every node — the builder laid them
 * out cluster by cluster — so this is a straight projection into SVG rather than a
 * layout algorithm. That also means the web map and the map Obsidian's Canvas shows
 * are the same picture, which is the point of storing coordinates at all.
 */
function vaultCanvas(wsKey, project, cssVersion) {
  const file = path.join(vaultDir(wsKey, project), `${indexNote(project).slice(0, -3)}.canvas`);
  let canvas;
  try {
    canvas = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return vaultPage(`${project} map`, cssVersion,
      '<div class="vault-bar"><span class="msg error">This vault has no canvas. Rebuild it.</span></div>');
  }

  const nodes = canvas.nodes || [];
  const edges = canvas.edges || [];
  const at = new Map(nodes.map((n) => [n.id, n]));
  const pad = 60;
  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs, 0) - pad; const minY = Math.min(...ys, 0) - pad;
  const w = Math.max(...xs.map((x, i) => x + nodes[i].width), 100) - minX + pad;
  const h = Math.max(...ys.map((y, i) => y + nodes[i].height), 100) - minY + pad;

  // The colour a node carries is a JSON Canvas preset number, not a CSS colour.
  const PRESET = { 1: '#e05252', 2: '#e08c52', 3: '#d9c04a', 4: '#4fa373', 5: '#4f9fa3', 6: '#8b6fc4' };

  const view = `/obsidian/${encodeURIComponent(wsKey)}/${encodeURIComponent(project)}/view`;
  const noteOf = (n) => (n.file || '').replace(/^notes\//, '').replace(/\.md$/, '');

  const edgeSvg = edges.map((e) => {
    const a = at.get(e.fromNode); const b = at.get(e.toNode);
    if (!a || !b) return '';
    const x1 = a.x + a.width; const y1 = a.y + a.height / 2;
    const x2 = b.x; const y2 = b.y + b.height / 2;
    const mid = (x1 + x2) / 2;
    return `<path class="e" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/>`;
  }).join('');

  const nodeSvg = nodes.map((n) => {
    const name = noteOf(n);
    const label = name.length > 30 ? `${name.slice(0, 29)}…` : name;
    const stroke = PRESET[n.color] || '';
    return `<a class="n" href="${view}?note=${encodeURIComponent(name)}"><title>${esc(name)}</title>
      <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="6"${stroke ? ` style="stroke:${stroke}"` : ''}/>
      <text x="${n.x + 12}" y="${n.y + n.height / 2 + 4}">${esc(label)}</text></a>`;
  }).join('');

  return vaultPage(`${project} map`, cssVersion, `
    <div class="vault-bar">
      <strong>${esc(project)}</strong>
      <span class="uk-text-meta">${nodes.length} on the map · ${edges.length} links</span>
      <a href="${view}">Notes</a>
      <a href="obsidian://open?path=${encodeURIComponent(vaultDir(wsKey, project))}">Open in the Obsidian app</a>
      <span class="uk-text-meta" style="margin-left:auto">drag to pan · scroll to zoom · click a node to read it</span>
    </div>
    <svg id="cv" viewBox="${minX} ${minY} ${w} ${h}">
      <g id="vp">${edgeSvg}${nodeSvg}</g>
    </svg>
    <script>
      // Pan and zoom by moving the viewBox, so the drawing stays vector-sharp and the
      // links keep working — a CSS transform would break hit testing on the anchors.
      (function () {
        var svg = document.getElementById('cv');
        var vb = { x: ${minX}, y: ${minY}, w: ${w}, h: ${h} };
        function apply() { svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h); }
        var drag = null, moved = false;
        svg.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY }; moved = false; });
        window.addEventListener('pointerup', function () { drag = null; });
        window.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var k = vb.w / svg.clientWidth;
          vb.x -= (e.clientX - drag.x) * k; vb.y -= (e.clientY - drag.y) * k;
          drag = { x: e.clientX, y: e.clientY };
          if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) moved = true;
          apply();
        });
        // A drag that ends over a node must not also open it.
        svg.addEventListener('click', function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);
        svg.addEventListener('wheel', function (e) {
          e.preventDefault();
          var f = e.deltaY > 0 ? 1.12 : 0.89;
          var r = svg.getBoundingClientRect();
          var mx = vb.x + (e.clientX - r.left) / r.width * vb.w;
          var my = vb.y + (e.clientY - r.top) / r.height * vb.h;
          vb.x = mx - (mx - vb.x) * f; vb.y = my - (my - vb.y) * f;
          vb.w *= f; vb.h *= f;
          apply();
        }, { passive: false });
      })();
    </script>`);
}

module.exports.vaultNotes = vaultNotes;
module.exports.renderNote = renderNote;
module.exports.vaultView = vaultView;
module.exports.vaultCanvas = vaultCanvas;
