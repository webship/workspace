/**
 * The container runtime of a project folder (webship/workspace#694): DDEV, Docker Compose, Podman, Kubernetes or
 * Lando (#729).
 *
 * A project's runtime is what it carries, read the way core/scripts/functions/fun-runtime.sh reads it:
 * an `x-webship:` block (in `compose.yaml` for docker, podman and kubernetes, in `.lando.yml` for lando), written by
 * a builder run with `--runtime`, is the runtime that block names; else `.ddev/config.yaml` is DDEV. Anything else
 * has none here: a Landofile or a compose file of the project's own keeps its container plugin's menu.
 *
 *   readProject(dir)        { runtime, name, root, port, type, docroot, platform, namespace }: files only, no process.
 *                           `platform` is the plugin that claims the project (rt_claim), '' when none does.
 *   urlOf(project)          the site's address: https://<name>.ddev.site, http://127.0.0.1:<port>, or the
 *                           cluster node's address and the NodePort ('' until the node's address is known).
 *   statesFor(projects)     Map(root -> 'running' | 'stopped' | 'unknown'), from one `docker compose ls`, one
 *                           `podman ps`, one `kubectl get deploy` per namespace and one `docker ps` for Lando's
 *                           containers (by their labels), cached like the DDEV statuses.
 *
 * It never hangs a page: every CLI call has a timeout, an error or a missing CLI is 'unknown', and a page waits
 * only for the first answer about a project (bounded); after that it is served what was last read while a refresh
 * runs behind it.
 */

const fs = require('fs');
const path = require('path');

const { run } = require('./jobs');

/** The runtimes the layer runs besides DDEV. */
const RUNTIMES = ['docker', 'podman', 'kubernetes', 'lando'];
/** What a row's menu button says. */
const LABELS = { ddev: 'DDEV', docker: 'DOCKER', podman: 'PODMAN', kubernetes: 'K8S', lando: 'LANDO' };
/** What a sentence says. */
const TITLES = { ddev: 'DDEV', docker: 'Docker Compose', podman: 'Podman', kubernetes: 'Kubernetes', lando: 'Lando' };
/** The icon of each, the container plugins' own (no logos). */
const ICONS = { docker: 'tabler:box-multiple', podman: 'tabler:capsule', kubernetes: 'tabler:steering-wheel', lando: 'tabler:chef-hat' };
/** The runtimes whose site runs on the runtime's own images: removing it removes no image of the Workspace's. */
const BUILDS_NO_IMAGE = ['lando'];
/** The file that carries a runtime's x-webship block, in the order rt_find_project reads them. */
const META_FILES = ['compose.yaml', '.lando.yml'];
/** The runtimes whose block lives in each file. */
const RUNTIMES_OF = { 'compose.yaml': ['docker', 'podman', 'kubernetes'], '.lando.yml': ['lando'] };

const FRESH_MS = 5 * 1000;
// How long a runtime's CLI may take to answer before the state is 'unknown'. WORKSPACE_RUNTIME_TIMEOUT_MS changes
// it (a far cluster may need more; the tests ask for less).
const CLI_TIMEOUT_MS = Math.max(200, Number(process.env.WORKSPACE_RUNTIME_TIMEOUT_MS) || 8 * 1000);
/** How long a page waits for a refresh when it already has an answer to show. */
const WAIT_MS = 1500;
const NODE_FRESH_MS = 5 * 60 * 1000;

/** The Kubernetes context the layer applies to: WORKSPACE_KUBE_CONTEXT, else the kind cluster (rt_kctx). */
function kubeContext() {
  return process.env.WORKSPACE_KUBE_CONTEXT || `kind-${process.env.WORKSPACE_KIND_CLUSTER || 'webship'}`;
}

const NONE = Object.freeze({ runtime: 'none', name: '', root: '', port: '', type: '', docroot: '', platform: '', namespace: '' });

/** The values of compose.yaml's `x-webship:` block (two-space keys under it), or null when it has none. */
function webshipBlock(text) {
  const lines = String(text).split('\n');
  const at = lines.findIndex((l) => /^x-webship:\s*$/.test(l));
  if (at === -1) return null;
  const out = {};
  for (const line of lines.slice(at + 1)) {
    if (!/^\s/.test(line)) break;
    const m = line.match(/^ {2}([a-z_]+):\s*["']?([^"'\n]*?)["']?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * What a project folder is, from its files alone. The `x-webship:` block first, as rt_find_project decides: only the
 * Workspace writes it, on a build that is not DDEV's, and a project template may ship a `.ddev/` of its own.
 */
function readProject(projectDir) {
  const root = path.resolve(String(projectDir || ''));
  for (const file of META_FILES) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch (_) { continue; }
    const block = webshipBlock(text);
    if (!block || !RUNTIMES_OF[file].includes(block.runtime)) continue;
    const name = block.name || (text.match(/^name:\s*["']?([\w.-]+)/m) || [])[1] || path.basename(root);
    return { runtime: block.runtime, name, root, port: /^\d+$/.test(block.port || '') ? block.port : '',
      type: block.type || '', docroot: block.docroot || '', platform: block.platform || '', namespace: block.runtime === 'kubernetes' ? `ws-${name}` : '' };
  }
  try {
    const cfg = fs.readFileSync(path.join(root, '.ddev', 'config.yaml'), 'utf8');
    const m = cfg.match(/^name:\s*["']?([^"'\s]+)/m);
    return { ...NONE, runtime: 'ddev', root, name: m ? m[1] : path.basename(root).replace(/[^a-zA-Z0-9._-]/g, '-'),
      docroot: (cfg.match(/^docroot:\s*["']?([^"'\s]*)/m) || [])[1] || '', type: (cfg.match(/^type:\s*["']?([^"'\s]+)/m) || [])[1] || '' };
  } catch (_) { return NONE; }
}

/** Is this one of the runtimes the layer runs besides DDEV? */
const isRuntimeProject = (project) => !!project && RUNTIMES.includes(project.runtime);

/* ---------------- the cluster node's address ---------------- */

const nodes = new Map();       // context -> { ip, at }
const nodeAsking = new Map();  // context -> promise

function refreshNode(context) {
  if (nodeAsking.has(context)) return nodeAsking.get(context);
  const asking = (async () => {
    const out = await run('kubectl', ['--context', context, '--request-timeout=5s', 'get', 'nodes', '-o',
      'jsonpath={.items[0].status.addresses[?(@.type=="InternalIP")].address}'], process.env.HOME || '/', { timeoutMs: CLI_TIMEOUT_MS });
    const ip = out.ok ? String(out.stdout).trim() : '';
    // An answer that is no address (an error, a cluster that is down) keeps the one read before.
    if (/^[0-9a-fA-F.:]+$/.test(ip)) nodes.set(context, { ip, at: Date.now() });
    else if (!nodes.has(context)) nodes.set(context, { ip: '', at: Date.now() - NODE_FRESH_MS + FRESH_MS });
    return (nodes.get(context) || {}).ip || '';
  })();
  nodeAsking.set(context, asking);
  asking.finally(() => nodeAsking.delete(context));
  return asking;
}

/** The node's address as last read ('' when it never was); a stale one is refreshed behind the answer. */
function nodeIp(context = kubeContext()) {
  const hit = nodes.get(context);
  if (!hit || Date.now() - hit.at > NODE_FRESH_MS) refreshNode(context);
  return hit ? hit.ip : '';
}

/** The site's address, or '' when it cannot be said yet. */
function urlOf(project) {
  if (!project || project.runtime === 'none') return '';
  if (project.runtime === 'ddev') return `https://${project.name}.ddev.site`;
  if (!project.port) return '';
  if (project.runtime === 'kubernetes') {
    const ip = nodeIp();
    return ip ? `http://${ip.includes(':') ? `[${ip}]` : ip}:${project.port}` : '';
  }
  return `http://127.0.0.1:${project.port}`;
}

/* ---------------- states ---------------- */

const cache = new Map();   // root -> { state, at }
const known = new Map();   // root -> project
let refreshing = null;

const parseJson = (text, fallback) => { try { return JSON.parse(text); } catch (_) { return fallback; } };

/** `docker compose ls --all --format json`: [{ Name, Status: "running(3)", ConfigFiles }]. */
function composeState(rows, project) {
  const file = path.join(project.root, 'compose.yaml');
  const mine = (r) => String(r.ConfigFiles || '').split(',').map((f) => f.trim()).includes(file);
  // This folder's own compose file first; the name only when the listing names no file, and never a project of
  // the same name that lives in another folder.
  const row = rows.find(mine) || rows.find((r) => r.Name === project.name && !r.ConfigFiles);
  if (!row) return 'stopped';
  const status = String(row.Status || '');
  return /running\(/.test(status) && !/(exited|dead|created|paused|restarting)\(/.test(status) ? 'running' : 'stopped';
}

/** `podman ps -a --format json`: the containers of the compose project, by the label its provider sets. */
function podmanState(rows, project) {
  const mine = rows.filter((c) => {
    const l = (c && c.Labels) || {};
    const dir = l['com.docker.compose.project.working_dir'] || l['io.podman.compose.project.working_dir'] || '';
    const name = l['com.docker.compose.project'] || l['io.podman.compose.project'] || '';
    return dir ? dir === project.root : name === project.name;
  });
  if (!mine.length) return 'stopped';
  return mine.every((c) => String(c.State || '').toLowerCase() === 'running') ? 'running' : 'stopped';
}

/**
 * `docker ps -a --filter label=io.lando.container=TRUE --format '{{.State}}\t{{.Label "io.lando.root"}}'`: Lando labels
 * each container of an app with its folder. Running when every one of them runs.
 */
function landoState(lines, project) {
  const mine = String(lines || '').split('\n').map((l) => l.split('\t')).filter((c) => c.length >= 2 && c[1].trim() === project.root);
  if (!mine.length) return 'stopped';
  return mine.every((c) => c[0].trim().toLowerCase() === 'running') ? 'running' : 'stopped';
}

/** `kubectl -n ws-<name> get deploy -o json`: the web Deployment decides. */
function deployState(list) {
  const items = (list && Array.isArray(list.items)) ? list.items : null;
  if (!items) return 'unknown';
  const web = items.find((d) => d && d.metadata && d.metadata.name === 'web');
  if (!web) return 'stopped';
  if (!((web.spec || {}).replicas > 0)) return 'stopped';
  return ((web.status || {}).availableReplicas || 0) >= 1 ? 'running' : 'unknown';
}

async function readStates(projects) {
  const out = new Map();
  const by = (rt) => projects.filter((p) => p.runtime === rt);
  const home = process.env.HOME || '/';
  const jobs = [];
  if (by('docker').length) {
    jobs.push((async () => {
      const r = await run('docker', ['compose', 'ls', '--all', '--format', 'json'], home, { timeoutMs: CLI_TIMEOUT_MS });
      const rows = r.ok ? parseJson(r.stdout, null) : null;
      for (const p of by('docker')) out.set(p.root, Array.isArray(rows) ? composeState(rows, p) : 'unknown');
    })());
  }
  if (by('podman').length) {
    jobs.push((async () => {
      const r = await run('podman', ['ps', '-a', '--format', 'json'], home, { timeoutMs: CLI_TIMEOUT_MS });
      const rows = r.ok ? parseJson(r.stdout || '[]', null) : null;
      for (const p of by('podman')) out.set(p.root, Array.isArray(rows) ? podmanState(rows, p) : 'unknown');
    })());
  }
  if (by('lando').length) {
    jobs.push((async () => {
      const r = await run('docker', ['ps', '-a', '--filter', 'label=io.lando.container=TRUE', '--format', '{{.State}}\t{{.Label "io.lando.root"}}'],
        home, { timeoutMs: CLI_TIMEOUT_MS });
      for (const p of by('lando')) out.set(p.root, r.ok ? landoState(r.stdout, p) : 'unknown');
    })());
  }
  const context = kubeContext();
  for (const p of by('kubernetes')) {
    jobs.push((async () => {
      const r = await run('kubectl', ['--context', context, '--request-timeout=5s', '-n', p.namespace, 'get', 'deploy', '-o', 'json'],
        home, { timeoutMs: CLI_TIMEOUT_MS });
      out.set(p.root, r.ok ? deployState(parseJson(r.stdout, null)) : 'unknown');
    })());
  }
  if (by('kubernetes').length) jobs.push(refreshNode(context));
  await Promise.all(jobs);
  return out;
}

function refresh() {
  if (refreshing) return refreshing;
  // Folders that are gone, or are no longer a runtime's, are forgotten before the CLIs are asked.
  for (const [root] of known) {
    const now = readProject(root);
    if (isRuntimeProject(now)) known.set(root, now); else { known.delete(root); cache.delete(root); }
  }
  const asked = [...known.values()];
  refreshing = (async () => {
    try {
      const states = await readStates(asked);
      const at = Date.now();
      for (const p of asked) cache.set(p.root, { state: states.get(p.root) || 'unknown', at });
    } catch (_) { /* the rows keep what they had */ }
  })();
  refreshing.finally(() => { refreshing = null; });
  return refreshing;
}

const delay = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t.unref) t.unref(); });

/**
 * The state of each project: Map(root -> 'running' | 'stopped' | 'unknown'). Fresh answers are served as they
 * are; otherwise one refresh runs for every project seen so far, and the caller waits for it only when a project
 * has no answer at all (bounded by the CLI timeouts), else at most WAIT_MS before it gets what was last read.
 */
async function statesFor(projects, { waitMs = WAIT_MS } = {}) {
  const asked = (projects || []).filter(isRuntimeProject);
  for (const p of asked) known.set(p.root, p);
  const now = Date.now();
  const stale = asked.filter((p) => !cache.has(p.root) || now - cache.get(p.root).at > FRESH_MS);
  if (stale.length) {
    const first = stale.some((p) => !cache.has(p.root));
    await Promise.race([refresh(), delay(first ? CLI_TIMEOUT_MS + 1000 : waitMs)]);
  }
  return new Map(asked.map((p) => [p.root, (cache.get(p.root) || {}).state || 'unknown']));
}

/** The state of one project (statesFor, for one). */
async function stateOf(project) {
  if (!isRuntimeProject(project)) return 'unknown';
  return (await statesFor([project])).get(project.root) || 'unknown';
}

/**
 * The line a session runs for a verb on a runtime project: core/scripts/runtime-verb.sh, which loads the workspace
 * and calls `ddev <args>`, so the runtime layer does the mapping. No `$` in it: the runner hands the line to an
 * outer shell first. '' when the workspace's path could not be single-quoted safely.
 */
function verbLine(args) {
  const { ROOT } = require('./workspaces');
  const script = path.join(ROOT, 'core', 'scripts', 'runtime-verb.sh');
  if (!/^[A-Za-z0-9_./@+-]+$/.test(script)) return '';
  return `bash '${script}' ${(args || []).join(' ')}`.trim();
}

/** Forget what was read, for one folder or for all: after a start, a stop or a delete. */
function invalidate(root) {
  if (root) cache.delete(path.resolve(root)); else cache.clear();
}

module.exports = {
  RUNTIMES, LABELS, TITLES, ICONS, kubeContext, webshipBlock, readProject, isRuntimeProject, urlOf, nodeIp,
  statesFor, stateOf, invalidate, verbLine, composeState, podmanState, deployState, landoState, META_FILES, BUILDS_NO_IMAGE,
};
