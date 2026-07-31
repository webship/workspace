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
  CONFIG_DIR,
  hubDomain,
  loadWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findSyncScript,
  findRemoveScript,
  findBuilderScripts,
  builderLabel,
} = require('./workspaces');

const PUBLIC_DIR = path.join(__dirname, 'public');
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SCRIPT_RE = /^cmd-[a-zA-Z0-9_.-]+\.sh$/;

// Default navigation scheme: workspace subdomains under the hub domain
// (workspace.ddev.site locally; hub_domain in settings.yml for a public
// remote-hub deployment).
const HOME_URL = () => `https://${hubDomain()}`;
const wsUrl = (key, sub = '') => `https://${key}.${hubDomain()}${sub}`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- process helpers ---------------- */

function run(cmd, args, cwd, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    // stdin must be closed ('ignore') — ddev wraps commands in `docker exec -i`,
    // which hangs indefinitely on an open-but-silent stdin pipe.
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

// A job may claim a key. Testing a project takes minutes, and starting a second run against the
// same project while the first is still going interleaves two suites over one site.
function runningJobKey(key) {
  for (const job of jobs.values()) if (job.key === key && !job.done) return true;
  return false;
}

function startJob(title, cmd, args, cwd, { timeoutMs = 15 * 60 * 1000, echoLine = '', key = '' } = {}) {
  const id = `${++jobSeq}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { title, key, buf: echoLine ? `$ ${echoLine}\n\n` : '', done: false, ok: null };
  jobs.set(id, job);
  // stdin 'ignore' — see run(): docker exec -i hangs on an open stdin pipe.
  const child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

/* ---------------- file-item workspaces (agents, skills, prompts, docs) --- */

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
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (key === 'skills' && e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) {
      items.push({ name: e.name, editable: true });
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      items.push({ name: e.name.replace(/\.md$/, ''), editable: true });
    } else if (key === 'docs' && e.isFile() && /\.(pdf|html|png)$/.test(e.name)) {
      items.push({ name: e.name, editable: false, artifact: true });
    } else if (key === 'videos' && e.isFile() && VIDEO_RE.test(e.name)) {
      items.push({ name: e.name, editable: false, artifact: true, video: true });
    } else if (key === 'videos' && e.isFile() && /\.(jpg|jpeg|png)$/i.test(e.name)) {
      items.push({ name: e.name, editable: false, artifact: true });
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

/* ---------------- test runs and their evidence ------------------------- */

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

function itemRowsHtml(key) {
  const meta = loadWorkspaces()[key];
  const items = listItems(key);
  const installable = !!INSTALL_TARGETS[key];
  const rows = items.map((it) => {
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
          ${key === 'docs' ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/make-pdf" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: file-pdf; ratio: .7"></span> PDF</button><button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/make-html" ${vals} hx-target="#webship-workspace-output" hx-swap="innerHTML"><span uk-icon="icon: world; ratio: .7"></span> HTML</button>` : ''}
          <button class="uk-button uk-button-danger uk-button-small arm-step" data-armed="0" hx-post="/actions/delete-item" hx-vals='{"workspace":"${esc(key)}","name":"${esc(it.name)}","confirm":"yes"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"><span uk-icon="icon: trash; ratio: .7"></span> Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');

  const heading = meta.nounPlural.charAt(0).toUpperCase() + meta.nounPlural.slice(1);
  return `
    <h3 class="uk-margin-small-bottom">${esc(heading)} <span class="uk-badge">${items.length}</span></h3>
    ${rows || `<p class="uk-text-meta">No ${esc(meta.nounPlural)} yet — create one below.</p>`}`;
}

function editorFormHtml(key, name, content, isNew) {
  const meta = loadWorkspaces()[key];
  return `
    <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
      <h3 class="uk-margin-small-bottom">${isNew ? `New ${esc(meta.noun)}` : `Edit ${esc(name)}`}</h3>
      <form hx-post="/actions/save-item" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(key)}">
        <input class="uk-input uk-margin-small-bottom" name="name" value="${esc(name)}" placeholder="${esc(meta.noun)}-name" required pattern="[a-zA-Z0-9_-]+" ${isNew ? '' : 'readonly'}>
        <textarea class="uk-textarea editor-area" name="content" rows="16" spellcheck="false">${esc(content)}</textarea>
        <div class="uk-margin-small-top">
          <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save</button>
        </div>
      </form>
    </div>`;
}

/* ---------------- shared page chrome ---------------- */

/* ---------------- settings editor -------------------------------------- */

// Only the workspace's own configuration is editable here — never an arbitrary path.
const SETTINGS_FILE_RE = /^(settings\.yml|workspace\.[a-z0-9_-]+\.settings\.yml)$/;

// A value that should not be echoed back into a page. A blank field keeps what is on disk.
function isSecretKey(key) {
  return /(pass|password|secret|token|api_key|apikey)$/i.test(key);
}

function listSettingsFiles() {
  let files = [];
  try {
    files = fs.readdirSync(CONFIG_DIR).filter((f) => SETTINGS_FILE_RE.test(f));
  } catch (_) {
    return [];
  }
  // settings.yml first, then the per-workspace files alphabetically.
  return files.sort((a, b) => (a === 'settings.yml' ? -1 : b === 'settings.yml' ? 1 : a.localeCompare(b)));
}

// Flatten a settings file into editable rows, straight from its lines so the order matches the
// file and nothing is invented.
//
// Scalars only. A list — settings.yml's `workspaces:` — is shown read-only: its order is the
// dashboard's card order and its membership is what registers a workspace, so it is not something
// to retype into a text field by accident.
function readSettingsRows(file) {
  let text;
  try {
    text = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8');
  } catch (_) {
    return null;
  }
  const lines = text.split('\n');
  const rows = [];
  const stack = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) return;
    const [, indentStr, key, rawValue] = m;
    const indent = indentStr.length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const dotted = [...stack.map((x) => x.key), key].join('.');
    const value = rawValue.replace(/\s+#.*$/, '').trim();
    if (value === '') {
      // A parent key, or one whose list items follow. Recorded so children get their dotted
      // path; only shown when it turns out to hold a list.
      stack.push({ indent, key });
      if (/^\s*-\s+/.test(lines[i + 1] || '')) {
        const items = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          const li = lines[j].match(/^\s*-\s+(.+?)\s*$/);
          if (!li) break;
          items.push(li[1].replace(/^["']|["']$/g, ''));
        }
        rows.push({ line: i, dotted, key, value: '', list: true, items });
      }
      return;
    }
    rows.push({ line: i, dotted, key, value, secret: isSecretKey(key) });
  });
  return rows;
}

// Replace the value on one known line, leaving the rest of the file — comments, blank lines,
// quoting style, list blocks — exactly as it was.
function writeSettingsValues(file, updates) {
  const full = path.join(CONFIG_DIR, file);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  let changed = 0;
  for (const { line, key, value, bool } of updates) {
    const cur = lines[line];
    if (cur === undefined) continue;
    const m = cur.match(/^(\s*)([A-Za-z0-9_.-]+):(\s*)(.*)$/);
    if (!m || m[2] !== key) continue;          // the file moved under us — skip it
    const [, indentStr, k, gap, rest] = m;
    const comment = rest.match(/\s+#.*$/);
    // Quote when the value would otherwise change type or break the parse.
    const needsQuote = !bool
      && (/[:#]|^\s|\s$/.test(value)
        || (value !== '' && /^(y|n|yes|no|true|false|on|off|null|~)$/i.test(value)));
    lines[line] = `${indentStr}${k}:${gap || ' '}${needsQuote ? JSON.stringify(value) : value}${comment ? comment[0] : ''}`;
    changed += 1;
  }
  if (changed) fs.writeFileSync(full, lines.join('\n'));
  return changed;
}

function settingsFieldHtml(r) {
  if (r.list) {
    return `
      <div class="uk-margin-small">
        <label class="uk-form-label">${esc(r.dotted)} <span class="uk-text-meta">(list — read only)</span></label>
        <div class="uk-form-controls"><pre class="uk-margin-remove">${esc(r.items.join('\n'))}</pre></div>
      </div>`;
  }
  const id = `v_${r.line}`;
  return `
    <div class="uk-margin-small">
      <label class="uk-form-label" for="${id}">${esc(r.dotted)}</label>
      <div class="uk-form-controls">
        <input type="hidden" name="k_${r.line}" value="${esc(r.key)}">
        ${r.secret ? `<input type="hidden" name="secret_${r.line}" value="1">` : ''}
        <input class="uk-input" id="${id}" name="${id}" type="${r.secret ? 'password' : 'text'}"
               value="${r.secret ? '' : esc(r.value)}"
               placeholder="${r.secret ? 'unchanged — type to replace' : ''}">
      </div>
    </div>`;
}

function settingsFormHtml(file, message) {
  const rows = readSettingsRows(file);
  if (!rows) return '<div class="msg error">Could not read that settings file.</div>';
  return `
    <h3 class="uk-margin-small-bottom">${esc(file)}</h3>
    <p class="uk-text-meta">Comments and formatting are preserved — only the lines you change are
      rewritten. Secrets are never sent to this page: a blank secret field keeps the value on disk.</p>
    ${message || ''}
    <form hx-post="/actions/save-settings" hx-target="#settings-output" hx-swap="innerHTML">
      <input type="hidden" name="file" value="${esc(file)}">
      ${rows.map(settingsFieldHtml).join('')}
      <div class="uk-margin-top">
        <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save ${esc(file)}</button>
      </div>
    </form>`;
}

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

function pageShell(title, body, crumbs = [], context = 'home') {
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
<script>(function(){try{if(localStorage.getItem('ws-theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})();</script>
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
          <img src="/logo.png" alt="workspace" width="46" height="46"> <span>workspace</span>
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
<div class="app-content">
${body}
<footer class="uk-section uk-section-xsmall uk-text-center uk-text-meta">
  webship/workspace · DDEV-only tooling · <a href="/">workspace.ddev.site</a>
</footer>
</div>
</body>
</html>`;
}

// The assistant's logo mark: a large + small four-point sparkle (inline SVG,
// inherits currentColor) — used in the panel header and the floating launcher.
const AI_MARK = `<svg class="ai-mark" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M10.5 2l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1L2.5 10l6.1-1.9L10.5 2z"/><path d="M18.5 13.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>`;

// The AI assistant panel — included on EVERY page. `floating` renders it as
// the bottom-right widget with a launcher button; inline renders it in flow.

/* ---------------- assistant reply (shared by both chat front-ends) ------ */

// One reply, whichever UI asked for it: the HTMX pane and the deep-chat component send the same
// message and context and get back the same rendered markdown plus the same interface directives.
async function assistantReply(message, ctx) {
const workspaceNames = Object.values(loadWorkspaces())
      .map((w) => `${w.key} (${w.subtitle})`)
      .join('; ');
    // Live page context: the assistant always knows which page the user is
    // on and what that page currently shows (computed fresh per message).
    let pageContext = 'The user is on the dashboard home page showing all workspace cards.';
    
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
      'The components workspace holds Drupal SDC components, React components, code components for Drupal Canvas, and HTMX and web components.',
      `Default domain scheme (hub domain: ${hubDomain()}): each workspace has <workspace>.${hubDomain()} (its dashboard page), and every running project has https://<project>.<workspace>.${hubDomain()} (its real site) — prefer these hierarchical URLs in OPEN directives; the canonical https://<project>.ddev.site also works.`,
      pageContext,
      'How to act:',
      `- Inspect: ls ${ROOT}/<workspace> ; ddev list ; each builder script has a "# workspace-name:" header naming what it builds.`,
      `- Build a new project: cd ${ROOT}/<workspace> && bash cmd-<...>-project.sh <project_name> --install`,
      `- Start/stop an existing project: cd ${ROOT}/<workspace>/<project> && ddev start -y (or ddev stop -y)`,
      `- Backup: run the folder's cmd-tool*-backup-*.sh <project_name> from inside ${ROOT}/<workspace>.`,
      `- Create/edit AI agents, skills, prompts, docs: write markdown files with Bash redirection — agents: ${ROOT}/agents/<name>.md (YAML frontmatter: name, description, tools), skills: ${ROOT}/skills/<name>/SKILL.md, prompts: ${ROOT}/prompts/<name>.md, docs: ${ROOT}/docs/<name>.md. Install into Claude Code by copying: agents → ~/.claude/agents/, skills → ~/.claude/skills/<name>/, prompts → ~/.claude/commands/.`,
      `- Docs tooling: render PDF with: pandoc <doc>.md -o <doc>.pdf --pdf-engine=wkhtmltopdf ; render HTML with: pandoc <doc>.md -o <doc>.html --standalone ; capture a site screenshot with: wkhtmltoimage --width 1440 <url> ${ROOT}/docs/<name>.png`,
      '- NEVER delete or remove anything unless the user explicitly asked for that in this exact message.',
      'After acting, end your reply with directives, each alone on its own line, so the interface can react:',
      'NAVIGATE:/<workspace>   (go to that workspace page, e.g. NAVIGATE:/dev — or its backups page: NAVIGATE:/dev/backups)',
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
      // Accepts /<workspace> and /<workspace>/backups
      const nav = line.match(/^\s*NAVIGATE:\/([a-z0-9_-]+)(\/backups)?\s*$/);
      if (nav) { directive.navigate = isValidWorkspace(nav[1]) ? wsUrl(nav[1], nav[2] || '') : HOME_URL(); return false; }
      const open = line.match(/^\s*OPEN:(https?:\/\/\S+)\s*$/);
      if (open) { directive.open = open[1]; return false; }
      if (/^\s*REFRESH\s*$/.test(line)) { directive.refresh = true; return false; }
      return true;
    }).join('\n').trim();

    const triggers = { 'refresh-projects': directive.refresh ? {} : undefined, 'assistant-directive': (directive.navigate || directive.open) ? directive : undefined };
    const activeTriggers = Object.fromEntries(Object.entries(triggers).filter(([, v]) => v !== undefined));
    if (Object.keys(activeTriggers).length) res.setHeader('HX-Trigger', JSON.stringify(activeTriggers));

    // Render the reply's markdown (tables, bold, code, lists) — gfm-raw_html
    // strips raw HTML passthrough, so model output can't inject markup.
    let replyHtml = `<p>${esc(reply)}</p>`;
    const mdResult = await new Promise((resolve) => {
      const child = spawn('pandoc', ['-f', 'gfm-raw_html', '-t', 'html'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve(code === 0 ? out : null));
      child.on('error', () => resolve(null));
      child.stdin.write(reply);
      child.stdin.end();
    });
    if (mdResult) replyHtml = mdResult;
  return { replyHtml, directive };
}

const COMMAND_MENU_ORDER = ['products', 'dev', 'test', 'demos'];
// The commands offered in the prompt box.
//
// Scoped to one workspace when the user is on a workspace page: on /dev the only
// commands that can sensibly run are dev's own, and a list of every command in
// the tree buries them. The home page keeps the full grouped list, because there
// no workspace is implied.
function commandMenuGroups(scope) {
  const all = loadWorkspaces();
  const keys = Object.keys(all);
  const ordered = (scope && keys.includes(scope))
    ? [scope]
    : [...COMMAND_MENU_ORDER.filter((k) => keys.includes(k)),
       ...keys.filter((k) => !COMMAND_MENU_ORDER.includes(k))];
  const groups = [];
  for (const key of ordered) {
    const dir = all[key].dir;
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^cmd-.*\.sh$/.test(f)).sort();
    } catch (_) { continue; }
    if (!files.length) continue;
    groups.push({
      key,
      label: all[key].label,
      items: files.map((f) => ({ file: f, label: builderLabel(dir, f) })),
    });
  }
  return groups;
}


function assistantHtml({ context = 'home' } = {}) {
  // "workspace:dev" / "backups:dev" — both mean the user is working in dev.
  const scopeMatch = String(context).match(/^(?:workspace|backups):([a-z0-9_-]+)$/);
  const scope = scopeMatch && isValidWorkspace(scopeMatch[1]) ? scopeMatch[1] : null;
  // The settings page belongs to no workspace, so it gets no command list at all rather than every
  // command in the tree: none of them edit those files.
  const isSettings = context === 'settings';
  const scopeLabel = scope ? loadWorkspaces()[scope].label : (isSettings ? 'Settings' : null);
  const commandGroups = isSettings ? [] : commandMenuGroups(scope);
  // Scoped to one workspace, the optgroup would repeat that workspace's name on every row for no
  // information; flat reads better.
  const commandOptions = scope
    ? commandGroups.flatMap((g) => g.items.map((it) =>
        `<option value="${esc(g.key)}/${esc(it.file)}">${esc(it.label === it.file ? it.file : `${it.label} — ${it.file}`)}</option>`)).join('')
    : commandGroups.map((g) => `
    <optgroup label="${esc(g.label)}">
      ${g.items.map((it) => `<option value="${esc(g.key)}/${esc(it.file)}">${esc(it.label === it.file ? it.file : `${it.label} — ${it.file}`)}</option>`).join('')}
    </optgroup>`).join('');
  const autoOption = scopeLabel
    ? `✨ Prompt mode: Auto — the agent decides (${scopeLabel})`
    : '✨ Prompt mode: Auto — the agent decides';
  const pickerLabel = isSettings ? 'Prompt mode — Settings'
    : scope ? `Prompt mode — ${scopeLabel} commands` : 'Prompt mode';
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
        <deep-chat id="ws-deep-chat" class="ws-deep-chat"
                   data-context="${esc(context)}"
                   style="width:100%;height:100%;border:none;background-color:transparent;"></deep-chat>
        <div class="chat-tools">
          <select class="uk-select command-picker" aria-label="${esc(pickerLabel)}" title="${esc(pickerLabel)}">
            <option value="">${esc(autoOption)}</option>
            ${commandOptions}
          </select>
        </div>
      </div>
    </div>`;

  return panel;
}

/* ---------------- pages ---------------- */

function homePage() {
  const workspaces = loadWorkspaces();
  const cards = Object.values(workspaces).map((w) => {
    const projectCount = w.kind === 'files' ? listItems(w.key).length : listProjects(w.dir).length;
    const hasBuilders = w.kind === 'files' ? false : findBuilderScripts(w.dir).length > 0;
    const backupCount = listBackups(w.key).length;
    return `
      <div class="uk-position-relative">
        <a class="uk-card uk-card-default uk-card-hover uk-card-body uk-card-small uk-text-center uk-display-block uk-link-reset workspace-card" href="${wsUrl(w.key)}">
          <div class="icon"><span uk-icon="icon: ${w.icon}; ratio: 1.4" class="uk-text-primary"></span></div>
          <h4 class="uk-card-title uk-margin-remove uk-text-bold">${esc(w.label)}</h4>
          <p class="uk-text-meta uk-margin-remove">${esc(w.subtitle)}</p>
          <span class="uk-label ${hasBuilders ? 'uk-label-success' : ''} uk-margin-small-top">${projectCount} ${projectCount === 1 ? w.noun : w.nounPlural}${hasBuilders ? ' · buildable' : ''}</span>
        </a>
        ${backupCount ? `<a class="ws-backups" href="${wsUrl(w.key, '/backups')}" title="View the ${backupCount} backup${backupCount === 1 ? '' : 's'} for ${esc(w.label)}"><span uk-icon="icon: album; ratio: .65"></span> ${backupCount}</a>` : ''}
      </div>`;
  }).join('');

  return pageShell('workspace', `
<main class="uk-container uk-container-large page-body">
  <div class="uk-card uk-card-default uk-card-body">
    <div class="uk-grid uk-grid-small uk-child-width-1-2@s uk-child-width-1-3@m uk-child-width-1-4@l" uk-grid>${cards}</div>
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

async function projectRowsHtml(key, dir) {
  const meta = loadWorkspaces()[key];
  const projects = listProjects(dir);
  const canBackup = !!findBackupScript(dir);
  const canRemove = !!findRemoveScript(dir);
  const canTest = fs.existsSync(path.join(dir, 'cmd-tools-testing.sh'));
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
        <span class="uk-text-bold">📁 ${esc(p)} ${statusBadge}
          ${isDdev && running ? `<a class="proj-alias uk-text-meta" href="https://${esc(ddevName)}.ddev.site" target="_blank" title="Canonical DDEV URL">${esc(ddevName)}.ddev.site</a>` : ''}</span>
        <div class="project-actions">
          ${isDdev && !running ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/ddev-start" ${vals()}><span uk-icon="icon: play; ratio: .7"></span> Start</button>` : ''}
          ${isDdev && running ? `<button class="uk-button uk-button-secondary uk-button-small" hx-post="/actions/ddev-stop" ${vals()}><span uk-icon="icon: ban; ratio: .7"></span> Stop</button>` : ''}
          ${isDdev && running ? `<a class="uk-button uk-button-primary uk-button-small" href="https://${esc(p)}.${esc(key)}.${hubDomain()}" target="_blank" title="https://${esc(p)}.${esc(key)}.${hubDomain()}"><span uk-icon="icon: forward; ratio: .7"></span> Launch</a>` : ''}
          ${canTest ? `<button class="uk-button uk-button-default uk-button-small" hx-post="/actions/testing-${testingStackOf(dir, p) === 'none' ? 'configure' : 'run'}" ${vals()} title="${testingStackOf(dir, p) === 'none' ? 'Set the automated-testing environment up on this project' : 'Run the webship-js suite'}"><span uk-icon="icon: ${testingStackOf(dir, p) === 'none' ? 'cog' : 'play-circle'}; ratio: .7"></span> ${testingStackOf(dir, p) === 'none' ? 'Set up tests' : 'Run tests'}</button>` : ''}
          ${projectTestRuns(dir, p).length ? `<button class="uk-button uk-button-default uk-button-small" hx-get="/fragments/${esc(key)}/tests/${encodeURIComponent(p)}" hx-target="#webship-workspace-output" hx-swap="innerHTML" title="The last run's report, screenshots and recordings"><span uk-icon="icon: file-text; ratio: .7"></span> Tests</button>` : ''}
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
</main>`, [{ label: 'Workspaces', href: HOME_URL() }, { label: meta.label, href: wsUrl(key) }, { label: 'Backups' }], `backups:${key}`);
}

async function workspacePage(key) {
  const workspaces = loadWorkspaces();
  const meta = workspaces[key];
  const dir = meta.dir;
  const isFiles = meta.kind === 'files';
  const builders = isFiles ? [] : findBuilderScripts(dir);
  const builderOptions = builders.map((s) => `<option value="${esc(s)}">${esc(builderLabel(dir, s))}</option>`).join('');

  const listSection = isFiles ? `
    <div id="webship-workspace-projects" hx-get="/fragments/${esc(key)}/items" hx-trigger="refresh-projects from:body">
      ${itemRowsHtml(key)}
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
      ${await projectRowsHtml(key, dir)}
    </div>`;

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
      <form hx-post="/actions/build" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(key)}">
        <div class="uk-grid uk-grid-small" uk-grid>
          <div class="uk-width-2-5@s"><select class="uk-select" name="script"
            hx-get="/fragments/${esc(key)}/builder-args" hx-trigger="change, load" hx-target="#builder-args" hx-swap="innerHTML" hx-include="this">${builderOptions}</select></div>
          <div class="uk-width-2-5@s"><input class="uk-input" name="projectName" placeholder="new-project-name" required pattern="[a-zA-Z0-9_-]+"></div>
          <div class="uk-width-1-5@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Build</button></div>
        </div>
        <div id="builder-args"></div>
      </form>
    ` : ''}

    ${listSection}

    ${listBackups(key).length ? `
    <p class="uk-margin-top uk-text-center">
      <a class="uk-button uk-button-default uk-border-pill" href="${wsUrl(key, '/backups')}"><span uk-icon="icon: album; ratio: .8"></span> Backups (${listBackups(key).length})</a>
    </p>` : ''}

    <div id="webship-workspace-output"></div>
  </div>
</main>`, [{ label: 'Workspaces', href: HOME_URL() }, { label: meta.label }], `workspace:${key}`);
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
  // save-settings edits core/config, so it carries no workspace to validate.
  if (pathname !== '/actions/chat' && pathname !== '/actions/status' && pathname !== '/actions/save-settings'
      && !isValidWorkspace(workspace)) {
    return send('<div class="msg error">Unknown workspace.</div>', 400);
  }

  if (pathname === '/actions/build' || pathname === '/actions/quick-build') {
    const dir = workspaceDir(workspace);
    const script = String(form.script || '');
    const projectName = String(form.projectName || '');
    if (!SCRIPT_RE.test(script) || !findBuilderScripts(dir).includes(script)) return send('<div class="msg error">Unknown build script.</div>', 400);
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    // Structured Arguments UI fields (argb: checkboxes, argv: value inputs)
    // take precedence; fall back to the legacy free-text `flags` (kept for
    // the API and the AI assistant).
    const schema = parseBuilderArgs(dir, script);
    const schemaFlags = new Map(schema.map((a) => [a.flag, a]));
    let flags = [];
    let usedStructured = false;
    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('argb:')) {
        usedStructured = true;
        const flag = k.slice(5);
        if (schemaFlags.has(flag)) flags.push(flag);
      } else if (k.startsWith('argv:')) {
        usedStructured = true;
        const flag = k.slice(5);
        const meta = schemaFlags.get(flag);
        const val = String(v).trim();
        if (meta && val && val !== String(meta.def)) flags.push(`${flag}=${val}`);
      }
    }
    if (!usedStructured) {
      flags = String(form.flags || '--install').trim().split(/\s+/).filter((f) => /^--[a-zA-Z0-9=_.,:@^~\/-]*$/.test(f));
    }
    // Full distribution builds (composer create-project + install) can far
    // exceed the default 15m on a cold composer cache.
    // Echo the exact final command as the first terminal line.
    const finalCmd = `bash ${script} ${projectName}${flags.length ? ' ' + flags.join(' ') : ''}`;
    const id = startJob(`🏗️ Build <strong>${esc(projectName)}</strong> (${esc(builderLabel(dir, script))})`, 'bash', [script, projectName, ...flags], dir, { timeoutMs: 60 * 60 * 1000, echoLine: finalCmd });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/testing-configure' || pathname === '/actions/testing-run') {
    const dir = workspaceDir(workspace);
    const projectName = String(form.projectName || '');
    const script = 'cmd-tools-testing.sh';
    const isRun = pathname.endsWith('-run');
    if (!fs.existsSync(path.join(dir, script))) return send('<div class="msg error">No testing script in this workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !listProjects(dir).includes(projectName)) {
      return send('<div class="msg error">Unknown project.</div>', 400);
    }
    // Running a suite before the stack exists fails deep inside cucumber; say so here instead.
    if (isRun && testingStackOf(dir, projectName) === 'none') {
      return send('<div class="msg error">No testing stack in this project yet — set the environment up first.</div>', 409);
    }
    const jobKey = `testing:${workspace}/${projectName}`;
    if (runningJobKey(jobKey)) {
      return send('<div class="msg error">A testing job is already running for this project.</div>', 409);
    }
    const args = isRun ? [script, projectName, '--run'] : [script, projectName];
    // A suite is minutes, not seconds: the default job timeout would kill a real run.
    const id = startJob(`${isRun ? '🧪 Run tests' : '🧰 Set up testing'} <strong>${esc(projectName)}</strong>`,
      'bash', args, dir,
      { timeoutMs: 90 * 60 * 1000, echoLine: `bash ${args.join(' ')}`, key: jobKey });
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

  if (pathname === '/actions/save-settings') {
    // A duplicated field means the form carried more than one `file`. String() would quietly turn
    // ['a','a'] into "a,a"; refuse rather than guess which was meant.
    if (Array.isArray(form.file)) return send('<div class="msg error">Ambiguous request — reload the page and try again.</div>', 400);
    const file = String(form.file || '');
    if (!SETTINGS_FILE_RE.test(file)) return send('<div class="msg error">Not a settings file.</div>', 400);
    const rows = readSettingsRows(file);
    if (!rows) return send('<div class="msg error">Could not read that settings file.</div>', 400);

    const updates = [];
    let keptSecrets = 0;
    for (const r of rows) {
      if (r.list) continue;
      const submittedKey = form[`k_${r.line}`];
      if (submittedKey === undefined) continue;
      // The line must still hold the key the form was built from, or the file changed since it was
      // rendered and this value belongs somewhere else now.
      if (submittedKey !== r.key) {
        return send('<div class="msg error">That file changed since this form was opened — reload and try again.</div>', 409);
      }
      const raw = form[`v_${r.line}`];
      const value = String((Array.isArray(raw) ? raw[raw.length - 1] : raw) ?? '');
      if (form[`secret_${r.line}`] === '1' && value === '') { keptSecrets += 1; continue; }
      if (value === r.value) continue;
      updates.push({
        line: r.line, key: r.key, value,
        // The row already held a boolean and so does the new value: write it unquoted so it stays
        // a YAML boolean. Quoting makes `active: "true"` — a string the shell reader never matches.
        bool: /^(true|false)$/i.test(String(r.value).trim()) && /^(true|false)$/i.test(value),
      });
    }

    if (!updates.length) {
      return send(`<div class="msg assistant">Nothing to change.${keptSecrets ? ` ${keptSecrets} secret(s) left as they are.` : ''}</div>`);
    }
    let changed = 0;
    try {
      changed = writeSettingsValues(file, updates);
    } catch (err) {
      return send(`<div class="msg error">Could not write ${esc(file)}: ${esc(err.message)}</div>`, 500);
    }
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(file)}</strong> — ${changed} value(s) changed.${keptSecrets ? ` ${keptSecrets} secret(s) left as they are.` : ''}</div>`);
  }

  if (pathname === '/actions/sync-items') {
    const dir = workspaceDir(workspace);
    const script = findSyncScript(dir);
    if (!script) return send('<div class="msg error">No sync script in this workspace.</div>', 400);
    // Only the two sources the script understands; reading ~/.claude keeps the
    // script's own name filter, so client and third-party items stay out.
    const source = form.source === 'claude' ? 'claude' : 'repo';
    const label = source === 'claude' ? '~/.claude' : 'webship/ai-agents';
    const id = startJob(`🔄 Sync <strong>${esc(workspace)}</strong> from ${esc(label)}`,
      'bash', [script, '--source', source], dir);
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

  if (pathname === '/actions/save-item') {
    const meta = loadWorkspaces()[workspace];
    if (meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name (letters, numbers, _ and - only).</div>', 400);
    const content = String(form.content || '').replace(/\r\n/g, '\n');
    if (content.length > 500000) return send('<div class="msg error">Content too large.</div>', 400);
    const file = itemFile(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(name)}</strong> (${esc(path.relative(ROOT, file))}).</div>`);
  }

  if (pathname === '/actions/install-item') {
    const meta = loadWorkspaces()[workspace];
    const target = INSTALL_TARGETS[workspace];
    if (!target || meta.kind !== 'files') return send('<div class="msg error">This workspace has no install target.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const src = itemFile(workspace, name);
    if (!fs.existsSync(src)) return send('<div class="msg error">Item not found.</div>', 404);
    fs.mkdirSync(target, { recursive: true });
    let dest;
    if (workspace === 'skills') {
      dest = path.join(target, name, 'SKILL.md');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } else {
      dest = path.join(target, `${name}.md`);
    }
    fs.copyFileSync(src, dest);
    const usage = workspace === 'prompts' ? ` — available in Claude Code as <code>/${esc(name)}</code>` : '';
    return send(`<div class="msg assistant">✅ Installed <strong>${esc(name)}</strong> to <code>${esc(dest.replace(process.env.HOME, '~'))}</code>${usage}. Restart Claude Code sessions to pick it up.</div>`);
  }

  if (pathname === '/actions/delete-item') {
    const meta = loadWorkspaces()[workspace];
    if (meta.kind !== 'files') return send('<div class="msg error">Not an editable workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Deleting requires confirmation.</div>', 400);
    const name = String(form.name || '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) return send('<div class="msg error">Invalid name.</div>', 400);
    const removed = [];
    if (/\.(pdf|html)$/.test(name)) {
      const f = path.join(meta.dir, name);
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(name); }
    } else if (workspace === 'skills') {
      const d = path.join(meta.dir, name);
      if (fs.existsSync(path.join(d, 'SKILL.md'))) { fs.rmSync(d, { recursive: true }); removed.push(name); }
    } else {
      const f = itemFile(workspace, name);
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed.push(`${name}.md`); }
    }
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(`<div class="msg assistant">🗑️ Deleted: ${esc(removed.join(', ') || '(nothing found)')}</div>`);
  }

  if (pathname === '/actions/generate-item') {
    const target = INSTALL_TARGETS[workspace];
    const meta = loadWorkspaces()[workspace];
    if (!target || meta.kind !== 'files') return send('<div class="msg error">AI generation is for agents, skills, and prompts.</div>', 400);
    const name = String(form.name || '');
    const description = String(form.description || '').slice(0, 2000);
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    if (!description.trim()) return send('<div class="msg error">Describe what it should do.</div>', 400);

    const SPECS = {
      agents: `a Claude Code CLI subagent definition markdown file. It MUST start with YAML frontmatter delimited by --- lines containing: name: ${name}, a one-paragraph description: telling Claude when to invoke this agent (starting "Use this agent to"), and a tools: list (only the tools it truly needs from Bash, Read, Write, Edit, Glob, Grep, WebFetch). After the frontmatter: a # ${name} heading, a role statement, and concrete ## Instructions the agent follows. Study ${ROOT} with your tools first if the description references this workspace.`,
      skills: `a Claude Code CLI skill (SKILL.md) markdown file. It MUST start with YAML frontmatter delimited by --- lines containing: name: ${name} and a one-line description: saying what the skill does and when to use it. After the frontmatter: a # ${name} heading and precise step-by-step ## Instructions. Study ${ROOT} with your tools first if the description references this workspace.`,
      prompts: `a reusable prompt file for a Claude Code CLI slash command (/${name}). Plain markdown, no frontmatter: just the complete, well-structured prompt text a user would run repeatedly. Make it specific and actionable.`,
    };
    const file = itemFile(workspace, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const genPrompt = `Write ${SPECS[workspace]}\n\nWhat it should do: ${description}\n\nOutput ONLY the raw file content — no surrounding commentary, no code fences.`;
    const shellLine = `set -e; echo "Generating ${meta.noun} '${name}' with AI…"; claude -p ${JSON.stringify(genPrompt)} --allowedTools Read Glob Grep --disallowedTools Write Edit Bash --no-session-persistence > ${JSON.stringify(file)}; echo "Written: ${path.relative(ROOT, file)}"; head -20 ${JSON.stringify(file)}`;
    const id = startJob(`🤖 Generate ${esc(meta.noun)} <strong>${esc(name)}</strong>`, 'bash', ['-c', shellLine], meta.dir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/make-html') {
    if (workspace !== 'docs') return send('<div class="msg error">HTML is generated in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    if (!fs.existsSync(itemFile('docs', name))) return send('<div class="msg error">Doc not found.</div>', 404);
    const id = startJob(`🌐 Render <strong>${esc(name)}.html</strong>`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; pandoc '${name}.md' -o '${name}.html' --standalone --metadata title='${name}' && echo "HTML written: ${name}.html"`],
      meta.dir, { timeoutMs: 2 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/screenshot') {
    if (workspace !== 'docs') return send('<div class="msg error">Screenshots are saved in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    const url = String(form.url || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    if (!/^https?:\/\/[a-zA-Z0-9.:\/_-]+$/.test(url)) return send('<div class="msg error">Invalid URL.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    const id = startJob(`📸 Screenshot <strong>${esc(name)}.png</strong> of ${esc(url)}`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; wkhtmltoimage --width 1440 --quality 80 ${JSON.stringify(url)} '${name}.png' && echo "Screenshot written: ${name}.png"`],
      meta.dir, { timeoutMs: 3 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/make-pdf') {
    if (workspace !== 'docs') return send('<div class="msg error">PDFs are generated in the docs workspace.</div>', 400);
    const name = String(form.name || '');
    if (!NAME_RE.test(name)) return send('<div class="msg error">Invalid name.</div>', 400);
    const meta = loadWorkspaces()[workspace];
    const md = itemFile('docs', name);
    if (!fs.existsSync(md)) return send('<div class="msg error">Doc not found.</div>', 404);
    const id = startJob(`📄 Render <strong>${esc(name)}.pdf</strong>`, 'bash',
      ['-c', `set -e; cd '${meta.dir}'; pandoc '${name}.md' -o '${name}.pdf' --pdf-engine=wkhtmltopdf --metadata title='${name}' -V margin-top=18mm -V margin-bottom=18mm -V margin-left=16mm -V margin-right=16mm && echo "PDF written: ${name}.pdf"`],
      meta.dir, { timeoutMs: 5 * 60 * 1000 });
    return send(jobFragment(id).html);
  }

  if (pathname === '/actions/generate-doc') {
    const srcWs = String(form.sourceWorkspace || '');
    const projectName = String(form.projectName || '');
    const docName = String(form.docName || '');
    if (!isValidWorkspace(srcWs)) return send('<div class="msg error">Unknown source workspace.</div>', 400);
    if (!NAME_RE.test(projectName) || !NAME_RE.test(docName)) return send('<div class="msg error">Invalid names.</div>', 400);
    const projectDir = path.join(workspaceDir(srcWs), projectName);
    if (!fs.existsSync(projectDir)) return send('<div class="msg error">Site/project not found.</div>', 404);
    const docsDir = workspaceDir('docs');
    const prompt = `Write comprehensive documentation (Markdown, no code fences around the whole document) about the site/project at ${projectDir}. Inspect the real files (composer.json, .ddev/config.yaml, README, directory layout) with your tools. Cover: what it is, the stack and versions, how to start it with ddev, its URL, notable modules/packages, and folder structure. Start with a # title.`;
    const shellLine = `set -e; echo "Generating documentation for ${projectName}…"; claude -p ${JSON.stringify(prompt)} --allowedTools Read Glob Grep Bash --disallowedTools Write Edit --no-session-persistence > '${docsDir}/${docName}.md'; echo "Markdown written: ${docName}.md"; cd '${docsDir}'; pandoc '${docName}.md' -o '${docName}.pdf' --pdf-engine=wkhtmltopdf --metadata title='${docName}' -V margin-top=18mm -V margin-bottom=18mm -V margin-left=16mm -V margin-right=16mm; echo "PDF written: ${docName}.pdf"`;
    const id = startJob(`🤖 Generate site doc <strong>${esc(docName)}</strong> from ${esc(srcWs)}/${esc(projectName)}`, 'bash', ['-c', shellLine], docsDir);
    return send(jobFragment(id).html);
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
    const { replyHtml, directive } = await assistantReply(message, String(form.context || ''));

    const triggers = { 'refresh-projects': directive.refresh ? {} : undefined, 'assistant-directive': (directive.navigate || directive.open) ? directive : undefined };
    const activeTriggers = Object.fromEntries(Object.entries(triggers).filter(([, v]) => v !== undefined));
    if (Object.keys(activeTriggers).length) res.setHeader('HX-Trigger', JSON.stringify(activeTriggers));

    return send(`<div class="msg user">${esc(message)}</div><div class="msg assistant">${replyHtml}</div>`);
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
  let { pathname } = new URL(req.url, 'http://localhost');

  // Workspace subdomains: <ws>.workspace.ddev.site serves that workspace's
  // pages — / maps to the workspace page and /backups to its backups page.
  // Absolute paths (/actions, /fragments, /files, assets) work unchanged.
  const hostMatch = String(req.headers.host || '').match(new RegExp(`^([a-z0-9_-]+)\\.${hubDomain().replace(/\./g, '\\.')}(?::\\d+)?$`));
  if (hostMatch && isValidWorkspace(hostMatch[1])) {
    if (pathname === '/') pathname = `/${hostMatch[1]}`;
    else if (pathname === '/backups' || pathname === '/backups/') pathname = `/${hostMatch[1]}/backups`;
  }

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
      const itemsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/items$/);
      if (itemsMatch && isValidWorkspace(itemsMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(itemRowsHtml(itemsMatch[1]));
      }
      const newMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/new$/);
      if (newMatch && isValidWorkspace(newMatch[1]) && loadWorkspaces()[newMatch[1]].kind === 'files') {
        const key = newMatch[1];
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(editorFormHtml(key, '', (ITEM_TEMPLATES[key] || ITEM_TEMPLATES.docs)('my-' + loadWorkspaces()[key].noun), true));
      }
      const editMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/edit\/([a-zA-Z0-9_%.-]+)$/);
      if (editMatch && isValidWorkspace(editMatch[1])) {
        const key = editMatch[1];
        const name = decodeURIComponent(editMatch[2]);
        if (!NAME_RE.test(name)) { res.writeHead(400); return res.end('bad name'); }
        const file = itemFile(key, name);
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(editorFormHtml(key, name, fs.readFileSync(file, 'utf8'), false));
      }
      const aiFormMatch = pathname.match(/^\/fragments\/(agents|skills|prompts)\/ai-form$/);
      if (aiFormMatch) {
        const key = aiFormMatch[1];
        const meta = loadWorkspaces()[key];
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Generate a ${esc(meta.noun)} with AI</h3>
            <form hx-post="/actions/generate-item" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="${esc(key)}">
              <input class="uk-input uk-margin-small-bottom" name="name" placeholder="${esc(meta.noun)}-name" required pattern="[a-zA-Z0-9_-]+">
              <textarea class="uk-textarea" name="description" rows="4" placeholder="Describe what this ${esc(meta.noun)} should do — e.g. 'reviews cmd-*.sh scripts for DDEV-only compliance and reports violations'" required></textarea>
              <div class="uk-margin-small-top">
                <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: bolt; ratio: .8"></span> Generate</button>
              </div>
            </form>
          </div>`);
      }
      if (pathname === '/fragments/docs/screenshot-form') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Screenshot a site → docs/&lt;name&gt;.png</h3>
            <form class="uk-grid uk-grid-small" uk-grid hx-post="/actions/screenshot" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="docs">
              <div class="uk-width-1-3@s"><input class="uk-input" name="name" placeholder="shot-name" required pattern="[a-zA-Z0-9_-]+"></div>
              <div class="uk-width-1-2@s"><input class="uk-input" name="url" placeholder="https://mysite.ddev.site" required></div>
              <div class="uk-width-1-6@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Capture</button></div>
            </form>
          </div>`);
      }
      if (pathname === '/fragments/docs/site-doc-form') {
        const wsOptions = Object.values(loadWorkspaces())
          .filter((w) => w.kind !== 'files')
          .map((w) => `<option value="${esc(w.key)}">${esc(w.label)}</option>`).join('');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
            <h3 class="uk-margin-small-bottom">Generate site documentation (AI → Markdown + PDF)</h3>
            <form class="uk-grid uk-grid-small" uk-grid hx-post="/actions/generate-doc" hx-target="#webship-workspace-output" hx-swap="innerHTML">
              <input type="hidden" name="workspace" value="docs">
              <div class="uk-width-1-4@s"><select class="uk-select" name="sourceWorkspace">${wsOptions}</select></div>
              <div class="uk-width-1-4@s"><input class="uk-input" name="projectName" placeholder="site/project name" required pattern="[a-zA-Z0-9_-]+"></div>
              <div class="uk-width-1-4@s"><input class="uk-input" name="docName" placeholder="doc-name" required pattern="[a-zA-Z0-9_-]+"></div>
              <div class="uk-width-1-4@s"><button type="submit" class="uk-button uk-button-primary uk-width-1-1">Generate</button></div>
            </form>
          </div>`);
      }
      const fileMatch = pathname.match(/^\/files\/([a-z0-9_-]+)\/([a-zA-Z0-9_%.-]+)$/);
      if (fileMatch && isValidWorkspace(fileMatch[1])) {
        const name = decodeURIComponent(fileMatch[2]);
        if (name.includes('..') || name.includes('/')) { res.writeHead(400); return res.end('bad name'); }
        const file = path.join(workspaceDir(fileMatch[1]), name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = { '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png',
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
          '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        // A <video> seeks by asking for a byte range. Answering the whole file with a 200 makes the
        // browser download all of it before the first frame and disables scrubbing entirely, so a
        // range request gets the 206 it asked for.
        const range = VIDEO_RE.test(file) ? req.headers.range : undefined;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (m) {
            let start = m[1] === '' ? null : parseInt(m[1], 10);
            let end = m[2] === '' ? null : parseInt(m[2], 10);
            if (start === null) { start = Math.max(0, size - (end || 0)); end = size - 1; }
            if (end === null || end >= size) end = size - 1;
            if (Number.isNaN(start) || start > end || start >= size) {
              res.writeHead(416, { 'Content-Range': `bytes */${size}` });
              return res.end();
            }
            res.writeHead(206, {
              'Content-Type': type,
              'Content-Length': end - start + 1,
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes',
            });
            return fs.createReadStream(file, { start, end }).pipe(res);
          }
        }
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': size,
          'Content-Disposition': 'inline',
          ...(VIDEO_RE.test(file) ? { 'Accept-Ranges': 'bytes' } : {}),
        });
        return fs.createReadStream(file).pipe(res);
      }
      const playMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/play\/([a-zA-Z0-9_%.-]+)$/);
      if (playMatch && isValidWorkspace(playMatch[1])) {
        const name = decodeURIComponent(playMatch[2]);
        if (!VIDEO_RE.test(name) || name.includes('..') || name.includes('/')) { res.writeHead(400); return res.end('bad name'); }
        const dir = workspaceDir(playMatch[1]);
        if (!fs.existsSync(path.join(dir, name))) { res.writeHead(404); return res.end('not found'); }
        // <stem>-poster.jpg is the convention, so the player shows a frame before it is played.
        const stem = name.replace(VIDEO_RE, '');
        const poster = ['-poster.jpg', '-poster.jpeg', '-poster.png']
          .map((s2) => `${stem}${s2}`).find((f) => fs.existsSync(path.join(dir, f)));
        const src = `/files/${playMatch[1]}/${encodeURIComponent(name)}`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div class="msg assistant">
            <p><span uk-icon="icon: play-circle; ratio: .8"></span> <strong>${esc(name)}</strong></p>
            <video class="uk-width-1-1" controls preload="metadata"${poster ? ` poster="/files/${playMatch[1]}/${encodeURIComponent(poster)}"` : ''} src="${src}"></video>
          </div>`);
      }

      if (pathname === '/settings' || pathname.startsWith('/settings/')) {
        const wanted = decodeURIComponent(pathname.slice('/settings/'.length) || '');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(settingsPage(SETTINGS_FILE_RE.test(wanted) ? wanted : ''));
      }

      const testsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/tests\/([a-zA-Z0-9_.-]+)$/);
      if (testsMatch && isValidWorkspace(testsMatch[1])) {
        const project = decodeURIComponent(testsMatch[2]);
        if (!NAME_RE.test(project) || !listProjects(workspaceDir(testsMatch[1])).includes(project)) {
          res.writeHead(404); return res.end('not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(testRunHtml(testsMatch[1], project));
      }

      // One artifact out of a project's tests/ directory. Everything is resolved and then checked
      // to be inside that directory, so a crafted path cannot walk out of it.
      const projFileMatch = pathname.match(/^\/project-files\/([a-z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/(.+)$/);
      if (projFileMatch && isValidWorkspace(projFileMatch[1])) {
        const [, key, project, relRaw] = projFileMatch;
        if (!NAME_RE.test(project) || !listProjects(workspaceDir(key)).includes(project)) {
          res.writeHead(404); return res.end('not found');
        }
        const testsRoot = path.resolve(workspaceDir(key), project, 'tests');
        const file = path.resolve(testsRoot, decodeURIComponent(relRaw).replace(/^tests\//, ''));
        if (file !== testsRoot && !file.startsWith(testsRoot + path.sep)) { res.writeHead(400); return res.end('bad path'); }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.json': 'application/json',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf',
          '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg',
          '.mov': 'video/quicktime' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const size = fs.statSync(file).size;
        // A recording is seeked with a range request; answering the whole file with a 200 makes
        // the browser fetch all of it before the first frame and disables scrubbing.
        const range = VIDEO_RE.test(file) ? req.headers.range : undefined;
        const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
          let start = m[1] === '' ? null : parseInt(m[1], 10);
          let end = m[2] === '' ? null : parseInt(m[2], 10);
          if (start === null) { start = Math.max(0, size - (end || 0)); end = size - 1; }
          if (end === null || end >= size) end = size - 1;
          if (Number.isNaN(start) || start > end || start >= size) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end();
          }
          res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': size,
          ...(VIDEO_RE.test(file) ? { 'Accept-Ranges': 'bytes' } : {}) });
        return fs.createReadStream(file).pipe(res);
      }

      const argsMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/builder-args$/);
      if (argsMatch && isValidWorkspace(argsMatch[1])) {
        const script = new URL(req.url, 'http://localhost').searchParams.get('script') || '';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(builderArgsHtml(argsMatch[1], script));
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

    // deep-chat speaks JSON, not form-encoded HTMX fragments, so it gets its own route rather
    // than going through handleAction: it posts { messages: [...] } and expects a Response object
    // back ({ html }), with anything else in the JSON left for our own responseInterceptor.
    if (req.method === 'POST' && pathname === '/actions/deep-chat') {
      let raw = '';
      req.on('data', (d) => { raw += d; if (raw.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        const json = (o, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(o));
        };
        try {
          const parsed = JSON.parse(raw || '{}');
          const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
          // Only the newest user turn is the ask; deep-chat keeps the transcript for display.
          const last = [...messages].reverse().find((m) => m.role !== 'ai');
          const message = String((last && (last.text || last.message)) || '').trim();
          if (!message) return json({ error: 'Empty message.' }, 400);
          audit('/actions/chat', { workspace: '-', projectName: message.slice(0, 120) });
          const { replyHtml, directive } = await assistantReply(message, String(parsed.context || ''));
          // `html` is deep-chat's own field; `directive` is ours, read by the response interceptor.
          return json({ html: `<div class="dc-reply">${replyHtml}</div>`, directive });
        } catch (err) {
          return json({ error: err.message || 'Assistant failed.' }, 500);
        }
      });
      return;
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
