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

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/vendor/uikit.min.css">
<link rel="stylesheet" href="/style.css">
<script src="/vendor/uikit.min.js"></script>
<script src="/vendor/uikit-icons.min.js"></script>
<script src="/htmx.min.js"></script>
<script src="/ui.js" defer></script>
</head>
<body class="uk-background-muted">
${body}
<footer class="uk-section uk-section-xsmall uk-text-center uk-text-meta">
  webship/workspace · DDEV-only tooling · <a href="/">workspace.ddev.site</a>
</footer>
</body>
</html>`;
}

// The AI assistant panel — included on EVERY page. `floating` renders it as
// the bottom-right widget with a 🤖 launcher; inline renders it in the flow.
function assistantHtml({ floating }) {
  const panel = `
    <div class="uk-card uk-card-default uk-card-body assistant-panel">
      <div class="uk-flex uk-flex-between uk-flex-middle uk-margin-small-bottom">
        <h3 class="uk-card-title uk-margin-remove">🤖 workspace AI Assistant</h3>
        <span class="uk-label uk-label-success">DDEV Mode ✓</span>
      </div>
      <p class="uk-text-meta uk-margin-small">Ask me anything about workspace, DDEV, or Drupal development tasks!</p>
      <div class="uk-margin-small quick-actions">
        <form hx-post="/actions/quick-build" hx-target="#chat-log" hx-swap="beforeend" class="qa-form uk-flex uk-flex-middle">
          <input type="hidden" name="script" value="cmd-drupal11-0-x-recommended-project.sh">
          <input type="hidden" name="flags" value="--install">
          <input type="text" name="projectName" placeholder="name…" class="uk-input uk-form-small uk-form-width-small qa-name" required pattern="[a-zA-Z0-9_-]+">
          <button type="submit" class="uk-button uk-button-primary uk-button-small"><span uk-icon="icon: plus; ratio: .7"></span> New Drupal 11</button>
        </form>
        <form hx-post="/actions/quick-build" hx-target="#chat-log" hx-swap="beforeend" class="qa-form uk-flex uk-flex-middle">
          <input type="hidden" name="script" value="cmd-varbase10-1-x-project.sh">
          <input type="hidden" name="flags" value="--install --add-users">
          <input type="text" name="projectName" placeholder="name…" class="uk-input uk-form-small uk-form-width-small qa-name" required pattern="[a-zA-Z0-9_-]+">
          <button type="submit" class="uk-button uk-button-primary uk-button-small"><span uk-icon="icon: bolt; ratio: .7"></span> New Varbase</button>
        </form>
        <button class="uk-button uk-button-default uk-button-small" hx-get="/actions/status" hx-target="#chat-log" hx-swap="beforeend"><span uk-icon="icon: heart; ratio: .7"></span> Status</button>
      </div>
      <div class="uk-background-muted uk-padding-small uk-panel-scrollable chat-log" id="chat-log">
        <div class="msg assistant">
          <p><strong>Hi!</strong> I can help you:</p>
          <ul class="uk-list uk-list-bullet uk-margin-remove">
            <li>Show you all available commands in any workspace</li>
            <li>Give step-by-step instructions with code examples</li>
          </ul>
          <p>💡 <strong>Try these examples:</strong></p>
          <ul class="uk-list uk-list-bullet uk-margin-remove">
            <li>"Create a new Varbase project"</li>
            <li>"Show me all available commands"</li>
            <li>"What's the system status?"</li>
          </ul>
        </div>
      </div>
      <form class="uk-flex uk-margin-small-top chat-input"
            hx-post="/actions/chat" hx-target="#chat-log" hx-swap="beforeend"
            hx-on::after-request="this.reset()">
        <input type="text" name="message" class="uk-input" placeholder="Ask me anything about workspace, DDEV, or Drupal..." autocomplete="off" required>
        <button type="submit" class="uk-button uk-button-primary uk-margin-small-left"><span uk-icon="icon: comment; ratio: .8"></span> Send</button>
      </form>
    </div>`;

  if (floating) {
    return `
      <div class="assistant-float" id="assistant-float">${panel}</div>
      <button class="assistant-launcher uk-button uk-button-primary" onclick="document.getElementById('assistant-float').classList.toggle('open')" title="workspace AI Assistant">🤖</button>`;
  }
  return panel;
}

/* ---------------- pages ---------------- */

function homePage() {
  const workspaces = loadWorkspaces();
  const cards = Object.values(workspaces).map((w) => {
    const projectCount = listProjects(w.dir).length;
    const hasBuilders = findBuilderScripts(w.dir).length > 0;
    return `
      <div>
        <a class="uk-card uk-card-default uk-card-hover uk-card-body uk-card-small uk-text-center uk-display-block uk-link-reset workspace-card" href="/${esc(w.key)}">
          <div class="icon"><span uk-icon="icon: ${w.icon}; ratio: 1.4" class="uk-text-primary"></span></div>
          <h4 class="uk-card-title uk-margin-remove uk-text-bold">${esc(w.label)}</h4>
          <p class="uk-text-meta uk-margin-remove">${esc(w.subtitle)}</p>
          <span class="uk-label ${hasBuilders ? 'uk-label-success' : ''} uk-margin-small-top">${projectCount} project${projectCount === 1 ? '' : 's'}${hasBuilders ? ' · buildable' : ''}</span>
        </a>
      </div>`;
  }).join('');

  return pageShell('workspace', `
<header class="uk-section uk-section-small uk-text-center hero">
  <div class="uk-container">
    <div class="logo"><span uk-icon="icon: settings; ratio: 2.2"></span></div>
    <h1 class="uk-heading-medium uk-margin-small-top uk-margin-small-bottom">workspace</h1>
    <p class="uk-text-lead uk-width-2-3@m uk-margin-auto">
      The <strong>workspace</strong> management system helps developers manage the base code
      development work cycle for custom distributions and starter kit templates —
      on your Linux development computer or servers with DDEV/Docker.
    </p>
    <div class="uk-margin-top">
      <a class="uk-button uk-button-default uk-border-pill uk-margin-small-right" href="https://github.com/webship/workspace" target="_blank"><span uk-icon="file-text"></span> Complete README</a>
      <button class="uk-button uk-button-default uk-border-pill" hx-get="/actions/status" hx-target="#chat-log" hx-swap="beforeend"><span uk-icon="heart"></span> Health Check</button>
    </div>
  </div>
</header>

<main class="uk-container uk-container-large uk-margin-bottom">
  <div class="uk-grid uk-grid-medium uk-flex-top" uk-grid>
    <div class="uk-width-2-5@m">
      ${assistantHtml({ floating: false })}
    </div>
    <div class="uk-width-3-5@m">
      <div class="uk-card uk-card-default uk-card-body">
        <h2 class="uk-text-center uk-margin-remove-bottom">Workspaces</h2>
        <p class="uk-text-meta uk-text-center uk-margin-small-bottom">Browse and manage your development environments</p>
        <div class="uk-grid uk-grid-small uk-child-width-1-2@s" uk-grid>${cards}</div>
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

  return `
    <h3 class="uk-margin-small-bottom">Projects <span class="uk-badge">${projects.length}</span></h3>
    ${rows || '<p class="uk-text-meta">No projects yet.</p>'}`;
}

async function workspacePage(key) {
  const workspaces = loadWorkspaces();
  const meta = workspaces[key];
  const dir = meta.dir;
  const builders = findBuilderScripts(dir);
  const builderOptions = builders.map((s) => `<option value="${esc(s)}">${esc(builderLabel(dir, s))}</option>`).join('');

  return pageShell(`${meta.label} · workspace`, `
<header class="uk-section uk-section-small uk-text-center uk-position-relative hero">
  <div class="uk-position-top-left uk-position-small">
    <a class="uk-button uk-button-default uk-border-pill" href="/"><span uk-icon="arrow-left"></span> All workspaces</a>
  </div>
  <div class="uk-container">
    <div class="logo logo-sm"><span uk-icon="icon: ${meta.icon}; ratio: 1.8"></span></div>
    <h1 class="uk-heading-small uk-margin-small-top uk-margin-remove-bottom uk-text-capitalize">${esc(meta.label)}</h1>
    <p class="uk-text-lead uk-margin-small-top">${esc(meta.subtitle)}</p>
  </div>
</header>

<main class="uk-container uk-container-small uk-margin-bottom webship-workspace-page">
  <div class="uk-card uk-card-default uk-card-body">
    ${builders.length ? `
      <h3 class="uk-margin-small-bottom">Build a new project</h3>
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

    <div id="webship-workspace-output"></div>
  </div>
</main>

${assistantHtml({ floating: true })}`);
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

async function handleAction(pathname, form, res) {
  const send = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };

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
    const result = await run('bash', [script, projectName, ...flags], dir);
    return send(resultFragment(result, `🏗️ Build <strong>${esc(projectName)}</strong> (${esc(script)}) ${result.ok ? 'finished' : 'failed'}.`));
  }

  if (pathname === '/actions/backup') {
    const dir = workspaceDir(workspace);
    const script = findBackupScript(dir);
    if (!script) return send('<div class="msg error">No backup script in this workspace.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const result = await run('bash', [script, form.projectName], dir);
    return send(resultFragment(result, `💾 Backup <strong>${esc(form.projectName)}</strong> ${result.ok ? 'finished' : 'failed'}.`));
  }

  if (pathname === '/actions/remove') {
    const dir = workspaceDir(workspace);
    const script = findRemoveScript(dir);
    if (!script) return send('<div class="msg error">No remove script in this workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Destructive action requires confirmation.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const result = await run('bash', [script, form.projectName], dir);
    // HX-Trigger tells the page to refresh its project list.
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(resultFragment(result, `🗑️ Remove <strong>${esc(form.projectName)}</strong> ${result.ok ? 'finished' : 'failed'}.`));
  }

  if (pathname === '/actions/ddev-start' || pathname === '/actions/ddev-stop') {
    const projectName = String(form.projectName || '');
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const projectDir = path.join(workspaceDir(workspace), projectName);
    if (!ddevProjectName(projectDir)) return send('<div class="msg error">Not a DDEV project.</div>', 400);
    const verb = pathname === '/actions/ddev-start' ? 'start' : 'stop';
    const result = await run('ddev', [verb, '-y'], projectDir, { timeoutMs: 5 * 60 * 1000 });
    const stripped = { ...result, stdout: result.stdout.replace(/\x1b\[[0-9;]*m/g, ''), stderr: result.stderr.replace(/\x1b\[[0-9;]*m/g, '') };
    // Refresh the project list so status badges + Start/Stop/Launch buttons update.
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(resultFragment(stripped, `${verb === 'start' ? '▶️' : '⏹️'} <code>ddev ${verb}</code> on <strong>${esc(projectName)}</strong> ${result.ok ? 'finished' : 'failed'}.`));
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
    const userHtml = `<div class="msg user">${esc(message)}</div>`;
    const args = [
      '-p', message,
      '--output-format', 'json',
      '--permission-mode', 'plan',
      '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Agent',
      '--no-session-persistence',
    ];
    const result = await run('claude', args, ROOT, { timeoutMs: 120 * 1000 });
    let reply = result.stdout.trim();
    try {
      const parsed = JSON.parse(result.stdout);
      reply = parsed.result || parsed.response || reply;
    } catch (_) { /* raw text fallback */ }
    if (!reply) reply = result.stderr.trim() || 'No response from the assistant.';
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
      const fragMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/projects$/);
      if (fragMatch && isValidWorkspace(fragMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await projectRowsHtml(fragMatch[1], workspaceDir(fragMatch[1])));
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
