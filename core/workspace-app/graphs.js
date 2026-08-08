/**
 * The knowledge graph a project can have, and the menu that builds and reads it.
 *
 * A graph is built by `cmd-tools-graphify.sh` in the project's own workspace and stored OUTSIDE
 * the project, in `graphs/<workspace>/<project>/`. That is deliberate: a graph runs to tens of
 * megabytes, its clustering is not bit-stable so every rebuild diffs in full, and many of the
 * projects worth mapping are repositories we ship — none of them should gain a graph directory
 * because somebody mapped it.
 *
 * Both halves read this file: `views.js` builds the row's menu from it and `server.js` serves what
 * the menu points at, so the menu cannot offer a file the server will not find.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');
const { esc } = require('./html');

// Where a project's graph lives. Never inside the project.
function graphStoreDir(wsKey, project) {
  return path.join(ROOT, 'graphs', wsKey, project);
}

// The three files a finished build leaves, and what each one is for.
const GRAPH_FILES = {
  html: 'graph.html',        // the picture, drawn by the clustering step
  report: 'GRAPH_REPORT.md', // key concepts and questions worth asking
  json: 'graph.json',        // what `graphify query` actually reads
};

// A row is re-rendered on every job poll — once a second while anything runs — and each render
// asks about three files per project. Memoised for two seconds so a list of twenty projects does
// not become sixty stat calls a second.
let _cache = new Map();
let _cacheAt = 0;
function hasGraph(wsKey, project, file) {
  const now = Date.now();
  if (now - _cacheAt > 2000) { _cache = new Map(); _cacheAt = now; }
  const k = `${wsKey}/${project}/${file}`;
  if (!_cache.has(k)) _cache.set(k, fs.existsSync(path.join(graphStoreDir(wsKey, project), file)));
  return _cache.get(k);
}

/**
 * The Graph menu for one project row.
 *
 * `vals` is the row's own hx-vals builder, so every action posts the workspace and project the row
 * is for. `busy` is true while a build for this project is running: graphify has no cross-process
 * lock, and two runs against one output directory race on the manifest and the graph itself.
 */
function graphMenuHtml(key, project, vals, busy) {
  const { obsidianMenuItems } = require('./obsidian');
  const built = hasGraph(key, project, GRAPH_FILES.json);
  const items = [];

  items.push(`<li><a href hx-post="/actions/graphify" ${vals()} class="${busy ? 'uk-disabled' : ''}"><span uk-icon="icon: play; ratio: .7"></span> ${built ? 'Rebuild the graph' : 'Build the graph'}${busy ? ' (running…)' : ''}</a></li>`);

  if (built) {
    items.push('<li class="uk-nav-divider"></li>');
    if (hasGraph(key, project, GRAPH_FILES.html)) {
      // Opened in a tab rather than the dialog: the viewer is an interactive canvas you pan and
      // zoom, and it wants the whole window. It also loads vis-network from a CDN, so it is the
      // one thing here that needs the internet.
      items.push(`<li><a href="/graph/${esc(key)}/${esc(project)}" target="_blank" title="Loads vis-network from unpkg.com, so it needs internet"><span uk-icon="icon: image; ratio: .7"></span> Open the graph</a></li>`);
    }
    if (hasGraph(key, project, GRAPH_FILES.report)) {
      items.push(`<li><a href hx-get="/graph/${esc(key)}/${esc(project)}/report" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: file-text; ratio: .7"></span> Read the report</a></li>`);
    }
    items.push(`<li><a href="/graph/${esc(key)}/${esc(project)}/download" title="The whole graph as a .tar.gz, to hand to another workspace"><span uk-icon="icon: download; ratio: .7"></span> Download to share</a></li>`);
    items.push(`<li><a href hx-post="/actions/graph-mcp-command" ${vals()}><span uk-icon="icon: link; ratio: .7"></span> Connect over MCP…</a></li>`);
    items.push(obsidianMenuItems(key, project, vals, busy));
    items.push('<li class="uk-nav-divider"></li>');
    items.push(`<li><a href class="uk-text-danger arm-step" data-armed="0" hx-post="/actions/graph-remove" ${vals(',"confirm":"yes"')} hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete the graph</a></li>`);
  }

  return `<div class="uk-inline act-menu">
      <button class="uk-button uk-button-${built ? 'secondary' : 'default'} uk-button-small" type="button" title="A queryable map of this project's code"><span uk-icon="icon: git-fork; ratio: .7"></span> Graph <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
      <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
        <li class="uk-nav-header">${esc(project)}${built ? '' : ' — not mapped yet'}</li>
        ${items.join('')}
      </ul></div>
    </div>`;
}

module.exports = { graphStoreDir, hasGraph, graphMenuHtml, GRAPH_FILES };
