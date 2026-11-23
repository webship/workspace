/**
 * What the command palette can go to: the workspaces, a few pages, and every project folder of the
 * workspaces that hold projects. One small JSON document, read by public/palette.js.
 *
 * An entry leads where the page it is drawn on can follow it (#759), the way that page's cards and rows do:
 *
 *   - **A workspace** is its subdomain on the hub (`https://dev.<hub>/`) and a path of the dashboard on a plain
 *     address (`/dev`: node on a port, Docker Compose, Kubernetes). It used to be the hub's on both, so Enter on
 *     a workspace left a dashboard at 127.0.0.1 for workspace.ddev.site.
 *   - **A DDEV project** opens its site: the hub's own address for it (`https://<folder>.<workspace>.<hub>/`) on
 *     the hub, as before. That address exists on the hub only, so on a plain address it is the site's canonical
 *     one (`https://<name>.ddev.site/`), the one its row shows.
 *   - **A project on another runtime** (Docker Compose, Podman, Kubernetes, Lando, Docksal) opens its own address
 *     on either, the one its row links to. Until that address is known (a cluster's node not read yet, no
 *     port) it opens its workspace.
 *   - **Any other folder** opens its workspace, on the address the page is on.
 *
 * What is on disk is read once and kept for ten seconds. The addresses are made for each request, so a
 * dashboard asked on two addresses answers each with its own.
 */

const fs = require('fs');
const path = require('path');
const { loadWorkspaces, hubDomain } = require('./workspaces');
const { wsUrl, absolute } = require('./urls');
const { ddevProjectName } = require('./jobs');
const projectRuntime = require('./project-runtime');

const MAX_PROJECTS = 800;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
let cache = null;
let cachedAt = 0;

const PAGES = [
  { label: 'Screens', url: '/screens', hint: 'Detached sessions' },
  { label: 'Commands', url: '/commands', hint: 'Every command the dashboard can run' },
  { label: 'Settings', url: '/settings', hint: 'core/config' },
  { label: 'Help', url: '/help', hint: 'The user guide' },
];

/**
 * What is there, with no address in it: the workspaces, and each project folder with what it runs on. A folder
 * with a `.ddev/config.yaml` is a DDEV project, as on its row; else it is on a runtime when it carries that
 * runtime's block (project-runtime.js), else a plain folder.
 */
function scan() {
  const workspaces = [];
  const projects = [];
  for (const [key, meta] of Object.entries(loadWorkspaces())) {
    workspaces.push({ key, label: meta.label || key, kind: meta.kind || 'projects' });
    if (meta.kind === 'files' || projects.length >= MAX_PROJECTS) continue;
    let entries = [];
    try { entries = fs.readdirSync(meta.dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || !NAME_RE.test(e.name) || projects.length >= MAX_PROJECTS) continue;
      const dir = path.join(meta.dir, e.name);
      const ddevName = ddevProjectName(dir);
      const onRuntime = ddevName === null ? projectRuntime.readProject(dir) : null;
      projects.push({ ws: key, name: e.name, ddevName, runtime: onRuntime && projectRuntime.isRuntimeProject(onRuntime) ? onRuntime : null });
    }
  }
  return { workspaces, projects };
}

/** The index for the address this request came in on (urls.js): the hub's addresses on the hub, this address's own elsewhere. */
function buildIndex(found = scan()) {
  const hub = hubDomain();
  const onHub = absolute();
  const workspaceUrl = (key) => (onHub ? `https://${key}.${hub}/` : wsUrl(key));
  const projects = found.projects.map(({ ws, name, ddevName, runtime }) => {
    const ddev = ddevName !== null;
    let site = '';
    if (ddev) site = onHub ? `https://${name}.${ws}.${hub}/` : `https://${ddevName}.ddev.site/`;
    else if (runtime) site = projectRuntime.urlOf(runtime);
    // `site`: the entry opens the project's own site, which is what its hint says (public/palette.js).
    return { ws, name, ddev, site: !!site, url: site || workspaceUrl(ws) };
  });
  return {
    workspaces: found.workspaces.map((w) => ({ ...w, url: workspaceUrl(w.key) })),
    pages: PAGES,
    projects,
  };
}

function paletteIndex() {
  const now = Date.now();
  if (!cache || now - cachedAt > 10000) { cache = scan(); cachedAt = now; }
  return buildIndex(cache);
}

module.exports = { paletteIndex, buildIndex, scan, PAGES };
