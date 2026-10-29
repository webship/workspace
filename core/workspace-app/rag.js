/**
 * The RAG indexes: which Milvus server holds a project's, and how the dashboard reaches it.
 *
 * Not the published host port — this process runs inside ddev-workspace-web, where 127.0.0.1 is
 * that container. DDEV puts every project on the shared `ddev_default` network, so the answer here
 * is the Milvus container's own name.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const { ROOT, CONFIG_DIR } = require('./workspaces');

/* ---------------- RAG indexes (Milvus) ---------------- */
//
// The counterpart of the graph helpers above, and deliberately the layer graphify does not cover:
// an index holds the TEXT of a project (Markdown, Twig, *.yml, hooks) as rows in Milvus, one
// collection per project — `ws_<workspace>_<project>`, the same name cmd-tools-ragify.sh writes.
//
// The database is not a file, so unlike a graph there is nothing on disk to stat: whether a project
// has an index is a question for Milvus, asked over its REST API and memoised, because
// projectRowsHtml re-renders on every job poll.

// Which Milvus instance, from the rag workspace's own settings. Read line by line rather than with
// a YAML parser, for the same reason the settings editor does: this file is written by hand and
// keeps its comments.
function milvusProjectName() {
  try {
    const text = fs.readFileSync(path.join(CONFIG_DIR, 'workspace.rag.settings.yml'), 'utf8');
    const inMilvus = text.split('\n');
    let block = false;
    for (const line of inMilvus) {
      if (/^milvus:\s*$/.test(line)) { block = true; continue; }
      if (block && /^\S/.test(line)) break;
      const m = block && line.match(/^\s{2}project:\s*"?([a-zA-Z0-9_-]+)"?\s*$/);
      if (m) return m[1];
    }
  } catch (_) { /* not configured */ }
  return 'milvus';
}

// Where the dashboard reaches Milvus. NOT the published host port: this process runs inside
// ddev-workspace-web, where 127.0.0.1 is this container and the host's firewall drops
// container-to-host traffic anyway. DDEV puts every project on the shared `ddev_default` network,
// so the Milvus container answers on its own name — same port, gRPC and REST multiplexed.
function milvusRestBase(instance) {
  return `http://ddev-${instance || milvusProjectName()}-milvus-standalone:19530`;
}

// Every RAG server built in the rag workspace: a directory carrying the compose file this tooling
// writes. One shared instance is the normal case; a project can be bound to its own.
function ragInstances() {
  const base = path.join(ROOT, 'rag');
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { return []; }
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(base, e.name, '.ddev', 'docker-compose.milvus.yaml')))
    .map((e) => e.name)
    .sort();
}

// Which server a project's index lives in. rag/bindings.yml holds one line per BOUND project —
// `<workspace>/<project>: <instance>` — and nothing for the rest, which use the default. The file
// is machine-local state and lives in the rag workspace rather than in the project, for the same
// reason a graph does: a repository we ship must not gain a file because somebody indexed it.
let _bindings = null;
let _bindingsAt = 0;
function ragBindings() {
  const now = Date.now();
  if (_bindings && now - _bindingsAt < 2000) return _bindings;
  const map = new Map();
  try {
    const text = fs.readFileSync(path.join(ROOT, 'rag', 'bindings.yml'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([a-z0-9_-]+\/[A-Za-z0-9_.-]+):\s*([A-Za-z0-9_-]+)\s*$/);
      if (m) map.set(m[1], m[2]);
    }
  } catch (_) { /* nothing bound */ }
  _bindings = map;
  _bindingsAt = now;
  return map;
}

function ragInstanceFor(wsKey, project) {
  return ragBindings().get(`${wsKey}/${project}`) || milvusProjectName();
}

function ragWriteBinding(wsKey, project, instance) {
  const file = path.join(ROOT, 'rag', 'bindings.yml');
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n');
  } catch (_) {
    lines = ['# Which Milvus instance holds each project\'s RAG index.',
      '#',
      '# Written by cmd-tools-ragify.sh --milvus <instance> and by the dashboard\'s RAG menu. A project',
      '# that is not listed here uses milvus.project from core/config/workspace.rag.settings.yml.',
      '#',
      '# Machine-local state, like the graphs store: it describes what is built on THIS machine.', ''];
  }
  const key = `${wsKey}/${project}`;
  const kept = lines.filter((l) => !l.startsWith(`${key}:`));
  if (instance) kept.push(`${key}: ${instance}`);
  fs.writeFileSync(file, `${kept.filter((l, i, a) => !(l === '' && a[i + 1] === '')).join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  _bindingsAt = 0;
}

// Milvus identifiers allow letters, digits and underscore only — the same folding
// rag_collection_name() does in bash and collection_ok() does in the Python worker.
function ragCollectionName(wsKey, project) {
  return `ws_${wsKey}_${project}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function milvusPost(pathname, body, timeoutMs = 4000, instance = null) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const url = new URL(milvusRestBase(instance) + pathname);
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
      });
    });
    // A stopped instance must not stall a page render: every caller treats null as "no Milvus".
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.end(payload);
  });
}

// Every collection in one server, memoised for 5s and keyed by server. One request per server per
// render rather than one per project row, and a stopped Milvus costs one connection refusal, not
// one per row. Keyed, because a workspace can mix projects bound to different servers.
const _ragCache = new Map();      // instance -> { list, up, at }
const _ragInFlight = new Map();
async function ragCollections(instance) {
  const key = instance || milvusProjectName();
  const hit = _ragCache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit;
  if (!_ragInFlight.has(key)) {
    _ragInFlight.set(key, milvusPost('/v2/vectordb/collections/list', {}, 4000, key).then((body) => {
      const up = !!body && body.code === 0;
      const entry = { list: up && Array.isArray(body.data) ? body.data : [], up, at: Date.now() };
      _ragCache.set(key, entry);
      _ragInFlight.delete(key);
      return entry;
    }));
  }
  return _ragInFlight.get(key);
}

function ragInvalidate() {
  _ragCache.clear();
  _bindingsAt = 0;
}

module.exports = {
  milvusProjectName, milvusRestBase, ragInstances, ragBindings, ragInstanceFor, ragWriteBinding,
  ragCollectionName, milvusPost, ragCollections, ragInvalidate,
};
