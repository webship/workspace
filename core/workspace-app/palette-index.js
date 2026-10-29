/**
 * What the command palette can go to: the workspaces, a few pages, and every project folder of the
 * workspaces that hold projects. One small JSON document, kept for ten seconds, read by public/palette.js.
 */

const fs = require('fs');
const path = require('path');
const { loadWorkspaces, hubDomain } = require('./workspaces');

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

function buildIndex() {
  const hub = hubDomain();
  const workspaces = [];
  const projects = [];
  for (const [key, meta] of Object.entries(loadWorkspaces())) {
    workspaces.push({ key, label: meta.label || key, url: `https://${key}.${hub}/`, kind: meta.kind || 'projects' });
    if (meta.kind === 'files' || projects.length >= MAX_PROJECTS) continue;
    let entries = [];
    try { entries = fs.readdirSync(meta.dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || !NAME_RE.test(e.name) || projects.length >= MAX_PROJECTS) continue;
      const ddev = fs.existsSync(path.join(meta.dir, e.name, '.ddev', 'config.yaml'));
      projects.push({ ws: key, name: e.name, ddev, url: ddev ? `https://${e.name}.${key}.${hub}/` : `https://${key}.${hub}/` });
    }
  }
  return { workspaces, pages: PAGES, projects };
}

function paletteIndex() {
  const now = Date.now();
  if (!cache || now - cachedAt > 10000) { cache = buildIndex(); cachedAt = now; }
  return cache;
}

module.exports = { paletteIndex, buildIndex, PAGES };
