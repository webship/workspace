/**
 * Every page and fragment the dashboard renders.
 *
 * Split out of server.js: building HTML is one job and it does not route anything. server.js asks
 * for a page, this decides what it looks like. Nothing here imports server.js, so the dependency
 * runs one way.
 */

const fs = require('fs');
const path = require('path');

const {
  ROOT,
  hubDomain,
  loadWorkspaces,
  isValidWorkspace,
  workspaceDir,
  listProjects,
  listBackups,
  ddevProjectName,
  findBackupScript,
  findSyncScript,
  findRemoveScript,
  findBuilderScripts,
  builderLabel,
  CONFIG_DIR,
  loadYaml,
  styleSettings,
} = require('./workspaces');
const { esc } = require('./html');
const { iconHtml } = require('./icons');
const { run, jobFragment } = require('./jobs');
const { assistantHtml } = require('./assistant');
const { SETTINGS_FILE_RE, settingsFormHtml, listSettingsFiles, listEditorHtml } = require('./settings');
const { DDEV_ACTIONS, DDEV_MENU_ORDER } = require('./ddev');
const {
  defaultListState,
  searchSortPage,
  listControlsHtml,
  statusFilterHtml,
  listPagerHtml,
  emptyListHtml,
} = require('./lists');

const PUBLIC_DIR = path.join(__dirname, 'public');

const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SCRIPT_RE = /^cmd-[a-zA-Z0-9_.-]+\.sh$/;
const HOME_URL = () => `https://${hubDomain()}`;
const wsUrl = (key, sub = '') => `https://${key}.${hubDomain()}${sub}`;

// Where each editable kind installs into the live Claude Code CLI setup.
const INSTALL_TARGETS = {
  agents: path.join(process.env.HOME, '.claude', 'agents'),
  skills: path.join(process.env.HOME, '.claude', 'skills'),
  prompts: path.join(process.env.HOME, '.claude', 'commands'),
};
// What counts as a video, in one place: the listing, the row icon and the play modal.
const VIDEO_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;

const ITEM_TEMPLATES = {
  agents: (name) => `---
name: ${name}
description: Use this agent to <when to invoke it>.
tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# ${name}

You are the specialist agent for <what this agent does>.

## Instructions

- <how to work>
`,
  skills: (name) => `---
name: ${name}
description: <what this skill does and when to use it>
---

# ${name}

## Instructions

- <steps the skill follows>
`,
  prompts: (name) => `<Write the reusable prompt here — installing it makes it available in Claude Code as /${name}>
`,
  docs: (name) => `# ${name}

<Write the document here — Markdown; use "Make PDF" to render a PDF next to it.>
`,
};
// The file that holds an item's content, given its display name.
function itemFile(key, name) {
  const dir = workspaceDir(key);
  if (key === 'skills') return path.join(dir, name, 'SKILL.md');
  return path.join(dir, `${name}.md`);
}
// Items in a file-kind workspace: .md files (and for skills, folders with a
// SKILL.md); docs also lists generated .pdf/.html outputs as artifacts.
function listItems(key) {
  const dir = workspaceDir(key);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const items = [];
  // A skill is a folder and the rest are files, so the timestamp comes from whichever one the item
  // actually is. It is what "newest first" sorts on, and it is why editing a doc moves it to the
  // top of its list rather than leaving it wherever the alphabet put it.
  const stamp = (...parts) => {
    try { return fs.statSync(path.join(dir, ...parts)).mtimeMs; } catch (_) { return 0; }
  };
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (key === 'skills' && e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) {
      items.push({ name: e.name, editable: true, mtime: stamp(e.name, 'SKILL.md') });
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      items.push({ name: e.name.replace(/\.md$/, ''), editable: true, mtime: stamp(e.name) });
    } else if (key === 'docs' && e.isFile() && /\.(pdf|html|png)$/.test(e.name)) {
      items.push({ name: e.name, editable: false, artifact: true, mtime: stamp(e.name) });
    } else if (key === 'videos' && e.isFile() && VIDEO_RE.test(e.name)) {
      items.push({ name: e.name, editable: false, artifact: true, video: true, mtime: stamp(e.name) });
    } else if (key === 'videos' && e.isFile() && /\.(jpg|jpeg|png)$/i.test(e.name)) {
      items.push({ name: e.name, editable: false, artifact: true, mtime: stamp(e.name) });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
// Mirrors testing_stack() in core/scripts/functions/fun-testing.sh — the same two markers, so the
// dashboard and the script agree about what a project has.
function testingStackOf(dir, project) {
  const root = path.join(dir, project);
  if (fs.existsSync(path.join(root, '.ddev', 'commands', 'web', 'init-full-automated-testing'))) return 'in-project';
  if (fs.existsSync(path.join(root, 'cucumber.js')) || fs.existsSync(path.join(root, 'tests', 'step-definitions'))) return 'webship-js';
  return 'none';
}
// A crashed run leaves 0-byte recordings and screenshots, and webship-js writes a DOM dump for
// every failed step even when the page never rendered — an empty document. A link to a blank
// page is worse than no link, so those are dropped rather than listed.
//
// Judged exactly rather than by a size threshold: a real captured dump can be a few hundred
// bytes of JSON, so a "too small to matter" cutoff would discard real evidence. Only files small
// enough to be empty are opened, so this costs nothing on the ones that matter.
function testArtifactIsEmpty(full, name, size) {
  if (size === 0) return true;
  if (!/\.html?$/i.test(name) || size > 400) return false;
  try {
    return /<body[^>]*>\s*<\/body>/i.test(fs.readFileSync(full, 'utf8'));
  } catch (_) {
    return false;
  }
}
// The runs a project has, newest first. A run is a tests/reports/ holding a cucumber report;
// its evidence sits beside it in tests/screenshots/ and tests/videos/.
function projectTestRuns(dir, project) {
  const root = path.join(dir, project);
  const reportsDir = path.join(root, 'tests', 'reports');
  const html = path.join(reportsDir, 'cucumber_report.html');
  const json = path.join(reportsDir, 'cucumber_report.json');
  if (!fs.existsSync(html) && !fs.existsSync(json)) return [];

  const sideFiles = (name, re) => {
    try {
      const base = path.join(root, 'tests', name);
      return fs.readdirSync(base)
        .filter((f) => re.test(f))
        .map((f) => {
          const full = path.join(base, f);
          let size = 0, mtimeMs = 0;
          try { const st = fs.statSync(full); size = st.size; mtimeMs = st.mtimeMs; } catch (_) { /* vanished */ }
          return { rel: path.relative(root, full), name: f, size, mtimeMs, full };
        })
        .filter((f) => !testArtifactIsEmpty(f.full, f.name, f.size))
        .map(({ full, ...rest }) => rest)
        .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
    } catch (_) { return []; }
  };

  const stamp = fs.statSync(fs.existsSync(json) ? json : html).mtime;
  return [{
    when: stamp,
    html: fs.existsSync(html) ? path.relative(root, html) : null,
    json: fs.existsSync(json) ? path.relative(root, json) : null,
    shots: sideFiles('screenshots', /\.(png|jpe?g)$/i),
    doms: sideFiles('screenshots', /\.html?$/i),
    videos: sideFiles('videos', VIDEO_RE),
  }];
}
function testRunHtml(key, project) {
  const runs = projectTestRuns(workspaceDir(key), project);
  if (!runs.length) {
    return `<div class="msg assistant">No test run in <strong>${esc(project)}</strong> yet — run the suite first.</div>`;
  }
  const run = runs[0];
  const link = (f, label) => `<a href="/project-files/${esc(key)}/${esc(project)}/${f.rel.split(path.sep).map(encodeURIComponent).join('/')}" target="_blank">${esc(label || f.name)}</a>`;
  const group = (title, files, icon) => (files.length ? `
    <p class="uk-margin-small-bottom"><span uk-icon="icon: ${icon}; ratio: .8"></span> <strong>${title}</strong> <span class="uk-badge">${files.length}</span></p>
    <ul class="uk-list uk-list-divider uk-margin-small">${files.map((f) => `<li>${link(f)}</li>`).join('')}</ul>` : '');

  return `
    <div class="msg assistant">
      <p><span uk-icon="icon: check; ratio: .8"></span> <strong>${esc(project)}</strong> — last run ${esc(run.when.toISOString().replace('T', ' ').slice(0, 16))}</p>
      ${run.html ? `<p>Report: ${link({ rel: run.html, name: 'cucumber_report.html' }, 'open the HTML report')}</p>` : ''}
      ${group('Screenshots', run.shots, 'image')}
      ${group('DOM dumps', run.doms, 'code')}
      ${group('Recordings', run.videos, 'play-circle')}
      ${!run.shots.length && !run.doms.length && !run.videos.length
        ? '<p class="uk-text-meta">No screenshots or recordings — nothing failed, or the run was configured not to keep them.</p>' : ''}
    </div>`;
}
function itemRowsHtml(key, state = defaultListState()) {
  const meta = loadWorkspaces()[key];
  const all = listItems(key);
  const url = `/fragments/${key}/items`;
  // The same container the projects list uses on the other kind of workspace page — one id, so the
  // `refresh-projects` event reloads whichever list this workspace has.
  const target = '#webship-workspace-projects';
  const page = searchSortPage(all, state);
  // A prompt is a copy-paste invocation, not something a CLI loads from a directory: installing it
  // into ~/.claude/commands made it a slash command whose placeholders nobody had filled in. It is
  // run — handed to the assistant — or cloned and adapted instead.
  const installable = !!INSTALL_TARGETS[key] && key !== 'prompts';
  const runnable = key === 'prompts';
  const rows = page.slice.map((it) => {
    const vals = `hx-vals='{"workspace":"${esc(key)}","name":"${esc(it.name)}"}'`;
    if (it.artifact) {
      return `
      <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
        <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
          <span class="uk-text-bold"><span uk-icon="icon: ${it.video ? 'play-circle' : /\.(png|jpe?g)$/i.test(it.name) ? 'image' : it.name.endsWith('.html') ? 'world' : 'file-pdf'}; ratio: .8"></span> ${esc(it.name)}</span>
          <div class="project-actions">
            ${it.video ? `<button class="uk-button uk-button-primary uk-button-small" hx-get="/fragments/${esc(key)}/play/${encodeURIComponent(it.name)}" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: play; ratio: .7"></span> Play</button>` : ''}
            <a class="uk-button uk-button-${it.video ? 'default' : 'primary'} uk-button-small" href="/files/${esc(key)}/${esc(it.name)}" target="_blank"><span uk-icon="icon: download; ratio: .7"></span> Open</a>
            <button class="uk-button uk-button-danger uk-button-small arm-step" data-armed="0" hx-post="/actions/delete-item" hx-vals='{"workspace":"${esc(key)}","name":"${esc(it.name)}","confirm":"yes"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete</button>
          </div>
        </div>
      </div>`;
    }
    return `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
        <span class="uk-text-bold"><span uk-icon="icon: file-edit; ratio: .8"></span> ${esc(it.name)}</span>
        <div class="project-actions">
          <button class="uk-button uk-button-default uk-button-small" hx-get="/fragments/${esc(key)}/edit/${encodeURIComponent(it.name)}" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: pencil; ratio: .7"></span> Edit</button>
          ${installable ? `<button class="uk-button uk-button-primary uk-button-small" hx-post="/actions/install-item" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: push; ratio: .7"></span> Install</button>` : ''}
          ${runnable ? `<button class="uk-button uk-button-primary uk-button-small run-prompt" data-workspace="${esc(key)}" data-name="${esc(it.name)}" title="Put it in the assistant, ready to fill in and send"><span uk-icon="icon: play; ratio: .7"></span> Run</button>` : ''}
          ${it.editable ? `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/clone-item" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML" title="Copy it to a new name to adapt"><span uk-icon="icon: copy; ratio: .7"></span> Clone</button>` : ''}
          ${key === 'docs' ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/make-pdf" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: file-pdf; ratio: .7"></span> PDF</button><button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/make-html" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: world; ratio: .7"></span> HTML</button>` : ''}
          <button class="uk-button uk-button-danger uk-button-small arm-step" data-armed="0" hx-post="/actions/delete-item" hx-vals='{"workspace":"${esc(key)}","name":"${esc(it.name)}","confirm":"yes"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');

  const heading = meta.nounPlural.charAt(0).toUpperCase() + meta.nounPlural.slice(1);
  // The badge counts what the whole workspace holds, not what this page shows — the pager already
  // says which slice of it you are looking at, and a heading that changed as you paged would be
  // reporting the pager back to you.
  const pager = listPagerHtml(url, target, page, state, meta.nounPlural);
  return `
    <h3 class="uk-margin-small-bottom">${esc(heading)} <span class="uk-badge">${all.length}</span></h3>
    ${all.length ? listControlsHtml(url, target, state, meta.nounPlural) : ''}
    ${pager}
    ${rows || emptyListHtml(state, meta.nounPlural, `No ${esc(meta.nounPlural)} yet — create one below.`)}
    ${page.pages > 1 ? pager : ''}`;
}
function editorFormHtml(key, name, content, isNew) {
  const meta = loadWorkspaces()[key];
  return `
    <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
      <h3 class="uk-margin-small-bottom">${isNew ? `New ${esc(meta.noun)}` : `Edit ${esc(name)}`}</h3>
      <form hx-post="/actions/save-item" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(key)}">
        <input class="uk-input uk-margin-small-bottom" name="name" value="${esc(name)}" placeholder="${esc(meta.noun)}-name" required pattern="[a-zA-Z0-9_\\-]+" ${isNew ? '' : 'readonly'}>
        <textarea class="uk-textarea editor-area" name="content" rows="16" spellcheck="false"
                  data-ace="markdown" aria-label="${isNew ? `New ${esc(meta.noun)} content` : `Content of ${esc(name)}`}">${esc(content)}</textarea>
        <div class="uk-margin-small-top">
          <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save</button>
        </div>
      </form>
    </div>`;
}
// Only the workspace's own configuration is editable here — never an arbitrary path.
function settingsPage(section) {
  const files = listSettingsFiles();
  const current = files.includes(section) ? section : files[0];
  const tabs = files.map((f) => `
    <a class="uk-button uk-button-${f === current ? 'primary' : 'default'} uk-button-small"
       href="/settings/${encodeURIComponent(f)}">${esc(f.replace(/^workspace\.|\.settings\.yml$/g, '') || f)}</a>`).join(' ');
  return pageShell('Settings · workspace', `
<main class="uk-container uk-container-small page-body webship-workspace-page">
  <div class="uk-flex uk-flex-middle page-heading">
    <span class="page-heading-icon"><span uk-icon="icon: cog; ratio: 1.1"></span></span>
    <div>
      <h1 class="uk-margin-remove">Settings</h1>
      <span class="uk-text-meta">${esc(CONFIG_DIR)}</span>
    </div>
  </div>
  <div class="uk-card uk-card-default uk-card-body">
    <p>${tabs || '<span class="uk-text-meta">No settings files found.</span>'}</p>
    ${current ? settingsFormHtml(current) : ''}
    <div id="settings-output"></div>
  </div>
</main>`, [{ label: 'Workspaces', href: HOME_URL() }, { label: 'Settings' }], 'settings');
}
// Present on every page: the actions this page has, then a way to every other. A rail that
// appears and disappears makes the layout jump between pages and gives the eye no fixed place to
// look for "what can I do here", so it is always there — and a page with no actions of its own
// still gets the navigation, which is the part you want from anywhere.
function pageActionsHtml(context) {
  const m = String(context).match(/^(workspace|backups):([a-z0-9_-]+)$/);
  const view = m && isValidWorkspace(m[2]) ? m[1] : null;
  const key = view ? m[2] : null;
  const meta = key ? loadWorkspaces()[key] : null;
  const out = 'hx-target="#webship-workspace-output" hx-swap="innerHTML"';
  const groups = [];

  const btn = (style, icon, label, attrs, title) =>
    `<button class="uk-button uk-button-${style} action-btn" ${attrs} title="${esc(title || label)}">`
    + `<span uk-icon="icon: ${icon}; ratio: .8"></span><span class="action-label">${esc(label)}</span></button>`;
  const link = (style, icon, label, href, title) =>
    `<a class="uk-button uk-button-${style} action-btn" href="${href}" title="${esc(title || label)}">`
    + `<span uk-icon="icon: ${icon}; ratio: .8"></span><span class="action-label">${esc(label)}</span></a>`;

  if (view === 'backups' && meta) {
    groups.push({ label: 'Go to', items: [link('default', 'arrow-left', `Back to ${meta.label}`, wsUrl(key))] });
  } else if (meta && meta.kind === 'files') {
    const create = [btn('primary', 'plus', `New ${meta.noun}`, `hx-get="/fragments/${esc(key)}/new" ${out}`)];
    if (INSTALL_TARGETS[key]) {
      create.push(btn('secondary', 'bolt', 'Generate with AI', `hx-get="/fragments/${esc(key)}/ai-form" ${out}`,
                      `Describe it and Claude Code writes the ${meta.noun}`));
    }
    if (key === 'docs') {
      create.push(btn('secondary', 'bolt', 'Generate site doc', `hx-get="/fragments/docs/site-doc-form" ${out}`));
      create.push(btn('secondary', 'image', 'Screenshot a site', `hx-get="/fragments/docs/screenshot-form" ${out}`));
    }
    groups.push({ label: 'Create', items: create });

    if (findSyncScript(meta.dir)) {
      const sync = (source, icon, label, title) =>
        btn('default', icon, label,
            `hx-post="/actions/sync-items" hx-vals='{"workspace":"${esc(key)}","source":"${source}"}' ${out}`, title);
      groups.push({ label: 'Sync', items: [
        sync('repo', 'cloud-download', 'From ai-agents', `Copy the shared ${meta.nounPlural} into this folder`),
        sync('claude', 'home', 'From ~/.claude', `Copy this machine's webship ${meta.nounPlural} into this folder`),
      ] });
    }
  }

  const backups = key ? listBackups(key).length : 0;
  if (view === 'workspace' && backups) {
    groups.push({ label: 'Archives', items: [
      link('default', 'album', `Backups (${backups})`, wsUrl(key, '/backups')),
    ] });
  }

  // One way back, and no more. A full workspace list here duplicated the home page's cards in a
  // worse form — twenty links to scroll past above the actions that actually belong to this page.
  // The cards are the place to choose a workspace.
  const navLink = (href, icon, label, current, title) =>
    `<a class="uk-button uk-button-default action-btn${current ? ' is-current' : ''}" href="${href}"`
    + `${current ? ' aria-current="page"' : ''} title="${esc(title || label)}">`
    + `<span uk-icon="icon: ${icon}; ratio: .8"></span><span class="action-label">${esc(label)}</span></a>`;

  groups.push({ label: 'Go', className: 'actions-nav', items: [
    navLink(HOME_URL(), 'home', 'All workspaces', !view && context !== 'settings'),
    navLink('/settings', 'cog', 'Settings', context === 'settings', 'Settings — core/config/*.yml'),
  ] });

  return `
<aside class="actions-side" id="actions-rail" aria-label="Page actions and workspace navigation">
  <button type="button" class="actions-toggle" aria-expanded="false" aria-controls="actions-rail-inner"
          title="Expand the actions rail">
    <span class="actions-toggle-icon" uk-icon="icon: chevron-right; ratio: .9"></span>
    <span class="action-label">Actions</span>
  </button>
  <div class="actions-rail-inner" id="actions-rail-inner">
    ${groups.map((g) => `
    <div class="actions-group${g.className ? ` ${g.className}` : ''}">
      <span class="actions-group-label">${esc(g.label)}</span>
      ${g.items.join('')}
    </div>`).join('')}
  </div>
</aside>`;
}
function pageShell(title, body, crumbs = [], context = 'home') {
  const style = styleSettings();
  const crumbHtml = crumbs.length ? `
    <ul class="uk-breadcrumb uk-margin-remove uk-visible@s">
      ${crumbs.map((c, i) => i === crumbs.length - 1
        ? `<li><span>${esc(c.label)}</span></li>`
        : `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`).join('')}
    </ul>` : '';
  return `<!doctype html>
<html lang="en"${style.editorTheme === 'auto' ? '' : ` data-editor-theme="${style.editorTheme}"`}>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/${esc(style.favicon)}">
<script>(function(){var d=document.documentElement;
// The configured default, applied before first paint so a dark page never flashes white. A stored
// choice always wins: style.mode is the default for someone who has not used the toggle, not an
// override of someone who has. 'system' follows the operating system.
try{var st=localStorage.getItem('ws-theme'),m='${style.mode}';
var dark = st ? st==='dark' : (m==='dark' || (m==='system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches));
if(dark)d.classList.add('dark');}catch(e){}})();</script>
<link rel="stylesheet" href="/vendor/uikit.min.css">
<link rel="stylesheet" href="/style.css">
<script src="/vendor/uikit.min.js"></script>
<script src="/vendor/uikit-icons.min.js"></script>
<script src="/htmx.min.js"></script>
<script type="module" src="/vendor/deep-chat.bundle.js"></script>
<script src="/ui.js" defer></script>
</head>
<body class="uk-background-muted">
<div class="global-working" aria-hidden="true">
  <div class="global-working-bar"></div>
  <div class="global-working-pill"><div uk-spinner="ratio: .5"></div> Working…</div>
</div>
<nav class="uk-navbar-container toolbar">
  <div class="toolbar-inner">
    <div uk-navbar>
      <div class="uk-navbar-left">
        <a class="uk-navbar-item uk-logo toolbar-logo" href="${HOME_URL()}">
          <img src="/${esc(style.logo)}" alt="${esc(style.workspaceName)}" width="46" height="46" class="brand-logo brand-logo-on-light">
          <img src="/${esc(style.logoOnDark)}" alt="${esc(style.workspaceName)}" width="46" height="46" class="brand-logo brand-logo-on-dark">
          <span>${esc(style.workspaceName)}</span>
        </a>
        ${crumbHtml}
      </div>
      <div class="uk-navbar-right">
        <a class="uk-navbar-item" href="/settings" title="Settings — core/config/*.yml"><span uk-icon="icon: cog"></span></a>
        <button class="uk-navbar-item theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">
          <svg class="theme-icon-moon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
          <svg class="theme-icon-sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
      </div>
    </div>
  </div>
</nav>
<aside class="assistant-side">
  ${assistantHtml({ context })}
</aside>
${pageActionsHtml(context)}
<!-- Short results — saved, deleted, refused — surface here instead of wherever the form happened to
     be. On the settings page that was below sixty fields and off the screen, so a save looked like
     it had done nothing. Top and centre, because it is the answer to what you just did. -->
<div id="flash-toasts" class="flash-toasts" aria-live="polite" role="status"></div>
<!-- Jobs live here rather than in the page that started them: a build outlives the click, and the
     stack asks for whatever is still running so a reload or a navigation does not lose it. -->
<div id="job-toasts" class="job-toasts" aria-live="polite"
     hx-get="/fragments/jobs/running" hx-trigger="load" hx-swap="innerHTML"></div>
<div class="app-content">
${body}
<footer class="uk-section uk-section-xsmall uk-text-center uk-text-meta">
  webship/workspace · DDEV-only tooling · <a href="/">workspace.ddev.site</a>
</footer>
</div>
</body>
</html>`;
}
function workspaceCardsHtml(message) {
  return homePage(message, true);
}

function homePage(message, gridOnly) {
  const workspaces = loadWorkspaces();
  const cards = Object.values(workspaces).map((w) => {
    const projectCount = w.kind === 'files' ? listItems(w.key).length : listProjects(w.dir).length;
    const hasBuilders = w.kind === 'files' ? false : findBuilderScripts(w.dir).length > 0;
    const backupCount = listBackups(w.key).length;
    return `
      <div class="ws-card-wrap" data-ws="${esc(w.key)}">
        <div class="uk-position-relative ws-card-inner">
        <span class="ws-card-handle" title="Drag to reorder the workspaces — the order is saved in settings.yml"><span uk-icon="icon: table; ratio: .7"></span></span>
        <a class="uk-card uk-card-default uk-card-hover uk-card-body uk-card-small uk-text-center uk-display-block uk-link-reset workspace-card" href="${wsUrl(w.key)}">
          <div class="icon uk-text-primary">${iconHtml(w.icon, 1.4)}</div>
          <h4 class="uk-card-title uk-margin-remove uk-text-bold">${esc(w.label)}</h4>
          <p class="uk-text-meta uk-margin-remove">${esc(w.subtitle)}</p>
          <span class="uk-label ${hasBuilders ? 'uk-label-success' : ''} uk-margin-small-top">${projectCount} ${projectCount === 1 ? w.noun : w.nounPlural}${hasBuilders ? ' · buildable' : ''}</span>
        </a>
        ${backupCount ? `<a class="ws-backups" href="${wsUrl(w.key, '/backups')}" title="View the ${backupCount} backup${backupCount === 1 ? '' : 's'} for ${esc(w.label)}"><span uk-icon="icon: album; ratio: .65"></span> ${backupCount}</a>` : ''}
        </div>
      </div>`;
  }).join('');

  const grid = `<div id="workspace-cards-wrap">
      <div id="workspace-cards" class="uk-grid uk-grid-small uk-child-width-1-2@s uk-child-width-1-3@m uk-child-width-1-4@l"
           uk-grid uk-sortable="handle: .ws-card-handle"
           data-order="${esc(Object.keys(workspaces).join(','))}" data-file="settings.yml" data-key="workspaces">${cards}</div>
      ${message || ''}
    </div>`;
  if (gridOnly) return grid;

  return pageShell('workspace', `
<main class="uk-container uk-container-large page-body">
  <div class="uk-card uk-card-default uk-card-body">
    ${grid}
  </div>
</main>`, [], 'home');
}
// One `ddev list` call → { name: { status, url } } so every project row can
// show whether it's already started and ready to launch.
let _statusCache = null;
let _statusCacheAt = 0;

async function ddevStatusMap() {
  // 3s TTL: refresh-triggered re-renders right after an action reuse one
  // `ddev list` call instead of forking it per fragment.
  const now = Date.now();
  if (_statusCache && now - _statusCacheAt < 3000) return _statusCache;
  const result = await run('ddev', ['list', '--json-output'], ROOT, { timeoutMs: 60 * 1000 });
  const map = {};
  try {
    for (const p of JSON.parse(result.stdout).raw || []) {
      map[p.name] = { status: p.status, url: p.primary_url };
    }
  } catch (_) { /* leave empty on parse/daemon errors — rows fall back to "unknown" */ }
  _statusCache = map;
  _statusCacheAt = now;
  return map;
}
async function projectRowsHtml(key, dir, state = defaultListState()) {
  const meta = loadWorkspaces()[key];
  const names = listProjects(dir);
  const canBackup = !!findBackupScript(dir);
  const canRemove = !!findRemoveScript(dir);
  const canTest = fs.existsSync(path.join(dir, 'cmd-tools-testing.sh'));
  const statuses = await ddevStatusMap();
  const url = `/fragments/${key}/projects`;
  const target = '#webship-workspace-projects';

  // Resolve each project's DDEV name and status once, here: the filter needs it, the sort needs the
  // timestamp, and the row needs both — three passes over the same stat calls otherwise.
  const projects = names.map((name) => {
    const ddevName = ddevProjectName(path.join(dir, name));
    let mtime = 0;
    try { mtime = fs.statSync(path.join(dir, name)).mtimeMs; } catch (_) { /* vanished mid-render */ }
    return {
      name,
      ddevName,
      mtime,
      status: ddevName !== null ? (statuses[ddevName]?.status || 'stopped') : null,
    };
  });

  const filtered = projects.filter((p) => {
    switch (state && state.status) {
      case 'running': return p.status === 'running';
      case 'stopped': return p.ddevName !== null && p.status !== 'running';
      case 'noddev':  return p.ddevName === null;
      // Only this filter opens directories, and only when it is the one asked for: a test report is
      // a file on disk, so an unfiltered page must not pay for the check on every row.
      case 'tested':  return projectTestRuns(dir, p.name).length > 0;
      default:        return true;
    }
  });

  const page = searchSortPage(filtered, state);

  const rows = page.slice.map((row) => {
    const p = row.name;
    const { ddevName } = row;
    const isDdev = ddevName !== null;
    const status = row.status;
    const running = status === 'running';
    const statusBadge = !isDdev ? '' : running
      ? '<span class="uk-label uk-label-success">🟢 Running</span>'
      : `<span class="uk-label">⚪ ${esc(status)}</span>`;
    const vals = (extra = '') => `hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}"${extra}}' hx-target="#webship-workspace-output" hx-swap="innerHTML"`;
    return `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
        <span class="uk-text-bold">📁 ${esc(p)} ${statusBadge}
          ${isDdev && running ? `<a class="proj-alias uk-text-meta" href="https://${esc(ddevName)}.ddev.site" target="_blank" title="Canonical DDEV URL">${esc(ddevName)}.ddev.site</a>` : ''}</span>
        <div class="project-actions">
          ${isDdev && !running ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/ddev-start" ${vals()}><span uk-icon="icon: play; ratio: .7"></span> Start</button>` : ''}
          ${isDdev && running ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/ddev-stop" ${vals()}><span uk-icon="icon: ban; ratio: .7"></span> Stop</button>` : ''}
          ${isDdev && running ? `<a class="uk-button uk-button-primary uk-button-small" href="https://${esc(p)}.${esc(key)}.${hubDomain()}" target="_blank" title="https://${esc(p)}.${esc(key)}.${hubDomain()}"><span uk-icon="icon: forward; ratio: .7"></span> Launch</a>` : ''}
          ${(() => {
            // The DDEV verbs, built from the same table the server dispatches on. Everything here
            // needs a `ddev` binary and a project it recognises, so a project without a .ddev
            // config gets no menu at all rather than a menu of failures.
            if (!isDdev) return '';
            const entries = DDEV_MENU_ORDER
              // A stopped site cannot answer drush or hand over its database. Offering those and
              // then explaining the refusal is worse than not offering them.
              .filter((k) => running || !DDEV_ACTIONS[k].needsRunning)
              .map((k) => {
                const a = DDEV_ACTIONS[k];
                return `<li><a href hx-post="${k}" ${vals()} title="${esc(a.label)}"><span uk-icon="icon: ${a.menuIcon}; ratio: .7"></span> ${esc(a.menuLabel)}</a></li>`;
              });
            return `<div class="uk-inline act-menu">
              <button class="uk-button uk-button-default uk-button-small" type="button" title="Restart, inspect and export this DDEV project"><span uk-icon="icon: cog; ratio: .7"></span> DDEV <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
              <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">
                <li class="uk-nav-header">${esc(ddevName)}</li>
                ${entries.join('')}
                <li class="uk-nav-divider"></li>
                <li><a href="https://${esc(ddevName)}.ddev.site" target="_blank"><span uk-icon="icon: link-external; ratio: .7"></span> Canonical URL</a></li>
              </ul></div>
            </div>`;
          })()}
          ${(() => {
            // Start, Stop and Launch are what a row is for; everything else goes behind one
            // button so a row reads at a glance instead of as eight controls.
            const items = [];
            if (projectTestRuns(dir, p).length) {
              items.push(`<li><a href hx-get="/fragments/${esc(key)}/tests/${encodeURIComponent(p)}" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: file-text; ratio: .7"></span> Last test run</a></li>`);
            }
            if (canTest) {
              const configured = testingStackOf(dir, p) !== 'none';
              items.push(`<li><a href hx-post="/actions/testing-${configured ? 'run' : 'configure'}" ${vals()}><span uk-icon="icon: ${configured ? 'play-circle' : 'cog'}; ratio: .7"></span> ${configured ? 'Run the tests' : 'Set up testing'}</a></li>`);
            }
            if (canBackup) {
              items.push(`<li><a href hx-post="/actions/backup" ${vals()}><span uk-icon="icon: download; ratio: .7"></span> Back it up</a></li>`);
              items.push(`<li><a href="${wsUrl(key, '/backups')}"><span uk-icon="icon: album; ratio: .7"></span> Archives for this workspace</a></li>`);
            }
            if (canRemove) {
              items.push('<li class="uk-nav-divider"></li>');
              items.push(`<li><a href class="uk-text-danger arm-step" data-armed="0" hx-post="/actions/remove" ${vals(',"confirm":"yes"')} hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Remove the project</a></li>`);
            }
            if (!items.length) return '';
            return `<div class="uk-inline act-menu">
              <button class="uk-button uk-button-default uk-button-small" type="button" title="More actions"><span uk-icon="icon: more; ratio: .7"></span> More <span uk-icon="icon: chevron-down; ratio: .6"></span></button>
              <div uk-dropdown="mode: click; pos: bottom-right"><ul class="uk-nav uk-dropdown-nav">${items.join('')}</ul></div>
            </div>`;
          })()}
        </div>
      </div>
    </div>`;
  }).join('');

  const heading = meta.nounPlural.charAt(0).toUpperCase() + meta.nounPlural.slice(1);
  const pager = listPagerHtml(url, target, page, state, meta.nounPlural);
  return `
    <h3 class="uk-margin-small-bottom">${esc(heading)} <span class="uk-badge">${projects.length}</span></h3>
    ${projects.length ? listControlsHtml(url, target, state, meta.nounPlural, statusFilterHtml(url, target, state)) : ''}
    ${pager}
    ${rows || emptyListHtml(state, meta.nounPlural, `No ${esc(meta.nounPlural)} yet.`)}
    ${page.pages > 1 ? pager : ''}`;
}
function humanSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}
// Parse a builder's argparse schema (from the arg-<distribution>.sh file it
// sources) into structured fields for the Arguments UI: booleans
// (action=store_true) and value flags with their defaults.
function parseArgparseText(argSrc) {
    const out = [];
    for (const block of argSrc.split('parser.add_argument(').slice(1)) {
      const flags = [...block.matchAll(/'(--?[a-zA-Z0-9_-]+)'/g)].map((m) => m[1]);
      const long = flags.find((f) => f.startsWith('--'));
      if (!long) continue; // positional (PROJECT_NAME etc.)
      const bool = /action='store_true'/.test(block.split('parser.add_argument')[0]);
      const dm2 = block.match(/default=(?:"([^"]*)"|'([^']*)'|(False|True))/);
      let def = dm2 ? (dm2[1] ?? dm2[2] ?? dm2[3]) : '';
      if (def === 'False') def = false; else if (def === 'True') def = true;
      if (def === '_none_') def = '';
      const hm = block.match(/help='((?:[^'\\]|\\.)*)'/);
      out.push({ flag: long, bool, def, help: hm ? hm[1].replace(/\\'/g, "'") : '' });
    }
    return out;
}
// Read a builder's arguments straight from the cmd- script: if the script
// carries its own inline argparse heredoc, parse that; otherwise follow the
// distribution it loads to the shared arg-<distribution>.sh file it sources.
function parseBuilderArgs(dir, script) {
  try {
    const src = fs.readFileSync(path.join(dir, script), 'utf8');
    if (/argparse "\$@"/.test(src) && src.includes('parser.add_argument(')) {
      return parseArgparseText(src);
    }
    const dm = src.match(/distribution_name="([a-z_]+)"/);
    if (!dm) return [];
    const argFile = path.join(ROOT, 'core', 'scripts', 'args', `arg-${dm[1]}.sh`);
    return parseArgparseText(fs.readFileSync(argFile, 'utf8'));
  } catch (_) {
    return [];
  }
}
// The collapsed Arguments group for one builder script.
function builderArgsHtml(key, script) {
  const dir = workspaceDir(key);
  if (!SCRIPT_RE.test(script) || !findBuilderScripts(dir).includes(script)) return '';
  const args = parseBuilderArgs(dir, script);
  if (!args.length) return '';
  const rows = args.map((a) => {
    const name = (a.bool ? 'argb:' : 'argv:') + a.flag;
    if (a.bool) {
      return `
        <label class="arg-row" title="${esc(a.help)}">
          <input class="uk-checkbox" type="checkbox" name="${esc(name)}" ${a.def === true || a.flag === '--install' ? 'checked' : ''}>
          <code>${esc(a.flag)}</code> <span class="uk-text-meta">${esc(a.help)}</span>
        </label>`;
    }
    return `
      <label class="arg-row" title="${esc(a.help)}">
        <code>${esc(a.flag)}</code>
        <input class="uk-input uk-form-small arg-value" type="text" name="${esc(name)}" value="${esc(String(a.def || ''))}" placeholder="${esc(a.help.slice(0, 60))}">
      </label>`;
  }).join('');
  return `
    <ul uk-accordion class="uk-margin-small-top builder-args">
      <li>
        <a class="uk-accordion-title" href>Arguments <span class="uk-text-meta">(${args.length} for this builder)</span></a>
        <div class="uk-accordion-content">${rows}</div>
      </li>
    </ul>`;
}
function backupRowsHtml(key, state = defaultListState()) {
  const backups = listBackups(key);
  const url = `/fragments/${key}/backups`;
  const target = '#webship-workspace-backups';
  // An archive's name is its only text and its date is what you look for, so the search and the
  // sort work off the filename and the mtime the archive already carries. Only `name` is added:
  // mtime stays the Date the row prints, and subtracting two Dates sorts them correctly anyway.
  const page = searchSortPage(backups.map((b) => ({ ...b, name: b.file })), state);
  const rows = page.slice.map((b) => `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
        <span><span uk-icon="icon: ${b.kind === 'db' ? 'database' : 'album'}; ratio: .8"></span> <span class="uk-text-bold">${esc(b.file)}</span>
          <span class="uk-text-meta">· ${b.kind === 'db' ? 'database dump · ' : ''}${humanSize(b.size)} · ${b.mtime.toISOString().slice(0, 16).replace('T', ' ')}</span></span>
        <div class="project-actions">
          ${b.kind === 'db' ? '' : `<button class="uk-button uk-button-secondary uk-button-small arm-step" data-armed="0"
                  hx-post="/actions/restore"
                  hx-vals='{"workspace":"${esc(key)}","file":"${esc(b.file)}","confirm":"yes"}'
                  hx-target="#webship-workspace-output" hx-swap="innerHTML"
                  hx-trigger="confirmed-remove"><span uk-icon="icon: history; ratio: .7"></span> Restore</button>`}
          <button class="uk-button uk-button-danger uk-button-small arm-step" data-armed="0"
                  hx-post="/actions/backup-delete"
                  hx-vals='{"workspace":"${esc(key)}","file":"${esc(b.file)}","confirm":"yes"}'
                  hx-target="#webship-workspace-output" hx-swap="innerHTML"
                  hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete</button>
        </div>
      </div>
    </div>`).join('');

  const pager = listPagerHtml(url, target, page, state, 'backups');
  return `
    <h3 class="uk-margin-small-bottom uk-margin-top">Backups <span class="uk-badge">${backups.length}</span></h3>
    ${backups.length ? listControlsHtml(url, target, state, 'backups') : ''}
    ${pager}
    ${rows || emptyListHtml(state, 'backups', 'No backups yet — use a project\'s Backup button to create one.')}
    ${page.pages > 1 ? pager : ''}`;
}
// Dedicated backups page: /<workspace>/backups
function backupsPage(key, state = defaultListState()) {
  const meta = loadWorkspaces()[key];

  return pageShell(`${meta.label} Backups · workspace`, `
<main class="uk-container uk-container-small page-body webship-workspace-page">
  <div class="uk-flex uk-flex-middle page-heading">
    <span class="page-heading-icon"><span uk-icon="icon: album; ratio: 1.1"></span></span>
    <div>
      <h1 class="uk-margin-remove">${esc(meta.label)} Backups</h1>
      <span class="uk-text-meta">Restore or delete archived projects from this workspace</span>
    </div>
  </div>
  <div class="uk-card uk-card-default uk-card-body">
    <div id="webship-workspace-backups" hx-get="/fragments/${esc(key)}/backups" hx-trigger="refresh-projects from:body">
      ${backupRowsHtml(key, state)}
    </div>

    <div id="webship-workspace-output"></div>
  </div>
</main>`, [{ label: 'Workspaces', href: HOME_URL() }, { label: meta.label, href: wsUrl(key) }, { label: 'Backups' }], `backups:${key}`);
}
async function workspacePage(key, state = defaultListState()) {
  const workspaces = loadWorkspaces();
  const meta = workspaces[key];
  const dir = meta.dir;
  const isFiles = meta.kind === 'files';
  const builders = isFiles ? [] : findBuilderScripts(dir);
  const builderOptions = builders.map((s) => `<option value="${esc(s)}">${esc(builderLabel(dir, s))}</option>`).join('');

  const listSection = isFiles ? `
    <div id="webship-workspace-projects" hx-get="/fragments/${esc(key)}/items" hx-trigger="refresh-projects from:body">
      ${itemRowsHtml(key, state)}
    </div>

    <p class="uk-margin-top">
      <button class="uk-button uk-button-primary" hx-get="/fragments/${esc(key)}/new" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: plus; ratio: .8"></span> New ${esc(meta.noun)}</button>
      ${INSTALL_TARGETS[key] ? `
      <button class="uk-button uk-button-secondary" hx-get="/fragments/${esc(key)}/ai-form" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: bolt; ratio: .8"></span> Generate with AI</button>` : ''}
      ${key === 'docs' ? `
      <button class="uk-button uk-button-secondary" hx-get="/fragments/docs/site-doc-form" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: bolt; ratio: .8"></span> Generate site doc (AI)</button>
      <button class="uk-button uk-button-secondary" hx-get="/fragments/docs/screenshot-form" hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: image; ratio: .8"></span> Screenshot a site</button>` : ''}
      ${findSyncScript(dir) ? `
      <button class="uk-button uk-button-default" hx-post="/actions/sync-items" hx-vals='{"workspace":"${esc(key)}","source":"repo"}' hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: download; ratio: .8"></span> Sync from webship/ai-agents</button>
      <button class="uk-button uk-button-default" hx-post="/actions/sync-items" hx-vals='{"workspace":"${esc(key)}","source":"claude"}' hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: home; ratio: .8"></span> Sync from ~/.claude</button>` : ''}
    </p>` : `
    <div id="webship-workspace-projects" hx-get="/fragments/${esc(key)}/projects" hx-trigger="refresh-projects from:body">
      ${await projectRowsHtml(key, dir, state)}
    </div>`;

  return pageShell(`${meta.label} · workspace`, `
<main class="uk-container uk-container-small page-body webship-workspace-page">
  <div class="uk-flex uk-flex-middle page-heading">
    <span class="page-heading-icon">${iconHtml(meta.icon, 1.1)}</span>
    <div>
      <h1 class="uk-margin-remove uk-text-capitalize">${esc(meta.label)}</h1>
      <span class="uk-text-meta">${esc(meta.subtitle)}</span>
    </div>
  </div>
  <div class="uk-card uk-card-default uk-card-body">
    ${builders.length ? `
      <h3 class="uk-margin-small-bottom">Build a new ${esc(meta.noun)}</h3>
      <form hx-post="/actions/build" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(key)}">
        <div class="uk-grid uk-grid-small" uk-grid>
          <div class="uk-width-2-5@s"><select class="uk-select" name="script"
            hx-get="/fragments/${esc(key)}/builder-args" hx-trigger="change, load" hx-target="#builder-args" hx-swap="innerHTML" hx-include="this">${builderOptions}</select></div>
          <div class="uk-width-2-5@s"><input class="uk-input" name="projectName" placeholder="new-project-name" required pattern="[a-zA-Z0-9_\\-]+"></div>
          <div class="uk-width-1-5@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Build</button></div>
        </div>
        <div id="builder-args"></div>
      </form>
    ` : ''}

    ${listSection}

    <div id="webship-workspace-output"></div>
  </div>
</main>`, [{ label: 'Workspaces', href: HOME_URL() }, { label: meta.label }], `workspace:${key}`);
}
function resultFragment(result, intro) {
  const text = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '');
  return `
    <div class="msg ${result.ok ? 'assistant' : 'error'}">
      ${intro ? `<p>${intro}</p>` : ''}
      <pre>${esc(text.slice(-3000) || JSON.stringify(result))}</pre>
    </div>`;
}

module.exports = {
  INSTALL_TARGETS,
  VIDEO_RE,
  ITEM_TEMPLATES,
  NAME_RE,
  SCRIPT_RE,
  itemFile,
  listItems,
  testingStackOf,
  projectTestRuns,
  testRunHtml,
  itemRowsHtml,
  editorFormHtml,
  settingsPage,
  pageActionsHtml,
  pageShell,
  homePage,
  workspaceCardsHtml,
  ddevStatusMap,
  projectRowsHtml,
  parseBuilderArgs,
  builderArgsHtml,
  backupRowsHtml,
  backupsPage,
  workspacePage,
  resultFragment,
  HOME_URL,
  wsUrl,
};
