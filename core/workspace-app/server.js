/*
 * workspace dashboard — basic Node.js (node:http, no framework) + HTMX.
 * All interactivity is server-rendered HTML fragments swapped in by HTMX;
 * the only client scripts are the vendored htmx.min.js and a tiny ui.js.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const querystring = require('querystring');
const {
  ROOT,
  loadWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findRemoveScript,
  findBuilderScripts,
  builderLabel,
} = require('./workspaces');

const PUBLIC_DIR = path.join(__dirname, 'public');
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SCRIPT_RE = /^cmd-[a-zA-Z0-9_.-]+\.sh$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- process helpers ---------------- */

function run(cmd, args, cwd, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, code: -1, stdout, stderr: String(err.message) }); });
  });
}

// A project's real DDEV name (from its .ddev/config.yaml), or null if it
// isn't a DDEV project. The name usually equals the folder name (the build
// scripts pass --project-name=<folder>), but not necessarily.
function ddevProjectName(projectDir) {
  try {
    const cfg = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8');
    const m = cfg.match(/^name:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

/* Background jobs with live terminal output: long actions run detached while
 * the page polls /fragments/job/<id> every second, streaming the command's
 * real stdout/stderr into a terminal box until it exits. */
const jobs = new Map();
let jobSeq = 0;

function startJob(title, cmd, args, cwd, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const id = `${++jobSeq}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { title, buf: '', done: false, ok: null };
  jobs.set(id, job);
  const child = spawn(cmd, args, { cwd, env: process.env });
  const append = (d) => { job.buf = (job.buf + d.toString()).slice(-30000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.on('close', (code) => { clearTimeout(timer); job.done = true; job.ok = code === 0; });
  child.on('error', (err) => { clearTimeout(timer); job.buf += `\n${err.message}`; job.done = true; job.ok = false; });
  setTimeout(() => jobs.delete(id), 30 * 60 * 1000);
  return id;
}

function jobFragment(id) {
  const job = jobs.get(id);
  if (!job) return { html: '<div class="msg error">Job not found (expired).</div>', done: true };
  const text = job.buf.replace(/\x1b\[[0-9;]*[mK]/g, '');
  const status = job.done ? (job.ok ? '✅ finished' : '❌ failed') : '<span uk-spinner="ratio: .5"></span> running…';
  const poll = job.done ? '' : ` hx-get="/fragments/job/${id}" hx-trigger="every 1s" hx-swap="outerHTML"`;
  const html = `
    <div class="msg ${job.done && !job.ok ? 'error' : 'assistant'} terminal" id="job-${id}"${poll}>
      <p>${job.title} — ${status}</p>
      <pre class="terminal-pre">${esc(text) || '…'}</pre>
    </div>`;
  return { html, done: job.done };
}

function listProjects(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch (_) {
    return [];
  }
}

/* ---------------- shared page chrome ---------------- */

function pageShell(title, body, crumbs = []) {
  const crumbHtml = crumbs.length ? `
    <ul class="uk-breadcrumb uk-margin-remove uk-visible@s">
      ${crumbs.map((c, i) => i === crumbs.length - 1
        ? `<li><span>${esc(c.label)}</span></li>`
        : `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`).join('')}
    </ul>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="/logo.png">
<link rel="stylesheet" href="/vendor/uikit.min.css">
<link rel="stylesheet" href="/style.css">
<script src="/vendor/uikit.min.js"></script>
<script src="/vendor/uikit-icons.min.js"></script>
<script src="/htmx.min.js"></script>
<script src="/ui.js" defer></script>
</head>
<body class="uk-background-muted">
<div class="global-working" aria-hidden="true">
  <div class="global-working-bar"></div>
  <div class="global-working-pill"><div uk-spinner="ratio: .5"></div> Working…</div>
</div>
<nav class="uk-navbar-container toolbar">
  <div class="uk-container uk-container-xlarge">
    <div uk-navbar>
      <div class="uk-navbar-left">
        <a class="uk-navbar-item uk-logo toolbar-logo" href="/">
          <img src="/logo.png" alt="workspace" width="46" height="46"> <span>workspace</span>
        </a>
        ${crumbHtml}
      </div>
    </div>
  </div>
</nav>
${body}
<footer class="uk-section uk-section-xsmall uk-text-center uk-text-meta">
  webship/workspace · DDEV-only tooling · <a href="/">workspace.ddev.site</a>
</footer>
</body>
</html>`;
}

// The assistant's logo mark: a large + small four-point sparkle (inline SVG,
// inherits currentColor) — used in the panel header and the floating launcher.
const AI_MARK = `<svg class="ai-mark" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M10.5 2l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1L2.5 10l6.1-1.9L10.5 2z"/><path d="M18.5 13.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>`;

// The AI assistant panel — included on EVERY page. `floating` renders it as
// the bottom-right widget with a launcher button; inline renders it in flow.
function assistantHtml({ floating, context = 'home' }) {
  const panel = `
    <div class="uk-card uk-card-default assistant-panel">
      <div class="assistant-head">
        <div class="uk-flex uk-flex-middle assistant-head-row">
          <span class="assistant-avatar">${AI_MARK}</span>
          <div class="assistant-head-text">
            <h3 class="uk-margin-remove">Workspace AI Assistant</h3>
            <span class="uk-text-small">Ask me anything about your workspace projects</span>
          </div>
        </div>
      </div>
      <div class="uk-card-body assistant-body">
        <div class="chat-log" id="chat-log">
          <div class="msg assistant">
            <p><strong>Hi!</strong> I can actually do things for you — build, start, back up, and open your projects, then take you there.</p>
            <p>💡 <strong>Try these examples:</strong></p>
            <ul class="uk-list uk-list-bullet uk-margin-remove">
              <li>"Create a new Varbase project called demo1 and open it"</li>
              <li>"Start natshahcom in dev and launch it"</li>
              <li>"What's running right now?"</li>
            </ul>
          </div>
        </div>
        <div class="chat-typing htmx-indicator" id="chat-typing">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="chat-typing-label">assistant is thinking…</span>
        </div>
        <form class="chat-input"
              hx-post="/actions/chat" hx-target="#chat-log" hx-swap="beforeend"
              hx-indicator="#chat-typing"
              hx-on::after-request="this.reset()">
          <input type="hidden" name="context" value="${esc(context)}">
          <input type="text" name="message" class="uk-input" placeholder="Ask me anything… (or use voice)" autocomplete="off" required>
          <button type="button" class="uk-button uk-button-default mic-btn" title="Voice input" aria-label="Voice input"><span uk-icon="icon: microphone; ratio: .9"></span></button>
          <button type="submit" class="uk-button uk-button-primary send-btn" title="Send" aria-label="Send"><span uk-icon="icon: comment; ratio: .8"></span><span class="qa-label"> Send</span></button>
        </form>
      </div>
    </div>`;

  if (floating) {
    return `
      <div class="assistant-float open" id="assistant-float">${panel}</div>
      <button class="assistant-launcher uk-button uk-button-primary" onclick="document.getElementById('assistant-float').classList.toggle('open')" title="Workspace AI Assistant">${AI_MARK}</button>`;
  }
  return panel;
}

/* ---------------- pages ---------------- */

function homePage() {
  const workspaces = loadWorkspaces();
  const cards = Object.values(workspaces).map((w) => {
    const projectCount = listProjects(w.dir).length;
    const hasBuilders = findBuilderScripts(w.dir).length > 0;
    const backupCount = listBackups(w.key).length;
    return `
      <div class="uk-position-relative">
        <a class="uk-card uk-card-default uk-card-hover uk-card-body uk-card-small uk-text-center uk-display-block uk-link-reset workspace-card" href="/${esc(w.key)}">
          <div class="icon"><span uk-icon="icon: ${w.icon}; ratio: 1.4" class="uk-text-primary"></span></div>
          <h4 class="uk-card-title uk-margin-remove uk-text-bold">${esc(w.label)}</h4>
          <p class="uk-text-meta uk-margin-remove">${esc(w.subtitle)}</p>
          <span class="uk-label ${hasBuilders ? 'uk-label-success' : ''} uk-margin-small-top">${projectCount} ${projectCount === 1 ? w.noun : w.nounPlural}${hasBuilders ? ' · buildable' : ''}</span>
        </a>
        ${backupCount ? `<a class="ws-backups" href="/${esc(w.key)}/backups" title="View the ${backupCount} backup${backupCount === 1 ? '' : 's'} for ${esc(w.label)}"><span uk-icon="icon: album; ratio: .65"></span> ${backupCount}</a>` : ''}
      </div>`;
  }).join('');

  return pageShell('workspace', `
<main class="uk-container uk-container-xlarge page-body">
  <div class="uk-grid uk-grid-medium uk-flex-top" uk-grid>
    <div class="uk-width-1-3@m">
      ${assistantHtml({ floating: false, context: 'home' })}
    </div>
    <div class="uk-width-2-3@m">
      <div class="uk-card uk-card-default uk-card-body">
        <h2 class="uk-text-center uk-margin-remove-bottom">Workspaces</h2>
        <p class="uk-text-meta uk-text-center uk-margin-small-bottom">Browse and manage your development environments</p>
        <div class="uk-grid uk-grid-small uk-child-width-1-2@s uk-child-width-1-3@m uk-child-width-1-4@l" uk-grid>${cards}</div>
      </div>
    </div>
  </div>
</main>`);
}

// One `ddev list` call → { name: { status, url } } so every project row can
// show whether it's already started and ready to launch.
async function ddevStatusMap() {
  const result = await run('ddev', ['list', '--json-output'], ROOT, { timeoutMs: 60 * 1000 });
  const map = {};
  try {
    for (const p of JSON.parse(result.stdout).raw || []) {
      map[p.name] = { status: p.status, url: p.primary_url };
    }
  } catch (_) { /* leave empty on parse/daemon errors — rows fall back to "unknown" */ }
  return map;
}

async function projectRowsHtml(key, dir) {
  const meta = loadWorkspaces()[key];
  const projects = listProjects(dir);
  const canBackup = !!findBackupScript(dir);
  const canRemove = !!findRemoveScript(dir);
  const statuses = await ddevStatusMap();

  const rows = projects.map((p) => {
    const ddevName = ddevProjectName(path.join(dir, p));
    const isDdev = ddevName !== null;
    const status = isDdev ? (statuses[ddevName]?.status || 'stopped') : null;
    const running = status === 'running';
    const statusBadge = !isDdev ? '' : running
      ? '<span class="uk-label uk-label-success">🟢 Running</span>'
      : `<span class="uk-label">⚪ ${esc(status)}</span>`;
    const vals = (extra = '') => `hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}"${extra}}' hx-target="#webship-workspace-output" hx-swap="innerHTML"`;
    return `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
        <span class="uk-text-bold">📁 ${esc(p)} ${statusBadge}</span>
        <div class="project-actions">
          ${isDdev && !running ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/ddev-start" ${vals()}><span uk-icon="icon: play; ratio: .7"></span> Start</button>` : ''}
          ${isDdev && running ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/ddev-stop" ${vals()}><span uk-icon="icon: ban; ratio: .7"></span> Stop</button>` : ''}
          ${isDdev && running ? `<a class="uk-button uk-button-primary uk-button-small" href="https://${esc(ddevName)}.ddev.site" target="_blank"><span uk-icon="icon: forward; ratio: .7"></span> Launch</a>` : ''}
          ${canBackup ? `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/backup" ${vals()}><span uk-icon="icon: download; ratio: .7"></span> Backup</button>` : ''}
          ${canRemove ? `<button class="uk-button uk-button-danger uk-button-small arm-step" data-armed="0" hx-post="/actions/remove" ${vals(',"confirm":"yes"')} hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Remove</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const heading = meta.nounPlural.charAt(0).toUpperCase() + meta.nounPlural.slice(1);
  return `
    <h3 class="uk-margin-small-bottom">${esc(heading)} <span class="uk-badge">${projects.length}</span></h3>
    ${rows || `<p class="uk-text-meta">No ${esc(meta.nounPlural)} yet.</p>`}`;
}

// Backup archives for a workspace: ${backups}/<workspace>/*.tar.gz created by
// the cmd-tool*-backup-*.sh scripts, newest first.
function listBackups(key) {
  const meta = loadWorkspaces()[key];
  try {
    return fs.readdirSync(meta.backupsDir)
      .filter((f) => f.endsWith('.tar.gz'))
      .map((f) => {
        const st = fs.statSync(path.join(meta.backupsDir, f));
        return { file: f, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return [];
  }
}

function humanSize(bytes) {
  if (bytes > 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function backupRowsHtml(key) {
  const backups = listBackups(key);
  const rows = backups.map((b) => `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap">
        <span><span uk-icon="icon: album; ratio: .8"></span> <span class="uk-text-bold">${esc(b.file)}</span>
          <span class="uk-text-meta">· ${humanSize(b.size)} · ${b.mtime.toISOString().slice(0, 16).replace('T', ' ')}</span></span>
        <div class="project-actions">
          <button class="uk-button uk-button-secondary uk-button-small arm-step" data-armed="0"
                  hx-post="/actions/restore"
                  hx-vals='{"workspace":"${esc(key)}","file":"${esc(b.file)}","confirm":"yes"}'
                  hx-target="#webship-workspace-output" hx-swap="innerHTML"
                  hx-trigger="confirmed-remove"><span uk-icon="icon: history; ratio: .7"></span> Restore</button>
          <button class="uk-button uk-button-danger uk-button-small arm-step" data-armed="0"
                  hx-post="/actions/backup-delete"
                  hx-vals='{"workspace":"${esc(key)}","file":"${esc(b.file)}","confirm":"yes"}'
                  hx-target="#webship-workspace-output" hx-swap="innerHTML"
                  hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete</button>
        </div>
      </div>
    </div>`).join('');

  return `
    <h3 class="uk-margin-small-bottom uk-margin-top">Backups <span class="uk-badge">${backups.length}</span></h3>
    ${rows || '<p class="uk-text-meta">No backups yet — use a project\'s Backup button to create one.</p>'}`;
}

// Dedicated backups page: /<workspace>/backups
function backupsPage(key) {
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
      ${backupRowsHtml(key)}
    </div>

    <div id="webship-workspace-output"></div>
  </div>
</main>

${assistantHtml({ floating: true, context: `backups:${key}` })}`, [{ label: 'Workspaces', href: '/' }, { label: meta.label, href: `/${key}` }, { label: 'Backups' }]);
}

async function workspacePage(key) {
  const workspaces = loadWorkspaces();
  const meta = workspaces[key];
  const dir = meta.dir;
  const builders = findBuilderScripts(dir);
  const builderOptions = builders.map((s) => `<option value="${esc(s)}">${esc(builderLabel(dir, s))}</option>`).join('');

  return pageShell(`${meta.label} · workspace`, `
<main class="uk-container uk-container-small page-body webship-workspace-page">
  <div class="uk-flex uk-flex-middle page-heading">
    <span class="page-heading-icon"><span uk-icon="icon: ${meta.icon}; ratio: 1.1"></span></span>
    <div>
      <h1 class="uk-margin-remove uk-text-capitalize">${esc(meta.label)}</h1>
      <span class="uk-text-meta">${esc(meta.subtitle)}</span>
    </div>
  </div>
  <div class="uk-card uk-card-default uk-card-body">
    ${builders.length ? `
      <h3 class="uk-margin-small-bottom">Build a new ${esc(meta.noun)}</h3>
      <form class="uk-grid uk-grid-small uk-margin-bottom" uk-grid hx-post="/actions/build" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(key)}">
        <div class="uk-width-2-5@s"><select class="uk-select" name="script">${builderOptions}</select></div>
        <div class="uk-width-2-5@s"><input class="uk-input" name="projectName" placeholder="new-project-name" required pattern="[a-zA-Z0-9_-]+"></div>
        <div class="uk-width-1-5@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Build</button></div>
      </form>
    ` : ''}

    <div id="webship-workspace-projects" hx-get="/fragments/${esc(key)}/projects" hx-trigger="refresh-projects from:body">
      ${await projectRowsHtml(key, dir)}
    </div>

    ${listBackups(key).length ? `
    <p class="uk-margin-top uk-text-center">
      <a class="uk-button uk-button-default uk-border-pill" href="/${esc(key)}/backups"><span uk-icon="icon: album; ratio: .8"></span> Backups (${listBackups(key).length})</a>
    </p>` : ''}

    <div id="webship-workspace-output"></div>
  </div>
</main>

${assistantHtml({ floating: true, context: `workspace:${key}` })}`, [{ label: 'Workspaces', href: '/' }, { label: meta.label }]);
}

/* ---------------- HTMX fragments/actions ---------------- */

function resultFragment(result, intro) {
  const text = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '');
  return `
    <div class="msg ${result.ok ? 'assistant' : 'error'}">
      ${intro ? `<p>${intro}</p>` : ''}
      <pre>${esc(text.slice(-3000) || JSON.stringify(result))}</pre>
    </div>`;
}

// Append-only audit trail of every action the dashboard executes — request
// logs don't survive container restarts, so destructive operations (remove,
// build) must be attributable after the fact from this file.
const AUDIT_LOG = path.join(__dirname, 'actions.log');
function audit(pathname, form, result) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    action: pathname,
    workspace: form.workspace,
    projectName: form.projectName,
    script: form.script,
    file: form.file,
    ok: result === undefined ? undefined : !!result,
  });
  try { fs.appendFileSync(AUDIT_LOG, line + '\n'); } catch (_) { /* never block the action */ }
}

async function handleAction(pathname, form, res) {
  const send = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };
  if (pathname !== '/actions/status' && pathname !== '/actions/chat') audit(pathname, form);

  const workspace = form.workspace || 'dev';
  if (pathname !== '/actions/chat' && pathname !== '/actions/status' && !isValidWorkspace(workspace)) {
    return send('<div class="msg error">Unknown workspace.</div>', 400);
  }

  if (pathname === '/actions/build' || pathname === '/actions/quick-build') {
    const dir = workspaceDir(workspace);
    const script = String(form.script || '');
    const projectName = String(form.projectName || '');
    if (!SCRIPT_RE.test(script) || !findBuilderScripts(dir).includes(script)) return send('<div class="msg error">Unknown build script.</div>', 400);
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const flags = String(form.flags || '--install').split(' ').filter((f) => /^--[a-zA-Z0-9=_.,-]*$/.test(f));
    const id = startJob(`🏗️ Build <strong>${esc(projectName)}</strong> (${esc(builderLabel(dir, script))})`, 'bash', [script, projectName, ...flags], dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/backup') {
    const dir = workspaceDir(workspace);
    const script = findBackupScript(dir);
    if (!script) return send('<div class="msg error">No backup script in this workspace.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const id = startJob(`💾 Backup <strong>${esc(form.projectName)}</strong>`, 'bash', [script, form.projectName], dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/remove') {
    const dir = workspaceDir(workspace);
    const script = findRemoveScript(dir);
    if (!script) return send('<div class="msg error">No remove script in this workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Destructive action requires confirmation.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const id = startJob(`🗑️ Remove <strong>${esc(form.projectName)}</strong>`, 'bash', [script, form.projectName], dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/restore') {
    const meta = loadWorkspaces()[workspace];
    const file = String(form.file || '');
    if (form.confirm !== 'yes') return send('<div class="msg error">Restore requires confirmation.</div>', 400);
    // Backup filenames come from the backup scripts: <ws>---<project>--<stamp>.tar.gz
    const m = file.match(/^([a-z]+)---([a-zA-Z0-9_-]+)--([0-9_-]+)\.tar\.gz$/);
    if (!m) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const projectName = m[2];
    const archive = path.join(meta.backupsDir, file);
    if (!fs.existsSync(archive)) return send('<div class="msg error">Backup file not found.</div>', 404);
    const targetDir = path.join(meta.dir, projectName);
    if (fs.existsSync(targetDir)) {
      return send(`<div class="msg error">'${esc(projectName)}' already exists in this workspace — remove it first, then restore.</div>`, 409);
    }

    // The archives were created from inside the workspace folder, so they
    // extract back to <workspace>/<project>/. Then, if a matching DB dump
    // sits next to the archive, bring the project up and import it — all as
    // one streaming job. (file/projectName are regex-validated above, so
    // embedding them in the shell line is safe.)
    const dbCandidates = [`${file.replace(/\.tar\.gz$/, '')}-db.sql.gz`, `${file.replace(/\.tar\.gz$/, '')}-db.sql`];
    const dbFile = dbCandidates.map((f) => path.join(meta.backupsDir, f)).find((f) => fs.existsSync(f));
    let shellLine = `set -e; echo "Extracting ${file}…"; tar -xzf '${archive}'`;
    if (dbFile) {
      shellLine += ` && if [ -f '${targetDir}/.ddev/config.yaml' ]; then cd '${targetDir}' && ddev start -y && echo "Importing database…" && ddev import-db --file='${dbFile}'; else echo "Not a DDEV project — import the DB dump manually: ${path.basename(dbFile)}"; fi`;
    }
    const id = startJob(`♻️ Restore <strong>${esc(projectName)}</strong> from <code>${esc(file)}</code>`, 'bash', ['-c', shellLine], meta.dir);
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/backup-delete') {
    const meta = loadWorkspaces()[workspace];
    const file = String(form.file || '');
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting a backup requires confirmation.</div>', 400);
    if (!/^[a-z]+---[a-zA-Z0-9_-]+--[0-9_-]+\.tar\.gz$/.test(file)) return send('<div class="msg error">Unrecognized backup filename.</div>', 400);
    const archive = path.join(meta.backupsDir, file);
    if (!fs.existsSync(archive)) return send('<div class="msg error">Backup file not found.</div>', 404);
    const removed = [];
    for (const f of [archive,
      path.join(meta.backupsDir, file.replace(/\.tar\.gz$/, '-db.sql.gz')),
      path.join(meta.backupsDir, file.replace(/\.tar\.gz$/, '-db.sql'))]) {
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(path.basename(f)); }
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant"><p>🗑️ Deleted backup:</p><pre>${esc(removed.join('\n'))}</pre></div>`);
  }

  if (pathname === '/actions/ddev-start' || pathname === '/actions/ddev-stop') {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    const verb = pathname === '/actions/ddev-start' ? 'start' : 'stop';
    // `ddev start` accepts -y (skip confirmation); `ddev stop` has no such flag.
    const args = verb === 'start' ? ['start', '-y'] : ['stop'];
    const id = startJob(`${verb === 'start' ? '▶️' : '⏹️'} <code>ddev ${verb}</code> on <strong>${esc(projectName)}</strong>`, 'ddev', args, projectDir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/status') {
    const result = await run('ddev', ['list', '--json-output'], ROOT, { timeoutMs: 60 * 1000 });
    let lines = '';
    try {
      const parsed = JSON.parse(result.stdout);
      lines = (parsed.raw || [])
        .map((p) => `${p.status === 'running' ? '🟢' : '⚪'} ${p.name} — ${p.status}${p.status === 'running' ? ` — ${p.primary_url}` : ''}`)
        .join('\n') || 'No DDEV projects registered.';
    } catch (_) {
      lines = (result.stdout + '\n' + result.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim();
    }
    return send(`
      <div class="msg ${result.ok ? 'assistant' : 'error'}">
        <p>💚 <strong>DDEV status:</strong></p>
        <pre>${esc(lines)}</pre>
      </div>`);
  }

  if (pathname === '/actions/chat') {
    const message = String(form.message || '').trim();
    if (!message) return send('<div class="msg error">Empty message.</div>', 400);
    audit(pathname, { workspace: '-', projectName: message.slice(0, 120) });
    const userHtml = `<div class="msg user">${esc(message)}</div>`;

    // Agent mode: the assistant can actually run the workspace tooling
    // (Bash + read tools inside this container, where ~/workspace, ddev and
    // docker are all available) and steers the interface afterwards through
    // NAVIGATE/OPEN/REFRESH directives that ui.js executes in the browser.
    const workspaceNames = Object.keys(loadWorkspaces()).join(', ');
    // Live page context: the assistant always knows which page the user is
    // on and what that page currently shows (computed fresh per message).
    let pageContext = 'The user is on the dashboard home page showing all workspace cards.';
    const ctx = String(form.context || '');
    const ctxMatch = ctx.match(/^(workspace|backups):([a-z0-9_-]+)$/);
    if (ctxMatch && isValidWorkspace(ctxMatch[2])) {
      const cKey = ctxMatch[2];
      const cMeta = loadWorkspaces()[cKey];
      if (ctxMatch[1] === 'workspace') {
        const projs = listProjects(cMeta.dir);
        pageContext = `The user is on the "${cMeta.label}" workspace page (/${cKey}, folder ${cMeta.dir}). Projects currently listed: ${projs.join(', ') || '(none)'} . Builder scripts available: ${findBuilderScripts(cMeta.dir).join(', ') || '(none)'}.`;
      } else {
        pageContext = `The user is on the "${cMeta.label}" backups page (/${cKey}/backups). Backups currently listed: ${listBackups(cKey).map((b) => b.file).join(', ') || '(none)'}.`;
      }
    }
    const system = [
      `You are the Workspace AI Assistant embedded in the web dashboard at https://workspace.ddev.site, managing the webship/workspace tooling rooted at ${ROOT}.`,
      `You run inside the dashboard's container with Bash access: the whole workspace tree is at ${ROOT}, and the ddev + docker CLIs manage sibling DDEV projects.`,
      `Workspaces (folders under ${ROOT}): ${workspaceNames}.`,
      pageContext,
      'How to act:',
      `- Inspect: ls ${ROOT}/<workspace> ; ddev list ; each builder script has a "# workspace-name:" header naming what it builds.`,
      `- Build a new project: cd ${ROOT}/<workspace> && bash cmd-<...>-project.sh <project_name> --install`,
      `- Start/stop an existing project: cd ${ROOT}/<workspace>/<project> && ddev start -y (or ddev stop -y)`,
      `- Backup: run the folder's cmd-tool*-backup-*.sh <project_name> from inside ${ROOT}/<workspace>.`,
      '- NEVER delete or remove anything unless the user explicitly asked for that in this exact message.',
      'After acting, end your reply with directives, each alone on its own line, so the interface can react:',
      'NAVIGATE:/<workspace>   (go to that workspace page, e.g. NAVIGATE:/dev)',
      'OPEN:<https url>        (open a site in a new tab, e.g. after ddev start)',
      'REFRESH                 (refresh the visible project list)',
      'Keep replies short and factual; report real command results, never invented ones.',
    ].join('\n');

    const args = [
      '-p', message,
      '--output-format', 'json',
      '--append-system-prompt', system,
      '--allowedTools', 'Bash', 'Read', 'Glob', 'Grep',
      '--disallowedTools', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Agent',
      '--no-session-persistence',
    ];
    const result = await run('claude', args, ROOT, { timeoutMs: 15 * 60 * 1000 });
    let reply = result.stdout.trim();
    try {
      const parsed = JSON.parse(result.stdout);
      reply = parsed.result || parsed.response || reply;
    } catch (_) { /* raw text fallback */ }
    if (!reply) reply = result.stderr.trim() || 'No response from the assistant.';

    // Pull the interface directives out of the reply text.
    const directive = {};
    reply = reply.split('\n').filter((line) => {
      const nav = line.match(/^\s*NAVIGATE:(\/[a-z0-9_-]+)\s*$/);
      if (nav) { directive.navigate = nav[1]; return false; }
      const open = line.match(/^\s*OPEN:(https?:\/\/\S+)\s*$/);
      if (open) { directive.open = open[1]; return false; }
      if (/^\s*REFRESH\s*$/.test(line)) { directive.refresh = true; return false; }
      return true;
    }).join('\n').trim();

    const triggers = { 'refresh-projects': directive.refresh ? {} : undefined, 'assistant-directive': (directive.navigate || directive.open) ? directive : undefined };
    const activeTriggers = Object.fromEntries(Object.entries(triggers).filter(([, v]) => v !== undefined));
    if (Object.keys(activeTriggers).length) res.setHeader('HX-Trigger', JSON.stringify(activeTriggers));

    return send(`${userHtml}<div class="msg assistant">${esc(reply)}</div>`);
  }

  send('<div class="msg error">Unknown action.</div>', 404);
}

/* ---------------- static files ---------------- */

const MIME = {
  '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(pathname, res) {
  const file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET') {
      if (pathname === '/' ) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(homePage());
      }
      if (pathname === '/actions/status') return handleAction(pathname, {}, res);
      const jobMatch = pathname.match(/^\/fragments\/job\/([a-z0-9-]+)$/);
      if (jobMatch) {
        const frag = jobFragment(jobMatch[1]);
        // When the job finishes, refresh the project/backup lists so status
        // badges and buttons reflect the new state.
        if (frag.done) res.setHeader('HX-Trigger', 'refresh-projects');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(frag.html);
      }
      const fragMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/projects$/);
      if (fragMatch && isValidWorkspace(fragMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await projectRowsHtml(fragMatch[1], workspaceDir(fragMatch[1])));
      }
      const backupsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/backups$/);
      if (backupsMatch && isValidWorkspace(backupsMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(backupRowsHtml(backupsMatch[1]));
      }
      const backupsPageMatch = pathname.match(/^\/([a-z0-9_-]+)\/backups\/?$/);
      if (backupsPageMatch && isValidWorkspace(backupsPageMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(backupsPage(backupsPageMatch[1]));
      }
      const wsKey = pathname.replace(/^\/+|\/+$/g, '');
      if (isValidWorkspace(wsKey)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await workspacePage(wsKey));
      }
      if (serveStatic(pathname, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    if (req.method === 'POST' && pathname.startsWith('/actions/')) {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => handleAction(pathname, querystring.parse(body), res));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`workspace-dashboard (node:http + HTMX) listening on :${PORT}`);
});
