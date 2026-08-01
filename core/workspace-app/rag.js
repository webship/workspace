/**
 * A project's RAG index, the Milvus instance holding it, and the menu that reads both.
 *
 * This is the complement of `graphs.js`, not an alternative to it. A graph parses code
 * deterministically and answers "what depends on what"; it reads no Markdown, no Twig and none of
 * the Drupal wiring YAML. An index reads exactly those — the prose, the templates, the config —
 * and answers "where is this explained or configured".
 *
 * Milvus runs as its own DDEV project in `rag/<instance>/`, so the dashboard talks to it over the
 * container network rather than through the host.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const { ROOT, CONFIG_DIR } = require('./workspaces');
const { esc } = require('./html');

// The default instance, read from the workspace settings rather than assumed. Parsed by hand
// rather than with the YAML loader because this is one value out of one block and the loader is
// not otherwise needed here.
function milvusProjectName() {
  try {
    const lines = fs.readFileSync(path.join(CONFIG_DIR, 'workspace.rag.settings.yml'), 'utf8').split('\n');
    let inBlock = false;
    for (const line of lines) {
      if (/^milvus:\s*$/.test(line)) { inBlock = true; continue; }
      if (inBlock && /^\S/.test(line)) break;          // the block ended
      const m = inBlock && line.match(/^\s{2}project:\s*"?([a-zA-Z0-9_-]+)"?\s*$/);
      if (m) return m[1];
    }
  } catch (_) { /* not configured — the default below is the same one the scripts use */ }
  return 'milvus';
}

// Reached over the DDEV network by container name, not through the router: the dashboard runs in a
// container beside it, and Milvus speaks its REST API on the same port as gRPC.
function milvusRestBase(instance) {
  return `http://ddev-${instance || milvusProjectName()}-milvus-standalone:19530`;
}

// Every RAG server built in the rag workspace: a directory carrying the compose file this tooling
// writes. One shared instance is the normal case; a project can be bound to its own.
function ragInstances() {
  try {
    return fs.readdirSync(path.join(ROOT, 'rag'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'rag', e.name, '.ddev', 'docker-compose.milvus.yaml')))
      .map((e) => e.name)
      .sort();
  } catch (_) {
    return [];
  }
}

// Which instance holds which project's index. Machine-local state, like the graph store: it
// describes what is built HERE, so it lives beside the instances rather than in core/config.
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
  } catch (_) { /* nothing bound: everything uses the default instance */ }
  _bindings = map;
  _bindingsAt = now;
  return map;
}

function ragInstanceFor(wsKey, project) {
  return ragBindings().get(`${wsKey}/${project}`) || milvusProjectName();
}

// Milvus allows letters, digits and underscore in a collection name, so everything else folds.
function ragCollectionName(wsKey, project) {
  return `ws_${wsKey}_${project}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function milvusPost(pathname, body, timeoutMs, instance) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const url = new URL(milvusRestBase(instance) + pathname);
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      timeout: timeoutMs || 4000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (response) => {
      let data = '';
      response.on('data', (c) => { data += c; });
      // A database that is down and a database that answered nonsense are the same to the caller:
      // there is nothing to show either way, and a row must still render.
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve(null); } });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.end(payload);
  });
}

/**
 * What an instance currently holds, and whether it is up at all.
 *
 * Cached for five seconds AND de-duplicated while in flight: a project list re-renders on every
 * job poll, and without the second guard twenty rows would open twenty sockets to the same
 * database within a second of each other.
 */
const _cache = new Map();
const _inFlight = new Map();
function ragCollections(instance) {
  const key = instance || milvusProjectName();
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < 5000) return Promise.resolve(hit);
  if (!_inFlight.has(key)) {
    _inFlight.set(key, milvusPost('/v2/vectordb/collections/list', {}, 4000, key).then((body) => {
      const up = !!body && body.code === 0;
      const entry = { list: up && Array.isArray(body.data) ? body.data : [], up, at: Date.now() };
      _cache.set(key, entry);
      _inFlight.delete(key);
      return entry;
    }));
  }
  return _inFlight.get(key);
}

/**
 * The RAG menu for one project row.
 *
 * `state` is what ragCollections() returned for this project's instance, resolved by the caller so
 * a page of rows shares one lookup per instance.
 */
function ragMenuHtml(key, project, vals, busy, state, hubDomainFn) {
  const instance = ragInstanceFor(key, project);
  const collection = ragCollectionName(key, project);
  const up = !!state && state.up;
  const built = up && state.list.includes(collection);
  const items = [];

  if (!up) {
    // Nothing else in this menu can work without the database, and saying so once at the top is
    // better than six items that all fail the same way.
    items.push(`<li><a href="https://rag.${hubDomainFn()}"><span uk-icon="icon: play; ratio: .7"></span> Start <strong>${esc(instance)}</strong> in the RAG workspace</a></li>`);
    items.push('<li class="uk-nav-divider"></li>');
  }

  items.push(`<li><a href hx-post="/actions/ragify" ${vals()} class="${busy || !up ? 'uk-disabled' : ''}"><span uk-icon="icon: play; ratio: .7"></span> ${built ? 'Re-index the project' : 'Build the index'}${busy ? ' (running…)' : ''}</a></li>`);

  if (built) {
    items.push('<li class="uk-nav-divider"></li>');
    items.push(`<li><a href hx-get="/fragments/${esc(key)}/rag-search/${encodeURIComponent(project)}" hx-target="#editor-modal-body" hx-swap="innerHTML"><span uk-icon="icon: search; ratio: .7"></span> Search this index</a></li>`);
    items.push(`<li><a href hx-post="/actions/rag-info" ${vals()}><span uk-icon="icon: info; ratio: .7"></span> What is in it</a></li>`);
    items.push(`<li><a href="https://${esc(instance)}.rag.${hubDomainFn()}" target="_blank" title="Attu, the Milvus web UI"><span uk-icon="icon: link-external; ratio: .7"></span> Open ${esc(collection)} in Attu</a></li>`);
  }

  items.push('<li class="uk-nav-divider"></li>');
  items.push(`<li><a href hx-post="/actions/rag-mcp-command" ${vals()}><span uk-icon="icon: link; ratio: .7"></span> Connect over MCP…</a></li>`);

  if (built) {
    items.push('<li class="uk-nav-divider"></li>');
    items.push(`<li><a href class="uk-text-danger arm-step" data-armed="0" hx-post="/actions/rag-remove" ${vals(',"confirm":"yes"')} hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete the index</a></li>`);
  }

  const status = !up ? 'offline' : built ? 'indexed' : 'none';
  return `<span class="act-with-status"><div class="uk-inline act-menu">
      <button class="uk-button uk-button-${built ? 'secondary' : 'default'} uk-button-small" type="button" title="A searchable index of this project's prose, templates and config"><span uk-icon="icon: database; ratio: .7"></span> RAG <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
      <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
        <li class="uk-nav-header">${esc(instance)} · ${esc(status)}</li>
        ${items.join('')}
      </ul></div>
    </div></span>`;
}

module.exports = {
  milvusProjectName,
  milvusRestBase,
  milvusPost,
  ragInstances,
  ragBindings,
  ragInstanceFor,
  ragCollectionName,
  ragCollections,
  ragMenuHtml,
};
