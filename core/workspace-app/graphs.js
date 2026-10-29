/**
 * Where a project's knowledge graph lives, and what is in it.
 *
 * The graph is kept in the graphs workspace rather than inside the project — it is tens of MB, it
 * re-diffs entirely on every rebuild, and half the projects worth mapping are repositories we ship.
 * Everything here reads that store; building one is `cmd-tools-graphify.sh`.
 */

const fs = require('fs');
const path = require('path');

const { ROOT } = require('./workspaces');

// Where a project's graph lives: the graphs workspace, never inside the project. graphify only
// writes <project>/graphify-out, so cmd-tools-graphify.sh moves the result here — a graph is tens
// of MB, it re-diffs entirely on every rebuild, and half the projects worth mapping are
// repositories we ship.
function graphStoreDir(wsKey, project) {
  return path.join(ROOT, 'graphs', wsKey, project);
}

// Graph lookups per project row, memoised for 2s: projectRowsHtml is
// re-rendered on every job poll.
let _graphCache = new Map();
let _graphCacheAt = 0;
function hasGraph(wsKey, project, file) {
  const now = Date.now();
  if (now - _graphCacheAt > 2000) { _graphCache = new Map(); _graphCacheAt = now; }
  const k = `${wsKey}/${project}/${file}`;
  if (!_graphCache.has(k)) _graphCache.set(k, fs.existsSync(path.join(graphStoreDir(wsKey, project), file)));
  return _graphCache.get(k);
}

// Node and edge counts, memoised on the graph file's identity so paging a long list re-reads
// nothing. Keyed on mtime+size: a rebuild changes both.
const _graphCounts = new Map();
function graphCounts(file, stat) {
  if (!stat) return { nodes: null, links: null };
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (_graphCounts.has(key)) return _graphCounts.get(key);
  let counts = { nodes: null, links: null };
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    counts = { nodes: (d.nodes || []).length, links: (d.links || d.edges || []).length };
  } catch (_) { /* unreadable or half-written */ }
  _graphCounts.set(key, counts);
  return counts;
}

// Every graph in the store, as <workspace>/<project> rows. Reads the two levels the build writes
// and nothing else, so a stray file in graphs/ cannot become a row.
function listGraphs() {
  const base = path.join(ROOT, 'graphs');
  const rows = [];
  let workspaces = [];
  try {
    workspaces = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (_) {
    return rows;
  }
  for (const ws of workspaces) {
    let projects = [];
    try {
      projects = fs.readdirSync(path.join(base, ws.name), { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch (_) { continue; }
    for (const pr of projects) {
      const dir = path.join(base, ws.name, pr.name);
      const stat = (f) => { try { return fs.statSync(path.join(dir, f)); } catch (_) { return null; } };
      const json = stat('graph.json');
      // The counts come from graph.json itself — .graphify_build.json carries only the excludes,
      // so the numbers were rendering empty. Parsing is cheap enough (20ms for a 2,430-node graph)
      // and the result is memoised on the file's mtime and size, so a re-render costs nothing.
      const nodes_links = graphCounts(path.join(dir, 'graph.json'), json);
      const nodes = nodes_links.nodes;
      const links = nodes_links.links;
      let size = 0;
      const walk = (d) => {
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else { try { size += fs.statSync(full).size; } catch (_) { /* gone */ } }
        }
      };
      walk(dir);
      rows.push({
        workspace: ws.name,
        project: pr.name,
        name: `${ws.name}/${pr.name}`,
        mtime: json ? json.mtime : new Date(0),
        size,
        nodes,
        links,
        hasHtml: !!stat('graph.html'),
        hasReport: !!stat('GRAPH_REPORT.md'),
        projectExists: fs.existsSync(path.join(ROOT, ws.name, pr.name)),
      });
    }
  }
  return rows;
}

module.exports = { graphStoreDir, hasGraph, graphCounts, listGraphs };
